
create table public.kitchen_meater_settings (
 id integer primary key check(id=1),
 vault_secret_id uuid,
 enabled boolean not null default false,
 generation uuid not null default gen_random_uuid(),
 last_poll_at timestamptz,
 last_ok_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
insert into public.kitchen_meater_settings(id) values(1);
create table public.kitchen_meater_probes (
 device_id text primary key check(length(device_id) between 1 and 160),
 slot integer unique check(slot between 1 and 4),
 label text check(length(label) between 1 and 80),
 qualified_at timestamptz,
 qualified_by text,
 present boolean not null default false,
 internal_c numeric check(internal_c between -10 and 105),
 ambient_c numeric check(ambient_c between -10 and 550),
 measured_at timestamptz,
 cook_id text,
 cook_state text,
 received_at timestamptz,
 check(qualified_at is null or slot is not null)
);
create table public.kitchen_meater_links (
 reheat_id uuid primary key references public.kitchen_reheats(id) on delete restrict,
 device_id text not null references public.kitchen_meater_probes(device_id) on delete restrict,
 cook_id text not null,
 attached_at timestamptz not null default now(),
 attached_by text not null,
 detached_at timestamptz
);
create unique index kitchen_meater_one_active_link on public.kitchen_meater_links(device_id) where detached_at is null;
create table public.kitchen_meater_samples (
 reheat_id uuid not null references public.kitchen_meater_links(reheat_id) on delete restrict,
 measured_at timestamptz not null,
 internal_c numeric not null check(internal_c between -10 and 105),
 ambient_c numeric not null check(ambient_c between -10 and 550),
 received_at timestamptz not null default now(),
 primary key(reheat_id,measured_at)
);
alter table public.kitchen_meater_settings enable row level security;
alter table public.kitchen_meater_probes enable row level security;
alter table public.kitchen_meater_links enable row level security;
alter table public.kitchen_meater_samples enable row level security;
revoke all on public.kitchen_meater_settings,public.kitchen_meater_probes,public.kitchen_meater_links,public.kitchen_meater_samples from public,anon,authenticated;
grant select,insert,update,delete on public.kitchen_meater_settings,public.kitchen_meater_probes,public.kitchen_meater_links,public.kitchen_meater_samples to service_role;

create function public.kitchen_meater_set_token(p_token text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare sid uuid;
begin
 if p_token is null or length(p_token) not between 20 and 8192 then raise exception 'Invalid MEATER token'; end if;
 select vault_secret_id into sid from public.kitchen_meater_settings where id=1 for update;
 if sid is null then sid:=vault.create_secret(p_token,'kitchen-meater-cloud-token','MEATER Cloud Cantine');
 else perform vault.update_secret(sid,p_token,null,null,null); end if;
 update public.kitchen_meater_settings set vault_secret_id=sid,enabled=false,generation=gen_random_uuid(),last_poll_at=null,last_ok_at=null,last_error=null,updated_at=now() where id=1;
 update public.kitchen_meater_probes set present=false,qualified_at=null,qualified_by=null;
 update public.kitchen_meater_links set detached_at=now() where detached_at is null;
 return true;
end $$;

create function public.kitchen_meater_claim(p_manual boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype; tok text;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré'); end if;
 if not p_manual and not s.enabled then return jsonb_build_object('skipped',true); end if;
 if s.last_poll_at is not null and s.last_poll_at>now()-interval '30 seconds' then return jsonb_build_object('skipped',true); end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible'); end if;
 update public.kitchen_meater_settings set last_poll_at=now() where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $$;

create function public.kitchen_meater_apply(p_generation uuid,p_devices jsonb,p_error text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype; d record; n int:=0; samples int:=0;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.generation<>p_generation then return jsonb_build_object('skipped',true); end if;
 if p_error is not null then
  update public.kitchen_meater_settings set last_error=left(p_error,240) where id=1;
  update public.kitchen_meater_probes set present=false;
  return jsonb_build_object('error',left(p_error,240));
 end if;
 if jsonb_typeof(p_devices)<>'array' then raise exception 'Invalid devices'; end if;
 update public.kitchen_meater_links l set detached_at=now() from public.kitchen_reheats r where r.id=l.reheat_id and r.status<>'en_cours' and l.detached_at is null;
 update public.kitchen_meater_probes set present=false;
 for d in select * from jsonb_to_recordset(p_devices) as x(device_id text,internal_c numeric,ambient_c numeric,measured_at timestamptz,cook_id text,cook_state text)
 loop
  if d.measured_at is null or d.measured_at<now()-interval '2 minutes' or d.measured_at>now()+interval '10 seconds' then continue; end if;
  insert into public.kitchen_meater_probes(device_id,present,internal_c,ambient_c,measured_at,cook_id,cook_state,received_at)
  values(d.device_id,true,d.internal_c,d.ambient_c,d.measured_at,d.cook_id,d.cook_state,now())
  on conflict(device_id) do update set present=true,internal_c=excluded.internal_c,ambient_c=excluded.ambient_c,measured_at=excluded.measured_at,cook_id=excluded.cook_id,cook_state=excluded.cook_state,received_at=excluded.received_at
  where kitchen_meater_probes.measured_at is null or excluded.measured_at>=kitchen_meater_probes.measured_at;
  n:=n+1;
 end loop;
 if s.enabled then
  insert into public.kitchen_meater_samples(reheat_id,measured_at,internal_c,ambient_c)
  select l.reheat_id,p.measured_at,p.internal_c,p.ambient_c from public.kitchen_meater_links l
  join public.kitchen_reheats r on r.id=l.reheat_id
  join public.kitchen_meater_probes p on p.device_id=l.device_id
  where l.detached_at is null and r.status='en_cours' and p.qualified_at is not null and p.present
  and p.cook_id=l.cook_id and p.measured_at>=greatest(l.attached_at,r.started_at)
  and p.measured_at<=now()+interval '10 seconds'
  on conflict do nothing;
  get diagnostics samples=row_count;
 end if;
 update public.kitchen_meater_settings set last_ok_at=now(),last_error=null where id=1;
 return jsonb_build_object('received',n,'samples',samples);
end $$;

create function public.kitchen_meater_configure_probe(p_device text,p_slot integer,p_label text,p_qualified boolean,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.kitchen_meater_probes%rowtype;
begin
 perform 1 from public.kitchen_meater_settings where id=1 for update;
 select * into p from public.kitchen_meater_probes where device_id=p_device for update;
 if not found then return jsonb_build_object('error','Sonde non détectée'); end if;
 if p_slot is null or p_slot not between 1 and 4 or length(btrim(p_label)) not between 1 and 80 or p_qualified is null then return jsonb_build_object('error','Paramètres invalides'); end if;
 if exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p_device and l.detached_at is null and r.status='en_cours') then return jsonb_build_object('error','Sonde utilisée dans un cycle'); end if;
 if p_qualified and (not p.present or p.measured_at is null or p.measured_at<now()-interval '2 minutes') then return jsonb_build_object('error','Mesure récente requise pour la qualification'); end if;
 update public.kitchen_meater_probes set slot=p_slot,label=btrim(p_label),qualified_at=case when p_qualified then now() else null end,qualified_by=case when p_qualified then p_actor else null end where device_id=p_device;
 return jsonb_build_object('saved',true);
exception when unique_violation then return jsonb_build_object('error','Numéro de sonde déjà attribué');
end $$;

create function public.kitchen_meater_enable(p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_enabled is null then return jsonb_build_object('error','État invalide'); end if;
 if p_enabled and (s.vault_secret_id is null or s.last_ok_at is null or s.last_error is not null or not exists(select 1 from public.kitchen_meater_probes where qualified_at is not null and present and measured_at>=now()-interval '2 minutes')) then return jsonb_build_object('error','Test récent et qualification d’au moins une sonde requis'); end if;
 update public.kitchen_meater_settings set enabled=p_enabled,updated_at=now() where id=1;
 return jsonb_build_object('enabled',p_enabled);
end $$;

create function public.kitchen_meater_attach(p_reheat uuid,p_device text,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype; p public.kitchen_meater_probes%rowtype; r public.kitchen_reheats%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 select * into r from public.kitchen_reheats where id=p_reheat for update;
 if not found or r.status<>'en_cours' or r.started_by<>p_actor then return jsonb_build_object('error','Cycle actif de votre session requis'); end if;
 select * into p from public.kitchen_meater_probes where device_id=p_device for update;
 if not found or not s.enabled or s.last_error is not null or not p.present or p.qualified_at is null or p.measured_at is null or p.measured_at<now()-interval '2 minutes' or p.cook_id is null or p.cook_state<>'Started' then return jsonb_build_object('error','Sonde qualifiée, connectée et cuisson MEATER active requises'); end if;
 update public.kitchen_meater_links l set detached_at=now() from public.kitchen_reheats h where h.id=l.reheat_id and h.status<>'en_cours' and l.detached_at is null;
 insert into public.kitchen_meater_links(reheat_id,device_id,cook_id,attached_by) values(p_reheat,p_device,p.cook_id,p_actor::text);
 return jsonb_build_object('linked',true);
exception when unique_violation then return jsonb_build_object('error','Sonde ou cycle déjà associé');
end $$;

revoke all on function public.kitchen_meater_set_token(text),public.kitchen_meater_claim(boolean),public.kitchen_meater_apply(uuid,jsonb,text),public.kitchen_meater_configure_probe(text,integer,text,boolean,text),public.kitchen_meater_enable(boolean),public.kitchen_meater_attach(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.kitchen_meater_set_token(text),public.kitchen_meater_claim(boolean),public.kitchen_meater_apply(uuid,jsonb,text),public.kitchen_meater_configure_probe(text,integer,text,boolean,text),public.kitchen_meater_enable(boolean),public.kitchen_meater_attach(uuid,text,uuid) to service_role;

select cron.schedule('kitchen-meater-poll','30 seconds',$job$
 select net.http_post(
  url:='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api?action=meater-auto-sync',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object(
   'timestamp',extract(epoch from now())::bigint,
   'signature',translate(rtrim(encode(extensions.hmac(
    'kitchen-meater-cron:'||(extract(epoch from now())::bigint)::text,
    (select admin_token::text from public.system_settings where id=1),'sha256'),'base64'),'='),'+/','-_')
  ),timeout_milliseconds:=20000
 ) where exists(select 1 from public.kitchen_meater_settings where id=1 and enabled and vault_secret_id is not null);
 $job$);
notify pgrst,'reload schema';
