-- Audited client corrections and guarded removal of unused accidental records.
-- Never delete a contact that is referenced by ANY registered FK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.admin_correct_client_contact(
 target_org uuid,target_contact uuid,
 new_first_name text,new_last_name text,new_email text,
 new_phone text,new_whatsapp text,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE old_contact public.contacts%ROWTYPE;
        clean_email text:=nullif(lower(btrim(coalesce(new_email,''))),'');
        clean_phone text:=nullif(btrim(coalesce(new_phone,'')),'');
        clean_whatsapp text:=nullif(btrim(coalesce(new_whatsapp,'')),'');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_rental_lifecycle_admin(target_org)
    OR NOT public.has_org_permission(target_org,'clients.edit') THEN
    RAISE EXCEPTION 'Administrator access to clients required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(reason,'')))<12 OR length(btrim(reason))>500 THEN
    RAISE EXCEPTION 'Correction requires a 12-500 character reason' USING ERRCODE='23514';
  END IF;
  IF length(btrim(coalesce(new_first_name,'')))<2 OR length(btrim(new_first_name))>140
    OR length(coalesce(new_last_name,''))>140 THEN
    RAISE EXCEPTION 'Invalid client name' USING ERRCODE='23514';
  END IF;
  IF clean_email IS NOT NULL AND
    (length(clean_email)>254 OR strpos(clean_email,'@')<2
      OR strpos(split_part(clean_email,'@',2),'.')<2) THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE='23514';
  END IF;
  IF clean_email IS NULL AND clean_phone IS NULL AND clean_whatsapp IS NULL THEN
    RAISE EXCEPTION 'At least one contact method is required' USING ERRCODE='23514';
  END IF;
  IF (clean_phone IS NOT NULL AND
      length(regexp_replace(clean_phone,'[^0-9]','','g')) NOT BETWEEN 7 AND 15)
    OR (clean_whatsapp IS NOT NULL AND
      length(regexp_replace(clean_whatsapp,'[^0-9]','','g')) NOT BETWEEN 7 AND 15) THEN
    RAISE EXCEPTION 'Contact numbers need 7-15 digits' USING ERRCODE='23514';
  END IF;
  SELECT * INTO old_contact FROM public.contacts
    WHERE organization_id=target_org AND id=target_contact FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found in this organization'
      USING ERRCODE='P0002'; END IF;
  IF clean_email IS NOT NULL AND lower(coalesce(old_contact.email,''))<>clean_email
    AND EXISTS(
     SELECT 1 FROM public.contacts another
     WHERE another.organization_id=target_org AND another.id<>target_contact
       AND lower(btrim(coalesce(another.email,'')))=clean_email
    ) THEN
    RAISE EXCEPTION 'A different client already has that email in this organization'
      USING ERRCODE='23505';
  END IF;
  UPDATE public.contacts SET first_name=btrim(new_first_name),
    last_name=nullif(btrim(coalesce(new_last_name,'')),''),
    email=clean_email,phone=clean_phone,whatsapp=clean_whatsapp,updated_at=now()
  WHERE organization_id=target_org AND id=target_contact;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'contact.corrected','contact',target_contact,
   jsonb_build_object('reason',btrim(reason),
    'before',jsonb_build_object('first_name',old_contact.first_name,'last_name',old_contact.last_name,
      'email',old_contact.email,'phone',old_contact.phone,'whatsapp',old_contact.whatsapp),
    'after',jsonb_build_object('first_name',btrim(new_first_name),'last_name',nullif(btrim(coalesce(new_last_name,'')),''),
      'email',clean_email,'phone',clean_phone,'whatsapp',clean_whatsapp)));
  RETURN target_contact;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_correct_client_contact(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_client_contact(uuid,uuid,text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_unlinked_contact(
 target_org uuid,target_contact uuid,reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog'
AS $fn$
DECLARE old_contact public.contacts%ROWTYPE;
        dep record; has_ref boolean; n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_rental_lifecycle_admin(target_org)
    OR NOT public.has_org_permission(target_org,'clients.edit') THEN
    RAISE EXCEPTION 'Only a tenant administrator may remove a client' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(reason,'')))<12 OR length(btrim(reason))>500 THEN
    RAISE EXCEPTION 'A 12-500 character deletion reason is required' USING ERRCODE='23514';
  END IF;
  SELECT * INTO old_contact FROM public.contacts
    WHERE organization_id=target_org AND id=target_contact FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found in this organization'
    USING ERRCODE='P0002'; END IF;

  -- Inspect every FK referencing contacts.id, not only current finance tables.
  -- This prevents cascading loss of leads, website consents, activities,
  -- invitations or cross-module history on a single accidental deletion.
  FOR dep IN
    SELECT DISTINCT c.conrelid::regclass::text AS source_table, a.attname AS source_column
    FROM pg_catalog.pg_constraint c
    JOIN LATERAL unnest(c.conkey,c.confkey) AS pair(local_attnum,remote_attnum) ON true
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=pair.local_attnum
    JOIN pg_catalog.pg_attribute ref ON ref.attrelid=c.confrelid AND ref.attnum=pair.remote_attnum
    WHERE c.contype='f' AND c.confrelid='public.contacts'::regclass
      AND ref.attname='id'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1)',
                   dep.source_table,dep.source_column)
       INTO has_ref USING target_contact;
    IF has_ref THEN
      RAISE EXCEPTION 'Client has linked records in %. Correct the existing contact; never delete its history',
        dep.source_table USING ERRCODE='23514';
    END IF;
  END LOOP;

  DELETE FROM public.contacts WHERE organization_id=target_org AND id=target_contact;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Client deletion was not confirmed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'contact.unlinked_deleted','contact',target_contact,
    jsonb_build_object('reason',btrim(reason),
     'last_name',old_contact.last_name,'first_name',old_contact.first_name,
     'email',old_contact.email,'associated_history',false));
  RETURN target_contact;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_delete_unlinked_contact(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_unlinked_contact(uuid,uuid,text) TO authenticated;
COMMIT;