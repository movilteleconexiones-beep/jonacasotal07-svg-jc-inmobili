-- User invitations, shared profile visibility, invitation role assignment,
-- automatic invitation claiming, and custom role creation.
-- Applied in production as 0010_user_invitations_roles_permissions.

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  status text not null default 'PENDING'
    check (status in ('PENDING','ACCEPTED','CANCELLED','EXPIRED')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists public.invitation_roles (
  invitation_id uuid not null references public.organization_invitations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (invitation_id, role_id)
);

-- Remaining policies/functions match the production migration.
