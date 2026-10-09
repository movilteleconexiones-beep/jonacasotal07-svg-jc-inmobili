-- INMOJCO: hardened platform subscription assignment.
-- REVIEW ONLY. Apply in an isolated Supabase branch after security tests.
-- Preserves the RPC signature for existing clients.
-- Append-only record for manual, non-entitled contract drafts.
-- No billing activation or payment verification is implied by this record.
create table if not exists public.platform_subscription_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  actor_id uuid not null,
  action text not null check (action = 'CREATE_NON_ENTITLED_DRAFT'),
  plan_id uuid not null references public.plans(id),
  billing_mode text not null,
  subscription_status text not null,
  created_at timestamptz not null default now()
);
alter table public.platform_subscription_audit enable row level security;
revoke all on public.platform_subscription_audit from public;
-- No client-facing policies: access requires a separately reviewed admin read API.

create or replace function public.platform_set_subscription(
  target_org uuid,
  target_plan_code text,
  target_billing_mode text,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_plan_id uuid;
  existing_subscription public.subscriptions%rowtype;
  target_org_status text;
  period_end timestamptz;
  created_subscription_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  if target_org is null or target_plan_code is null or target_billing_mode is null or target_status is null then
    raise exception 'Missing required subscription data' using errcode = '22023';
  end if;

  if target_billing_mode not in ('SAAS_MONTHLY','SAAS_ANNUAL','LIFETIME','DEDICATED','CUSTOM')
     or target_status not in ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','LIFETIME') then
    raise exception 'Unsupported billing mode or status' using errcode = '22023';
  end if;

  if (target_billing_mode = 'LIFETIME') <> (target_status = 'LIFETIME') then
    raise exception 'Lifetime billing and lifetime status must match' using errcode = '22023';
  end if;

  -- Serialize subscription changes for the same organization.
  select o.status into target_org_status
  from public.organizations o where o.id = target_org for update;
  if not found then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;

  if target_org_status <> 'ACTIVE' then
    raise exception 'Organization must be active before assigning a subscription' using errcode = '22023';
  end if;

  select p.id into target_plan_id
  from public.plans p
  where p.code = target_plan_code and p.active = true;
  if target_plan_id is null then
    raise exception 'Unknown or inactive plan' using errcode = '22023';
  end if;

  if target_billing_mode in ('DEDICATED', 'CUSTOM') and target_plan_code <> 'ENTERPRISE' then
    raise exception 'Dedicated and custom contracts require an enterprise plan' using errcode = '22023';
  end if;

  if (target_plan_code = 'LIFETIME') <> (target_billing_mode = 'LIFETIME') then
    raise exception 'Lifetime plan requires lifetime billing mode' using errcode = '22023';
  end if;

  select s.* into existing_subscription
  from public.subscriptions s where s.organization_id = target_org for update;

  if found then
    if existing_subscription.plan_id is not distinct from target_plan_id
       and existing_subscription.billing_mode = target_billing_mode
       and existing_subscription.status = target_status then
      return; -- Idempotent: do not reset the billing period.
    end if;

    -- No implicit renewal, activation, or contract conversion.
    if existing_subscription.plan_id is distinct from target_plan_id
       or existing_subscription.billing_mode is distinct from target_billing_mode then
      raise exception 'Changing an existing plan or billing mode requires a separate audited workflow'
        using errcode = '22023';
    end if;

    -- Status transitions may grant or revoke access: require a separate audited workflow.
    raise exception 'Changing subscription status requires a separate audited workflow'
      using errcode = '22023';
  end if;

  -- Never create a paid/active entitlement through this manual RPC before payment verification.
  if target_status not in ('SUSPENDED', 'CANCELLED') then
    raise exception 'Creating an entitlement requires a separate audited grant workflow'
      using errcode = '22023';
  end if;

  -- A non-entitled draft has no active billing period.
  period_end := null;

  insert into public.subscriptions (
    organization_id, plan_id, status, billing_mode,
    current_period_start, current_period_end, updated_at
  ) values (
    target_org, target_plan_id, target_status, target_billing_mode,
    null, period_end, now()
  ) returning id into created_subscription_id;

  insert into public.platform_subscription_audit (
    organization_id, subscription_id, actor_id, action,
    plan_id, billing_mode, subscription_status
  ) values (
    target_org, created_subscription_id, auth.uid(), 'CREATE_NON_ENTITLED_DRAFT',
    target_plan_id, target_billing_mode, target_status
  );
  -- Do not modify organizations.status: administrative and commercial status are separate.
end;
$function$;
