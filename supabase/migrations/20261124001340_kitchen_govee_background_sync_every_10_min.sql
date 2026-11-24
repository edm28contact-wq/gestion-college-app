-- Collecte des temperatures Govee sans navigateur ouvert.
-- Le corps de la requete ne contient pas de cle secrete : signature HMAC a duree courte.
-- Le serveur Edge valide signature + horodatage avant toute operation privilegiee.
select cron.schedule(
 'kitchen-govee-sync-every-10m',
 '*/10 * * * *',
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
 );
 $job$
);
