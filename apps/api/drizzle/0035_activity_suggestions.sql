-- ADR 0033: per-period activity settings for training point suggestions and the organising committee.
-- Suggestions are computed on read; nothing here changes declarations or review decisions.
CREATE TABLE "training_activity_settings" (
	"period_id" uuid PRIMARY KEY NOT NULL REFERENCES "training_periods"("id") ON DELETE restrict,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_activity_settings_revision_check" CHECK ("revision" >= 1),
	CONSTRAINT "training_activity_settings_config_check" CHECK (jsonb_typeof("config")='object' AND "config" ? 'window' AND "config" ? 'school' AND "config" ? 'club' AND "config" ? 'volunteer')
);--> statement-breakpoint
CREATE TABLE "activity_organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"student_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"added_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"added_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"removed_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"removed_at" timestamp with time zone,
	CONSTRAINT "activity_organizers_self_check" CHECK ("added_by_user_id"<>"student_user_id"),
	CONSTRAINT "activity_organizers_removed_check" CHECK (("removed_at" IS NULL) = ("removed_by_user_id" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_organizers_active_unique" ON "activity_organizers" ("activity_id","student_user_id") WHERE "removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "activity_organizers_student_idx" ON "activity_organizers" ("student_user_id") WHERE "removed_at" IS NULL;--> statement-breakpoint
-- Organiser rows are never deleted; only removed_at/removed_by may be set, once.
CREATE FUNCTION protect_activity_organizer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.removed_at IS NOT NULL OR NEW.activity_id<>OLD.activity_id OR NEW.student_user_id<>OLD.student_user_id
  OR NEW.added_by_user_id<>OLD.added_by_user_id OR NEW.added_at<>OLD.added_at THEN
  RAISE EXCEPTION 'ACTIVITY_ORGANIZER_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "activity_organizers_protect" BEFORE UPDATE OR DELETE ON "activity_organizers" FOR EACH ROW EXECUTE FUNCTION protect_activity_organizer();
