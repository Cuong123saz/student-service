CREATE TABLE "authorization_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" varchar(30) NOT NULL,
	"faculty_id" uuid,
	"class_id" uuid,
	"organizational_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_scopes_target_check" CHECK ((
        ("authorization_scopes"."scope_type" = 'GLOBAL'
          AND "authorization_scopes"."faculty_id" IS NULL
          AND "authorization_scopes"."class_id" IS NULL
          AND "authorization_scopes"."organizational_unit_id" IS NULL)
        OR
        ("authorization_scopes"."scope_type" = 'FACULTY'
          AND "authorization_scopes"."faculty_id" IS NOT NULL
          AND "authorization_scopes"."class_id" IS NULL
          AND "authorization_scopes"."organizational_unit_id" IS NULL)
        OR
        ("authorization_scopes"."scope_type" = 'CLASS'
          AND "authorization_scopes"."faculty_id" IS NULL
          AND "authorization_scopes"."class_id" IS NOT NULL
          AND "authorization_scopes"."organizational_unit_id" IS NULL)
        OR
        ("authorization_scopes"."scope_type" = 'ORGANIZATION'
          AND "authorization_scopes"."faculty_id" IS NULL
          AND "authorization_scopes"."class_id" IS NULL
          AND "authorization_scopes"."organizational_unit_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "user_role_scopes" (
	"user_id" uuid NOT NULL,
	"role_id" integer NOT NULL,
	"scope_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_scopes_user_id_role_id_scope_id_pk" PRIMARY KEY("user_id","role_id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "organizational_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizational_units_status_check" CHECK ("organizational_units"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "authorization_scopes" ADD CONSTRAINT "authorization_scopes_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_scopes" ADD CONSTRAINT "authorization_scopes_class_id_academic_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."academic_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_scopes" ADD CONSTRAINT "authorization_scopes_org_unit_fk" FOREIGN KEY ("organizational_unit_id") REFERENCES "public"."organizational_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_scope_id_authorization_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."authorization_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_user_role_fk" FOREIGN KEY ("user_id","role_id") REFERENCES "public"."user_roles"("user_id","role_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_scopes_global_unique" ON "authorization_scopes" USING btree ("scope_type") WHERE "authorization_scopes"."scope_type" = 'GLOBAL';--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_scopes_faculty_unique" ON "authorization_scopes" USING btree ("faculty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_scopes_class_unique" ON "authorization_scopes" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authorization_scopes_organization_unique" ON "authorization_scopes" USING btree ("organizational_unit_id");--> statement-breakpoint
CREATE INDEX "user_role_scopes_scope_id_idx" ON "user_role_scopes" USING btree ("scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizational_units_code_unique" ON "organizational_units" USING btree ("code");
--> statement-breakpoint
INSERT INTO "authorization_scopes" (
	"scope_type"
) VALUES ('GLOBAL')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_role_scopes" (
	"user_id",
	"role_id",
	"scope_id"
)
SELECT
	"user_roles"."user_id",
	"user_roles"."role_id",
	"authorization_scopes"."id"
FROM "user_roles"
INNER JOIN "roles"
	ON "roles"."id" = "user_roles"."role_id"
CROSS JOIN "authorization_scopes"
WHERE
	"roles"."code" = 'SYSTEM_ADMIN'
	AND "authorization_scopes"."scope_type" = 'GLOBAL'
ON CONFLICT DO NOTHING;
