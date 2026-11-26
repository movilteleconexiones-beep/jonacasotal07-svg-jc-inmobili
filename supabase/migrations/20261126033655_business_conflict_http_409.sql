-- Business conflicts must not use PostgreSQL serialization_failure (40001).
-- PostgREST retries 40001 automatically; a stale business snapshot never becomes valid.
DO $patch$
DECLARE f record; d text; n integer:=0;
BEGIN
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.prokind='f' AND p.proname IN ('admin_update_role_permissions','admin_correct_lease_draft','admin_delete_unlinked_contact','admin_rectify_active_lease')
  LOOP
    d:=pg_get_functiondef(f.oid);
    IF (length(d)-length(replace(d,$old$ERRCODE='40001'$old$,'')))/length($old$ERRCODE='40001'$old$)<>1 THEN
      RAISE EXCEPTION 'Unexpected function definition: %',f.proname;
    END IF;
    EXECUTE replace(d,$old$ERRCODE='40001'$old$,$new$ERRCODE='PT409'$new$);
    n:=n+1;
  END LOOP;
  IF n<>4 THEN RAISE EXCEPTION 'Expected four functions, got %',n; END IF;
END $patch$;
