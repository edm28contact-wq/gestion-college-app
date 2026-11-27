-- Continuous group polling and inferred undock, isolated from professional HACCP.
-- Persist observation state separately from the physical charging state (not exposed by MEATER Cloud).
alter table public.kitchen_meater_probes add column technical_generation uuid,
 add column technical_missing_since timestamptz,
 add column technical_last_measure_at timestamptz;

create or replace function public.kitchen_meater_path_after_poll() returns trigger
language plpgsql set search_path='' as $$
declare p public.kitchen_meater_probes%rowtype; stamp timestamptz:=clock_timestamp(); available boolean; new_measure boolean;
begin
 if new.enabled or new.vault_secret_id is null or new.last_error is not null or new.last_ok_at is null or new.last_ok_at is not distinct from old.last_ok_at then return new;end if;
 for p in select * from public.kitchen_meater_probes d where d.slot between 1 and 12 or exists(select 1 from public.kitchen_meater_paths r where r.device_id=d.device_id and r.status in ('armed','running')) loop
  available:=p.present and p.internal_c is not null and p.measured_at is not null and p.measured_at<=stamp and p.measured_at>=stamp-interval '120 seconds';
  if p.technical_generation is distinct from new.generation then
   -- Establish a baseline on a successful reply, never infer a removal from existing cached data.
   update public.kitchen_meater_probes set technical_generation=new.generation,technical_missing_since=case when available then null else stamp end,technical_last_measure_at=p.measured_at where device_id=p.device_id;
  elsif not available then
   if p.technical_missing_since is null then
    update public.kitchen_meater_probes set technical_missing_since=stamp where device_id=p.device_id;
   end if;
  else
   new_measure:=p.technical_last_measure_at is null or p.measured_at>p.technical_last_measure_at;
   if new_measure and (p.technical_missing_since is null or p.measured_at>=p.technical_missing_since-interval '1 second') then
    if p.technical_missing_since is not null and p.slot between 1 and 12 and not exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p.device_id and l.detached_at is null and r.status='en_cours') then
     insert into public.kitchen_meater_paths(device_id,label,slot,armed_by,armed_at)
     values(p.device_id,coalesce(p.label,'Sonde '||p.slot),p.slot,'auto-meater',p.measured_at)
     on conflict (device_id) where status in ('armed','running') do nothing;
    end if;
    update public.kitchen_meater_probes set technical_last_measure_at=p.measured_at,technical_missing_since=null where device_id=p.device_id;
   end if;
  end if;
  if available then
   perform public.kitchen_meater_path_ingest(p.device_id,p.measured_at,p.internal_c,p.ambient_c,stamp);
  end if;
 end loop;
 return new;
exception when others then
 raise warning 'MEATER parcours ingestion failed: %',SQLSTATE;
 return new;
end $$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_claim(p_manual boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype;tok text;technical_monitor boolean;stamp timestamptz;cadence interval;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 stamp:=clock_timestamp();
 if p_manual is null then return jsonb_build_object('error','Mode de collecte invalide');end if;
 technical_monitor:=not s.enabled and (exists(select 1 from public.kitchen_meater_probes where slot between 1 and 12) or exists(select 1 from public.kitchen_meater_paths where status in ('armed','running')));
 if not p_manual and not s.enabled and not technical_monitor and coalesce(s.test_until<=stamp,true) then return jsonb_build_object('skipped',true);end if;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré');end if;
 if s.last_error='Limite de requêtes MEATER atteinte' and s.last_poll_at>stamp-interval '60 seconds' then return jsonb_build_object('skipped',true);end if;
 cadence:=case when technical_monitor then interval '4 seconds' else interval '30 seconds' end;
 if s.last_poll_at>stamp-cadence then return jsonb_build_object('skipped',true);end if;
 if technical_monitor and s.last_poll_at>stamp-interval '15 seconds' and (s.last_ok_at is null or s.last_ok_at<s.last_poll_at) then return jsonb_build_object('skipped',true);end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible');end if;
 update public.kitchen_meater_settings set last_poll_at=stamp,graph_request_id=null where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $function$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_path_ingest(p_device text, p_at timestamp with time zone, p_core numeric, p_ambient numeric, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.kitchen_meater_paths%rowtype; reached boolean; record_sample boolean;
begin
 if p_at is null or p_core is null or p_core not between -10 and 105 or p_at>p_now or p_at<p_now-interval '120 seconds' then return;end if;
 select * into r from public.kitchen_meater_paths where device_id=p_device and status in ('armed','running') for update;
 if not found or (p_at<r.armed_at or (p_at=r.armed_at and r.armed_by<>'auto-meater')) or (r.last_measure_at is not null and p_at<=r.last_measure_at) then return;end if;
 if r.status='armed' then
  if p_now>=r.armed_at+interval '30 minutes' then return;end if;
  if p_core>=10 then
   update public.kitchen_meater_paths set last_measure_at=p_at,last_c=p_core,last_ambient_c=p_ambient where id=r.id;
   return;
  end if;
  update public.kitchen_meater_paths set status='running',started_at=p_at,deadline_at=p_at+interval '1 hour',trigger_c=p_core,cold_c=p_core,cold_at=p_at,last_measure_at=p_at,last_record_at=p_at,last_c=p_core,last_ambient_c=p_ambient where id=r.id;
  insert into public.kitchen_meater_path_samples values(r.id,p_at,p_core,p_ambient,'trigger') on conflict do nothing;
  return;
 end if;
 if p_now>=r.deadline_at or p_at>=r.deadline_at then return;end if;
 if not r.heating and p_core<10 and abs(p_core-3)<abs(r.cold_c-3) then r.cold_c:=p_core;r.cold_at:=p_at;end if;
 r.heating:=r.heating or p_core>=10;
 if r.heating and (r.hot_c is null or abs(p_core-65)<abs(r.hot_c-65)) then r.hot_c:=p_core;r.hot_at:=p_at;end if;
 reached:=r.heating and p_core>=65;
 record_sample:=reached or r.last_record_at is null or floor(extract(epoch from (p_at-r.started_at))/10)>floor(extract(epoch from (r.last_record_at-r.started_at))/10);
 if record_sample then
  insert into public.kitchen_meater_path_samples values(r.id,p_at,p_core,p_ambient,case when reached then 'target' else 'periodic' end) on conflict do nothing;
  r.last_record_at:=p_at;
 end if;
 update public.kitchen_meater_paths set cold_c=r.cold_c,cold_at=r.cold_at,heating=r.heating,hot_c=r.hot_c,hot_at=r.hot_at,last_measure_at=p_at,last_record_at=r.last_record_at,last_c=p_core,last_ambient_c=p_ambient,status=case when reached then 'target' else 'running' end,reached_c=case when reached then p_core else null end,finished_at=case when reached then p_at else null end where id=r.id;
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
  update public.kitchen_meater_paths set status='cancelled',finished_at=stamp,reason='Collecte professionnelle activée' where status in ('armed','running');
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
