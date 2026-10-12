-- Share claims from Zaina chats, kept in the database so a booking Zaina makes
-- in a chat is credited to the share link even after a server restart. Rows
-- older than 30 days (the credit window) are deleted by the server. Device and
-- address are stored only as keyed hashes. The server also creates this table
-- on first use.
CREATE TABLE IF NOT EXISTS zaina_share_claims (
  session_id varchar PRIMARY KEY,
  claim jsonb NOT NULL,
  device_hash varchar,
  ip_hash varchar,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS zaina_share_claims_updated_idx ON zaina_share_claims (updated_at);
