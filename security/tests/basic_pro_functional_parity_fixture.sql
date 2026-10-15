-- SQL fixture with 47 permissions and a subset of 21 allowed in Basic.
-- Named synthetic permissions are sufficient for testing the DB set parity.
CREATE TABLE public.permissions(key text PRIMARY KEY);
CREATE TABLE public.plan_features(
 plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
 feature_key text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(plan_id,feature_key)
);
INSERT INTO public.permissions(key)
SELECT 'module.permission_'||lpad(n::text,2,'0')
FROM generate_series(1,47) AS n;
INSERT INTO public.plan_features(plan_id,feature_key,enabled)
SELECT p.id,'permission:'||per.key,true
FROM public.plans p CROSS JOIN public.permissions per
WHERE p.code='PRO';
INSERT INTO public.plan_features(plan_id,feature_key,enabled)
SELECT p.id,'permission:'||per.key,true
FROM public.plans p CROSS JOIN public.permissions per
WHERE p.code='BASIC' AND per.key<='module.permission_21';
