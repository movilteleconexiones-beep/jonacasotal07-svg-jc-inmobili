\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT monthly_rent FROM lease_fixture WHERE id=1)<>1800000 THEN RAISE EXCEPTION 'first writer not committed'; END IF;
 IF (SELECT revision FROM lease_fixture WHERE id=1)<>1 THEN RAISE EXCEPTION 'revision not incremented exactly once'; END IF;
 IF (SELECT count(*) FROM lease_audit_fixture WHERE lease_id=1)<>1 THEN RAISE EXCEPTION 'audit entries duplicated or missing'; END IF;
 IF EXISTS(SELECT 1 FROM lease_audit_fixture WHERE previous_rent<>1700000 OR new_rent<>1800000) THEN RAISE EXCEPTION 'audit values wrong'; END IF;
END $$;
SELECT 'fixture locked update and audit passed';
