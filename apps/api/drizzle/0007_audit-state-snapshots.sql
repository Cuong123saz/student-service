-- Additive migration: keep historical authentication events in metadata.
-- Nullable snapshots intentionally require no backfill of existing rows.
ALTER TABLE "audit_logs" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "after" jsonb;
