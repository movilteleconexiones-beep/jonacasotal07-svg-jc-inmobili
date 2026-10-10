-- REVIEW ONLY. Do not apply to production without staging verification.
-- Harden inherited permissions by checking role tenant and active state.
create or replace function public.has_org_permission(target_org uuid, permission_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $fn$
 with membership as (
   select id from public.organization_members
   where organization_id=target_org and user_id=auth.uid() and status='ACTIVE'
   limit 1
 ), requested_permission as (
   select id from public.permissions where key=permission_key limit 1
 ), override_effect as (
   select mp.effect from public.member_permissions mp
   join membership m on m.id=mp.organization_member_id
   join requested_permission p on p.id=mp.permission_id
   limit 1
 ), role_grant as (
   select exists (
     select 1 from public.member_roles mr
     join membership m on m.id=mr.organization_member_id
     join public.roles r on r.id=mr.role_id
       and r.organization_id=target_org and r.active=true
     join public.role_permissions rp on rp.role_id=r.id
     join requested_permission p on p.id=rp.permission_id
   ) as granted
 )
 select case
  when exists(select 1 from override_effect where effect='DENY') then false
  when exists(select 1 from override_effect where effect='ALLOW') then true
  else coalesce((select granted from role_grant),false)
 end;
$fn$;
-- Execution privileges and existing policy dependencies must be audited before deployment.
