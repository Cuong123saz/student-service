-- ADR0009 was committed before this migration. Adding DEFAULT backfills without UPDATE or disabling append-only history.
ALTER TABLE "submission_rounds" ADD COLUMN "declaration_template" jsonb DEFAULT '{"id":"submission-summary-v1","sha256":"9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2","bindingSource":"LEGACY_V1"}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "submission_rounds" ALTER COLUMN "declaration_template" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "submission_rounds" ADD CONSTRAINT "submission_rounds_template_check" CHECK (jsonb_typeof("submission_rounds"."declaration_template") = 'object'
      AND "submission_rounds"."declaration_template" ?& ARRAY['id','sha256','bindingSource']
      AND "submission_rounds"."declaration_template" - 'id' - 'sha256' - 'bindingSource' = '{}'::jsonb
      AND jsonb_typeof("submission_rounds"."declaration_template"->'id') = 'string'
      AND ("submission_rounds"."declaration_template"->>'id') ~ '^submission-summary-v[1-9][0-9]*$'
      AND jsonb_typeof("submission_rounds"."declaration_template"->'sha256') = 'string'
      AND ("submission_rounds"."declaration_template"->>'sha256') ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof("submission_rounds"."declaration_template"->'bindingSource') = 'string'
      AND ("submission_rounds"."declaration_template"->>'bindingSource') IN ('SUBMITTED','LEGACY_V1'));