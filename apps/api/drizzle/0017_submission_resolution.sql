CREATE TABLE "submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	CONSTRAINT "submission_events_shape_check" CHECK ("submission_events"."from_revision" > 0 AND "submission_events"."to_revision" = "submission_events"."from_revision" + 1 AND "submission_events"."action" IN ('SUBMITTED','CLAIMED','SUPPLEMENT_REQUESTED','RESUBMITTED','APPROVED','REJECTED') AND (("submission_events"."action" IN ('SUPPLEMENT_REQUESTED','APPROVED','REJECTED') AND "submission_events"."note" IS NOT NULL AND char_length(btrim("submission_events"."note")) BETWEEN 1 AND 2000) OR ("submission_events"."action" IN ('SUBMITTED','CLAIMED','RESUBMITTED') AND "submission_events"."note" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "submission_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"student_snapshot" jsonb NOT NULL,
	"values" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"source" varchar(20) NOT NULL,
	CONSTRAINT "submission_rounds_shape_check" CHECK ("submission_rounds"."round_number" > 0 AND "submission_rounds"."source" IN ('LIVE','MIGRATION') AND jsonb_typeof("submission_rounds"."values") = 'object' AND jsonb_typeof("submission_rounds"."student_snapshot") = 'object' AND jsonb_typeof("submission_rounds"."files") = 'array')
);
--> statement-breakpoint
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_state_check";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "round_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "last_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_rounds" ADD CONSTRAINT "submission_rounds_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_events_revision_unique" ON "submission_events" USING btree ("submission_id","from_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_rounds_number_unique" ON "submission_rounds" USING btree ("submission_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_rounds_id_submission_unique" ON "submission_rounds" USING btree ("id","submission_id");--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_round_submission_fk" FOREIGN KEY ("round_id","submission_id") REFERENCES "public"."submission_rounds"("id","submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP TRIGGER submissions_immutable_content ON submissions;
--> statement-breakpoint
UPDATE submissions SET round_number = 1, last_submitted_at = submitted_at WHERE status <> 'DRAFT';
--> statement-breakpoint
INSERT INTO submission_rounds (submission_id, round_number, submitted_at, student_snapshot, values, files, source)
SELECT s.id, 1, s.submitted_at, s.student_snapshot, s.values,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'attachmentKey', f.attachment_key, 'name', f.name, 'mimeType', f.mime_type, 'size', f.size, 'sha256', f.sha256, 'signatureStatus', f.signature_status, 'storageKey', f.storage_key) ORDER BY f.created_at, f.id) FROM submission_files f WHERE f.submission_id = s.id AND f.removed_at IS NULL), '[]'::jsonb),
       'MIGRATION'
