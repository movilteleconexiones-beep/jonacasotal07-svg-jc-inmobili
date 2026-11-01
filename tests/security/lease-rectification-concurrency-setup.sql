\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 regression: concurrent updates must serialize on one lease.
CREATE TABLE lease_fixture (id int PRIMARY KEY, monthly_rent int NOT NULL, revision int NOT NULL DEFAULT 0);
CREATE TABLE lease_audit_fixture (id bigserial PRIMARY KEY, lease_id int NOT NULL, previous_rent int NOT NULL, new_rent int NOT NULL);
INSERT INTO lease_fixture(id,monthly_rent) VALUES(1,1700000);
CREATE FUNCTION rectify_fixture(next_rent int, expected_revision int) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE current_row lease_fixture%ROWTYPE;
BEGIN
 SELECT * INTO current_row FROM lease_fixture WHERE id=1 FOR UPDATE;
 IF current_row.revision<>expected_revision THEN RETURN false; END IF;
 UPDATE lease_fixture SET monthly_rent=next_rent,revision=revision+1 WHERE id=1;
 INSERT INTO lease_audit_fixture(lease_id,previous_rent,new_rent) VALUES(1,current_row.monthly_rent,next_rent);
 RETURN true;
END $$;
-- Session A keeps the row locked. Session B attempts the same revision and must wait,
-- then reject stale input without writing an audit entry.
BEGIN;
SELECT rectify_fixture(1800000,0) AS first_accepted;
SELECT pg_sleep(2);
COMMIT;
