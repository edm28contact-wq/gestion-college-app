-- Delete only cancelled technical MEATER paths. Associated technical samples cascade.
-- Completed/expired paths and professional HACCP records are never targeted.
CREATE OR REPLACE FUNCTION public.kitchen_meater_path_cancel(p_id uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 delete from public.kitchen_meater_paths where id=p_id and status in ('armed','running','cancelled');
 if not found then return jsonb_build_object('error','Parcours déjà terminé ou introuvable');end if;
 return jsonb_build_object('status','cancelled','deleted',true);
end $function$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_path_tick()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; stamp timestamptz:=clock_timestamp(); ts bigint;cadence interval;
begin
 update public.kitchen_meater_paths set status='expired',finished_at=stamp,reason=case when status='armed' then 'Aucune mesure sous 10 °C dans les 30 minutes' else 'Objectif non confirmé dans l’heure' end where (status='armed' and armed_at<=stamp-interval '30 minutes') or (status='running' and deadline_at<=stamp);
 select * into s from public.kitchen_meater_settings where id=1;
 if s.enabled then
  delete from public.kitchen_meater_paths where status in ('armed','running');
  return;
 end if;
 if s.vault_secret_id is null then return;end if;
 if not exists(select 1 from public.kitchen_meater_probes where slot between 1 and 12) and not exists(select 1 from public.kitchen_meater_paths where status in ('armed','running')) then return;end if;
 cadence:=interval '4 seconds';
 if s.last_poll_at>stamp-cadence or (s.last_error='Limite de requêtes MEATER atteinte' and s.last_poll_at>stamp-interval '60 seconds') then return;end if;
 if s.last_poll_at>stamp-interval '15 seconds' and (s.last_ok_at is null or s.last_ok_at<s.last_poll_at) then return;end if;
 ts:=extract(epoch from stamp)::bigint;
 perform net.http_post(url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api?action=meater-auto-sync',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('timestamp',ts,'signature',translate(rtrim(encode(extensions.hmac('kitchen-meater-cron:'||ts::text,(select admin_token::text from public.system_settings where id=1),'sha256'),'base64'),'='),'+/','-_')),timeout_milliseconds:=20000);
end $function$;

 delete from public.kitchen_meater_paths where status='cancelled';

