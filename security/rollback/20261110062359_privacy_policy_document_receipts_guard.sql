-- EMERGENCY ONLY: reopens previously blocked consent routes.
-- Use only after separate incident review and a recorded rollback decision.
BEGIN;
ALTER TABLE private.website_lead_consents
  DROP CONSTRAINT IF EXISTS website_lead_consents_not_platform_page;
ALTER TABLE private.website_contact_consents
  DROP CONSTRAINT IF EXISTS website_contact_consents_not_platform_page;
COMMIT;
