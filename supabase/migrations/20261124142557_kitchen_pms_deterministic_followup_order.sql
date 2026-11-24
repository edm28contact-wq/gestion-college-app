alter table public.kitchen_pms_followups add column event_seq bigint generated always as identity;
grant usage,select on sequence public.kitchen_pms_followups_event_seq_seq to service_role;
create index kitchen_pms_followups_order_idx on public.kitchen_pms_followups(record_id,event_seq desc);
CREATE OR REPLACE FUNCTION public.kitchen_pms_followup(p_id uuid, p_action text, p_note text, p_evidence text, p_actor text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.kitchen_pms_records%rowtype; state text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,29));
 select * into r from public.kitchen_pms_records where id=p_id;
 if not found or r.result not in ('alert','review') then return jsonb_build_object('error','Dossier à vérifier introuvable','status',404);end if;
 select action into state from public.kitchen_pms_followups where record_id=p_id and action in ('closed','reopened') order by event_seq desc limit 1;
 if (p_action='closed' and state='closed') or (p_action='reopened' and state is distinct from 'closed') then return jsonb_build_object('error','État déjà modifié','status',409);end if;
 if p_action not in ('followup','closed','reopened') or length(btrim(coalesce(p_note,'')))<3 or (p_action in ('closed','reopened') and length(btrim(coalesce(p_evidence,'')))<3) then return jsonb_build_object('error','Motif et preuve de vérification nécessaires','status',400);end if;
 insert into public.kitchen_pms_followups(record_id,action,note,evidence_ref,actor,actor_name) values(p_id,p_action,p_note,p_evidence,p_actor,p_name);
 return jsonb_build_object('saved',true);
end $function$
;
CREATE OR REPLACE FUNCTION public.kitchen_pms_open_alerts()
 RETURNS TABLE(id uuid, code text, observed_at timestamp with time zone, reasons text[], corrective_action text, actor_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select r.id,r.code,r.observed_at,r.reasons,r.corrective_action,r.actor_name
 from public.kitchen_pms_records r
 left join lateral(select f.action from public.kitchen_pms_followups f where f.record_id=r.id and f.action in ('closed','reopened') order by f.event_seq desc limit 1) last_action on true
 where r.result in ('alert','review') and coalesce(last_action.action,'')<>'closed'
 order by r.observed_at desc,r.id
$function$
;
