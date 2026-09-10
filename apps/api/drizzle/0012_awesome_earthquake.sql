CREATE TABLE "student_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "student_import_files_byte_size_check" CHECK ("student_import_files"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "student_import_files_sha256_check" CHECK ("student_import_files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "student_import_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_job_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "student_import_previews_status_check" CHECK ("student_import_previews"."status" IN ('PENDING', 'PROCESSING', 'CONSUMED')),
	CONSTRAINT "student_import_previews_lock_state_check" CHECK (("student_import_previews"."status" = 'PROCESSING' AND "student_import_previews"."locked_at" IS NOT NULL AND "student_import_previews"."locked_by" IS NOT NULL AND "student_import_previews"."consumed_at" IS NULL) OR ("student_import_previews"."status" = 'PENDING' AND "student_import_previews"."locked_at" IS NULL AND "student_import_previews"."locked_by" IS NULL AND "student_import_previews"."consumed_at" IS NULL) OR ("student_import_previews"."status" = 'CONSUMED' AND "student_import_previews"."locked_at" IS NULL AND "student_import_previews"."locked_by" IS NULL AND "student_import_previews"."consumed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "student_import_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"preview_id" uuid,
	"last_error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_import_processing_jobs_status_check" CHECK ("student_import_processing_jobs"."status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "student_import_processing_jobs_attempts_check" CHECK ("student_import_processing_jobs"."attempts" >= 0 AND "student_import_processing_jobs"."max_attempts" BETWEEN 1 AND 10 AND "student_import_processing_jobs"."attempts" <= "student_import_processing_jobs"."max_attempts"),
	CONSTRAINT "student_import_processing_jobs_lock_state_check" CHECK (("student_import_processing_jobs"."status" = 'PROCESSING' AND "student_import_processing_jobs"."locked_at" IS NOT NULL AND "student_import_processing_jobs"."locked_by" IS NOT NULL) OR ("student_import_processing_jobs"."status" <> 'PROCESSING' AND "student_import_processing_jobs"."locked_at" IS NULL AND "student_import_processing_jobs"."locked_by" IS NULL)),
	CONSTRAINT "student_import_processing_jobs_result_state_check" CHECK (("student_import_processing_jobs"."status" = 'SUCCEEDED' AND "student_import_processing_jobs"."preview_id" IS NOT NULL AND "student_import_processing_jobs"."last_error_code" IS NULL) OR ("student_import_processing_jobs"."status" = 'FAILED' AND "student_import_processing_jobs"."preview_id" IS NULL AND "student_import_processing_jobs"."last_error_code" IS NOT NULL) OR ("student_import_processing_jobs"."status" IN ('PENDING', 'PROCESSING') AND "student_import_processing_jobs"."preview_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "student_import_files" ADD CONSTRAINT "student_import_files_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_previews" ADD CONSTRAINT "student_import_previews_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_processing_jobs" ADD CONSTRAINT "student_import_processing_jobs_file_id_student_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."student_import_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_processing_jobs" ADD CONSTRAINT "student_import_processing_jobs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_processing_jobs" ADD CONSTRAINT "student_import_processing_jobs_preview_id_student_import_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."student_import_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_import_files_expires_at_idx" ON "student_import_files" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_import_previews_source_job_unique" ON "student_import_previews" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "student_import_previews_expires_at_idx" ON "student_import_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "student_import_previews_locked_at_idx" ON "student_import_previews" USING btree ("locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_import_processing_jobs_file_unique" ON "student_import_processing_jobs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "student_import_processing_jobs_ready_idx" ON "student_import_processing_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "student_import_processing_jobs_locked_at_idx" ON "student_import_processing_jobs" USING btree ("locked_at");
