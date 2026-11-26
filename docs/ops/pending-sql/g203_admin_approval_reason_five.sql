-- Five-character minimum for ordinary manual authorization only.
DO $patch$
DECLARE d text; original constant text:=$old$length(trim(reason))<10$old$;
BEGIN
 SELECT pg_get_functiondef('public.billing_admin_action(uuid,text,text,uuid)'::regprocedure) INTO STRICT d;
 IF (length(d)-length(replace(d,original,'')))/length(original)<>1 THEN
   RAISE EXCEPTION 'Unexpected administrative reason validation';
 END IF;
 EXECUTE replace(d,original,$new$length(trim(reason)) < (CASE WHEN action='APPROVE' THEN 5 ELSE 10 END)$new$);
END $patch$;
