/** Never render signed or private Storage URLs inside an anonymous catalogue. */
export function safePublicPropertyPhoto(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1500) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname.toLowerCase().includes('/storage/v1/object/sign/') ||
        url.href.toLowerCase().includes('jco-inventory-private') ||
        url.searchParams.has('token')) return '';
    return url.href;
  } catch {
    return '';
  }
}
