
alter table public.kitchen_meater_probes drop constraint kitchen_meater_probes_slot_check;
alter table public.kitchen_meater_probes add constraint kitchen_meater_probes_slot_check check(slot between 1 and 12);
alter table public.kitchen_meater_settings add column professional_permission_ref text check(char_length(professional_permission_ref) between 5 and 500);
alter table public.kitchen_meater_probes add column qualification_expires_at timestamptz;
create table public.kitchen_meater_qualification (
 id uuid primary key default gen_random_uuid(),
 device_id text not null references public.kitchen_meater_probes(device_id) on delete restrict,
 slot int not null check(slot between 1 and 12),
 manufacturer_certificate text not null check(char_length(btrim(manufacturer_certificate)) between 3 and 240),
 reference_certificate text not null check(char_length(btrim(reference_certificate)) between 3 and 240),
 cold_ref numeric not null check(cold_ref between -2 and 5),
 cold_probe numeric not null check(cold_probe between -10 and 105),
 hot_ref numeric not null check(hot_ref between 60 and 75),
 hot_probe numeric not null check(hot_probe between -10 and 105),
 reference_uncertainty numeric not null check(reference_uncertainty between 0 and 0.5),
 transmission_verified boolean not null,
 hygiene_verified boolean not null,
 passed boolean not null,
 recorded_by text not null,
 recorded_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index kitchen_meater_qualification_device_idx on public.kitchen_meater_qualification(device_id,recorded_at desc);
alter table public.kitchen_meater_qualification enable row level security;
revoke all on public.kitchen_meater_qualification from public,anon,authenticated;
grant select,insert on public.kitchen_meater_qualification to service_role;
create function public.kitchen_meater_professional_permission(p_ref text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_ref is not null and char_length(btrim(p_ref)) not between 5 and 500 then return jsonb_build_object('error','Référence de l’autorisation écrite requise'); end if;
 update public.kitchen_meater_settings set professional_permission_ref=nullif(btrim(p_ref),''),enabled=false,generation=gen_random_uuid(),updated_at=now() where id=1;
 return jsonb_build_object('saved',true);
end $$;
create function public.kitchen_meater_record_qualification(p_device text,p_evidence jsonb,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.kitchen_meater_probes%rowtype; s public.kitchen_meater_settings%rowtype;
 a numeric; b numeric; c numeric; d numeric; u numeric; ok boolean; expires timestamptz:=now()+interval '1 year'; cert text; ref text; transmission boolean; hygiene boolean;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 select * into p from public.kitchen_meater_probes where device_id=p_device for update;
 if not found or p.slot is null then return jsonb_build_object('error','Sonde et emplacement physique requis'); end if;
 if exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p_device and l.detached_at is null and r.status='en_cours') then return jsonb_build_object('error','Sonde utilisée dans un cycle'); end if;
 cert:=btrim(p_evidence->>'manufacturer_certificate');ref:=btrim(p_evidence->>'reference_certificate');
 a:=(p_evidence->>'cold_ref')::numeric;b:=(p_evidence->>'cold_probe')::numeric;c:=(p_evidence->>'hot_ref')::numeric;d:=(p_evidence->>'hot_probe')::numeric;u:=(p_evidence->>'reference_uncertainty')::numeric;
 transmission:=(p_evidence->>'transmission_verified')::boolean;hygiene:=(p_evidence->>'hygiene_verified')::boolean;
 if cert is null or length(cert) not between 3 and 240 or ref is null or length(ref) not between 3 and 240 or a is null or a not between -2 and 5 or b is null or b not between -10 and 105 or c is null or c not between 60 and 75 or d is null or d not between -10 and 105 or u is null or u not between 0 and 0.5 or transmission is null or hygiene is null then return jsonb_build_object('error','Dossier de qualification incomplet ou mesures hors plage'); end if;
 ok:=abs(a-b)+u<=0.5 and abs(c-d)+u<=0.5 and transmission and hygiene and p.present and p.measured_at is not null and p.measured_at>=now()-interval '2 minutes' and s.last_error is null and s.professional_permission_ref is not null;
 insert into public.kitchen_meater_qualification(device_id,slot,manufacturer_certificate,reference_certificate,cold_ref,cold_probe,hot_ref,hot_probe,reference_uncertainty,transmission_verified,hygiene_verified,passed,recorded_by,expires_at)
 values(p_device,p.slot,cert,ref,a,b,c,d,u,transmission,hygiene,ok,p_actor,expires);
 update public.kitchen_meater_probes set qualified_at=case when ok then now() else null end,qualified_by=case when ok then p_actor else null end,qualification_expires_at=case when ok then expires else null end where device_id=p_device;
 return jsonb_build_object('recorded',true,'qualified',ok,'cold_error',abs(a-b),'hot_error',abs(c-d),'expires_at',case when ok then expires else null end);
end $$;
revoke all on function public.kitchen_meater_professional_permission(text),public.kitchen_meater_record_qualification(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.kitchen_meater_professional_permission(text),public.kitchen_meater_record_qualification(text,jsonb,text) to service_role;
CREATE OR REPLACE FUNCTION public.kitchen_meater_apply(p_generation uuid, p_devices jsonb, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 if s.enabled and s.professional_permission_ref is not null then
  insert into public.kitchen_meater_samples(reheat_id,measured_at,internal_c,ambient_c)
  select l.reheat_id,p.measured_at,p.internal_c,p.ambient_c from public.kitchen_meater_links l
  join public.kitchen_reheats r on r.id=l.reheat_id
  join public.kitchen_meater_probes p on p.device_id=l.device_id
  where l.detached_at is null and r.status='en_cours' and p.qualified_at is not null and p.qualification_expires_at>now() and p.present
  and p.cook_id=l.cook_id and p.measured_at>=greatest(l.attached_at,r.started_at)
  and p.measured_at<=now()+interval '10 seconds'
  on conflict do nothing;
  get diagnostics samples=row_count;
 end if;
 update public.kitchen_meater_settings set last_ok_at=now(),last_error=null where id=1;
 return jsonb_build_object('received',n,'samples',samples);
end $function$
;
CREATE OR REPLACE FUNCTION public.kitchen_meater_attach(p_reheat uuid, p_device text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; p public.kitchen_meater_probes%rowtype; r public.kitchen_reheats%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 select * into r from public.kitchen_reheats where id=p_reheat for update;
 if not found or r.status<>'en_cours' or r.started_by<>p_actor then return jsonb_build_object('error','Cycle actif de votre session requis'); end if;
 select * into p from public.kitchen_meater_probes where device_id=p_device for update;
 if not found or not s.enabled or s.professional_permission_ref is null or s.last_error is not null or not p.present or p.qualified_at is null or p.qualification_expires_at is null or p.qualification_expires_at<=now() or p.measured_at is null or p.measured_at<now()-interval '2 minutes' or p.cook_id is null or p.cook_state is distinct from 'Started' then return jsonb_build_object('error','Sonde qualifiée, connectée et cuisson MEATER active requises'); end if;
 update public.kitchen_meater_links l set detached_at=now() from public.kitchen_reheats h where h.id=l.reheat_id and h.status<>'en_cours' and l.detached_at is null;
 insert into public.kitchen_meater_links(reheat_id,device_id,cook_id,attached_by) values(p_reheat,p_device,p.cook_id,p_actor::text);
 return jsonb_build_object('linked',true);
exception when unique_violation then return jsonb_build_object('error','Sonde ou cycle déjà associé');
end $function$
;
CREATE OR REPLACE FUNCTION public.kitchen_meater_claim(p_manual boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; tok text;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.professional_permission_ref is null then return jsonb_build_object('error','Autorisation professionnelle MEATER requise'); end if;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré'); end if;
 if not p_manual and not s.enabled then return jsonb_build_object('skipped',true); end if;
 if s.last_poll_at is not null and s.last_poll_at>now()-interval '30 seconds' then return jsonb_build_object('skipped',true); end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible'); end if;
 update public.kitchen_meater_settings set last_poll_at=now() where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $function$
;
CREATE OR REPLACE FUNCTION public.kitchen_meater_configure_probe(p_device text, p_slot integer, p_label text, p_qualified boolean, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.kitchen_meater_probes%rowtype;
begin
 perform 1 from public.kitchen_meater_settings where id=1 for update;
 select * into p from public.kitchen_meater_probes where device_id=p_device for update;
 if not found then return jsonb_build_object('error','Sonde non détectée'); end if;
 if (p_slot is not null and p_slot not between 1 and 12) or (p_slot is null and p_qualified) or length(btrim(p_label)) not between 1 and 80 or p_qualified is null then return jsonb_build_object('error','Paramètres invalides'); end if;
 if exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p_device and l.detached_at is null and r.status='en_cours') then return jsonb_build_object('error','Sonde utilisée dans un cycle'); end if;
 if p_qualified then return jsonb_build_object('error','Enregistrez un dossier de qualification complet'); end if;
 update public.kitchen_meater_probes set slot=p_slot,label=btrim(p_label),qualified_at=case when p_slot is not distinct from p.slot then p.qualified_at else null end,qualified_by=case when p_slot is not distinct from p.slot then p.qualified_by else null end,qualification_expires_at=case when p_slot is not distinct from p.slot then p.qualification_expires_at else null end where device_id=p_device;
 return jsonb_build_object('saved',true);
exception when unique_violation then return jsonb_build_object('error','Numéro de sonde déjà attribué');
end $function$
;
CREATE OR REPLACE FUNCTION public.kitchen_meater_enable(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_enabled is null then return jsonb_build_object('error','État invalide'); end if;
 if p_enabled and (s.professional_permission_ref is null or s.vault_secret_id is null or s.last_ok_at is null or s.last_error is not null or not exists(select 1 from public.kitchen_meater_probes where qualified_at is not null and qualification_expires_at>now() and present and measured_at>=now()-interval '2 minutes')) then return jsonb_build_object('error','Test récent et qualification d’au moins une sonde requis'); end if;
 update public.kitchen_meater_settings set enabled=p_enabled,updated_at=now() where id=1;
 return jsonb_build_object('enabled',p_enabled);
end $function$
;
notify pgrst,'reload schema';