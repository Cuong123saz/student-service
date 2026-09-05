CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
CREATE TABLE "academic_advisor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advisor_user_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_advisor_assignments_status_check" CHECK ("academic_advisor_assignments"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "academic_advisor_assignments_valid_period_check" CHECK ("academic_advisor_assignments"."valid_to" IS NULL OR "academic_advisor_assignments"."valid_to" > "academic_advisor_assignments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "academic_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_classes_status_check" CHECK ("academic_classes"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "faculties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faculties_status_check" CHECK ("faculties"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"student_code" varchar(50) NOT NULL,
	"class_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_advisor_assignments" ADD CONSTRAINT "academic_advisor_assignments_advisor_user_id_users_id_fk" FOREIGN KEY ("advisor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_advisor_assignments" ADD CONSTRAINT "academic_advisor_assignments_class_id_academic_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."academic_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_classes" ADD CONSTRAINT "academic_classes_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_class_id_academic_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."academic_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_advisor_assignments_class_id_idx" ON "academic_advisor_assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "academic_advisor_assignments_advisor_user_id_idx" ON "academic_advisor_assignments" USING btree ("advisor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_classes_code_unique" ON "academic_classes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "academic_classes_faculty_id_idx" ON "academic_classes" USING btree ("faculty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "faculties_code_unique" ON "faculties" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_student_code_unique" ON "student_profiles" USING btree ("student_code");--> statement-breakpoint
CREATE INDEX "student_profiles_class_id_idx" ON "student_profiles" USING btree ("class_id");--> statement-breakpoint
ALTER TABLE "academic_advisor_assignments"
	ADD CONSTRAINT "academic_advisor_assignments_no_overlapping_active"
	EXCLUDE USING gist (
		"class_id" WITH =,
		tstzrange(
			"valid_from",
			COALESCE("valid_to", 'infinity'::timestamptz),
			'[)'
		) WITH &&
	)
	WHERE ("status" = 'ACTIVE');
