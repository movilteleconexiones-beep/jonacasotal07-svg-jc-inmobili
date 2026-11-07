-- Country switching RPC.
create or replace function public.set_organization_country(
  target_org uuid,
  target_country_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cp public.country_profiles%rowtype;
  pack_id uuid;
begin
  if not public.has_org_permission(target_org,'settings.edit') then
    raise exception 'Permission denied';
  end if;

  select * into cp
  from public.country_profiles
  where country_code = upper(target_country_code) and active = true;

  if cp.country_code is null then
    raise exception 'Unsupported country';
  end if;

  update public.organization_settings
  set
    default_currency = cp.currency_code,
    country = cp.country_code,
    timezone = cp.timezone,
    language = cp.language,
    locale = cp.locale,
    updated_at = now()
  where organization_id = target_org;

  select id into pack_id
  from public.compliance_packs
  where country_code = cp.country_code and status = 'ACTIVE'
  order by effective_date desc nulls last, created_at desc
  limit 1;

  insert into public.organization_compliance(
    organization_id, compliance_pack_id, status, updated_at
  )
  values(
    target_org,
    pack_id,
    case when pack_id is null then 'REVIEW_REQUIRED' else 'ACTIVE' end,
    now()
  )
  on conflict (organization_id) do update set
    compliance_pack_id = excluded.compliance_pack_id,
    status = excluded.status,
    acknowledged_by = null,
    acknowledged_at = null,
    updated_at = now();

  insert into public.audit_log(
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values(
    target_org,
    auth.uid(),
    'organization.country_changed',
    'organization',
    target_org,
    jsonb_build_object(
      'country', cp.country_code,
      'currency', cp.currency_code,
      'locale', cp.locale,
      'timezone', cp.timezone
    )
  );
end;
$$;

revoke all on function public.set_organization_country(uuid,text) from public,anon;
grant execute on function public.set_organization_country(uuid,text) to authenticated;
