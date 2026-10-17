/**
 * Invalidates permission lookups started under earlier auth/session contexts.
 * Supabase callbacks and getSession can overlap; only the newest load may
 * publish memberships, tenant branding, or platform-administrator status.
 */
export function createAuthLoadGate() {
  let generation = 0;

  return {
    begin(): number {
      return ++generation;
    },
    invalidate(): void {
      ++generation;
    },
    isCurrent(candidate: number): boolean {
      return candidate === generation;
    },
  };
}
