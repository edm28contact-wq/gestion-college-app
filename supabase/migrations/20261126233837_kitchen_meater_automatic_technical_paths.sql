-- Independent technical trials; no HACCP compliance or reheat record is inferred.
create table public.kitchen_meater_paths (
 id uuid primary key default gen_random_uuid(),
 device_id text not null references public.kitchen_meater_probes(device_id),
 label text not null, slot integer not null check(slot between 1 and 12),
 armed_by text not null, armed_at timestamptz not null default clock_timestamp(),
 status text not null default 'armed' check(status in ('armed','running','target','expired','cancelled')),
 started_at timestamptz, deadline_at timestamptz, trigger_c numeric,
 cold_c numeric,cold_at timestamptz, heating boolean not null default false,
 hot_c numeric,hot_at timestamptz,reached_c numeric,finished_at timestamptz,
 last_measure_at timestamptz,last_record_at timestamptz,
 last_c numeric,last_ambient_c numeric, reason text
);
create unique index kitchen_meater_paths_one_active on public.kitchen_meater_paths(device_id) where status in ('armed','running');
create index kitchen_meater_paths_device_idx on public.kitchen_meater_paths(device_id,armed_at desc);
create table public.kitchen_meater_path_samples (
 path_id uuid not null references public.kitchen_meater_paths(id) on delete cascade,
 measured_at timestamptz not null,internal_c numeric not null,ambient_c numeric,
 event text not null check(event in ('trigger','periodic','target')),
 primary key(path_id,measured_at)
);
alter table public.kitchen_meater_paths enable row level security;
alter table public.kitchen_meater_path_samples enable row level security;
revoke all on public.kitchen_meater_paths,public.kitchen_meater_path_samples from public,anon,authenticated;
grant select,insert,update on public.kitchen_meater_paths to service_role;
grant select,insert on public.kitchen_meater_path_samples to service_role;

create function public.kitchen_meater_path_arm(p_device text,p_actor text) returns jsonb
language plpgsql set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype; p public.kitchen_meater_probes%rowtype; rid uuid;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.vault_secret_id is null or s.enabled then return jsonb_build_object('error','Essai technique disponible uniquement avec MEATER connecté et collecte HACCP professionnelle désactivée.');end if;
 select * into p from public.kitchen_meater_probes where device_id=p_device and slot between 1 and 12;
 if not found then return jsonb_build_object('error','Sonde non associée');end if;
 if exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p_device and l.detached_at is null and r.status='en_cours') then return jsonb_build_object('error','Sonde déjà associée à un cycle HACCP actif');end if;
 if exists(select 1 from public.kitchen_meater_paths where device_id=p_device and status in ('armed','running')) then return jsonb_build_object('error','Un parcours est déjà actif pour cette sonde');end if;
 insert into public.kitchen_meater_paths(device_id,label,slot,armed_by) values(p.device_id,coalesce(p.label,'Sonde '||p.slot),p.slot,p_actor) returning id into rid;
 return jsonb_build_object('id',rid,'status','armed');
end $$;
create function public.kitchen_meater_path_cancel(p_id uuid,p_actor text) returns jsonb
language plpgsql set search_path='' as $$
begin
 update public.kitchen_meater_paths set status='cancelled',finished_at=clock_timestamp(),reason='Annulation manuelle par '||left(p_actor,80) where id=p_id and status in ('armed','running');
 if not found then return jsonb_build_object('error','Parcours déjà terminé ou introuvable');end if;
 return jsonb_build_object('status','cancelled');
end $$;

create function public.kitchen_meater_path_ingest(p_device text,p_at timestamptz,p_core numeric,p_ambient numeric,p_now timestamptz) returns void
language plpgsql set search_path='' as $$
declare r public.kitchen_meater_paths%rowtype; reached boolean; record_sample boolean;
begin
 if p_at is null or p_core is null or p_core not between -10 and 105 or p_at>p_now or p_at<p_now-interval '120 seconds' then return;end if;
 select * into r from public.kitchen_meater_paths where device_id=p_device and status in ('armed','running') for update;
 if not found or p_at<=r.armed_at or (r.last_measure_at is not null and p_at<=r.last_measure_at) then return;end if;
 if r.status='armed' then
  if p_now>=r.armed_at+interval '30 minutes' then return;end if;
  if p_core>=7 then
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
 record_sample:=reached or r.last_record_at is null or p_at>=r.last_record_at+interval '30 seconds';
 if record_sample then
  insert into public.kitchen_meater_path_samples values(r.id,p_at,p_core,p_ambient,case when reached then 'target' else 'periodic' end) on conflict do nothing;
  r.last_record_at:=p_at;
 end if;
 update public.kitchen_meater_paths set cold_c=r.cold_c,cold_at=r.cold_at,heating=r.heating,hot_c=r.hot_c,hot_at=r.hot_at,last_measure_at=p_at,last_record_at=r.last_record_at,last_c=p_core,last_ambient_c=p_ambient,status=case when reached then 'target' else 'running' end,reached_c=case when reached then p_core else null end,finished_at=case when reached then p_at else null end where id=r.id;
