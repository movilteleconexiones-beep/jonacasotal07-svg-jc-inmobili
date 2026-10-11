-- Preserve accepted terms when aligning the official site's older schema.
-- Apply this before verified_tenant_billing when billing is not installed yet.
BEGIN;
ALTER TABLE public.license_acceptances ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES public.organizations(id);
ALTER TABLE public.license_acceptances ADD COLUMN IF NOT EXISTS terms_snapshot text;
ALTER TABLE public.license_acceptances ADD COLUMN IF NOT EXISTS acceptance_user_agent text;
UPDATE public.license_acceptances a SET organization_id=l.organization_id
  FROM public.organization_licenses l WHERE l.id=a.organization_license_id AND a.organization_id IS NULL;
UPDATE public.license_acceptances a SET terms_snapshot=t.terms_markdown
  FROM public.license_terms_versions t WHERE t.id=a.terms_version_id AND a.terms_snapshot IS NULL;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='license_acceptances' AND column_name='user_agent') THEN
    EXECUTE 'UPDATE public.license_acceptances SET acceptance_user_agent=user_agent WHERE acceptance_user_agent IS NULL';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS license_acceptances_organization_idx ON public.license_acceptances(organization_id);

-- An older frontend still submits license ID, terms ID and user_agent. Derive
-- the added fields from that actual acceptance, never from an assumed version.
CREATE OR REPLACE FUNCTION public.normalize_license_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected_org uuid; accepted_terms text;
BEGIN
  SELECT organization_id INTO expected_org FROM public.organization_licenses WHERE id=NEW.organization_license_id;
  SELECT terms_markdown INTO accepted_terms FROM public.license_terms_versions WHERE id=NEW.terms_version_id;
  IF expected_org IS NULL OR accepted_terms IS NULL OR
    (NEW.organization_id IS NOT NULL AND NEW.organization_id<>expected_org) THEN
    RAISE EXCEPTION 'Invalid license acceptance' USING ERRCODE='42501';
  END IF;
  NEW.organization_id:=expected_org;
  NEW.terms_snapshot:=accepted_terms;
  NEW.acceptance_user_agent:=coalesce(NEW.acceptance_user_agent,to_jsonb(NEW)->>'user_agent');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_license_acceptance() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS normalize_license_acceptance ON public.license_acceptances;
CREATE TRIGGER normalize_license_acceptance BEFORE INSERT ON public.license_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.normalize_license_acceptance();

-- Both released schemas keep their existing status values; new registrations
-- also need a pending license. No licenses or acceptances are deleted.
DO $$ DECLARE c record; BEGIN
  IF EXISTS(SELECT 1 FROM public.organization_licenses WHERE status NOT IN
    ('PENDING','ACTIVE','SUSPENDED','EXPIRED','CANCELLED','TERMINATED')) THEN
    RAISE EXCEPTION 'Unsupported license status; inspect before aligning';
  END IF;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.organization_licenses'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE public.organization_licenses DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
ALTER TABLE public.organization_licenses ADD CONSTRAINT jco_license_status
  CHECK(status IN ('PENDING','ACTIVE','SUSPENDED','EXPIRED','CANCELLED','TERMINATED'));
REVOKE INSERT,UPDATE,DELETE ON public.organization_licenses,public.subscriptions FROM anon,authenticated;

-- The older bootstrap inserts its own license and a free subscription. Let the
-- billing trigger keep the pending license and let payment authorize access.
DO $$ DECLARE definition text; patched text; BEGIN
  IF to_regprocedure('public.create_organization_with_owner(text,text,text)') IS NOT NULL THEN
    definition:=pg_get_functiondef('public.create_organization_with_owner(text,text,text)'::regprocedure);
    IF position('active_terms_id' IN definition)>0 AND position('organization_licenses' IN definition)>0 THEN
      patched:=replace(definition,E'false,false,false,false,false,false,active_terms_id\n  );',
        E'false,false,false,false,false,false,active_terms_id\n  ) on conflict (organization_id) do nothing;');
      IF patched=definition AND position(E'active_terms_id\n  ) on conflict (organization_id) do nothing;' IN definition)=0 THEN
        RAISE EXCEPTION 'Unsupported license bootstrap; inspect before aligning';
      END IF;
      patched:=replace(patched,'if basic_plan_id is not null then',
        'if basic_plan_id is not null and to_regclass(''public.organization_billing_access'') is null then');
      IF patched<>definition THEN EXECUTE patched; END IF;
    END IF;
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
