-- PostgreSQL 17 controlled auth+invite regression tests. All data fictional.
CREATE FUNCTION public.assert_test(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(ok,false) THEN
   RAISE EXCEPTION 'Invitation security test failed: %',label;
 END IF;
END
$$;

SELECT public.assert_test(NOT has_function_privilege('anon','public.claim_my_invitations()','EXECUTE'),
 'anonymous users have no invitation claim permission');
SELECT public.assert_test(has_function_privilege('authenticated','public.claim_my_invitations()','EXECUTE'),
 'authenticated user retains invitation claim access');

-- Signed-in user with an email but no confirmed proof must not claim.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claim.email','victim@agency.test',false);
SELECT public.claim_my_invitations();
RESET ROLE;

SELECT public.assert_test((SELECT count(*) FROM public.organization_members)=0,
 'unconfirmed email cannot create membership');
SELECT public.assert_test((SELECT count(*) FROM public.organization_invitations WHERE status='ACCEPTED')=0,
 'unconfirmed email cannot accept an invitation');

-- A confirmed attacker cannot spoof the JWT email of another invitee.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
SELECT set_config('request.jwt.claim.email','victim@agency.test',false);
SELECT public.claim_my_invitations();
RESET ROLE;

SELECT public.assert_test((SELECT count(*) FROM public.organization_members)=0,
 'JWT email spoofing cannot impersonate confirmed invitee');

-- Legitimately confirmed identity may claim ONLY its own, unexpired,
-- correctly scoped and active-role invitation.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
SELECT set_config('request.jwt.claim.email','wrong@untrusted.test',false);
SELECT public.claim_my_invitations();
SELECT public.claim_my_invitations();
RESET ROLE;

SELECT public.assert_test(
 (SELECT count(*) FROM public.organization_members
  WHERE organization_id='20000000-0000-4000-8000-000000000001'
    AND user_id='10000000-0000-4000-8000-000000000003'
    AND status='ACTIVE')=1,
 'verified current Auth email receives only one agency membership');
SELECT public.assert_test(
 (SELECT count(*) FROM public.member_roles mr
  JOIN public.organization_members m ON mr.organization_member_id=m.id
  WHERE m.user_id='10000000-0000-4000-8000-000000000003'
    AND mr.role_id='30000000-0000-4000-8000-000000000001')=1,
 'correct agency role granted exactly once');
SELECT public.assert_test(
 (SELECT count(*) FROM public.organization_invitations
   WHERE status='ACCEPTED'
     AND accepted_by='10000000-0000-4000-8000-000000000003')=1,
 'legitimate invite accepted exactly once');
SELECT public.assert_test(
 (SELECT count(*) FROM public.organization_invitations
   WHERE id IN (
     '40000000-0000-4000-8000-000000000002',
     '40000000-0000-4000-8000-000000000003',
     '40000000-0000-4000-8000-000000000004')
   AND status='PENDING')=3,
 'expired, roleless and cross-organization role grants remain unaccepted');
SELECT public.assert_test(
 (SELECT count(*) FROM public.member_roles
    WHERE role_id='30000000-0000-4000-8000-000000000002')=0,
 'an invitation cannot attach another organization role');

-- A second verified user may accept a separate agency invitation.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
SELECT set_config('request.jwt.claim.email','attacker@other.test',false);
SELECT public.claim_my_invitations();
RESET ROLE;

SELECT public.assert_test(
 (SELECT count(*) FROM public.organization_members
  WHERE organization_id='20000000-0000-4000-8000-000000000002'
  AND user_id='10000000-0000-4000-8000-000000000004')=1,
 'verified second tenant invitation still works');
SELECT public.assert_test((SELECT count(*) FROM public.organization_members)=2,
 'no extra memberships created');

-- A revoked/changed email is never claimable using an old signed JWT.
UPDATE auth.users
SET email='new@agency.test',email_confirmed_at=NULL
WHERE id='10000000-0000-4000-8000-000000000003';
INSERT INTO public.organization_invitations(id,organization_id,email,status,expires_at)
VALUES('40000000-0000-4000-8000-000000000006',
 '20000000-0000-4000-8000-000000000002','victim@agency.test',
 'PENDING',now()+interval '1 day');
INSERT INTO public.invitation_roles VALUES
 ('40000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000002');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
SELECT set_config('request.jwt.claim.email','victim@agency.test',false);
SELECT public.claim_my_invitations();
RESET ROLE;

SELECT public.assert_test(
 (SELECT status FROM public.organization_invitations
   WHERE id='40000000-0000-4000-8000-000000000006')='PENDING',
 'a stale JWT must not allow claiming another agency after email change');
SELECT public.assert_test((SELECT count(*) FROM public.organization_members)=2,
 'email-change attempt cannot create cross-agency membership');
