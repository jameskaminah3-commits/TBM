ALTER TABLE errands
ADD COLUMN IF NOT EXISTS help_mama_pricing jsonb NOT NULL DEFAULT '{"enabled":false,"hourlyDaytimePrice":0,"hourlyEveningPrice":0,"overnightPrice":0,"fullDayPrice":0,"ageBands":[]}'::jsonb;
