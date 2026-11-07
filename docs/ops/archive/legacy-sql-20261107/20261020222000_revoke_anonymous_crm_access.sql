-- Defense in depth: PostgREST anonymous users must use only the guarded
-- public submission RPC, never direct read/write access to private CRM tables.
BEGIN;
REVOKE ALL PRIVILEGES ON TABLE public.contacts, public.leads FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.contacts, public.leads FROM PUBLIC;
COMMIT;
