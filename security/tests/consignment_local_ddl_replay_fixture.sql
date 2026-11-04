-- #104 — PostgreSQL 17 DISPOSABLE fixture ONLY.
-- Minimal referenced parents and API roles required to apply the original
-- two CREATE TABLE definitions, index DDL, RLS, ACL and read policy from
-- supabase/migrations/20261010212630_property_consignment_intake.sql.
-- Does not create or restore any real Supabase data or historical ledger.
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA auth;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.properties(id uuid PRIMARY KEY);
CREATE TABLE public.contacts(id uuid PRIMARY KEY);
CREATE TABLE public.leads(id uuid PRIMARY KEY);
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION public.has_org_permission(uuid,text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='' AS $$ SELECT false $$;
