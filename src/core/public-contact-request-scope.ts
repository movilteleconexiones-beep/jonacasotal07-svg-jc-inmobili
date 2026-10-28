/**
 * The public contact form is scoped to both an agency and its currently
 * published privacy-policy URL. Switching either must invalidate pending
 * requests and clear ALL personal data previously entered for that scope.
 *
 * This is only a client-side UI guard: the SQL RPC remains authoritative
 * for consent, rate limits and agency isolation.
 */
export class PublicContactRequestScope {
  private scope: string | null = null;
  private generation = 0;

  update(tenantSlug?: string | null, policyUrl?: string | null): boolean {
    const next = JSON.stringify([
      tenantSlug?.trim().toLowerCase() || '',
      policyUrl?.trim() || '',
    ]);
    if (this.scope === next) return false;
    this.scope = next;
    this.generation++;
    return true;
  }

  capture(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return Number.isSafeInteger(generation) && generation === this.generation;
  }
}
