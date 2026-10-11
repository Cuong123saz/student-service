CREATE TABLE "submission_document_retries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempts" integer NOT NULL,
	"allowance" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason_code" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_retries_shape_check" CHECK (("submission_document_retries"."allowance" >= 1 AND "submission_document_retries"."allowance" <= 3 AND "submission_document_retries"."attempts" = 2 + "submission_document_retries"."allowance"
    AND "submission_document_retries"."reason_code" IN ('RENDERER_FIXED','CONVERTER_FIXED','STORAGE_FIXED','WORKER_RESTARTED')) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "submission_document_jobs" DROP CONSTRAINT "document_jobs_shape_check";--> statement-breakpoint
ALTER TABLE "submission_document_jobs" ADD COLUMN "retry_allowance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_document_retries" ADD CONSTRAINT "submission_document_retries_job_id_submission_document_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."submission_document_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_document_retries" ADD CONSTRAINT "submission_document_retries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_retries_job_attempt_unique" ON "submission_document_retries" USING btree ("job_id","attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_retries_job_allowance_unique" ON "submission_document_retries" USING btree ("job_id","allowance");--> statement-breakpoint
ALTER TABLE "submission_document_jobs" ADD CONSTRAINT "document_jobs_shape_check" CHECK (("submission_document_jobs"."format" IN ('DOCX','PDF') AND "submission_document_jobs"."retry_allowance" BETWEEN 0 AND 3 AND "submission_document_jobs"."attempts" BETWEEN 0 AND 3 + "submission_document_jobs"."retry_allowance" AND (
    ("submission_document_jobs"."state" = 'PENDING' AND "submission_document_jobs"."attempts" = 0 AND "submission_document_jobs"."attempt_id" IS NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL) OR
    ("submission_document_jobs"."state" = 'RUNNING' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NOT NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL) OR
    ("submission_document_jobs"."state" = 'RETRYABLE' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL AND "submission_document_jobs"."error_code" IN ('RENDER_FAILED','CONVERT_FAILED','STORAGE_FAILED','LEASE_EXPIRED')) OR
    ("submission_document_jobs"."state" = 'COMPLETE' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NOT NULL))) IS TRUE);
--> statement-breakpoint
-- ADR0011 was committed before this migration. Existing attempts and artifacts are retained.
INSERT INTO permissions(code,name,description) VALUES('document.retry','Mở thêm lượt tạo tài liệu','Mở một lượt kỹ thuật sau khi kiểm tra lỗi, trong phạm vi hồ sơ được giao') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SYSTEM_ADMIN' AND p.code='document.retry'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_document_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document jobs cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.attempts <> 0 OR NEW.retry_allowance <> 0 THEN
      RAISE EXCEPTION 'Document jobs start pending' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.set_id,NEW.format,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.set_id,OLD.format,OLD.created_at) OR OLD.state='COMPLETE' THEN
    RAISE EXCEPTION 'Document job binding is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.retry_allowance = OLD.retry_allowance + 1 AND OLD.state='RETRYABLE'
    AND OLD.attempts = 3 + OLD.retry_allowance AND OLD.retry_allowance < 3
    AND (to_jsonb(NEW) - 'retry_allowance' - 'next_attempt_at' - 'updated_at') =
        (to_jsonb(OLD) - 'retry_allowance' - 'next_attempt_at' - 'updated_at')
    AND NEW.next_attempt_at > clock_timestamp()
    AND EXISTS (SELECT 1 FROM submission_document_retries WHERE job_id=OLD.id AND attempt_id=OLD.attempt_id
      AND attempts=OLD.attempts AND allowance=NEW.retry_allowance) THEN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.retry_allowance IS DISTINCT FROM OLD.retry_allowance THEN
    RAISE EXCEPTION 'DOCUMENT_RETRY_AUTHORIZATION_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.state='RUNNING' AND (OLD.state IN ('PENDING','RETRYABLE') OR (OLD.state='RUNNING' AND OLD.lease_until <= clock_timestamp()))
    AND OLD.next_attempt_at <= clock_timestamp() AND OLD.attempts < 3 + OLD.retry_allowance AND NEW.attempts=OLD.attempts+1
    AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id AND NEW.lease_until > clock_timestamp()
    AND NEW.lease_until <= clock_timestamp()+interval '180 seconds' THEN
    IF NEW.format='PDF' AND NOT EXISTS(SELECT 1 FROM submission_documents WHERE set_id=NEW.set_id AND format='DOCX') THEN
      RAISE EXCEPTION 'DOCUMENT_WORD_REQUIRED' USING ERRCODE='P0001';
    END IF;
    valid := true;
  ELSIF OLD.state='RUNNING' AND NEW.state='RETRYABLE' AND NEW.attempts=OLD.attempts AND NEW.attempt_id=OLD.attempt_id THEN
    valid := true;
  ELSIF OLD.state='RUNNING' AND NEW.state='COMPLETE' AND OLD.lease_until > clock_timestamp()
    AND NEW.attempts=OLD.attempts AND NEW.attempt_id=OLD.attempt_id AND EXISTS (
      SELECT 1 FROM submission_documents WHERE id=NEW.published_document_id AND set_id=NEW.set_id
        AND format=NEW.format AND attempt_id=OLD.attempt_id) THEN
    valid := true;
  END IF;
  IF NOT valid THEN RAISE EXCEPTION 'INVALID_DOCUMENT_JOB_TRANSITION' USING ERRCODE='23514'; END IF;
  NEW.updated_at := clock_timestamp();
  IF NEW.state IN ('RUNNING','RETRYABLE') THEN
    INSERT INTO audit_logs(actor_type,action,resource_type,resource_id,outcome,metadata)
      VALUES('SYSTEM',CASE WHEN NEW.state='RUNNING' THEN 'document.job.claimed' ELSE 'document.job.failed' END,
        'submission_document_job',NEW.id::text,CASE WHEN NEW.state='RUNNING' THEN 'SUCCESS' ELSE 'FAILURE' END,
        jsonb_build_object('setId',NEW.set_id,'format',NEW.format,'attemptId',NEW.attempt_id,'attempts',NEW.attempts,'retryAllowance',NEW.retry_allowance,'code',NEW.error_code));
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION apply_document_retry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job submission_document_jobs%ROWTYPE;
DECLARE document_set submission_document_sets%ROWTYPE;
DECLARE dossier submissions%ROWTYPE;
DECLARE actor_name text;
DECLARE expected_reason text;
BEGIN
  SELECT s.* INTO document_set FROM submission_document_sets s JOIN submission_document_jobs j ON j.set_id=s.id WHERE j.id=NEW.job_id FOR UPDATE OF s;
  SELECT * INTO job FROM submission_document_jobs WHERE id=NEW.job_id FOR UPDATE;
  SELECT * INTO dossier FROM submissions WHERE id=document_set.submission_id FOR SHARE;
  -- Retry and review permissions, and scope, must belong to the SAME assigned role.
  SELECT u.username INTO actor_name FROM users u
    JOIN user_roles ur ON ur.user_id=u.id
    JOIN role_permissions rp ON rp.role_id=ur.role_id
    JOIN permissions p ON p.id=rp.permission_id AND p.code='document.retry'
    JOIN user_role_scopes urs ON urs.user_id=ur.user_id AND urs.role_id=ur.role_id
    JOIN authorization_scopes scope ON scope.id=urs.scope_id
    JOIN organizational_units unit ON unit.id=dossier.processing_unit_id AND unit.status='ACTIVE'
    WHERE u.id=NEW.actor_user_id AND u.status='ACTIVE' AND NOT u.must_change_password
      AND dossier.student_user_id<>u.id AND dossier.status IN ('SUBMITTED','IN_REVIEW','NEEDS_SUPPLEMENT','APPROVED','REJECTED')
      AND EXISTS (SELECT 1 FROM role_permissions g JOIN permissions p2 ON p2.id=g.permission_id WHERE g.role_id=ur.role_id AND p2.code='submission.review')
      AND (scope.scope_type='GLOBAL' OR (scope.scope_type='ORGANIZATION' AND scope.organizational_unit_id=dossier.processing_unit_id))
      AND (dossier.designated_reviewer_id IS NULL
        OR (dossier.status='SUBMITTED' AND dossier.designated_reviewer_id=u.id)
        OR (dossier.status IN ('IN_REVIEW','NEEDS_SUPPLEMENT') AND (dossier.reviewer_user_id=u.id
          OR EXISTS (SELECT 1 FROM role_permissions g JOIN permissions p3 ON p3.id=g.permission_id WHERE g.role_id=ur.role_id AND p3.code='submission.assign')))
        OR (dossier.status IN ('APPROVED','REJECTED') AND dossier.reviewer_user_id=u.id)) LIMIT 1;
  IF actor_name IS NULL THEN RAISE EXCEPTION 'DOCUMENT_RETRY_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF job.state='RUNNING' AND job.lease_until<=clock_timestamp() AND job.attempts=3+job.retry_allowance THEN
    UPDATE submission_document_jobs SET state='RETRYABLE',lease_until=NULL,error_code='LEASE_EXPIRED' WHERE id=job.id RETURNING * INTO job;
  END IF;
  expected_reason := CASE job.error_code WHEN 'RENDER_FAILED' THEN 'RENDERER_FIXED' WHEN 'CONVERT_FAILED' THEN 'CONVERTER_FIXED'
    WHEN 'STORAGE_FAILED' THEN 'STORAGE_FIXED' WHEN 'LEASE_EXPIRED' THEN 'WORKER_RESTARTED' END;
  IF job.state<>'RETRYABLE' OR job.attempts<>3+job.retry_allowance OR job.retry_allowance>=3
    OR NEW.attempt_id IS DISTINCT FROM job.attempt_id OR NEW.attempts<>job.attempts
    OR NEW.allowance<>job.retry_allowance+1 OR NEW.reason_code IS DISTINCT FROM expected_reason THEN
    RAISE EXCEPTION 'DOCUMENT_RETRY_CONFLICT' USING ERRCODE='23514';
  END IF;
  UPDATE submission_document_jobs SET retry_allowance=NEW.allowance,next_attempt_at=clock_timestamp()+interval '3 seconds' WHERE id=job.id;
  INSERT INTO audit_logs(actor_type,actor_user_id,actor_username,action,resource_type,resource_id,outcome,metadata)
    VALUES('USER',NEW.actor_user_id,actor_name,'document.retry.authorized','submission_document_job',job.id::text,'SUCCESS',
      jsonb_build_object('requestId',NEW.id,'setId',job.set_id,'format',job.format,'attemptId',job.attempt_id,
        'attempts',job.attempts,'attemptLimit',3+NEW.allowance,'reasonCode',NEW.reason_code));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_retries_apply AFTER INSERT ON submission_document_retries FOR EACH ROW EXECUTE FUNCTION apply_document_retry();
--> statement-breakpoint
CREATE TRIGGER document_retries_immutable BEFORE UPDATE OR DELETE ON submission_document_retries FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
