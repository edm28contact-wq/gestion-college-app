-- Consultation rapide uniquement, sans modification du rythme des cycles HACCP.
alter table public.kitchen_meater_settings add column graph_request_id uuid;

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
 if s.last_error='Limite de requêtes MEATER atteinte' and s.last_poll_at>now()-interval '60 seconds' then return jsonb_build_object('skipped',true); end if;
 if s.last_poll_at is not null and s.last_poll_at>now()-interval '30 seconds' then return jsonb_build_object('skipped',true); end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible'); end if;
 update public.kitchen_meater_settings set last_poll_at=now(),graph_request_id=null where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $function$;
revoke all on function public.kitchen_meater_claim(boolean) from public,anon,authenticated;
grant execute on function public.kitchen_meater_claim(boolean) to service_role;

CREATE OR REPLACE FUNCTION public.kitchen_meater_claim_graph()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype; tok text; stamp timestamptz; rid uuid;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 stamp:=clock_timestamp();
 if s.enabled or s.vault_secret_id is null then return jsonb_build_object('skipped',true);end if;
 -- 1.1 s: leave margin below 60 requests/minute, shared by every browser.
 if s.last_poll_at>stamp-interval '1100 milliseconds' then return jsonb_build_object('skipped',true);end if;
 if s.last_error is not null and s.last_poll_at>stamp-interval '60 seconds' then return jsonb_build_object('skipped',true);end if;
 -- Wait for a prior claim to finish, including normal/cron requests; recover after a timeout.
 if s.last_poll_at>stamp-interval '15 seconds' and (s.last_ok_at is null or s.last_ok_at<s.last_poll_at) then return jsonb_build_object('skipped',true);end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible');end if;
 rid:=gen_random_uuid();
 update public.kitchen_meater_settings set last_poll_at=stamp,graph_request_id=rid where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation,'request_id',rid);
end $function$;
revoke all on function public.kitchen_meater_claim_graph() from public,anon,authenticated;
grant execute on function public.kitchen_meater_claim_graph() to service_role;

CREATE OR REPLACE FUNCTION public.kitchen_meater_apply_graph(p_request_id uuid, p_generation uuid, p_devices jsonb, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.kitchen_meater_settings%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.enabled or p_request_id is null or s.graph_request_id is distinct from p_request_id or s.generation is distinct from p_generation then
  return jsonb_build_object('skipped',true);
 end if;
 update public.kitchen_meater_settings set graph_request_id=null where id=1;
 return public.kitchen_meater_apply(p_generation,p_devices,p_error);
end $function$;
revoke all on function public.kitchen_meater_apply_graph(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.kitchen_meater_apply_graph(uuid,uuid,jsonb,text) to service_role;

