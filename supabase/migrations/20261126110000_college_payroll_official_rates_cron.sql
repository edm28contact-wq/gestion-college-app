-- Every 20th at 05:00 UTC (06:00 in Paris winter, 07:00 summer).
-- HTTP authorization token remains exclusively in Supabase Vault.
SELECT cron.schedule(
 'college-payroll-official-rates-monthly',
 '0 5 20 * *',
 $job$
 SELECT net.http_post(
  url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/college-payroll-rates-sync',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-college-rate-cron-token',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='college_payroll_rates_cron_token_v1')
  ),
  body:='{"action":"check"}'::jsonb,
  timeout_milliseconds:=30000
 );
 $job$
);
-- Retry only if the 20th did not yield a complete audit or the audit is incomplete.
SELECT cron.schedule(
 'college-payroll-official-rates-retry',
 '0 5 21-22 * *',
 $job$
 SELECT net.http_post(
  url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/college-payroll-rates-sync',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-college-rate-cron-token',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='college_payroll_rates_cron_token_v1')
  ),
  body:='{"action":"check"}'::jsonb,
  timeout_milliseconds:=30000
 )
 WHERE NOT EXISTS (
  SELECT 1 FROM public.college_payroll_rate_checks
  WHERE month=to_char(timezone('Europe/Paris',now()),'YYYY-MM')
  AND status IN ('verified','review')
 );
 $job$
);
