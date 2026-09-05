ALTER TABLE "users" ADD COLUMN "last_invitation_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_status_last_invitation_sent_at_idx" ON "users" USING btree ("status","last_invitation_sent_at");--> statement-breakpoint
ALTER TABLE "user_action_tokens" ADD CONSTRAINT "user_action_tokens_expiration_policy_check" CHECK (
    "user_action_tokens"."expires_at"
      > "user_action_tokens"."created_at"
    AND (
      (
        "user_action_tokens"."purpose"
          = 'ACCOUNT_ACTIVATION'
        AND "user_action_tokens"."expires_at"
          <= "user_action_tokens"."created_at"
            + INTERVAL '72 hours'
      )
      OR
      (
        "user_action_tokens"."purpose"
          = 'PASSWORD_RESET'
        AND "user_action_tokens"."expires_at"
          <= "user_action_tokens"."created_at"
            + INTERVAL '30 minutes'
      )
    )
  );