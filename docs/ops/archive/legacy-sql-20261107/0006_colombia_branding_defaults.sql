-- Colombia-first localization and tenant branding.

alter table public.organization_branding
  add column if not exists software_name text;

alter table public.organization_settings
  alter column default_currency set default 'COP',
  alter column country set default 'CO',
  alter column timezone set default 'America/Bogota';

update public.organization_settings
set
  default_currency = case when default_currency = 'MXN' then 'COP' else default_currency end,
  country = case when country = 'MX' then 'CO' else country end,
  timezone = case when timezone = 'America/Mexico_City' then 'America/Bogota' else timezone end;

update public.organization_branding
set software_name = coalesce(nullif(software_name, ''), 'JC Inmobili Software');

-- create_organization_with_owner was updated in Supabase to seed COP/CO/America-Bogota
-- and software_name for every new tenant.
