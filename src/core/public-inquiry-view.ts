/**
 * An immutable identity for a public inquiry page instance.
 * A -> B -> A must NOT accept the response from the first A visit.
 * This is a UI isolation token; backend tenant RLS remains authoritative.
 */
export interface PublicInquiryView {
  readonly slug: string;
  readonly epoch: number;
}

export function updatePublicInquiryView(previous: PublicInquiryView, slug: string): PublicInquiryView {
  return previous.slug === slug ? previous : { slug, epoch: previous.epoch + 1 };
}
