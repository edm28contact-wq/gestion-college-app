create or replace function public.kitchen_meater_claim(p_manual boolean)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s public.kitchen_meater_settings%rowtype; tok text;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if p_manual is null then return jsonb_build_object('error','Mode de collecte invalide'); end if;
 if not p_manual and not s.enabled then return jsonb_build_object('skipped',true); end if;
 if not p_manual and s.professional_permission_ref is null then return jsonb_build_object('error','Autorisation professionnelle MEATER requise'); end if;
 if s.vault_secret_id is null then return jsonb_build_object('error','Compte MEATER non configuré'); end if;
 if s.last_poll_at is not null and s.last_poll_at>now()-interval '30 seconds' then return jsonb_build_object('skipped',true); end if;
 select decrypted_secret into tok from vault.decrypted_secrets where id=s.vault_secret_id;
 if tok is null then return jsonb_build_object('error','Jeton MEATER indisponible'); end if;
 update public.kitchen_meater_settings set last_poll_at=now() where id=1;
 return jsonb_build_object('token',tok,'generation',s.generation);
end $function$;
revoke all on function public.kitchen_meater_claim(boolean) from public,anon,authenticated;
grant execute on function public.kitchen_meater_claim(boolean) to service_role;