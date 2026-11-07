-- Set default software name.
update public.organization_branding
set software_name = 'SISTEMA INMOBILIARIO JCO'
where software_name is null
   or software_name = ''
   or software_name = 'JC Inmobili Software';

-- The three-argument create_organization_with_owner function is updated in production
-- to seed software_name = 'SISTEMA INMOBILIARIO JCO' for new organizations.
