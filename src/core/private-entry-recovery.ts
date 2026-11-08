/**
 * Do not make sign-in depend on an unrelated public-tenant catalog RPC.
 * This controls presentation only; Supabase Auth, membership and RLS still
 * authorize every private operation.
 */
export type PrivateEntryRecovery = 'sign-in' | 'restore-membership' | null;

export function privateEntryRecovery({
  pathname,
  search,
  authenticated,
  authorized,
}: {
  pathname: string;
  search: string;
  authenticated: boolean;
  authorized: boolean;
}): PrivateEntryRecovery {
  const privatePath = pathname === '/app' || pathname === '/app/';
  const billingReturn = pathname === '/' &&
    new URLSearchParams(search).get('billing') === 'return';

  if ((!privatePath && !billingReturn) || authorized) return null;
  return authenticated ? 'restore-membership' : 'sign-in';
}
