-- Regression coverage for the owner-only acceptance boundary.
-- Run with the Supabase test database after applying migrations. The assertions
-- deliberately inspect the live RLS policy so a direct PostgREST insert cannot
-- silently fall back to membership-only authorization.

do $$
declare
  policy_qual text;
  policy_with_check text;
begin
  select qual, with_check
    into policy_qual, policy_with_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'license_acceptances'
    and policyname = 'license_acceptance_insert';

  if policy_with_check is null
     or policy_with_check not like '%ORGANIZATION_OWNER%'
     or policy_with_check not like '%om.status = ''ACTIVE''%'
     or policy_with_check not like '%r.active = true%' then
    raise exception
      'license_acceptance_insert must require an active ORGANIZATION_OWNER';
  end if;
end
$$;

-- Behavioral cases exercised by the Supabase integration suite:
-- 1. owner + accepted_by = auth.uid() + current organization license: succeeds.
-- 2. ADMIN, AGENT, and another active member: direct insert is rejected by RLS.
-- 3. accepted_by different from auth.uid(): rejected by RLS.
-- 4. all roles above retain SELECT access to terms and acceptance history.
