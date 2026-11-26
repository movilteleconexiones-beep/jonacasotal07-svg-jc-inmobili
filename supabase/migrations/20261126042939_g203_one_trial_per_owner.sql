-- G04/#203: one trial per owner even when separate tenant transactions race.
-- The existing RPC records this event in the same atomic transaction as the trial.
-- If a duplicate actor reaches INSERT, PostgreSQL rolls back the losing trial.
-- Historical audit entries and unrelated actions are not modified.
CREATE UNIQUE INDEX audit_log_one_trial_per_actor
  ON public.audit_log(actor_user_id)
  WHERE action='billing.trial_started' AND actor_user_id IS NOT NULL;
