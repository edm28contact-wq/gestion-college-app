-- Protocole 7 : formulaire papier de nettoyage du self, transcription du 24/11/2026.
alter table public.kitchen_task_rules drop constraint kitchen_task_rules_recurrence_check;
alter table public.kitchen_task_rules add constraint kitchen_task_rules_recurrence_check check(recurrence in ('daily','weekly','once','monthly','on_demand'));
alter table public.kitchen_task_rules add constraint kitchen_task_rules_monthly_weekday_check check(recurrence<>'monthly' or cardinality(weekdays)=1);
CREATE OR REPLACE FUNCTION public.kitchen_task_calendar(p_day date)
 RETURNS TABLE(id uuid, label text, assigned_to uuid, active boolean, created_at timestamp with time zone, description text, instructions text, scheduled_time time without time zone, weekdays integer[], starts_on date, ends_on date, priority text, recurrence text, scheduled boolean, effective_on date, single_day boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select t.id,coalesce(v.label,t.label),case when v.task_id is null then t.assigned_to else v.assigned_to end,
 coalesce(v.active,t.active),t.created_at,coalesce(v.description,''),coalesce(v.instructions,''),v.scheduled_time,
 coalesce(v.weekdays,array[1,2,3,4,5,6,7]),coalesce(v.starts_on,(t.created_at at time zone 'Europe/Paris')::date),v.ends_on,
 coalesce(v.priority,'normal'),coalesce(v.recurrence,'daily'),
 coalesce(v.active,t.active) and (
 case when v.single_day then true
 when v.task_id is null then (t.created_at at time zone 'Europe/Paris')::date<=p_day
 else p_day>=v.starts_on and (v.ends_on is null or p_day<=v.ends_on)
 and case v.recurrence when 'once' then p_day=v.starts_on when 'weekly' then extract(isodow from p_day)::int=any(v.weekdays)
 when 'monthly' then extract(day from p_day)<=7 and extract(isodow from p_day)::int=any(v.weekdays)
 when 'on_demand' then false else true end
 end
 ),
 v.effective_on,coalesce(v.single_day,false)
 from public.kitchen_tasks t
 left join lateral (
  select r.* from public.kitchen_task_rules r where r.task_id=t.id
  and ((r.single_day and r.effective_on=p_day) or (not r.single_day and r.effective_on<=p_day))
  order by r.single_day desc,r.effective_on desc limit 1
 ) v on true
 where (t.created_at at time zone 'Europe/Paris')::date<=p_day
 order by coalesce(v.scheduled_time,'23:59:59'::time),coalesce(v.label,t.label),t.id
$function$
;
CREATE OR REPLACE FUNCTION public.kitchen_task_save(p_task_id uuid, p_day date, p_single_day boolean, p_config jsonb, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_id uuid := p_task_id;
 v_label text := btrim(p_config->>'label');
 v_assigned uuid := nullif(p_config->>'assigned_to','')::uuid;
 v_active boolean := (p_config->>'active')::boolean;
 v_start date := (p_config->>'starts_on')::date;
 v_end date := nullif(p_config->>'ends_on','')::date;
 v_days integer[] := array(select distinct d::integer from jsonb_array_elements_text(p_config->'weekdays') d order by d::integer);
 v_rec text := p_config->>'recurrence';
begin
 if p_day is null or p_day<v_today or p_day>v_today+3650 or p_single_day is null or
 v_label is null or char_length(v_label) not between 3 and 100 or v_active is null or v_start is null or
 (v_end is not null and v_end<v_start) or v_rec is null or v_rec not in ('daily','weekly','once','monthly','on_demand') or
 cardinality(v_days)=0 or (v_rec='monthly' and cardinality(v_days)<>1) or not(v_days <@ array[1,2,3,4,5,6,7]) or array_position(v_days,null) is not null
 then return jsonb_build_object('error','Paramètres de tâche invalides','status',400); end if;
 if v_assigned is not null and not exists(select 1 from public.kitchen_staff where id=v_assigned and active)
 then return jsonb_build_object('error','Agent actif introuvable','status',400); end if;
 perform pg_advisory_xact_lock(26784,927);
 if v_id is not null then
  perform 1 from public.kitchen_tasks where id=v_id for update;
  if not found then return jsonb_build_object('error','Tâche introuvable','status',404); end if;
  if exists(select 1 from public.kitchen_task_checks where task_id=v_id and performed_on>=p_day and (not p_single_day or performed_on=p_day))
  then return jsonb_build_object('error','Une validation existe pour cette période. Choisissez une date ultérieure.','status',409); end if;
 elsif p_single_day then
  return jsonb_build_object('error','Créer une tâche avant de modifier une occurrence','status',400);
 end if;
 if exists(select 1 from public.kitchen_tasks t where t.id is distinct from v_id and lower(btrim(t.label))=lower(v_label))
 or exists(select 1 from public.kitchen_task_rules r where r.task_id is distinct from v_id and lower(btrim(r.label))=lower(v_label))
 then return jsonb_build_object('error','Ce libellé est déjà utilisé par une autre tâche','status',409); end if;
 if v_id is null then
  insert into public.kitchen_tasks(label,assigned_to,active) values(v_label,v_assigned,false) returning id into v_id;
 end if;
 if not p_single_day then
  delete from public.kitchen_task_rules where task_id=v_id and effective_on>=p_day;
 end if;
 insert into public.kitchen_task_rules(task_id,effective_on,single_day,label,assigned_to,active,description,instructions,scheduled_time,weekdays,starts_on,ends_on,priority,recurrence,changed_by)
 values(v_id,p_day,p_single_day,v_label,v_assigned,v_active,coalesce(p_config->>'description',''),coalesce(p_config->>'instructions',''),nullif(p_config->>'scheduled_time','')::time,v_days,v_start,v_end,p_config->>'priority',v_rec,p_actor)
 on conflict(task_id,effective_on,single_day) do update set label=excluded.label,assigned_to=excluded.assigned_to,active=excluded.active,description=excluded.description,instructions=excluded.instructions,scheduled_time=excluded.scheduled_time,weekdays=excluded.weekdays,starts_on=excluded.starts_on,ends_on=excluded.ends_on,priority=excluded.priority,recurrence=excluded.recurrence,changed_by=excluded.changed_by,changed_at=now();
 return jsonb_build_object('task_id',v_id,'effective_on',p_day,'single_day',p_single_day);
exception when unique_violation then return jsonb_build_object('error','Tâche déjà existante','status',409);
end
$function$
;
CREATE OR REPLACE FUNCTION public.kitchen_task_validate(p_task_id uuid, p_agent uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_task record;
 v_check public.kitchen_task_checks%rowtype;
begin
 perform 1 from public.kitchen_tasks where id=p_task_id for update;
 if not found then return jsonb_build_object('error','Tâche introuvable','status',404); end if;
 select * into v_task from public.kitchen_task_calendar(v_today) where id=p_task_id;
 if not found or not (v_task.scheduled or (v_task.active and v_task.recurrence='on_demand' and v_today>=v_task.starts_on and (v_task.ends_on is null or v_today<=v_task.ends_on))) then return jsonb_build_object('error','Tâche non programmée aujourd’hui','status',409); end if;
 if v_task.assigned_to is not null and v_task.assigned_to<>p_agent then return jsonb_build_object('error','Accès non autorisé','status',403); end if;
 insert into public.kitchen_task_checks(task_id,performed_on,performed_by)
 values(p_task_id,v_today,p_agent) returning * into v_check;
 return jsonb_build_object('check',to_jsonb(v_check));
exception when unique_violation then return jsonb_build_object('error','Tâche déjà validée aujourd’hui','status',409);
end
$function$
;
-- New schedule begins on the next local calendar day. Preserve all historical rows and checks.
do $seed$
declare
  effective date := (now() at time zone 'Europe/Paris')::date+1;
  r record; target_id uuid; v_result jsonb; v_count integer;
  v_old text; old_checks bigint;
begin
 perform pg_advisory_xact_lock(26784,927);
 select count(*) into old_checks from public.kitchen_task_checks;
 -- Refuse to overwrite any concurrently programmed rule.
 if exists(select 1 from public.kitchen_task_rules) or (select count(*) from public.kitchen_tasks)<>4 then
  raise exception 'Le planning a changé depuis la vérification : migration interrompue';
 end if;
 for r in select * from (values
 ('Plans de travail','daily'),
('Poubelles','daily'),
('Lave-vaisselle','daily'),
('Chariots de service','daily'),
('Lave-mains','daily'),
('Tables','daily'),
('Sol','daily'),
('Bacs à vaisselle','daily'),
('Bacs à légumes','daily'),
('Sols de cuisine et siphons','daily'),
('Sanitaires','daily'),
('Vestiaires','daily'),
('Supports à couverts','daily'),
('Meubles réfrigérés','daily'),
('Bain-marie','daily'),
('Chauffe-assiettes','daily'),
('Caisse','daily'),
('Salle de restaurant','daily'),
('Table des condiments','daily'),
('Chaises','daily'),
('Cafetières','daily'),
('Fours de remise en température','weekly'),
('Armoires','weekly'),
('Micro-ondes','weekly'),
('Point d’eau du self','weekly'),
('Hottes et grilles','monthly'),
('Carrelages','monthly'),
('Congélateur','monthly'),
('Friteuse / huile','on_demand')
 ) as source(label,recurrence)
 loop
  v_old:=case r.label when 'Lave-vaisselle' then 'Nettoyage du lave-vaisselle' when 'Fours de remise en température' then 'Nettoyage des fours' else null end;
  target_id:=null;
  if v_old is not null then
   select id into strict target_id from public.kitchen_tasks where label=v_old;
  end if;
  v_result:=public.kitchen_task_save(target_id,effective,false,jsonb_build_object(
   'label',r.label,'assigned_to',null,'active',true,'starts_on',effective,'ends_on',null,
   'weekdays',case when r.recurrence in ('weekly','monthly') then to_jsonb(array[5]) else to_jsonb(array[1,2,3,4,5,6,7]) end,
   'recurrence',r.recurrence,'priority','normal','scheduled_time',null,
   'description','Protocole 7 – nettoyage du self',
   'instructions',case when r.recurrence='on_demand' then 'À valider uniquement les jours d’utilisation de la friteuse, après le contrôle de l’huile et le nettoyage prévu par la procédure.' else '' end
  ),'migration:protocole_7_2026_11');
  if v_result ? 'error' then raise exception 'Impossible de configurer % : %',r.label,v_result; end if;
 end loop;
 -- Retire only the two former generic rows prospectively; history remains intact.
 for r in select id,label,assigned_to from public.kitchen_tasks where label in ('Nettoyage de la ligne de self','Nettoyage de la plonge')
 loop
  v_result:=public.kitchen_task_save(r.id,effective,false,jsonb_build_object('label',r.label,'assigned_to',r.assigned_to,'active',false,'starts_on',effective,'ends_on',null,'weekdays',array[1,2,3,4,5,6,7],'recurrence','daily','priority','normal','scheduled_time',null,'description','Remplacée par les lignes détaillées du protocole 7.','instructions',''),'migration:protocole_7_2026_11');
  if v_result ? 'error' then raise exception 'Archivage impossible : %',v_result; end if;
 end loop;
 select count(*) into v_count from public.kitchen_task_calendar(effective) where active;
 if v_count<>29 or (select count(*) from public.kitchen_task_checks)<>old_checks then raise exception 'Contrôle des données échoué : % tâches actives',v_count;end if;
end $seed$;
notify pgrst,'reload schema';
