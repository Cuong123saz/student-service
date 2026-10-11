CREATE TABLE "submission_document_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"format" varchar(4) NOT NULL,
	"state" varchar(10) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempt_id" uuid,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" varchar(30),
	"published_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_jobs_shape_check" CHECK (("submission_document_jobs"."format" IN ('DOCX','PDF') AND "submission_document_jobs"."attempts" BETWEEN 0 AND 3 AND (
    ("submission_document_jobs"."state" = 'PENDING' AND "submission_document_jobs"."attempts" = 0 AND "submission_document_jobs"."attempt_id" IS NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL) OR
    ("submission_document_jobs"."state" = 'RUNNING' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NOT NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL) OR
    ("submission_document_jobs"."state" = 'RETRYABLE' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."published_document_id" IS NULL AND "submission_document_jobs"."error_code" IN ('RENDER_FAILED','CONVERT_FAILED','STORAGE_FAILED','LEASE_EXPIRED')) OR
    ("submission_document_jobs"."state" = 'COMPLETE' AND "submission_document_jobs"."attempts" > 0 AND "submission_document_jobs"."attempt_id" IS NOT NULL AND "submission_document_jobs"."lease_until" IS NULL AND "submission_document_jobs"."error_code" IS NULL AND "submission_document_jobs"."published_document_id" IS NOT NULL))) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "submission_document_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"template" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sets_kind_check" CHECK ("submission_document_sets"."kind" = 'DECLARATION')
);
--> statement-breakpoint
CREATE TABLE "submission_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"format" varchar(4) NOT NULL,
	"storage_key" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"template" jsonb NOT NULL,
	"renderer" jsonb NOT NULL,
	"converter" jsonb,
	"source_docx_sha256" varchar(64),
	"status" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_shape_check" CHECK (("submission_documents"."format" IN ('DOCX','PDF') AND "submission_documents"."size" BETWEEN 1 AND 16777216
    AND "submission_documents"."sha256" ~ '^[a-f0-9]{64}$' AND "submission_documents"."storage_key" = "submission_documents"."attempt_id" AND "submission_documents"."status" = 'UNSIGNED_DECLARATION'
    AND jsonb_typeof("submission_documents"."renderer") = 'object' AND "submission_documents"."renderer" ?& ARRAY['version','buildSha256','nodeVersion','icuVersion']
    AND "submission_documents"."renderer" - 'version' - 'buildSha256' - 'nodeVersion' - 'icuVersion' = '{}'::jsonb
    AND jsonb_typeof("submission_documents"."renderer"->'version') = 'string' AND char_length("submission_documents"."renderer"->>'version') BETWEEN 1 AND 200
    AND jsonb_typeof("submission_documents"."renderer"->'buildSha256') = 'string' AND ("submission_documents"."renderer"->>'buildSha256') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("submission_documents"."renderer"->'nodeVersion') = 'string' AND char_length("submission_documents"."renderer"->>'nodeVersion') BETWEEN 1 AND 40
    AND jsonb_typeof("submission_documents"."renderer"->'icuVersion') = 'string' AND char_length("submission_documents"."renderer"->>'icuVersion') BETWEEN 1 AND 40
    AND (("submission_documents"."format" = 'DOCX' AND "submission_documents"."converter" IS NULL AND "submission_documents"."source_docx_sha256" IS NULL) OR
    ("submission_documents"."format" = 'PDF' AND "submission_documents"."source_docx_sha256" ~ '^[a-f0-9]{64}$' AND "submission_documents"."converter" IS NOT NULL
      AND jsonb_typeof("submission_documents"."converter") = 'object' AND "submission_documents"."converter" ?& ARRAY['version','binarySha256']
      AND "submission_documents"."converter" - 'version' - 'binarySha256' = '{}'::jsonb AND jsonb_typeof("submission_documents"."converter"->'version') = 'string'
      AND char_length("submission_documents"."converter"->>'version') BETWEEN 1 AND 200 AND jsonb_typeof("submission_documents"."converter"->'binarySha256') = 'string'
      AND ("submission_documents"."converter"->>'binarySha256') ~ '^[a-f0-9]{64}$'))) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "submission_document_jobs" ADD CONSTRAINT "submission_document_jobs_set_id_submission_document_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."submission_document_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_document_sets" ADD CONSTRAINT "document_sets_round_fk" FOREIGN KEY ("round_id","submission_id") REFERENCES "public"."submission_rounds"("id","submission_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_documents" ADD CONSTRAINT "submission_documents_set_id_submission_document_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."submission_document_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_jobs_set_format_unique" ON "submission_document_jobs" USING btree ("set_id","format");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sets_round_kind_unique" ON "submission_document_sets" USING btree ("round_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_set_format_unique" ON "submission_documents" USING btree ("set_id","format");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_unique" ON "submission_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_job_reference_unique" ON "submission_documents" USING btree ("id","set_id","format");
