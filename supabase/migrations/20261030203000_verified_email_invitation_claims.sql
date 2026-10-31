-- Invitation acceptance must prove ownership of the invited email.
-- Protects against signed-in accounts with unconfirmed/changed email claims.
-- Does not modify existing invitations, members, roles, or billing history.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_my_invitations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  confirmed_email text;
  invitation record;
  member_id uuid;
BEGIN
  IF current_user_id IS NULL THEN RETURN; END IF;

  -- Read identity from the authoritative Supabase Auth table, not the
  -- potentially stale "email" attribute embedded in a signed session JWT.
  -- Email ownership must already have been confirmed.
  SELECT lower(btrim(u.email))
    INTO confirmed_email
    FROM auth.users u
   WHERE u.id=current_user_id
     AND u.email_confirmed_at IS NOT NULL
     AND nullif(btrim(u.email),'') IS NOT NULL;

  IF confirmed_email IS NULL THEN RETURN; END IF;

  FOR invitation IN
    SELECT i.*
      FROM public.organization_invitations i
     WHERE lower(btrim(i.email))=confirmed_email
       AND i.status='PENDING'
       AND i.expires_at>now()
     ORDER BY i.created_at,i.id
     FOR UPDATE OF i
  LOOP
    -- An invitation without an active organization-scoped role must never
    -- create an active member with unknown privileges or consume a staff seat.
    IF NOT EXISTS (
      SELECT 1 FROM public.invitation_roles ir
      JOIN public.roles r ON r.id=ir.role_id
      WHERE ir.invitation_id=invitation.id
        AND r.organization_id=invitation.organization_id
        AND r.active
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.organization_members(organization_id,user_id,status,joined_at)
    VALUES(invitation.organization_id,current_user_id,'ACTIVE',now())
    ON CONFLICT (organization_id,user_id) DO UPDATE
      SET status='ACTIVE',
          joined_at=coalesce(public.organization_members.joined_at,excluded.joined_at)
    RETURNING id INTO member_id;

    INSERT INTO public.member_roles(organization_member_id,role_id)
    SELECT member_id,ir.role_id
      FROM public.invitation_roles ir
      JOIN public.roles r ON r.id=ir.role_id
     WHERE ir.invitation_id=invitation.id
       AND r.organization_id=invitation.organization_id
       AND r.active
    ON CONFLICT DO NOTHING;

    UPDATE public.organization_invitations
       SET status='ACCEPTED',
           accepted_by=current_user_id,
           accepted_at=now()
     WHERE id=invitation.id
       AND status='PENDING';
  END LOOP;
END;
$function$;

-- CREATE OR REPLACE preserves existing EXECUTE grants. Explicitly constrain
-- the RPC API entrypoint to signed-in users and server-side service calls.
REVOKE ALL ON FUNCTION public.claim_my_invitations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_my_invitations() TO authenticated,service_role;

COMMIT;
