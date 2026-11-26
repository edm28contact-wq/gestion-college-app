-- Mode d'essai temporaire, strictement distinct des mesures de production.
alter table public.kitchen_meater_settings add column test_until timestamptz;
alter table public.kitchen_meater_settings add constraint kitchen_meater_exclusive_modes check (not enabled or test_until is null);

CREATE OR REPLACE FUNCTION public.kitchen_meater_test_mode(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; expires timestamptz;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_enabled is null then return jsonb_build_object('error','Mode invalide'); end if;
 if s.enabled then return jsonb_build_object('error','Suspendez la collecte de production avant un essai'); end if;
 if p_enabled and s.vault_secret_id is null then return jsonb_build_object('error','Connectez le compte MEATER'); end if;
 expires:=case when p_enabled then now()+interval '2 hours' else null end;
 update public.kitchen_meater_settings set test_until=expires,generation=gen_random_uuid(),updated_at=now() where id=1;
 return jsonb_build_object('test_until',expires,'test_active',p_enabled);
end $function$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_claim(p_manual boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; tok text;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_manual is null then return jsonb_build_object('error','Mode de collecte invalide'); end if;
 if not p_manual and not s.enabled and coalesce(s.test_until<=now(),true) then return jsonb_build_object('skipped',true); end if;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré'); end if;
 if s.last_poll_at is not null and s.last_poll_at>now()-interval '30 seconds' then return jsonb_build_object('skipped',true); end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible'); end if;
 update public.kitchen_meater_settings set last_poll_at=now() where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $function$;

CREATE OR REPLACE FUNCTION public.kitchen_meater_enable(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_enabled is null then return jsonb_build_object('error','État invalide'); end if;
 if p_enabled and (s.vault_secret_id is null or s.last_ok_at is null or s.last_error is not null or not exists(select 1 from public.kitchen_meater_probes where qualified_at is not null and qualification_expires_at>now() and present and measured_at>=now()-interval '2 minutes')) then return jsonb_build_object('error','Test récent et qualification d’au moins une sonde requis'); end if;
 update public.kitchen_meater_settings set enabled=p_enabled,test_until=null,generation=gen_random_uuid(),updated_at=now() where id=1;
 return jsonb_build_object('enabled',p_enabled);
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
 update public.kitchen_meater_settings set vault_secret_id=sid,enabled=false,test_until=null,generation=gen_random_uuid(),last_poll_at=null,last_ok_at=null,last_error=null,updated_at=now() where id=1;
 update public.kitchen_meater_probes set present=false,qualified_at=null,qualified_by=null,qualification_expires_at=null
 where present or qualified_at is not null or qualified_by is not null or qualification_expires_at is not null;
 update public.kitchen_meater_links set detached_at=now() where detached_at is null;
 return true;
end $function$;

revoke all on function public.kitchen_meater_test_mode(boolean) from public,anon,authenticated;
grant execute on function public.kitchen_meater_test_mode(boolean) to service_role;

-- Modifier exclusivement la tache MEATER existante, sans toucher a Govee.
do $cron$
declare j record; next_command text;
begin
 select jobid,command into strict j from cron.job where jobname='kitchen-meater-poll';
 if strpos(j.command,'where id=1 and enabled and vault_secret_id is not null')=0 then raise exception 'Unexpected MEATER cron definition';end if;
 next_command:=replace(j.command,'where id=1 and enabled and vault_secret_id is not null','where id=1 and (enabled or test_until>now()) and vault_secret_id is not null');
 perform cron.alter_job(j.jobid,command:=next_command);
end $cron$;
