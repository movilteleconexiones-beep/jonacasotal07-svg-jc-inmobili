-- Isolated PostgreSQL fixture; never run in production.
CREATE TABLE public.plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL,name text NOT NULL,description text,billing_cycle text NOT NULL,price numeric NOT NULL,currency text NOT NULL,active boolean NOT NULL DEFAULT true,updated_at timestamptz DEFAULT now());
INSERT INTO public.plans(code,name,billing_cycle,price,currency) VALUES ('BASIC','Basic','MONTHLY',0,'USD'),('PRO','Pro','MONTHLY',0,'USD'),('ENTERPRISE','Enterprise','CUSTOM',0,'USD'),('LIFETIME','Lifetime','ONE_TIME',0,'USD');
