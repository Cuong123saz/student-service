CREATE TABLE "personal_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"recipient_kind" varchar(20) NOT NULL,
	"submission_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "personal_notifications_kind_check" CHECK ("personal_notifications"."recipient_kind" IN ('OWNER','REVIEWER'))
);
--> statement-breakpoint
ALTER TABLE "submission_events" DROP CONSTRAINT "submission_events_shape_check";--> statement-breakpoint
ALTER TABLE "submission_events" ADD COLUMN "from_reviewer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "submission_events" ADD COLUMN "to_reviewer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "submission_events" ADD COLUMN "from_reviewer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "submission_events" ADD COLUMN "to_reviewer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "personal_notifications" ADD CONSTRAINT "personal_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_notifications" ADD CONSTRAINT "personal_notifications_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_events_id_submission_unique" ON "submission_events" USING btree ("id","submission_id");--> statement-breakpoint
ALTER TABLE "personal_notifications" ADD CONSTRAINT "personal_notifications_event_submission_fk" FOREIGN KEY ("event_id","submission_id") REFERENCES "public"."submission_events"("id","submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_notifications_event_recipient_unique" ON "personal_notifications" USING btree ("event_id","recipient_user_id","recipient_kind");--> statement-breakpoint
CREATE INDEX "personal_notifications_recipient_created_idx" ON "personal_notifications" USING btree ("recipient_user_id","created_at","id");--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_from_reviewer_user_id_users_id_fk" FOREIGN KEY ("from_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_to_reviewer_user_id_users_id_fk" FOREIGN KEY ("to_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_shape_check" CHECK ("submission_events"."from_revision" > 0 AND "submission_events"."to_revision" = "submission_events"."from_revision" + 1 AND "submission_events"."action" IN ('SUBMITTED','CLAIMED','SUPPLEMENT_REQUESTED','RESUBMITTED','APPROVED','REJECTED','REASSIGNED') AND (("submission_events"."action" IN ('SUPPLEMENT_REQUESTED','APPROVED','REJECTED','REASSIGNED') AND "submission_events"."note" IS NOT NULL AND char_length(btrim("submission_events"."note")) BETWEEN 1 AND 2000) OR ("submission_events"."action" IN ('SUBMITTED','CLAIMED','RESUBMITTED') AND "submission_events"."note" IS NULL)) AND (("submission_events"."action" = 'REASSIGNED' AND "submission_events"."from_reviewer_user_id" IS NOT NULL AND "submission_events"."to_reviewer_user_id" IS NOT NULL AND "submission_events"."from_reviewer_user_id" <> "submission_events"."to_reviewer_user_id" AND "submission_events"."from_reviewer_name" IS NOT NULL AND char_length(btrim("submission_events"."from_reviewer_name")) > 0 AND "submission_events"."to_reviewer_name" IS NOT NULL AND char_length(btrim("submission_events"."to_reviewer_name")) > 0) OR ("submission_events"."action" <> 'REASSIGNED' AND "submission_events"."from_reviewer_user_id" IS NULL AND "submission_events"."to_reviewer_user_id" IS NULL AND "submission_events"."from_reviewer_name" IS NULL AND "submission_events"."to_reviewer_name" IS NULL)));
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
  IF OLD.status IN ('IN_REVIEW','NEEDS_SUPPLEMENT') AND NEW.status = OLD.status
     AND NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id THEN
    IF NEW.revision <> OLD.revision + 1 OR NEW.reviewer_user_id IS NULL
       OR (to_jsonb(NEW) - 'reviewer_user_id' - 'revision' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'reviewer_user_id' - 'revision' - 'updated_at') THEN
      RAISE EXCEPTION 'Reassignment may only replace the current reviewer' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
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
CREATE FUNCTION protect_personal_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notifications cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at')
     OR (NEW.read_at IS DISTINCT FROM OLD.read_at AND (OLD.read_at IS NOT NULL OR NEW.read_at IS NULL)) THEN
    RAISE EXCEPTION 'Only marking a notification read is allowed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER personal_notifications_immutable BEFORE UPDATE OR DELETE ON personal_notifications FOR EACH ROW EXECUTE FUNCTION protect_personal_notification();
--> statement-breakpoint
INSERT INTO permissions (code,name,description,is_system)
VALUES ('submission.assign','Bàn giao hồ sơ','Phân công lại cán bộ xử lý hồ sơ',true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN' AND p.code='submission.assign'
ON CONFLICT (role_id,permission_id) DO NOTHING;
