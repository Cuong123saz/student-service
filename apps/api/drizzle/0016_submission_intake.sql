ALTER TABLE "submissions" DROP CONSTRAINT "submissions_draft_check";--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processing_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "designated_reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "student_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "reviewer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_processing_unit_id_organizational_units_id_fk" FOREIGN KEY ("processing_unit_id") REFERENCES "public"."organizational_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_designated_reviewer_id_users_id_fk" FOREIGN KEY ("designated_reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_intake_idx" ON "submissions" USING btree ("processing_unit_id","submitted_at");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_state_check" CHECK (
      "submissions"."revision" > 0 AND (
        ("submissions"."status" = 'DRAFT' AND "submissions"."submitted_at" IS NULL AND "submissions"."processing_unit_id" IS NULL AND "submissions"."designated_reviewer_id" IS NULL AND "submissions"."student_snapshot" IS NULL AND "submissions"."reviewer_user_id" IS NULL AND "submissions"."review_started_at" IS NULL)
        OR
        ("submissions"."status" = 'SUBMITTED' AND "submissions"."submitted_at" IS NOT NULL AND "submissions"."processing_unit_id" IS NOT NULL AND "submissions"."student_snapshot" IS NOT NULL AND "submissions"."reviewer_user_id" IS NULL AND "submissions"."review_started_at" IS NULL)
        OR
        ("submissions"."status" = 'IN_REVIEW' AND "submissions"."submitted_at" IS NOT NULL AND "submissions"."processing_unit_id" IS NOT NULL AND "submissions"."student_snapshot" IS NOT NULL AND "submissions"."reviewer_user_id" IS NOT NULL AND "submissions"."review_started_at" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_snapshot_check" CHECK ("submissions"."student_snapshot" IS NULL OR jsonb_typeof("submissions"."student_snapshot") = 'object');
--> statement-breakpoint
CREATE FUNCTION protect_submitted_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Submitted content cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF ROW(NEW.id, NEW.student_user_id, NEW.service_id, NEW.procedure_version_id,
           NEW.service_name, NEW.procedure, NEW.values, NEW.created_at, NEW.submitted_at,
           NEW.processing_unit_id, NEW.designated_reviewer_id, NEW.student_snapshot)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.student_user_id, OLD.service_id, OLD.procedure_version_id,
           OLD.service_name, OLD.procedure, OLD.values, OLD.created_at, OLD.submitted_at,
           OLD.processing_unit_id, OLD.designated_reviewer_id, OLD.student_snapshot) THEN
      RAISE EXCEPTION 'Submitted content is immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT (OLD.status = 'SUBMITTED' AND NEW.status = 'IN_REVIEW'
            AND NEW.reviewer_user_id IS NOT NULL AND NEW.review_started_at IS NOT NULL
            AND NEW.reviewer_user_id <> NEW.student_user_id
            AND (NEW.designated_reviewer_id IS NULL OR NEW.designated_reviewer_id = NEW.reviewer_user_id)
            AND NEW.revision = OLD.revision + 1) THEN
      RAISE EXCEPTION 'Invalid submitted state transition' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status <> 'DRAFT' THEN
    IF ROW(NEW.id, NEW.student_user_id, NEW.service_id, NEW.procedure_version_id,
           NEW.service_name, NEW.procedure, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.student_user_id, OLD.service_id, OLD.procedure_version_id,
           OLD.service_name, OLD.procedure, OLD.created_at) THEN
      RAISE EXCEPTION 'Submission binding cannot change during submit' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'SUBMITTED' OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Invalid draft state transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER submissions_immutable_content BEFORE UPDATE OR DELETE ON submissions
FOR EACH ROW EXECUTE FUNCTION protect_submitted_content();
--> statement-breakpoint
CREATE FUNCTION protect_submitted_files() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_status varchar(20);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'Evidence cannot be transferred between submissions' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN parent_id := OLD.submission_id;
  ELSE parent_id := NEW.submission_id;
  END IF;
  -- Serialize even direct SQL file mutations with submit's parent row lock.
  SELECT status INTO parent_status FROM submissions WHERE id = parent_id FOR UPDATE;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Submitted evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER submission_files_immutable_content BEFORE INSERT OR UPDATE OR DELETE ON submission_files
FOR EACH ROW EXECUTE FUNCTION protect_submitted_files();
