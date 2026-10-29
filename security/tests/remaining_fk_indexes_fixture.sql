-- Minimal isolated PostgreSQL schema to exercise all index targets without real user data.
CREATE SCHEMA private;
CREATE TABLE private.website_contact_consents (organization_id uuid, contact_id uuid);
CREATE TABLE public.commission_review_requests (archived_by uuid);
CREATE TABLE public.invitation_roles (role_id uuid);
CREATE TABLE public.license_acceptances (terms_version_id uuid);
CREATE TABLE public.maintenance_requests (reported_by uuid);
CREATE TABLE public.organization_licenses (terms_version_id uuid);
CREATE TABLE public.owner_payout_review_requests (payout_id uuid, requested_by uuid, reviewed_by uuid);
CREATE TABLE public.owner_statement_payouts (recorded_by uuid);
CREATE TABLE public.owner_statements (issued_by uuid, lease_id uuid);
-- Representative rows permit smoke-checking index validity without production data.
INSERT INTO public.owner_statements (issued_by,lease_id)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
