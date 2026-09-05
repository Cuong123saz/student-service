CREATE TABLE "user_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_action_tokens_purpose_check" CHECK (
          "user_action_tokens"."purpose" IN (
            'ACCOUNT_ACTIVATION',
            'PASSWORD_RESET'
          )
        ),
	CONSTRAINT "user_action_tokens_terminal_state_check" CHECK (
          NOT (
            "user_action_tokens"."consumed_at" IS NOT NULL
            AND "user_action_tokens"."revoked_at" IS NOT NULL
          )
        )
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_action_tokens" ADD CONSTRAINT "user_action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_action_tokens" ADD CONSTRAINT "user_action_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_action_tokens_token_hash_idx" ON "user_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_action_tokens_one_open_idx" ON "user_action_tokens" USING btree ("user_id","purpose") WHERE 
            "user_action_tokens"."consumed_at" IS NULL
            AND "user_action_tokens"."revoked_at" IS NULL
          ;--> statement-breakpoint
CREATE INDEX "user_action_tokens_expires_at_idx" ON "user_action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_action_tokens_created_by_idx" ON "user_action_tokens" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "users_status_invited_at_idx" ON "users" USING btree ("status","invited_at");