-- Un ordonnanceur unique interroge uniquement les chambres dont le creneau est du.
select cron.schedule(
 'kitchen-govee-room-schedules',
 '* * * * *',
 $job$
 select net.http_post(
  url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api?action=govee-auto-sync',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object(
   'timestamp',extract(epoch from now())::bigint,
   'signature',translate(rtrim(encode(
    extensions.hmac(
     'kitchen-govee-cron:'||(extract(epoch from now())::bigint)::text,
     (select admin_token::text from public.system_settings where id=1),
     'sha256'
    ),'base64'),'='),'+/','-_')
  ),
  timeout_milliseconds:=120000
 ) where exists(select 1 from public.kitchen_govee_due_rooms(now()));
 $job$
);
select cron.unschedule(jobid) from cron.job where jobname='kitchen-govee-sync-every-10m';
