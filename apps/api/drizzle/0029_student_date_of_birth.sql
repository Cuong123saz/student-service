-- ADR 0027: student date of birth (personal data). Nullable; existing rows stay NULL.
ALTER TABLE "student_profiles" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_date_of_birth_check" CHECK ("student_profiles"."date_of_birth" IS NULL OR "student_profiles"."date_of_birth" BETWEEN '1900-01-01' AND '2099-12-31');
