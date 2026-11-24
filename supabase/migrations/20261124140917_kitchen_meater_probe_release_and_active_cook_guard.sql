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
 if not found or not s.enabled or s.last_error is not null or not p.present or p.qualified_at is null or p.measured_at is null or p.measured_at<now()-interval '2 minutes' or p.cook_id is null or p.cook_state is distinct from 'Started' then return jsonb_build_object('error','Sonde qualifiée, connectée et cuisson MEATER active requises'); end if;
 update public.kitchen_meater_links l set detached_at=now() from public.kitchen_reheats h where h.id=l.reheat_id and h.status<>'en_cours' and l.detached_at is null;
 insert into public.kitchen_meater_links(reheat_id,device_id,cook_id,attached_by) values(p_reheat,p_device,p.cook_id,p_actor::text);
 return jsonb_build_object('linked',true);
exception when unique_violation then return jsonb_build_object('error','Sonde ou cycle déjà associé');
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
 if (p_slot is not null and p_slot not between 1 and 4) or (p_slot is null and p_qualified) or length(btrim(p_label)) not between 1 and 80 or p_qualified is null then return jsonb_build_object('error','Paramètres invalides'); end if;
 if exists(select 1 from public.kitchen_meater_links l join public.kitchen_reheats r on r.id=l.reheat_id where l.device_id=p_device and l.detached_at is null and r.status='en_cours') then return jsonb_build_object('error','Sonde utilisée dans un cycle'); end if;
 if p_qualified and (not p.present or p.measured_at is null or p.measured_at<now()-interval '2 minutes') then return jsonb_build_object('error','Mesure récente requise pour la qualification'); end if;
 update public.kitchen_meater_probes set slot=p_slot,label=btrim(p_label),qualified_at=case when p_qualified then now() else null end,qualified_by=case when p_qualified then p_actor else null end where device_id=p_device;
 return jsonb_build_object('saved',true);
exception when unique_violation then return jsonb_build_object('error','Numéro de sonde déjà attribué');
end $function$
;