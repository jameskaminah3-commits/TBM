CREATE TABLE IF NOT EXISTS partner_admin_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id varchar NOT NULL,
  user_id varchar NOT NULL,
  sender_role text NOT NULL,
  message text NOT NULL,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS partner_admin_messages_provider_idx
  ON partner_admin_messages (provider_user_id, created_at);
