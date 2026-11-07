-- JCO Wompi order schema: DRAFT ONLY; not applied to Supabase.
BEGIN;
CREATE TABLE IF NOT EXISTS public.payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
 billing_mode text NOT NULL CHECK (billing_mode IN ('SAAS_MONTHLY','SAAS_ANNUAL','LIFETIME')),
 provider text NOT NULL DEFAULT 'WOMPI' CHECK (provider = 'WOMPI'),
 environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
 reference text NOT NULL UNIQUE CHECK (reference ~ '^[A-Za-z0-9_-]{8,100}$'),
 amount_in_cents bigint NOT NULL CHECK (amount_in_cents > 0),
 currency text NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DECLINED','VOIDED','ERROR')),
 provider_transaction_id text UNIQUE,
 expires_at timestamptz NOT NULL,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT payment_approval_consistency CHECK (
 (status = 'APPROVED' AND approved_at IS NOT NULL AND provider_transaction_id IS NOT NULL)
 OR (status <> 'APPROVED' AND approved_at IS NULL))
);
CREATE INDEX IF NOT EXISTS payment_orders_org_idx ON public.payment_orders(organization_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
 provider text NOT NULL DEFAULT 'WOMPI' CHECK (provider = 'WOMPI'),
 provider_event_id text NOT NULL,
 provider_transaction_id text,
 reported_status text NOT NULL,
 signature_valid boolean NOT NULL DEFAULT false,
 payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON public.payment_events(payment_order_id,created_at DESC);
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_orders_tenant_read ON public.payment_orders
 FOR SELECT TO authenticated USING (public.is_platform_admin() OR public.is_org_member(organization_id));
-- Only trusted backend writes; no client-side RLS write policies.
REVOKE INSERT,UPDATE,DELETE ON public.payment_orders FROM anon,authenticated;
REVOKE ALL ON public.payment_events FROM anon,authenticated;
COMMIT;
