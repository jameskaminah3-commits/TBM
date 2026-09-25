-- 0002_tbm_business.sql
--
-- Tembea Bila Matata moves in as business number one. These are starting
-- settings, to be confirmed with TBM:
--   staffed hours   07:00–22:00 Kenya time, every day
--   unclaimed chat  back to Zaina, with a callback request, after 10 minutes
--   model budget    30 million tokens a day (roughly 800 chat turns)
--   transcripts     deleted 90 days after the last message (the proposal in
--                   the Productisation Plan)
-- The public key is what TBM's website widget sends; it is not a secret.

insert into businesses (
  id, name, public_key, allowed_origins, time_zone, staffed_hours,
  unclaimed_timeout_minutes, daily_token_cap, retention_days
) values (
  'tbm',
  'Tembea Bila Matata',
  'pk_tbm_live',
  array['https://tembeabilamatata.com', 'https://www.tembeabilamatata.com'],
  'Africa/Nairobi',
  '{"days": [0, 1, 2, 3, 4, 5, 6], "open": "07:00", "close": "22:00"}',
  10,
  30000000,
  90
);
