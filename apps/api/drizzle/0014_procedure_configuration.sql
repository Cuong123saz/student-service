CREATE TABLE "procedure_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" integer NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "procedure_versions_status_check" CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
	CONSTRAINT "procedure_versions_numbers_check" CHECK (version_number > 0 AND revision > 0),
	CONSTRAINT "procedure_versions_config_check" CHECK (jsonb_typeof(config) = 'object'),
	CONSTRAINT "procedure_versions_publication_check" CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_owner_unit_id_organizational_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."organizational_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_versions_service_version_unique" ON "procedure_versions" USING btree ("service_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_versions_one_draft" ON "procedure_versions" USING btree ("service_id") WHERE status = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_versions_one_published" ON "procedure_versions" USING btree ("service_id") WHERE status = 'PUBLISHED';--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION protect_procedure_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published procedure versions cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.config IS DISTINCT FROM OLD.config OR
    NEW.service_id IS DISTINCT FROM OLD.service_id OR
    NEW.owner_unit_id IS DISTINCT FROM OLD.owner_unit_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.published_at IS DISTINCT FROM OLD.published_at OR
    NEW.revision IS DISTINCT FROM OLD.revision
  ) THEN
    RAISE EXCEPTION 'Published procedure content is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PUBLISHED')) OR
    (OLD.status = 'PUBLISHED' AND NEW.status IN ('PUBLISHED', 'RETIRED')) OR
    (OLD.status = 'RETIRED' AND NEW.status = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'Invalid procedure version state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procedure_version_immutability
  BEFORE UPDATE OR DELETE ON procedure_versions
  FOR EACH ROW EXECUTE FUNCTION protect_procedure_version();
