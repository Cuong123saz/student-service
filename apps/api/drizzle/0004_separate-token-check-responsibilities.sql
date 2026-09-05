ALTER TABLE "user_action_tokens" DROP CONSTRAINT "user_action_tokens_expiration_policy_check";--> statement-breakpoint
ALTER TABLE "user_action_tokens" ADD CONSTRAINT "user_action_tokens_expiration_policy_check" CHECK (
    "user_action_tokens"."expires_at"
      > "user_action_tokens"."created_at"

    AND (
      "user_action_tokens"."purpose"
        <> 'ACCOUNT_ACTIVATION'
      OR
      "user_action_tokens"."expires_at"
        <= "user_action_tokens"."created_at"
          + INTERVAL '72 hours'
    )

    AND (
      "user_action_tokens"."purpose"
        <> 'PASSWORD_RESET'
      OR
      "user_action_tokens"."expires_at"
        <= "user_action_tokens"."created_at"
          + INTERVAL '30 minutes'
    )
  );