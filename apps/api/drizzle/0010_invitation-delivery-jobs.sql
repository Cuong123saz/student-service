CREATE TABLE "invitation_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"actor_username" varchar(100),
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"sent_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_delivery_jobs_status_check" CHECK ("invitation_delivery_jobs"."status" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
	CONSTRAINT "invitation_delivery_jobs_attempts_check" CHECK ("invitation_delivery_jobs"."attempts" >= 0 AND "invitation_delivery_jobs"."max_attempts" BETWEEN 1 AND 10 AND "invitation_delivery_jobs"."attempts" <= "invitation_delivery_jobs"."max_attempts"),
	CONSTRAINT "invitation_delivery_jobs_lock_state_check" CHECK (("invitation_delivery_jobs"."status" = 'PROCESSING' AND "invitation_delivery_jobs"."locked_at" IS NOT NULL AND "invitation_delivery_jobs"."locked_by" IS NOT NULL) OR ("invitation_delivery_jobs"."status" <> 'PROCESSING' AND "invitation_delivery_jobs"."locked_at" IS NULL AND "invitation_delivery_jobs"."locked_by" IS NULL)),
	CONSTRAINT "invitation_delivery_jobs_sent_state_check" CHECK (("invitation_delivery_jobs"."status" = 'SENT' AND "invitation_delivery_jobs"."sent_at" IS NOT NULL) OR ("invitation_delivery_jobs"."status" <> 'SENT' AND "invitation_delivery_jobs"."sent_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invitation_delivery_jobs" ADD CONSTRAINT "invitation_delivery_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_delivery_jobs" ADD CONSTRAINT "invitation_delivery_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_delivery_jobs_one_open_per_user_idx" ON "invitation_delivery_jobs" USING btree ("user_id") WHERE "invitation_delivery_jobs"."status" IN ('PENDING', 'PROCESSING');--> statement-breakpoint
CREATE INDEX "invitation_delivery_jobs_ready_idx" ON "invitation_delivery_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "invitation_delivery_jobs_locked_at_idx" ON "invitation_delivery_jobs" USING btree ("locked_at");