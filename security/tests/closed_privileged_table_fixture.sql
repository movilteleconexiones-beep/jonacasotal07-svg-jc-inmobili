-- PostgreSQL 17 disposable test only. Never execute on Supabase production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA private;
CREATE SCHEMA jco_private;
CREATE TABLE jco_private.active_lease_correction_permits(id bigint PRIMARY KEY);
CREATE TABLE private.property_intake_sites(id bigint PRIMARY KEY);
CREATE TABLE private.website_contact_consents(id bigint PRIMARY KEY);
CREATE TABLE public.payment_events(id bigint PRIMARY KEY);
ALTER TABLE jco_private.active_lease_correction_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.property_intake_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.website_contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jco_private.active_lease_correction_permits FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.property_intake_sites FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.website_contact_consents FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.payment_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_events TO service_role;
