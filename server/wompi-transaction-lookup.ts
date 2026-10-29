/**
 * Secure Wompi transaction reconciliation. The event checksum normally signs
 * ID/status/amount, not necessarily the reference/currency used for billing.
 * Only a private-key server-to-server lookup can establish those fields.
 * Do not import into the public Vite client.
 */
export type WompiEnvironment = 'sandbox' | 'production';
export type WompiTransactionLookup = (id: string, environment: WompiEnvironment) => Promise<unknown>;

export function createWompiTransactionLookup(
  privateKey: string | undefined,
  httpFetch: typeof fetch = fetch,
): WompiTransactionLookup {
  return async (id, environment) => {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error('Invalid transaction id');
    const baseUrl = environment === 'sandbox'
      ? 'https://sandbox.wompi.co' : 'https://production.wompi.co';
    const keyPrefix = environment === 'sandbox' ? 'prv_test_' : 'prv_prod_';
    if (!privateKey?.startsWith(keyPrefix) || privateKey.length <= keyPrefix.length) {
      throw new Error('Private payment verification unavailable');
    }
    const response = await httpFetch(baseUrl + '/v1/transactions/' + encodeURIComponent(id), {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + privateKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Payment provider lookup unavailable');
    return response.json();
  };
}
