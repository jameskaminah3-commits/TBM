-- TBM's Spotlight (shared/spotlight.ts): TBM shares a provider's live page on
-- its own channels, using the existing share-link tables (listing_kind
-- 'provider', made by a TBM admin). Additive only. The server also adds this
-- column on start (server/provider-pages.ts).

-- When the provider said no to being featured. Empty means TBM may feature
-- their page while it's live.
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS spotlight_opt_out_at text;
