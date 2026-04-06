ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;

UPDATE "users"
SET "email_verified_at" = COALESCE("email_verified_at", "created_at", NOW())
WHERE "email" IS NOT NULL
  AND "email_verified_at" IS NULL;

CREATE TABLE IF NOT EXISTS "email_verification_otps" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL,
  "email" varchar NOT NULL,
  "otp_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_email_verification_otps_email"
ON "email_verification_otps" ("email");
