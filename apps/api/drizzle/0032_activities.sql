-- ADR 0030: extracurricular activities. Mandatory activities belong to CTSV or Phòng Đào tạo and may be
-- delegated to a club; voluntary activities belong to a club. History is append-only in activity_events.
INSERT INTO "permissions" ("code","name","description","is_system") VALUES
	('activity.read','Xem hoạt động ngoại khóa','Xem mọi hoạt động ngoại khóa và lịch sử thay đổi',true),
	('activity.mandatory.manage','Quản lý hoạt động bắt buộc','Tạo, sửa, công bố, hủy và giao CLB thực hiện hoạt động bắt buộc',true),
	('activity.moderate','Kiểm soát hoạt động ngoại khóa','Tạm dừng hoặc mở lại hoạt động đã công bố',true),
	('activity.club.manage','Quản lý hoạt động của CLB','Tạo, sửa, công bố và hủy hoạt động tự nguyện của CLB trong nhiệm kỳ',true)
ON CONFLICT ("code") DO UPDATE SET "name"=excluded."name","description"=excluded."description","is_system"=true;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM (VALUES
	('STUDENT_AFFAIRS','activity.read'),('STUDENT_AFFAIRS','activity.mandatory.manage'),('STUDENT_AFFAIRS','activity.moderate'),
	('TRAINING_OFFICE','activity.read'),('TRAINING_OFFICE','activity.mandatory.manage'),
	('CLUB_LEADER','activity.club.manage'),('SYSTEM_ADMIN','activity.read')) AS m(role_code,permission_code)
JOIN "roles" r ON r.code=m.role_code JOIN "permissions" p ON p.code=m.permission_code
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"category" varchar(30) NOT NULL,
	"owner_type" varchar(30) NOT NULL,
	"owner_club_id" uuid REFERENCES "clubs"("id") ON DELETE restrict,
	"delegated_club_id" uuid REFERENCES "clubs"("id") ON DELETE restrict,
	"title" varchar(255) NOT NULL,
	"description" varchar(4000) DEFAULT '' NOT NULL,
	"location" varchar(255) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer,
	"eligibility" jsonb DEFAULT '{"facultyIds":[],"classIds":[],"cohortYears":[]}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"status_reason" varchar(500),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_kind_check" CHECK ("kind" IN ('MANDATORY','VOLUNTARY')),
	CONSTRAINT "activities_category_check" CHECK ("category" IN ('SCHOOL','CLUB_ACADEMIC','VOLUNTEER')),
	CONSTRAINT "activities_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','SUSPENDED','CANCELLED')),
	CONSTRAINT "activities_owner_check" CHECK (
		("kind"='MANDATORY' AND "owner_type" IN ('STUDENT_AFFAIRS','TRAINING_OFFICE') AND "owner_club_id" IS NULL)
		OR ("kind"='VOLUNTARY' AND "owner_type"='CLUB' AND "owner_club_id" IS NOT NULL AND "delegated_club_id" IS NULL)),
	CONSTRAINT "activities_time_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "activities_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 100000),
	CONSTRAINT "activities_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "activities_published_check" CHECK ("status"='DRAFT' OR "published_at" IS NOT NULL OR "status"='CANCELLED'),
	CONSTRAINT "activities_eligibility_check" CHECK (
		jsonb_typeof("eligibility"->'facultyIds')='array' AND jsonb_typeof("eligibility"->'classIds')='array' AND jsonb_typeof("eligibility"->'cohortYears')='array'
		AND jsonb_array_length("eligibility"->'facultyIds')<=50 AND jsonb_array_length("eligibility"->'classIds')<=50 AND jsonb_array_length("eligibility"->'cohortYears')<=50)
);--> statement-breakpoint
CREATE INDEX "activities_status_starts_idx" ON "activities" ("status","starts_at");--> statement-breakpoint
CREATE INDEX "activities_owner_club_idx" ON "activities" ("owner_club_id");--> statement-breakpoint
CREATE INDEX "activities_delegated_club_idx" ON "activities" ("delegated_club_id");--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"revision" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"reason" varchar(500),
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_action_check" CHECK ("action" IN ('CREATED','UPDATED','PUBLISHED','SUSPENDED','RESUMED','CANCELLED','DELEGATED','DELEGATION_REVOKED'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_revision_unique" ON "activity_events" ("activity_id","revision");--> statement-breakpoint
CREATE FUNCTION protect_activity_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACTIVITY_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END $$;--> statement-breakpoint
CREATE TRIGGER "activity_events_protect" BEFORE UPDATE OR DELETE ON "activity_events" FOR EACH ROW EXECUTE FUNCTION protect_activity_history();--> statement-breakpoint
-- Activities are never deleted; a cancelled activity is final and every change bumps the revision.
CREATE FUNCTION protect_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACTIVITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'ACTIVITY_CANCELLED' USING ERRCODE='23514'; END IF;
 IF NEW.kind<>OLD.kind OR NEW.owner_type<>OLD.owner_type OR NEW.owner_club_id IS DISTINCT FROM OLD.owner_club_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'ACTIVITY_INVALID' USING ERRCODE='23514'; END IF;
 IF OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','PUBLISHED','CANCELLED') THEN RAISE EXCEPTION 'ACTIVITY_INVALID' USING ERRCODE='23514'; END IF;
 IF OLD.status<>'DRAFT' AND NEW.status='DRAFT' THEN RAISE EXCEPTION 'ACTIVITY_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "activities_protect" BEFORE UPDATE OR DELETE ON "activities" FOR EACH ROW EXECUTE FUNCTION protect_activity();--> statement-breakpoint
-- Shared eligibility rule for viewing (11.2), registration and attendance (11.3–11.4). AND of the three
-- conditions; an empty list means no restriction; a student without a cohort fails a cohort restriction.
CREATE FUNCTION activity_student_eligible(student uuid,activity uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM activities a JOIN users u ON u.id=student AND u.status='ACTIVE'
  JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='STUDENT'
  JOIN student_profiles sp ON sp.user_id=u.id JOIN academic_classes c ON c.id=sp.class_id
  WHERE a.id=activity
  AND (jsonb_array_length(a.eligibility->'facultyIds')=0 OR a.eligibility->'facultyIds' ? c.faculty_id::text)
  AND (jsonb_array_length(a.eligibility->'classIds')=0 OR a.eligibility->'classIds' ? c.id::text)
  AND (jsonb_array_length(a.eligibility->'cohortYears')=0 OR (sp.cohort_year IS NOT NULL AND a.eligibility->'cohortYears' @> to_jsonb(sp.cohort_year::integer)))) $$;
