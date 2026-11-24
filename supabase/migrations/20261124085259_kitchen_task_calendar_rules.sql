
create table public.kitchen_task_rules (
 task_id uuid not null references public.kitchen_tasks(id) on delete restrict,
 effective_on date not null,
 single_day boolean not null default false,
 label text not null check (char_length(btrim(label)) between 3 and 100),
 assigned_to uuid references public.kitchen_staff(id) on delete restrict,
 active boolean not null default true,
 description text not null default '' check (char_length(description)<=1000),
 instructions text not null default '' check (char_length(instructions)<=2000),
 scheduled_time time,
 weekdays integer[] not null default array[1,2,3,4,5,6,7] check (cardinality(weekdays)>0 and weekdays <@ array[1,2,3,4,5,6,7] and array_position(weekdays,null) is null),
 starts_on date not null,
 ends_on date,
 priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
 recurrence text not null default 'daily' check (recurrence in ('daily','weekly','once')),
 changed_by text not null,
 changed_at timestamptz not null default now(),
 primary key (task_id,effective_on,single_day),
 check (ends_on is null or ends_on>=starts_on)
);
alter table public.kitchen_task_rules enable row level security;
revoke all on public.kitchen_task_rules from public, anon, authenticated;
grant select,insert,update,delete on public.kitchen_task_rules to service_role;
create index kitchen_task_rules_assigned_idx on public.kitchen_task_rules(assigned_to);

create function public.kitchen_task_calendar(p_day date)
returns table(id uuid,label text,assigned_to uuid,active boolean,created_at timestamptz,
 description text,instructions text,scheduled_time time,weekdays integer[],starts_on date,ends_on date,
 priority text,recurrence text,scheduled boolean,effective_on date,single_day boolean)
language sql stable security invoker set search_path = ''
as $$
 select t.id,coalesce(v.label,t.label),case when v.task_id is null then t.assigned_to else v.assigned_to end,
 coalesce(v.active,t.active),t.created_at,coalesce(v.description,''),coalesce(v.instructions,''),v.scheduled_time,
 coalesce(v.weekdays,array[1,2,3,4,5,6,7]),coalesce(v.starts_on,(t.created_at at time zone 'Europe/Paris')::date),v.ends_on,
 coalesce(v.priority,'normal'),coalesce(v.recurrence,'daily'),
 coalesce(v.active,t.active) and (
 case when v.single_day then true
 when v.task_id is null then (t.created_at at time zone 'Europe/Paris')::date<=p_day
 else p_day>=v.starts_on and (v.ends_on is null or p_day<=v.ends_on)
 and case v.recurrence when 'once' then p_day=v.starts_on when 'weekly' then extract(isodow from p_day)::int=any(v.weekdays) else true end
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
$$;
revoke all on function public.kitchen_task_calendar(date) from public, anon, authenticated;
grant execute on function public.kitchen_task_calendar(date) to service_role;

create function public.kitchen_task_save(p_task_id uuid,p_day date,p_single_day boolean,p_config jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
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
 (v_end is not null and v_end<v_start) or v_rec is null or v_rec not in ('daily','weekly','once') or
 cardinality(v_days)=0 or not(v_days <@ array[1,2,3,4,5,6,7]) or array_position(v_days,null) is not null
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
$$;
revoke all on function public.kitchen_task_save(uuid,date,boolean,jsonb,text) from public, anon, authenticated;
grant execute on function public.kitchen_task_save(uuid,date,boolean,jsonb,text) to service_role;

create function public.kitchen_task_validate(p_task_id uuid,p_agent uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_task record;
 v_check public.kitchen_task_checks%rowtype;
begin
 perform 1 from public.kitchen_tasks where id=p_task_id for update;
 if not found then return jsonb_build_object('error','Tâche introuvable','status',404); end if;
 select * into v_task from public.kitchen_task_calendar(v_today) where id=p_task_id;
 if not found or not v_task.scheduled then return jsonb_build_object('error','Tâche non programmée aujourd’hui','status',409); end if;
 if v_task.assigned_to is not null and v_task.assigned_to<>p_agent then return jsonb_build_object('error','Accès non autorisé','status',403); end if;
 insert into public.kitchen_task_checks(task_id,performed_on,performed_by)
 values(p_task_id,v_today,p_agent) returning * into v_check;
 return jsonb_build_object('check',to_jsonb(v_check));
exception when unique_violation then return jsonb_build_object('error','Tâche déjà validée aujourd’hui','status',409);
end
$$;
revoke all on function public.kitchen_task_validate(uuid,uuid) from public, anon, authenticated;
grant execute on function public.kitchen_task_validate(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
