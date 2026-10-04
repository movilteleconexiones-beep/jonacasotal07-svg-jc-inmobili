-- Normalize visible software name casing.
update public.organization_branding
set software_name = 'Sistema Inmobiliario JCO'
where software_name = 'SISTEMA INMOBILIARIO JCO'
   or software_name = 'JC Inmobili Software'
   or software_name is null
   or software_name = '';

create or replace function public.normalize_jco_software_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.software_name is null
     or trim(new.software_name) = ''
     or new.software_name = 'SISTEMA INMOBILIARIO JCO'
     or new.software_name = 'JC Inmobili Software'
  then
    new.software_name := 'Sistema Inmobiliario JCO';
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_jco_software_name_trigger on public.organization_branding;
create trigger normalize_jco_software_name_trigger
before insert or update on public.organization_branding
for each row execute function public.normalize_jco_software_name();
