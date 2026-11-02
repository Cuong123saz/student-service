-- ADR 0029: clubs (CLB) as organizational units, the roles CTSV / Phòng Đào tạo / club leader and
-- club leader terms. Existing organizational units are untouched; a club is a unit plus a clubs row.
INSERT INTO "roles" ("code","name","description","is_system") VALUES
	('STUDENT_AFFAIRS','Công tác sinh viên (CTSV)','Quản lý CLB và hoạt động ngoại khóa bắt buộc',true),
	('TRAINING_OFFICE','Phòng Đào tạo','Tạo hoạt động ngoại khóa bắt buộc trong phạm vi được gán',true),
	('CLUB_LEADER','Người phụ trách CLB','Mở hoạt động tự nguyện của CLB trong nhiệm kỳ',true)
ON CONFLICT ("code") DO UPDATE SET "name"=excluded."name","description"=excluded."description","is_system"=true;--> statement-breakpoint
INSERT INTO "permissions" ("code","name","description","is_system") VALUES
	('club.read','Xem CLB','Xem danh sách CLB và người phụ trách trong phạm vi',true),
	('club.manage','Quản lý CLB','Tạo, sửa, tạm dừng, giải thể CLB và gán người phụ trách',true)
ON CONFLICT ("code") DO UPDATE SET "name"=excluded."name","description"=excluded."description","is_system"=true;--> statement-breakpoint
-- SYSTEM_ADMIN only reads clubs: it assigns roles to people but does not act as CTSV (ADR 0029).
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id,p.id FROM (VALUES ('STUDENT_AFFAIRS','club.read'),('STUDENT_AFFAIRS','club.manage'),('TRAINING_OFFICE','club.read'),('CLUB_LEADER','club.read'),('SYSTEM_ADMIN','club.read')) AS m(role_code,permission_code)
JOIN "roles" r ON r.code=m.role_code JOIN "permissions" p ON p.code=m.permission_code
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizational_unit_id" uuid NOT NULL REFERENCES "organizational_units"("id") ON DELETE restrict,
	"description" varchar(2000) DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"status_reason" varchar(500),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dissolved_at" timestamp with time zone,
	CONSTRAINT "clubs_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED','DISSOLVED')),
	CONSTRAINT "clubs_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "clubs_dissolved_check" CHECK (("status"='DISSOLVED') = ("dissolved_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_organizational_unit_unique" ON "clubs" ("organizational_unit_id");--> statement-breakpoint
CREATE INDEX "clubs_status_idx" ON "clubs" ("status");--> statement-breakpoint
CREATE TABLE "club_leader_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE restrict,
	"leader_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"assigned_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"ended_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"end_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_leader_assignments_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "club_leader_assignments_valid_period_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
);--> statement-breakpoint
CREATE UNIQUE INDEX "club_leader_assignments_active_unique" ON "club_leader_assignments" ("club_id","leader_user_id") WHERE "status"='ACTIVE';--> statement-breakpoint
CREATE INDEX "club_leader_assignments_leader_idx" ON "club_leader_assignments" ("leader_user_id","status");--> statement-breakpoint
-- A dissolved club is final and club rows are never deleted (certificates keep pointing at them).
CREATE FUNCTION protect_club() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CLUB_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.status='DISSOLVED' THEN RAISE EXCEPTION 'CLUB_DISSOLVED' USING ERRCODE='23514'; END IF;
 IF NEW.organizational_unit_id<>OLD.organizational_unit_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'CLUB_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "clubs_protect" BEFORE UPDATE OR DELETE ON "clubs" FOR EACH ROW EXECUTE FUNCTION protect_club();--> statement-breakpoint
CREATE FUNCTION club_staff_allowed(actor uuid,perm text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions pm ON pm.id=rp.permission_id JOIN user_role_scopes urs ON urs.user_id=u.id AND urs.role_id=r.id JOIN authorization_scopes s ON s.id=urs.scope_id
 WHERE u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password AND pm.code=perm
 AND ((r.code='STUDENT_AFFAIRS' AND s.scope_type='GLOBAL') OR (r.code='TRAINING_OFFICE' AND s.scope_type IN ('GLOBAL','FACULTY')) OR (r.code='SYSTEM_ADMIN' AND s.scope_type='GLOBAL'))) $$;
--> statement-breakpoint
CREATE FUNCTION club_is_leader(actor uuid,club uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='CLUB_LEADER' JOIN club_leader_assignments a ON a.leader_user_id=u.id AND a.club_id=club
 WHERE u.id=actor AND u.status='ACTIVE' AND NOT u.must_change_password AND a.status='ACTIVE' AND a.valid_from<=clock_timestamp() AND (a.valid_to IS NULL OR a.valid_to>clock_timestamp())) $$;
