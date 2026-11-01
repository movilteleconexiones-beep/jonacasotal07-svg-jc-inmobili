\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 simulation. NOT the production Supabase RPC.
BEGIN;
CREATE TABLE fixture_receipts (id bigserial PRIMARY KEY, org text NOT NULL, payment_id int NOT NULL, request_key text NOT NULL UNIQUE, amount int NOT NULL CHECK(amount>0));
CREATE TABLE fixture_payments (id int PRIMARY KEY, org text NOT NULL, expected int NOT NULL, paid int NOT NULL DEFAULT 0, CHECK(paid>=0 AND paid<=expected));
INSERT INTO fixture_payments(id,org,expected) VALUES (1,'JCO',1700000),(2,'OTHER',500000);
CREATE FUNCTION fixture_record_receipt(actor text, actor_org text, payment int, amount int, request_key text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE p fixture_payments%ROWTYPE; existing bigint; receipt_id bigint;
BEGIN
  IF actor NOT IN ('MANAGER','ADMIN') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT id INTO existing FROM fixture_receipts WHERE fixture_receipts.request_key=fixture_record_receipt.request_key;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  SELECT * INTO p FROM fixture_payments WHERE id=payment FOR UPDATE;
  IF NOT FOUND OR p.org<>actor_org THEN RAISE EXCEPTION 'tenant isolation' USING ERRCODE='42501'; END IF;
  IF amount<=0 OR p.paid+amount>p.expected THEN RAISE EXCEPTION 'overpayment' USING ERRCODE='22003'; END IF;
  INSERT INTO fixture_receipts(org,payment_id,request_key,amount) VALUES(actor_org,payment,request_key,amount) RETURNING id INTO receipt_id;
  UPDATE fixture_payments SET paid=paid+amount WHERE id=payment;
  RETURN receipt_id;
END $$;
DO $$
DECLARE first_id bigint; second_id bigint;
BEGIN
  BEGIN PERFORM fixture_record_receipt('AGENT','JCO',1,100,'agent'); RAISE EXCEPTION 'AGENT was allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fixture_record_receipt('MANAGER','JCO',2,100,'cross'); RAISE EXCEPTION 'cross tenant allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fixture_record_receipt('MANAGER','JCO',1,1700001,'over'); RAISE EXCEPTION 'overpay allowed'; EXCEPTION WHEN numeric_value_out_of_range THEN NULL; END;
  first_id:=fixture_record_receipt('MANAGER','JCO',1,100,'same');
  second_id:=fixture_record_receipt('MANAGER','JCO',1,100,'same');
  IF first_id<>second_id THEN RAISE EXCEPTION 'retry created distinct receipt'; END IF;
  IF (SELECT paid FROM fixture_payments WHERE id=1)<>100 THEN RAISE EXCEPTION 'retry double-charged'; END IF;
  IF (SELECT count(*) FROM fixture_receipts)<>1 THEN RAISE EXCEPTION 'invalid receipt count'; END IF;
END $$;
ROLLBACK;
