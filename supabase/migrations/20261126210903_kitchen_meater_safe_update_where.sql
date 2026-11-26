-- Compatibilite avec la protection UPDATE sans WHERE de PostgREST.
-- Ne modifier que les sondes dont l'etat doit changer; conserver les affectations.
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
  update public.kitchen_meater_probes set present=false where present;
  return jsonb_build_object('error',left(p_error,240));
 end if;
 if jsonb_typeof(p_devices)<>'array' then raise exception 'Invalid devices'; end if;
 update public.kitchen_meater_links l set detached_at=now() from public.kitchen_reheats r where r.id=l.reheat_id and r.status<>'en_cours' and l.detached_at is null;
 update public.kitchen_meater_probes set present=false where present;
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
  where l.detached_at is null and r.status='en_cours' and p.qualified_at is not null and p.qualification_expires_at>now() and p.present
  and p.cook_id=l.cook_id and p.measured_at>=greatest(l.attached_at,r.started_at)
  and p.measured_at<=now()+interval '10 seconds'
  on conflict do nothing;
  get diagnostics samples=row_count;
 end if;
 update public.kitchen_meater_settings set last_ok_at=now(),last_error=null where id=1;
 return jsonb_build_object('received',n,'samples',samples);
end $function$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_set_token(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sid uuid;
begin
 if p_token is null or length(p_token) not between 20 and 8192 then raise exception 'Invalid MEATER token'; end if;
 select vault_secret_id into sid from public.kitchen_meater_settings where id=1 for update;
 if sid is null then sid:=vault.create_secret(p_token,'kitchen-meater-cloud-token','MEATER Cloud Cantine');
 else perform vault.update_secret(sid,p_token,null,null,null); end if;
 update public.kitchen_meater_settings set vault_secret_id=sid,enabled=false,generation=gen_random_uuid(),last_poll_at=null,last_ok_at=null,last_error=null,updated_at=now() where id=1;
 update public.kitchen_meater_probes set present=false,qualified_at=null,qualified_by=null,qualification_expires_at=null
 where present or qualified_at is not null or qualified_by is not null or qualification_expires_at is not null;
 update public.kitchen_meater_links set detached_at=now() where detached_at is null;
 return true;
end $function$;

revoke all on function public.kitchen_meater_set_token(text) from public,anon,authenticated;
grant execute on function public.kitchen_meater_set_token(text) to service_role;
revoke all on function public.kitchen_meater_apply(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.kitchen_meater_apply(uuid,jsonb,text) to service_role;
