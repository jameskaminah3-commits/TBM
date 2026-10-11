-- TBM manages guest communication: guests talk to TBM, and each partner talks
-- to TBM about their job. Existing messages stay in the guest conversation.
ALTER TABLE booking_messages ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'guest';
ALTER TABLE booking_messages ADD COLUMN IF NOT EXISTS partner_user_id varchar;

CREATE INDEX IF NOT EXISTS booking_messages_conversation_idx
  ON booking_messages (booking_id, audience, partner_user_id, created_at);
