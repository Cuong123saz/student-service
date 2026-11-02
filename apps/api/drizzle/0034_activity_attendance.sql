-- ADR 0032: activity check-in (QR + in-page photo), attendance review and participation certificates.
-- Existing activities get a fresh random check-in secret; no other existing row changes.
ALTER TABLE "activities" ADD COLUMN "checkin_secret" varchar(64) DEFAULT encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex') NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "rotating_qr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_action_check";--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_action_check" CHECK ("action" IN ('CREATED','UPDATED','PUBLISHED','SUSPENDED','RESUMED','CANCELLED','DELEGATED','DELEGATION_REVOKED','CHECKIN_RESET','CHECKIN_MODE_CHANGED'));--> statement-breakpoint
CREATE TABLE "activity_attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"student_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"registration_id" uuid NOT NULL REFERENCES "activity_registrations"("id") ON DELETE restrict,
	"status" varchar(20) NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"capture_expires_at" timestamp with time zone NOT NULL,
	"photo_storage_key" varchar(255),
	"photo_sha256" varchar(64),
	"photo_size" integer,
	"photo_deleted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(500),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_attendances_status_check" CHECK ("status" IN ('SCANNED','PENDING_REVIEW','APPROVED','REJECTED')),
	CONSTRAINT "activity_attendances_photo_check" CHECK ("status"='SCANNED' OR ("submitted_at" IS NOT NULL AND "photo_sha256" ~ '^[0-9a-f]{64}$' AND "photo_size" BETWEEN 1 AND 2097152)),
	CONSTRAINT "activity_attendances_review_check" CHECK ("status" NOT IN ('APPROVED','REJECTED') OR ("reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "reviewed_by_user_id"<>"student_user_id")),
	CONSTRAINT "activity_attendances_reject_check" CHECK ("status"<>'REJECTED' OR "review_note" IS NOT NULL),
	CONSTRAINT "activity_attendances_revision_check" CHECK ("revision" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_attendances_unique" ON "activity_attendances" ("activity_id","student_user_id");--> statement-breakpoint
CREATE INDEX "activity_attendances_review_idx" ON "activity_attendances" ("activity_id","status","submitted_at","id");--> statement-breakpoint
CREATE FUNCTION protect_activity_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a activities%ROWTYPE; g activity_registrations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.activity_id<>OLD.activity_id OR NEW.student_user_id<>OLD.student_user_id OR NEW.registration_id<>OLD.registration_id OR NEW.revision<>OLD.revision+1) THEN
  RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>0 THEN RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM activities WHERE id=NEW.activity_id;
 SELECT * INTO g FROM activity_registrations WHERE id=NEW.registration_id;
 IF g.activity_id IS DISTINCT FROM NEW.activity_id OR g.student_user_id IS DISTINCT FROM NEW.student_user_id THEN RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_INVALID' USING ERRCODE='23514'; END IF;
 -- Scanning and sending the photo happen only during the activity, with a held seat.
 IF NEW.status IN ('SCANNED','PENDING_REVIEW') AND (TG_OP='INSERT' OR OLD.status='SCANNED') THEN
  IF a.status<>'PUBLISHED' OR clock_timestamp()<a.starts_at OR clock_timestamp()>a.ends_at OR g.status<>'REGISTERED' THEN
   RAISE EXCEPTION 'ACTIVITY_CHECKIN_CLOSED' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NOT ((OLD.status='SCANNED' AND NEW.status IN ('SCANNED','PENDING_REVIEW'))
   OR (OLD.status='PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW','APPROVED','REJECTED'))
   OR (OLD.status IN ('APPROVED','REJECTED') AND NEW.status=OLD.status)) THEN
   RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_TRANSITION' USING ERRCODE='23514'; END IF;
  IF NEW.status='PENDING_REVIEW' AND OLD.status='SCANNED' AND clock_timestamp()>OLD.capture_expires_at THEN
   RAISE EXCEPTION 'ACTIVITY_CHECKIN_EXPIRED' USING ERRCODE='23514'; END IF;
  -- After submission only the review fields and photo deletion may change.
  IF OLD.status<>'SCANNED' AND (NEW.photo_sha256 IS DISTINCT FROM OLD.photo_sha256 OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at
   OR (NEW.photo_storage_key IS DISTINCT FROM OLD.photo_storage_key AND NEW.photo_storage_key IS NOT NULL)) THEN
   RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_INVALID' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('APPROVED','REJECTED') AND (NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id OR NEW.review_note IS DISTINCT FROM OLD.review_note) THEN
   RAISE EXCEPTION 'ACTIVITY_ATTENDANCE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "activity_attendances_protect" BEFORE INSERT OR UPDATE OR DELETE ON "activity_attendances" FOR EACH ROW EXECUTE FUNCTION protect_activity_attendance();--> statement-breakpoint
CREATE TABLE "activity_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"student_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"attendance_id" uuid NOT NULL REFERENCES "activity_attendances"("id") ON DELETE restrict,
	"issued_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"payload_sha256" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'ISSUED' NOT NULL,
	"revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(500),
	"technical_signature_status" varchar(20) DEFAULT 'NOT_VERIFIED' NOT NULL,
	"legal_effect" boolean DEFAULT false NOT NULL,
	CONSTRAINT "activity_certificates_code_check" CHECK ("code" ~ '^CN-[A-Z2-7]{12}$'),
	CONSTRAINT "activity_certificates_status_check" CHECK ("status" IN ('ISSUED','REVOKED')),
	CONSTRAINT "activity_certificates_revoke_check" CHECK (("status"='REVOKED') = ("revoked_at" IS NOT NULL AND "revoked_by_user_id" IS NOT NULL AND "revoke_reason" IS NOT NULL)),
	CONSTRAINT "activity_certificates_hash_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "activity_certificates_signature_check" CHECK ("technical_signature_status"='NOT_VERIFIED' AND NOT "legal_effect")
);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_certificates_code_unique" ON "activity_certificates" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_certificates_attendance_unique" ON "activity_certificates" ("attendance_id");--> statement-breakpoint
CREATE INDEX "activity_certificates_student_idx" ON "activity_certificates" ("student_user_id","issued_at");--> statement-breakpoint
CREATE FUNCTION protect_activity_certificate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t activity_attendances%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACTIVITY_CERTIFICATE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO t FROM activity_attendances WHERE id=NEW.attendance_id;
  IF t.status IS DISTINCT FROM 'APPROVED' OR t.activity_id<>NEW.activity_id OR t.student_user_id<>NEW.student_user_id OR NEW.status<>'ISSUED' THEN
   RAISE EXCEPTION 'ACTIVITY_CERTIFICATE_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'ISSUED' OR NEW.status<>'REVOKED' OR NEW.code<>OLD.code OR NEW.activity_id<>OLD.activity_id OR NEW.student_user_id<>OLD.student_user_id
  OR NEW.attendance_id<>OLD.attendance_id OR NEW.issued_by_user_id<>OLD.issued_by_user_id OR NEW.issued_at<>OLD.issued_at OR NEW.payload_sha256<>OLD.payload_sha256 THEN
  RAISE EXCEPTION 'ACTIVITY_CERTIFICATE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "activity_certificates_protect" BEFORE INSERT OR UPDATE OR DELETE ON "activity_certificates" FOR EACH ROW EXECUTE FUNCTION protect_activity_certificate();
