-- INMOJCO #104: MINIMAL AUTH FIXTURE FOR DISPOSABLE PG17 ONLY.
-- This is NOT Supabase Auth, Storage or a recovered production backup.
-- Applied solely after dedicated jco_migration_104_replay_test creation.
-- The real auth.users catalogue is Supabase-managed; this is a deliberate stub.
-- Supabase production has pgcrypto installed inside extensions.
-- Use the same managed extension schema only in the disposable database.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
-- Supabase-managed grants to the trusted service role exist BEFORE user DDL.
-- Only in this disposable database. The service role stays NOLOGIN.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;

-- Synthetic supabase-managed objects required by early (<=0026) migrations.
-- Column names / functions are enough for DDL parse; NOT production semantics.
CREATE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT '{}'::jsonb $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(object_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT string_to_array(object_name, '/') $$;
