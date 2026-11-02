-- ADR 0031: activity registration, waitlist and cancellation requests. One row per student per activity;
-- seats are guarded in the database; history is append-only in activity_registration_events.
CREATE TABLE "activity_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"student_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
	"status" varchar(20) NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"cancel_reason" varchar(500),
	"cancel_requested_at" timestamp with time zone,
	"decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(500),
	"auto_accepted" boolean DEFAULT false NOT NULL,
	"excused" boolean DEFAULT false NOT NULL,
	"promoted_at" timestamp with time zone,
	"promotion_seen_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_registrations_status_check" CHECK ("status" IN ('REGISTERED','WAITLISTED','CANCEL_REQUESTED','CANCELLED','WITHDRAWN')),
	CONSTRAINT "activity_registrations_cancel_check" CHECK ("status" NOT IN ('CANCEL_REQUESTED','CANCELLED') OR ("cancel_reason" IS NOT NULL AND "cancel_requested_at" IS NOT NULL)),
	CONSTRAINT "activity_registrations_excused_check" CHECK (NOT "excused" OR "status"='CANCELLED'),
	CONSTRAINT "activity_registrations_revision_check" CHECK ("revision" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_registrations_unique" ON "activity_registrations" ("activity_id","student_user_id");--> statement-breakpoint
CREATE INDEX "activity_registrations_queue_idx" ON "activity_registrations" ("activity_id","status","queued_at","id");--> statement-breakpoint
CREATE INDEX "activity_registrations_student_idx" ON "activity_registrations" ("student_user_id","created_at");--> statement-breakpoint
CREATE TABLE "activity_registration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL REFERENCES "activity_registrations"("id") ON DELETE restrict,
	"activity_id" uuid NOT NULL REFERENCES "activities"("id") ON DELETE restrict,
	"action" varchar(30) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"actor_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "activity_registration_events_action_check" CHECK ("action" IN ('REGISTERED','WAITLISTED','PROMOTED','CANCEL_REQUESTED','CANCEL_ACCEPTED','CANCEL_REJECTED','CANCEL_AUTO_ACCEPTED','WITHDRAWN'))
);--> statement-breakpoint
CREATE INDEX "activity_registration_events_registration_idx" ON "activity_registration_events" ("registration_id","created_at");--> statement-breakpoint
CREATE TRIGGER "activity_registration_events_protect" BEFORE UPDATE OR DELETE ON "activity_registration_events" FOR EACH ROW EXECUTE FUNCTION protect_activity_history();--> statement-breakpoint
-- Seats: REGISTERED and CANCEL_REQUESTED hold a seat. Entering a seat locks the activity row so
-- concurrent registrations queue up and can never exceed the capacity.
CREATE FUNCTION protect_activity_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a activities%ROWTYPE; held integer; entering boolean; fresh boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACTIVITY_REGISTRATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.activity_id<>OLD.activity_id OR NEW.student_user_id<>OLD.student_user_id OR NEW.revision<>OLD.revision+1) THEN
  RAISE EXCEPTION 'ACTIVITY_REGISTRATION_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.revision<>0 THEN RAISE EXCEPTION 'ACTIVITY_REGISTRATION_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM activities WHERE id=NEW.activity_id FOR UPDATE;
 entering := NEW.status IN ('REGISTERED','CANCEL_REQUESTED') AND (TG_OP='INSERT' OR OLD.status NOT IN ('REGISTERED','CANCEL_REQUESTED'));
 -- A new place in the activity (new row, re-registration or promotion) needs a published activity before it starts.
 fresh := NEW.status IN ('REGISTERED','WAITLISTED') AND (TG_OP='INSERT' OR OLD.status IN ('CANCELLED','WITHDRAWN','WAITLISTED'));
 IF fresh AND (a.status<>'PUBLISHED' OR clock_timestamp()>=a.starts_at) THEN RAISE EXCEPTION 'ACTIVITY_REGISTRATION_CLOSED' USING ERRCODE='23514'; END IF;
 IF entering AND a.capacity IS NOT NULL THEN
  SELECT count(*) INTO held FROM activity_registrations WHERE activity_id=NEW.activity_id AND status IN ('REGISTERED','CANCEL_REQUESTED') AND id<>NEW.id;
  IF held>=a.capacity THEN RAISE EXCEPTION 'ACTIVITY_REGISTRATION_FULL' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "activity_registrations_protect" BEFORE INSERT OR UPDATE OR DELETE ON "activity_registrations" FOR EACH ROW EXECUTE FUNCTION protect_activity_registration();--> statement-breakpoint
-- Pending cancellation requests are accepted automatically once the activity has started.
CREATE FUNCTION activity_settle(activity uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
 FOR r IN SELECT g.id FROM activity_registrations g JOIN activities a ON a.id=g.activity_id
  WHERE g.activity_id=activity AND g.status='CANCEL_REQUESTED' AND a.starts_at<=clock_timestamp() ORDER BY g.id FOR UPDATE OF g LOOP
  UPDATE activity_registrations SET status='CANCELLED',excused=true,auto_accepted=true,decided_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=r.id;
  INSERT INTO activity_registration_events(registration_id,activity_id,action,from_status,to_status) VALUES(r.id,activity,'CANCEL_AUTO_ACCEPTED','CANCEL_REQUESTED','CANCELLED');
  n := n+1;
 END LOOP;
 RETURN n;
END $$;--> statement-breakpoint
-- Fills free seats from the waitlist in queue order, only while the activity is published and not started.
CREATE FUNCTION activity_promote(activity uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE a activities%ROWTYPE; next_id uuid; held integer; n integer := 0;
BEGIN
 SELECT * INTO a FROM activities WHERE id=activity FOR UPDATE;
 IF a.status<>'PUBLISHED' OR clock_timestamp()>=a.starts_at THEN RETURN 0; END IF;
 LOOP
  SELECT count(*) INTO held FROM activity_registrations WHERE activity_id=activity AND status IN ('REGISTERED','CANCEL_REQUESTED');
  EXIT WHEN a.capacity IS NOT NULL AND held>=a.capacity;
  SELECT id INTO next_id FROM activity_registrations WHERE activity_id=activity AND status='WAITLISTED' ORDER BY queued_at,id LIMIT 1 FOR UPDATE;
  EXIT WHEN next_id IS NULL;
  UPDATE activity_registrations SET status='REGISTERED',promoted_at=clock_timestamp(),promotion_seen_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=next_id;
  INSERT INTO activity_registration_events(registration_id,activity_id,action,from_status,to_status) VALUES(next_id,activity,'PROMOTED','WAITLISTED','REGISTERED');
  n := n+1;
 END LOOP;
 RETURN n;
END $$;
