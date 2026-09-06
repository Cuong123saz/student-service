CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" varchar(255),
	"is_system" boolean DEFAULT true NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");
--> statement-breakpoint
INSERT INTO "roles" (
	"code",
	"name",
	"description",
	"is_system"
) VALUES
	('SYSTEM_ADMIN', 'Quản trị hệ thống', 'Quản lý cấu hình và quyền cao nhất của hệ thống', true),
	('ADMIN', 'Quản trị nghiệp vụ', 'Quản lý người dùng, dịch vụ và quy trình', true),
	('STUDENT', 'Sinh viên', 'Kê khai và theo dõi hồ sơ của bản thân', true),
	('ACADEMIC_ADVISOR', 'Giảng viên cố vấn', 'Duyệt hồ sơ và điểm rèn luyện của lớp được phân công', true),
	('FACULTY_REVIEWER', 'Cán bộ khoa', 'Tiếp nhận và duyệt hồ sơ thuộc phạm vi khoa', true),
	('DOCUMENT_SIGNER', 'Người ký văn bản', 'Thực hiện ký văn bản khi được phân công', true)
ON CONFLICT ("code") DO UPDATE SET
	"name" = excluded."name",
	"description" = excluded."description",
	"is_system" = true;
--> statement-breakpoint
INSERT INTO "permissions" (
	"code",
	"name",
	"description",
	"is_system"
) VALUES
	('student.read', 'Xem sinh viên', 'Xem hồ sơ sinh viên trong phạm vi được giao', true),
	('student.create', 'Tạo sinh viên', 'Tạo tài khoản và hồ sơ sinh viên', true),
	('student.import', 'Import sinh viên', 'Import tài khoản sinh viên từ Excel hoặc CSV', true),
	('student.export', 'Export sinh viên', 'Export danh sách sinh viên trong phạm vi được giao', true),
	('user.manage', 'Quản lý người dùng', 'Quản lý trạng thái và thông tin tài khoản', true),
	('role.manage', 'Quản lý vai trò', 'Gán hoặc thu hồi vai trò trong phạm vi cho phép', true),
	('organization.manage', 'Quản lý cơ cấu', 'Quản lý khoa, lớp, đơn vị và phân công cố vấn', true),
	('audit.read', 'Xem nhật ký audit', 'Tra cứu nhật ký thay đổi dữ liệu quan trọng', true),
	('service.configure', 'Cấu hình dịch vụ', 'Quản lý cấu hình dịch vụ và biểu mẫu', true),
	('submission.review', 'Xét duyệt hồ sơ', 'Xem xét hồ sơ được giao trong workflow', true),
	('submission.reject', 'Trả lại hồ sơ', 'Trả hồ sơ cho người nộp bổ sung hoặc chỉnh sửa', true),
	('document.sign', 'Ký tài liệu', 'Ký tài liệu khi được workflow phân công', true),
	('training_point.review', 'Duyệt điểm rèn luyện', 'Duyệt kê khai điểm rèn luyện theo lớp được giao', true),
	('training_point.faculty_approve', 'Duyệt điểm rèn luyện cấp khoa', 'Phê duyệt kết quả điểm rèn luyện ở cấp khoa', true)
ON CONFLICT ("code") DO UPDATE SET
	"name" = excluded."name",
	"description" = excluded."description",
	"is_system" = true;
--> statement-breakpoint
INSERT INTO "role_permissions" (
	"role_id",
	"permission_id"
)
SELECT
	"roles"."id",
	"permissions"."id"
FROM (
	VALUES
		('SYSTEM_ADMIN', 'student.read'),
		('SYSTEM_ADMIN', 'student.create'),
		('SYSTEM_ADMIN', 'student.import'),
		('SYSTEM_ADMIN', 'student.export'),
		('SYSTEM_ADMIN', 'user.manage'),
		('SYSTEM_ADMIN', 'role.manage'),
		('SYSTEM_ADMIN', 'organization.manage'),
		('SYSTEM_ADMIN', 'audit.read'),
		('SYSTEM_ADMIN', 'service.configure'),
		('SYSTEM_ADMIN', 'submission.review'),
		('SYSTEM_ADMIN', 'submission.reject'),
		('SYSTEM_ADMIN', 'document.sign'),
		('SYSTEM_ADMIN', 'training_point.review'),
		('SYSTEM_ADMIN', 'training_point.faculty_approve'),
		('ADMIN', 'student.read'),
		('ADMIN', 'student.create'),
		('ADMIN', 'student.import'),
		('ADMIN', 'student.export'),
		('ADMIN', 'user.manage'),
		('ADMIN', 'role.manage'),
		('ADMIN', 'organization.manage'),
		('ADMIN', 'service.configure'),
		('ACADEMIC_ADVISOR', 'student.read'),
		('ACADEMIC_ADVISOR', 'submission.review'),
		('ACADEMIC_ADVISOR', 'submission.reject'),
		('ACADEMIC_ADVISOR', 'training_point.review'),
		('FACULTY_REVIEWER', 'student.read'),
		('FACULTY_REVIEWER', 'submission.review'),
		('FACULTY_REVIEWER', 'submission.reject'),
		('FACULTY_REVIEWER', 'training_point.faculty_approve'),
		('DOCUMENT_SIGNER', 'document.sign')
) AS "mapping" ("role_code", "permission_code")
INNER JOIN "roles"
	ON "roles"."code" = "mapping"."role_code"
INNER JOIN "permissions"
	ON "permissions"."code" = "mapping"."permission_code"
ON CONFLICT DO NOTHING;
