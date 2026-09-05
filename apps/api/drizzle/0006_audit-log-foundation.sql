CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"actor_username" varchar(100),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100),
	"outcome" varchar(20) NOT NULL,
	"request_id" varchar(100),
	"ip_address" varchar(45),
	"user_agent" varchar(512),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("audit_logs"."actor_type" IN ('USER', 'ANONYMOUS', 'SYSTEM')),
	CONSTRAINT "audit_logs_outcome_check" CHECK ("audit_logs"."outcome" IN ('SUCCESS', 'FAILURE')),
	CONSTRAINT "audit_logs_actor_identity_check" CHECK (("audit_logs"."actor_type" = 'USER' AND "audit_logs"."actor_user_id" IS NOT NULL) OR ("audit_logs"."actor_type" <> 'USER' AND "audit_logs"."actor_user_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE FUNCTION "prevent_audit_logs_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_logs are append-only'
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only_trigger"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_logs_mutation"();
