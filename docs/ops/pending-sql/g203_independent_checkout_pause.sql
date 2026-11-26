-- G203: separate emergency checkout pause from verified-event fulfillment.
-- Default false preserves current behavior. No grants or payment data changes.
ALTER TABLE public.billing_activation_settings
  ADD COLUMN production_checkout_paused boolean NOT NULL DEFAULT false;
DO $patch$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.billing_create_order(uuid,uuid,text,uuid)'::regprocedure) INTO d;
  IF strpos(d,$old$SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;$old$)=0
    OR strpos(d,$guard$    THEN RAISE EXCEPTION 'Payments unavailable for this environment'; END IF;$guard$)=0
  THEN RAISE EXCEPTION 'Unexpected checkout function'; END IF;
  d:=replace(d,$old$SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;$old$,$new$SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true FOR SHARE;$new$);
  d:=replace(d,$guard$    THEN RAISE EXCEPTION 'Payments unavailable for this environment'; END IF;$guard$,$new$    THEN RAISE EXCEPTION 'Payments unavailable for this environment'; END IF;
  IF target_environment='production' AND settings.production_checkout_paused
    THEN RAISE EXCEPTION 'Production checkout temporarily paused' USING ERRCODE='PT503'; END IF;$new$);
  EXECUTE d;
END $patch$;
