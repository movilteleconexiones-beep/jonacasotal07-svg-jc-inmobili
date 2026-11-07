-- INMOJCO #104: MINIMAL AUTH FIXTURE FOR DISPOSABLE PG17 ONLY.
-- This is NOT Supabase Auth, Storage or a recovered production backup.
-- Applied solely after dedicated jco_migration_104_replay_test creation.
-- The real auth.users catalogue is Supabase-managed; this is a deliberate stub.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