end $$;

create function public.kitchen_meater_path_after_poll() returns trigger
language plpgsql set search_path='' as $$
declare p record;
begin
 if new.enabled or new.last_error is not null or new.last_ok_at is not distinct from old.last_ok_at then return new;end if;
 for p in select d.device_id,d.measured_at,d.internal_c,d.ambient_c from public.kitchen_meater_probes d join public.kitchen_meater_paths r on r.device_id=d.device_id where d.present and r.status in ('armed','running') loop
  perform public.kitchen_meater_path_ingest(p.device_id,p.measured_at,p.internal_c,p.ambient_c,clock_timestamp());
 end loop;
 return new;
exception when others then
 raise warning 'MEATER parcours ingestion failed: %',SQLSTATE;
 return new;
end $$;
create trigger kitchen_meater_paths_after_poll after update of last_ok_at on public.kitchen_meater_settings for each row execute function public.kitchen_meater_path_after_poll();

-- Keep all production polling semantics unchanged; use shorter interval only during technical trials.
create or replace function public.kitchen_meater_claim(p_manual boolean) returns jsonb
language plpgsql set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype;tok text;active_path boolean;armed_path boolean;stamp timestamptz;cadence interval;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 stamp:=clock_timestamp();
 if p_manual is null then return jsonb_build_object('error','Mode de collecte invalide');end if;
 select exists(select 1 from public.kitchen_meater_paths where status in ('armed','running')),exists(select 1 from public.kitchen_meater_paths where status='armed') into active_path,armed_path;
 active_path:=active_path and not s.enabled;armed_path:=armed_path and active_path;
 if not p_manual and not s.enabled and not active_path and coalesce(s.test_until<=stamp,true) then return jsonb_build_object('skipped',true);end if;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré');end if;
 if s.last_error='Limite de requêtes MEATER atteinte' and s.last_poll_at>stamp-interval '60 seconds' then return jsonb_build_object('skipped',true);end if;
 cadence:=case when armed_path then interval '4 seconds' when active_path then interval '29 seconds' else interval '30 seconds' end;
 if s.last_poll_at>stamp-cadence then return jsonb_build_object('skipped',true);end if;
 if active_path and s.last_poll_at>stamp-interval '15 seconds' and (s.last_ok_at is null or s.last_ok_at<s.last_poll_at) then return jsonb_build_object('skipped',true);end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible');end if;
 update public.kitchen_meater_settings set last_poll_at=stamp,graph_request_id=null where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $$;

create function public.kitchen_meater_path_tick() returns void
language plpgsql set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype; stamp timestamptz:=clock_timestamp(); ts bigint;cadence interval;
begin
 update public.kitchen_meater_paths set status='expired',finished_at=stamp,reason=case when status='armed' then 'Aucune mesure sous 7 °C dans les 30 minutes' else 'Objectif non confirmé dans l’heure' end where (status='armed' and armed_at<=stamp-interval '30 minutes') or (status='running' and deadline_at<=stamp);
 if not exists(select 1 from public.kitchen_meater_paths where status in ('armed','running')) then return;end if;
 select * into s from public.kitchen_meater_settings where id=1;
 if s.enabled then
  update public.kitchen_meater_paths set status='cancelled',finished_at=stamp,reason='Collecte professionnelle activée' where status in ('armed','running');
  return;
 end if;
 if s.vault_secret_id is null then return;end if;
 cadence:=case when exists(select 1 from public.kitchen_meater_paths where status='armed') then interval '4 seconds' else interval '29 seconds' end;
 if s.last_poll_at>stamp-cadence or (s.last_error='Limite de requêtes MEATER atteinte' and s.last_poll_at>stamp-interval '60 seconds') then return;end if;
 if s.last_poll_at>stamp-interval '15 seconds' and (s.last_ok_at is null or s.last_ok_at<s.last_poll_at) then return;end if;
 ts:=extract(epoch from stamp)::bigint;
 perform net.http_post(url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api?action=meater-auto-sync',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('timestamp',ts,'signature',translate(rtrim(encode(extensions.hmac('kitchen-meater-cron:'||ts::text,(select admin_token::text from public.system_settings where id=1),'sha256'),'base64'),'='),'+/','-_')),timeout_milliseconds:=20000);
end $$;
revoke all on function public.kitchen_meater_path_arm(text,text),public.kitchen_meater_path_cancel(uuid,text),public.kitchen_meater_path_ingest(text,timestamptz,numeric,numeric,timestamptz),public.kitchen_meater_path_after_poll(),public.kitchen_meater_path_tick(),public.kitchen_meater_claim(boolean) from public,anon,authenticated;
grant execute on function public.kitchen_meater_path_arm(text,text),public.kitchen_meater_path_cancel(uuid,text),public.kitchen_meater_path_ingest(text,timestamptz,numeric,numeric,timestamptz),public.kitchen_meater_path_after_poll(),public.kitchen_meater_claim(boolean) to service_role;
select cron.schedule('kitchen-meater-technical-paths','5 seconds','select public.kitchen_meater_path_tick()');
