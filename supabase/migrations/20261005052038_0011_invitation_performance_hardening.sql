create index if not exists idx_org_compliance_ack_by
  on public.organization_compliance(acknowledged_by);
create index if not exists idx_org_compliance_pack
  on public.organization_compliance(compliance_pack_id);
create index if not exists idx_org_invites_accepted_by
  on public.organization_invitations(accepted_by);
create index if not exists idx_org_invites_invited_by
  on public.organization_invitations(invited_by);

drop policy if exists invitations_insert_admin on public.organization_invitations;
create policy invitations_insert_admin
on public.organization_invitations for insert
to authenticated
with check (
  public.has_org_permission(organization_id,'users.create')
  and invited_by = (select auth.uid())
);

drop policy if exists member_permissions_delete_admin on public.member_permissions;
