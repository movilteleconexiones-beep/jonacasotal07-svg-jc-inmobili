-- INMOJCO: paid onboarding only. No free trial and no browser-side activation.
-- DDL is guarded against unknown drift; already approved accounts remain untouched.
-- Initial state INACTIVE permits checkout, NOT tenant operational access.
-- Activation is performed solely by the existing verified Wompi webhook or audited admin flow.
BEGIN;

CREATE OR REPLACE FUNCTION jco_private.pending_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  NEW.status := 'INACTIVE';
  RETURN NEW;
END;
$function$;

DO $migration$
DECLARE
  checkout_def text;
  webhook_def text;
  needle text := 'org.status NOT IN (''ACTIVE'',''TRIAL'')';
  replacement text := 'org.status NOT IN (''ACTIVE'',''INACTIVE'',''TRIAL'')';
BEGIN
  SELECT pg_get_functiondef('public.billing_create_order(uuid,uuid,text,uuid)'::regprocedure)
    INTO checkout_def;
  SELECT pg_get_functiondef(
    'public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure
  ) INTO webhook_def;

  IF checkout_def IS NULL OR webhook_def IS NULL
     OR strpos(checkout_def, needle) = 0
     OR strpos(webhook_def, needle) = 0 THEN
    RAISE EXCEPTION 'Paid onboarding requires a review of the current billing functions';
  END IF;

  -- Owners may pay for an INACTIVE registration. SUSPENDED accounts cannot bypass review.
  EXECUTE replace(checkout_def, needle, replacement);
  -- Verified Wompi approval may activate an INACTIVE registration.
  EXECUTE replace(webhook_def, needle, replacement);
END;
$migration$;

-- Remove the former 1–30 day trial authorization entry point.
-- Preserve its signature so existing clients fail closed, not with an ambiguous 404.
CREATE OR REPLACE FUNCTION public.billing_admin_authorize_trial(
  target_org uuid, target_owner uuid, target_plan uuid, trial_days integer, reason text
)
RETURNS timestamp with time zone
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Las pruebas gratuitas ya no estan disponibles.'
    USING ERRCODE='42501';
END;
$function$;

DO $verify$
BEGIN
 IF position('NEW.status := ''INACTIVE''' IN
      pg_get_functiondef('jco_private.pending_organization()'::regprocedure)) = 0
    OR position('''INACTIVE''' IN
      pg_get_functiondef('public.billing_create_order(uuid,uuid,text,uuid)'::regprocedure)) = 0
    OR position('''INACTIVE''' IN
      pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure)) = 0 THEN
   RAISE EXCEPTION 'Paid onboarding migration verification failed';
 END IF;
END;
$verify$;

COMMIT;
