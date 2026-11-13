/**
 * Finance #96 QA: create a real org membership without briefly consuming
 * an internal seat before its role is known.
 *
 * The database counts unclassified ACTIVE memberships as internal staff.
 * In a Basic (5-seat) QA tenant, the fifth new identity is CLIENT and must
 * receive its exclusive role before activation to stay within the real limit.
 * No RLS, plan, trigger or billing setting is bypassed or changed.
 */
import assert from 'node:assert/strict';

export async function addTemporaryQaMember({admin,orgId,userId,roleId,record}) {
  assert.ok(admin && orgId && userId && roleId && record?.userId === userId,
    'QA temporary membership requires a previously created Auth identity and QA role');
  assert.equal(record.memberId,null,'QA identity must not already have membership');

  // INSERT INVITED does not consume a staff seat. Set the ID immediately so
  // the outer finally can clean up even if role assignment/activation fails.
  const {data:member,error:membershipError} = await admin
    .from('organization_members')
    .insert({organization_id:orgId,user_id:userId,status:'INVITED'})
    .select('id').single();
  if(membershipError || !member?.id) {
    throw new Error('QA invited membership creation failed: ' +
      String(membershipError?.code??'missing-row'));
  }
  record.memberId=member.id;

  const {error:roleError} = await admin.from('member_roles')
    .insert({organization_member_id:member.id,role_id:roleId});
  if(roleError) throw new Error('QA exclusive role assignment failed: '+String(roleError.code));

  // AFTER role assignment, CLIENT is recognized as external-only by
  // jco_private.is_external_only_member and does not consume staff capacity.
  // OWNER/ADMIN/MANAGER/AGENT still consume their required staff seats.
  const {data:active,error:activateError} = await admin
    .from('organization_members')
    .update({status:'ACTIVE'})
    .eq('id',member.id).eq('organization_id',orgId)
    .eq('user_id',userId).eq('status','INVITED')
    .select('id,status').single();
  if(activateError || active?.id !== member.id || active.status !== 'ACTIVE') {
    throw new Error('QA membership activation refused: ' +
      String(activateError?.code??'missing-row'));
  }
  return member.id;
}
