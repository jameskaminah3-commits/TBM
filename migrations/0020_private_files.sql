-- Protected files (vehicle documents, fleet-application files, guests'
-- attachments) move to private storage, opened only through /api/files/<key>.
CREATE TABLE IF NOT EXISTS private_files (
  key varchar PRIMARY KEY,
  kind varchar NOT NULL,
  owner_user_id varchar,
  mime_type varchar,
  size_bytes integer,
  source_path text,
  created_at text NOT NULL
);

-- Every attempt to open a protected file, allowed or refused.
CREATE TABLE IF NOT EXISTS private_file_access (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key varchar NOT NULL,
  user_id varchar,
  role varchar,
  allowed boolean NOT NULL,
  reason varchar NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS private_file_access_file_idx ON private_file_access (file_key, created_at);

-- Each existing file moved out of the public bucket, for checking, audit and rollback.
CREATE TABLE IF NOT EXISTS storage_migrations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  old_path text NOT NULL UNIQUE,
  new_key varchar NOT NULL,
  category varchar NOT NULL,
  references_updated integer NOT NULL DEFAULT 0,
  copied_at text NOT NULL,
  verified_at text,
  public_removed_at text
);
