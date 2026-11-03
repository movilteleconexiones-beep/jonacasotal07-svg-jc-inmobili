-- INMOJCO | Candidate only. DO NOT apply to production while issue #104 is NO-GO.
-- Requires staged proof with authentic schema, trusted backup and a measured lock window.
-- Enforces same organization for CRM leads, linked properties, and accepted consignments.
-- PostgreSQL 17. Runs atomically: any failed preflight or VALIDATE rolls back all changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Read-only integrity preflight; must fail BEFORE any DDL if live rows are inconsistent.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.contacts c ON c.id=l.contact_id
    WHERE l.organization_id<>c.organization_id
  ) THEN RAISE EXCEPTION 'NO-GO: leads reference contacts from another agency'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.properties p ON p.id=l.property_id
    WHERE l.organization_id<>p.organization_id
  ) THEN RAISE EXCEPTION 'NO-GO: leads reference properties from another agency'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.property_consignments pc
    JOIN public.contacts c ON c.id=pc.contact_id
    WHERE pc.organization_id<>c.organization_id
  ) THEN RAISE EXCEPTION 'NO-GO: consignments reference contacts from another agency'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.property_consignments pc
    JOIN public.properties p ON p.id=pc.property_id
    WHERE pc.organization_id<>p.organization_id
  ) THEN RAISE EXCEPTION 'NO-GO: consignments reference properties from another agency'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.property_consignments pc
    WHERE pc.lead_id IS NOT NULL AND pc.contact_id IS NULL
  ) THEN RAISE EXCEPTION 'NO-GO: consignment with lead has no contact (composite FK null bypass)'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.property_consignments pc
    JOIN public.leads l ON l.id=pc.lead_id
    WHERE pc.organization_id<>l.organization_id OR pc.contact_id IS DISTINCT FROM l.contact_id
  ) THEN RAISE EXCEPTION 'NO-GO: consignment lead belongs to another agency/contact'; END IF;
END $preflight$;

-- contacts and properties already have UNIQUE (organization_id,id) in the active schema.
-- Lead uniqueness must additionally bind the consent/consignment to its exact contact.
-- One composite unique index satisfies the 3-column accepted-consignment FK.
CREATE UNIQUE INDEX jco_leads_org_id_contact_fk_key
  ON public.leads(organization_id,id,contact_id);

ALTER TABLE public.leads
  ADD CONSTRAINT jco_leads_org_contact_fk
    FOREIGN KEY (organization_id,contact_id)
    REFERENCES public.contacts(organization_id,id) NOT VALID,
  ADD CONSTRAINT jco_leads_org_property_fk
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id) NOT VALID;

ALTER TABLE public.property_consignments
  ADD CONSTRAINT jco_consignment_org_contact_fk
    FOREIGN KEY (organization_id,contact_id)
    REFERENCES public.contacts(organization_id,id) NOT VALID,
  ADD CONSTRAINT jco_consignment_org_property_fk
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id) NOT VALID,
  ADD CONSTRAINT jco_consignment_org_lead_contact_fk
    FOREIGN KEY (organization_id,lead_id,contact_id)
    REFERENCES public.leads(organization_id,id,contact_id) NOT VALID;

-- MATCH SIMPLE composite FKs skip validation when ANY referencing column is NULL.
-- A consignment linked to a lead must carry a contact for the 3-column FK
-- to enforce exact lead/contact/organization identity (including future writes).
ALTER TABLE public.property_consignments
  ADD CONSTRAINT jco_consignment_lead_requires_contact
  CHECK (lead_id IS NULL OR contact_id IS NOT NULL) NOT VALID;

-- Protect existing rows too. If any check fails the whole candidate is rolled back.
ALTER TABLE public.property_consignments VALIDATE CONSTRAINT jco_consignment_lead_requires_contact;
ALTER TABLE public.leads VALIDATE CONSTRAINT jco_leads_org_contact_fk;
ALTER TABLE public.leads VALIDATE CONSTRAINT jco_leads_org_property_fk;
ALTER TABLE public.property_consignments VALIDATE CONSTRAINT jco_consignment_org_contact_fk;
ALTER TABLE public.property_consignments VALIDATE CONSTRAINT jco_consignment_org_property_fk;
ALTER TABLE public.property_consignments VALIDATE CONSTRAINT jco_consignment_org_lead_contact_fk;
COMMIT;
