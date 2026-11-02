-- ADR 0025: admission year of the student's niên khóa (K = year - 2006, so 2007 = K1).
-- Nullable; existing rows stay NULL and are never inferred.
ALTER TABLE "student_profiles" ADD COLUMN "cohort_year" smallint;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_cohort_year_check" CHECK ("student_profiles"."cohort_year" IS NULL OR "student_profiles"."cohort_year" BETWEEN 2007 AND 2100);
