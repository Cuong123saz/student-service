ALTER TABLE "student_import_processing_jobs"
  DROP CONSTRAINT "student_import_processing_jobs_result_state_check";

ALTER TABLE "student_import_processing_jobs"
  ADD CONSTRAINT "student_import_processing_jobs_result_state_check"
  CHECK (
    ("status" = 'SUCCEEDED' AND "last_error_code" IS NULL)
    OR ("status" = 'FAILED' AND "preview_id" IS NULL AND "last_error_code" IS NOT NULL)
    OR ("status" IN ('PENDING', 'PROCESSING') AND "preview_id" IS NULL)
  );
