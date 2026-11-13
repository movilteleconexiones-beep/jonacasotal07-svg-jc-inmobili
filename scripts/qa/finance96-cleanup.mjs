/**
 * #96 — fail-closed removal of Auth users created by ONE QA run.
 * No production credentials, user emails, tokens, or passwords are logged.
 *
 * The caller must pin the Supabase client to the verified restored clone.
 * This helper never deletes accounts whose auth.app_metadata differs from
 * the expected suite AND run identifier.
 */
export async function cleanupQaAccounts({admin, created, orgId, runId, logger=console}) {
  if (!admin || !Array.isArray(created) || !orgId || !runId) {
    throw new Error('QA cleanup requires admin, created, orgId, and runId');
  }
  let failures = 0;
  let deleted = 0;
  for (const entry of [...created].reverse()) {
    if (!entry?.userId) {
      failures++;
      continue;
    }
    let user;
    try {
      const lookup = await admin.auth.admin.getUserById(entry.userId);
      if (lookup.error || !lookup.data?.user) {
        throw new Error('QA Auth identity could not be attested');
      }
      user = lookup.data.user;
      if (user.id !== entry.userId ||
          user.app_metadata?.qa_suite !== 'finance96' ||
          user.app_metadata?.qa_run !== runId) {
        throw new Error('Refuse deletion: QA ownership marker does not match');
      }
    } catch {
      // Never guess that an existing user is disposable.
      failures++;
      continue;
    }

    // Attempt both operations independently. A failed membership DELETE must
    // not prevent deleting the temporary Auth identity: FK CASCADE handles it.
    let memberFailed = false;
    if (entry.memberId) {
      try {
        const {error} = await admin.from('organization_members').delete()
          .eq('id',entry.memberId).eq('organization_id',orgId).eq('user_id',entry.userId);
        if (error) throw new Error('QA membership deletion failed');
      } catch {
        memberFailed = true;
      }
    }
    let authFailed = false;
    try {
      const {error} = await admin.auth.admin.deleteUser(entry.userId);
      if (error) throw new Error('QA Auth deletion failed');
      deleted++;
    } catch {
      authFailed = true;
    }
    if (memberFailed || authFailed) failures++;
  }
  logger.log('QA96 CLEANUP: attempted=' + created.length +
    ', authDeleted=' + deleted + ', failures=' + failures);
  if (failures) throw new Error('QA cleanup incomplete: inspect only generated user IDs in the restored clone');
  return {attempted:created.length,authDeleted:deleted};
}
