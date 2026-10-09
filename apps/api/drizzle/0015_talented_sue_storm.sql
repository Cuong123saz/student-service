CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"attachment_key" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_key" uuid NOT NULL,
	"signature_status" varchar(20) DEFAULT 'NOT_CHECKED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "submission_files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "submission_files_limits_check" CHECK ("submission_files"."size" > 0 AND "submission_files"."size" <= 5242880 AND "submission_files"."signature_status" = 'NOT_CHECKED'),
	CONSTRAINT "submission_files_format_check" CHECK ("submission_files"."mime_type" IN ('application/pdf', 'image/png', 'image/jpeg') AND "submission_files"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid NOT NULL,
	"service_id" integer NOT NULL,
	"procedure_version_id" uuid NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"procedure" jsonb NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_draft_check" CHECK ("submissions"."status" = 'DRAFT' AND "submissions"."revision" > 0),
	CONSTRAINT "submissions_json_check" CHECK (jsonb_typeof("submissions"."procedure") = 'object' AND jsonb_typeof("submissions"."values") = 'object')
);
--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_procedure_version_id_procedure_versions_id_fk" FOREIGN KEY ("procedure_version_id") REFERENCES "public"."procedure_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_files_draft_idx" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_student_version_unique" ON "submissions" USING btree ("student_user_id","procedure_version_id");--> statement-breakpoint
CREATE INDEX "submissions_student_updated_idx" ON "submissions" USING btree ("student_user_id","updated_at");