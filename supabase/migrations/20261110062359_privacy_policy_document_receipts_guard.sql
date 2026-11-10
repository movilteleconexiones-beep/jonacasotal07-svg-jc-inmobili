-- Applied in Supabase production on 2026-11-10 as migration 20261110062359.
-- Preserves existing immutable consents and only constrains future receipts.
-- Tested in isolated PostgreSQL 17, GitHub Actions run #42767741047.
-- REVIEW ONLY. Run in disposable PostgreSQL 17 before any production migration.
-- An anonymous CRM caller must not accept the INMOJCO homepage, backoffice
-- or agency storefront as a published agency-specific privacy policy.
-- The final consent insert is in the same transaction as contacts and leads,
-- so a check violation aborts the entire unapproved data capture.
-- This does not validate legal approval or HTTP availability of a document.

ALTER TABLE private.website_lead_consents
  ADD CONSTRAINT website_lead_consents_not_platform_page
  CHECK (
    lower(btrim(policy_url)) !~ '^https://(www\.)?inmojco\.com\.?(:443)?(?:/|[?#]|$)'
    OR lower(btrim(policy_url)) ~ '^https://(www\.)?inmojco\.com\.?(:443)?/(politicas/[^/?#]+|politica-de-datos(?:/|[?#]|$)|politica-de-privacidad(?:/|[?#]|$)|privacidad(?:/|[?#]|$))'
  );

ALTER TABLE private.website_contact_consents
  ADD CONSTRAINT website_contact_consents_not_platform_page
  CHECK (
    lower(btrim(policy_url)) !~ '^https://(www\.)?inmojco\.com\.?(:443)?(?:/|[?#]|$)'
    OR lower(btrim(policy_url)) ~ '^https://(www\.)?inmojco\.com\.?(:443)?/(politicas/[^/?#]+|politica-de-datos(?:/|[?#]|$)|politica-de-privacidad(?:/|[?#]|$)|privacidad(?:/|[?#]|$))'
  );

