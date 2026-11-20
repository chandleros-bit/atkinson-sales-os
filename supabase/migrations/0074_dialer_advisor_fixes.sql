-- Power Dialer: two Supabase security-advisor warnings from 0072 / 0073.
--   * dialer_calls_metrics() is a SECURITY DEFINER trigger function, so the
--     advisor lists it as callable at /rest/v1/rpc. Postgres refuses to run a
--     trigger function outside a trigger, but nobody needs EXECUTE on it:
--     the privilege is checked when the trigger is created, not when it fires.
--   * dialer_touch() had no fixed search_path.

revoke all on function public.dialer_calls_metrics() from public, anon, authenticated;

alter function public.dialer_touch() set search_path = public;
