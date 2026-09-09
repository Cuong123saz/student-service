INSERT INTO "permissions" (
	"code",
	"name",
	"description",
	"is_system"
)
VALUES (
	'student.update',
	'Cập nhật sinh viên',
	'Cập nhật thông tin sinh viên trong phạm vi được giao',
	true
)
ON CONFLICT ("code") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"is_system" = EXCLUDED."is_system";
--> statement-breakpoint
INSERT INTO "role_permissions" (
	"role_id",
	"permission_id"
)
SELECT
	"roles"."id",
	"permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."code" IN ('SYSTEM_ADMIN', 'ADMIN')
	AND "permissions"."code" = 'student.update'
ON CONFLICT DO NOTHING;