FROM submissions s WHERE s.status <> 'DRAFT';
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_state_check" CHECK (
      "submissions"."revision" > 0 AND (
        ("submissions"."status" = 'DRAFT' AND "submissions"."round_number" = 0 AND "submissions"."last_submitted_at" IS NULL AND "submissions"."decision_at" IS NULL AND "submissions"."submitted_at" IS NULL AND "submissions"."processing_unit_id" IS NULL AND "submissions"."designated_reviewer_id" IS NULL AND "submissions"."student_snapshot" IS NULL AND "submissions"."reviewer_user_id" IS NULL AND "submissions"."review_started_at" IS NULL)
        OR
        ("submissions"."status" = 'SUBMITTED' AND "submissions"."round_number" > 0 AND "submissions"."last_submitted_at" IS NOT NULL AND "submissions"."decision_at" IS NULL AND "submissions"."submitted_at" IS NOT NULL AND "submissions"."processing_unit_id" IS NOT NULL AND "submissions"."student_snapshot" IS NOT NULL AND "submissions"."reviewer_user_id" IS NULL AND "submissions"."review_started_at" IS NULL)
        OR
        ("submissions"."status" IN ('IN_REVIEW', 'NEEDS_SUPPLEMENT', 'APPROVED', 'REJECTED') AND "submissions"."round_number" > 0 AND "submissions"."last_submitted_at" IS NOT NULL AND "submissions"."submitted_at" IS NOT NULL AND "submissions"."processing_unit_id" IS NOT NULL AND "submissions"."student_snapshot" IS NOT NULL AND "submissions"."reviewer_user_id" IS NOT NULL AND "submissions"."reviewer_user_id" <> "submissions"."student_user_id" AND "submissions"."review_started_at" IS NOT NULL AND (("submissions"."status" IN ('APPROVED','REJECTED') AND "submissions"."decision_at" IS NOT NULL) OR ("submissions"."status" IN ('IN_REVIEW','NEEDS_SUPPLEMENT') AND "submissions"."decision_at" IS NULL)))
      ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_submitted_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted content cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.student_user_id, NEW.service_id, NEW.procedure_version_id,
         NEW.service_name, NEW.procedure, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.student_user_id, OLD.service_id, OLD.procedure_version_id,
         OLD.service_name, OLD.procedure, OLD.created_at) THEN
    RAISE EXCEPTION 'Submission binding is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status = 'DRAFT' THEN RETURN NEW; END IF;
    IF NEW.status <> 'SUBMITTED' OR NEW.revision <> OLD.revision + 1 OR NEW.round_number <> 1 OR NEW.last_submitted_at IS DISTINCT FROM NEW.submitted_at THEN
      RAISE EXCEPTION 'Invalid initial submission' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.submitted_at, NEW.processing_unit_id, NEW.designated_reviewer_id)
     IS DISTINCT FROM ROW(OLD.submitted_at, OLD.processing_unit_id, OLD.designated_reviewer_id) THEN
    RAISE EXCEPTION 'Submission routing is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'NEEDS_SUPPLEMENT' AND NEW.status IN ('NEEDS_SUPPLEMENT','IN_REVIEW') THEN
    IF ROW(NEW.reviewer_user_id, NEW.review_started_at, NEW.decision_at)
       IS DISTINCT FROM ROW(OLD.reviewer_user_id, OLD.review_started_at, OLD.decision_at) OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Invalid supplementary working copy' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'NEEDS_SUPPLEMENT' THEN
      IF ROW(NEW.round_number, NEW.last_submitted_at, NEW.student_snapshot)
         IS DISTINCT FROM ROW(OLD.round_number, OLD.last_submitted_at, OLD.student_snapshot) THEN
        RAISE EXCEPTION 'Submitted round is immutable' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.round_number <> OLD.round_number + 1 OR NEW.last_submitted_at < OLD.last_submitted_at THEN
      RAISE EXCEPTION 'Invalid resubmission round' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.values, NEW.student_snapshot, NEW.round_number, NEW.last_submitted_at)
     IS DISTINCT FROM ROW(OLD.values, OLD.student_snapshot, OLD.round_number, OLD.last_submitted_at) THEN
    RAISE EXCEPTION 'Submitted content is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Invalid submitted revision' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'SUBMITTED' AND NEW.status = 'IN_REVIEW' AND NEW.reviewer_user_id IS NOT NULL
     AND NEW.review_started_at IS NOT NULL AND NEW.reviewer_user_id <> NEW.student_user_id
     AND (NEW.designated_reviewer_id IS NULL OR NEW.designated_reviewer_id = NEW.reviewer_user_id)
     AND NEW.decision_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'IN_REVIEW' AND NEW.status IN ('NEEDS_SUPPLEMENT','APPROVED','REJECTED')
     AND ROW(NEW.reviewer_user_id, NEW.review_started_at) IS NOT DISTINCT FROM ROW(OLD.reviewer_user_id, OLD.review_started_at)
     AND ((NEW.status = 'NEEDS_SUPPLEMENT' AND NEW.decision_at IS NULL) OR (NEW.status IN ('APPROVED','REJECTED') AND NEW.decision_at IS NOT NULL)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Invalid submitted state transition' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER submissions_immutable_content BEFORE UPDATE OR DELETE ON submissions FOR EACH ROW EXECUTE FUNCTION protect_submitted_content();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_submitted_files() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status varchar(20); historical boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN parent_id := OLD.submission_id; ELSE parent_id := NEW.submission_id; END IF;
  SELECT status INTO parent_status FROM submissions WHERE id = parent_id FOR UPDATE;
  IF parent_status NOT IN ('DRAFT','NEEDS_SUPPLEMENT') THEN
    RAISE EXCEPTION 'Submitted evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'removed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'removed_at')
       OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL THEN
      RAISE EXCEPTION 'Only soft removal of working evidence is allowed' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF parent_status = 'NEEDS_SUPPLEMENT' THEN
      RAISE EXCEPTION 'Working evidence can only be soft-removed' USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (SELECT 1 FROM submission_rounds r WHERE r.submission_id = OLD.submission_id AND r.files @> jsonb_build_array(jsonb_build_object('id', OLD.id))) INTO historical;
    IF historical THEN RAISE EXCEPTION 'Historical evidence cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  ELSIF NEW.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'New evidence must be linked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION protect_submission_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submission history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER submission_rounds_immutable BEFORE UPDATE OR DELETE ON submission_rounds FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
--> statement-breakpoint
CREATE TRIGGER submission_events_immutable BEFORE UPDATE OR DELETE ON submission_events FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