--> statement-breakpoint
ALTER TABLE "submission_document_jobs" ADD CONSTRAINT "document_jobs_published_fk" FOREIGN KEY ("published_document_id","set_id","format") REFERENCES "public"."submission_documents"("id","set_id","format") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- ADR0009 + ADR0010 predate this migration. No historical rows are rewritten.
CREATE FUNCTION bind_document_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding jsonb;
BEGIN
  SELECT declaration_template INTO binding FROM submission_rounds
    WHERE id=NEW.round_id AND submission_id=NEW.submission_id;
  IF binding IS NULL OR NEW.template IS DISTINCT FROM binding THEN
    RAISE EXCEPTION 'DOCUMENT_TEMPLATE_BINDING_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_sets_bind BEFORE INSERT ON submission_document_sets FOR EACH ROW EXECUTE FUNCTION bind_document_set();
--> statement-breakpoint
CREATE TRIGGER document_sets_immutable BEFORE UPDATE OR DELETE ON submission_document_sets FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
--> statement-breakpoint
CREATE TRIGGER documents_immutable BEFORE UPDATE OR DELETE ON submission_documents FOR EACH ROW EXECUTE FUNCTION protect_submission_history();
--> statement-breakpoint
CREATE FUNCTION protect_document_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document jobs cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'Document jobs start pending' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.set_id,NEW.format,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.set_id,OLD.format,OLD.created_at) OR OLD.state='COMPLETE' THEN
    RAISE EXCEPTION 'Document job binding is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.state='RUNNING' AND (OLD.state IN ('PENDING','RETRYABLE') OR (OLD.state='RUNNING' AND OLD.lease_until <= clock_timestamp()))
    AND OLD.next_attempt_at <= clock_timestamp() AND OLD.attempts < 3 AND NEW.attempts=OLD.attempts+1
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
        jsonb_build_object('setId',NEW.set_id,'format',NEW.format,'attemptId',NEW.attempt_id,'attempts',NEW.attempts,'code',NEW.error_code));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_jobs_protect BEFORE INSERT OR UPDATE OR DELETE ON submission_document_jobs FOR EACH ROW EXECUTE FUNCTION protect_document_job();
--> statement-breakpoint
CREATE FUNCTION publish_submission_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_set submission_document_sets%ROWTYPE;
DECLARE job submission_document_jobs%ROWTYPE;
DECLARE word submission_documents%ROWTYPE;
BEGIN
  -- Every application writer locks set then job. The converter never runs inside this transaction.
  SELECT * INTO document_set FROM submission_document_sets WHERE id=NEW.set_id FOR UPDATE;
  SELECT * INTO job FROM submission_document_jobs WHERE set_id=NEW.set_id AND format=NEW.format FOR UPDATE;
  IF job.id IS NULL OR job.state <> 'RUNNING' OR job.attempt_id IS DISTINCT FROM NEW.attempt_id
    OR job.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'DOCUMENT_LEASE_LOST' USING ERRCODE='P0001';
  END IF;
  IF NEW.template IS DISTINCT FROM document_set.template THEN
    RAISE EXCEPTION 'DOCUMENT_TEMPLATE_BINDING_INVALID' USING ERRCODE='23514';
  END IF;
  IF NEW.format='PDF' THEN
    SELECT * INTO word FROM submission_documents WHERE set_id=NEW.set_id AND format='DOCX';
    IF word.id IS NULL OR NEW.source_docx_sha256 IS DISTINCT FROM word.sha256 OR NEW.renderer IS DISTINCT FROM word.renderer THEN
      RAISE EXCEPTION 'DOCUMENT_WORD_BINDING_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  UPDATE submission_document_jobs SET state='COMPLETE', lease_until=NULL, error_code=NULL,
    published_document_id=NEW.id WHERE id=job.id;
  INSERT INTO audit_logs(actor_type,action,resource_type,resource_id,outcome,metadata)
    VALUES('SYSTEM','document.published','submission_document',NEW.id::text,'SUCCESS',
      jsonb_build_object('setId',NEW.set_id,'roundId',document_set.round_id,'format',NEW.format,
        'sha256',NEW.sha256,'size',NEW.size,'template',NEW.template,'renderer',NEW.renderer,
        'converter',NEW.converter,'sourceDocxSha256',NEW.source_docx_sha256,'status',NEW.status));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_publish AFTER INSERT ON submission_documents FOR EACH ROW EXECUTE FUNCTION publish_submission_document();
