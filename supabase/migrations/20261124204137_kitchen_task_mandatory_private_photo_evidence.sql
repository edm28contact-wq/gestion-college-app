-- Photos obligatoires pour les nouvelles validations du nettoyage. Les validations anterieures restent intactes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kitchen-cleaning-photos','kitchen-cleaning-photos',false,350000,array['image/jpeg']);
alter table public.kitchen_task_checks
 add column photo_path text,
 add column photo_sha256 text,
 add column photo_bytes integer;
alter table public.kitchen_task_checks add constraint kitchen_task_checks_photo_fields check(
 (photo_path is null and photo_sha256 is null and photo_bytes is null) or
 (photo_path is not null and photo_sha256 ~ '^[0-9a-f]{64}$' and photo_bytes between 100 and 350000 and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);
create unique index kitchen_task_checks_photo_path_unique on public.kitchen_task_checks(photo_path) where photo_path is not null;
create unique index kitchen_task_checks_photo_sha_unique on public.kitchen_task_checks(photo_sha256) where photo_sha256 is not null;

create function public.kitchen_task_photo_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.photo_path is distinct from old.photo_path or new.photo_sha256 is distinct from old.photo_sha256 or new.photo_bytes is distinct from old.photo_bytes or new.task_id is distinct from old.task_id or new.performed_by is distinct from old.performed_by or new.performed_on is distinct from old.performed_on or new.performed_at is distinct from old.performed_at then
   raise exception 'Le constat original et sa preuve photographique ne peuvent pas être modifiés' using errcode='23514';
  end if;
  return new;
 end if;
 if new.photo_path is null or new.photo_sha256 is null or new.photo_bytes is null then
  raise exception 'Une photo est obligatoire pour valider une tâche' using errcode='23514';
 end if;
 if new.photo_path not like new.task_id::text||'/'||new.performed_by::text||'/%' or not exists(
  select 1 from storage.objects o where o.bucket_id='kitchen-cleaning-photos' and o.name=new.photo_path
  and o.metadata->>'mimetype'='image/jpeg' and o.metadata->>'size'=new.photo_bytes::text
 ) then
  raise exception 'Photo de la tâche introuvable ou invalide' using errcode='23514';
 end if;
 return new;
end $$;
create trigger kitchen_task_require_photo before insert or update on public.kitchen_task_checks
 for each row execute function public.kitchen_task_photo_guard();
revoke all on function public.kitchen_task_photo_guard() from public,anon,authenticated;
grant execute on function public.kitchen_task_photo_guard() to service_role;

-- The old client must fail closed with a clear instruction rather than inserting without evidence.
create or replace function public.kitchen_task_validate(p_task_id uuid,p_agent uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('error','Photo obligatoire. Actualisez Gestion Cantine pour utiliser la caméra.','status',400);
$$;

create function public.kitchen_task_validate_photo(p_task_id uuid,p_agent uuid,p_day date,p_path text,p_sha256 text,p_bytes integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_today date:=(now() at time zone 'Europe/Paris')::date; v_task record; v_check public.kitchen_task_checks%rowtype;
begin
 if p_day is distinct from v_today then return jsonb_build_object('error','La date a changé. Actualisez les tâches.','status',409);end if;
 if p_path is null or p_sha256 is null or p_bytes is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes not between 100 and 350000 or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then
  return jsonb_build_object('error','Photo obligatoire ou invalide','status',400);end if;
 if not exists(select 1 from public.kitchen_staff where id=p_agent and active) then return jsonb_build_object('error','Agent non autorisé','status',403);end if;
 perform 1 from public.kitchen_tasks where id=p_task_id for update;
 if not found then return jsonb_build_object('error','Tâche introuvable','status',404);end if;
 select * into v_task from public.kitchen_task_calendar(v_today) where id=p_task_id;
 if not found or not(v_task.scheduled or(v_task.active and v_task.recurrence='on_demand' and v_today>=v_task.starts_on and(v_task.ends_on is null or v_today<=v_task.ends_on))) then return jsonb_build_object('error','Tâche non programmée aujourd’hui','status',409);end if;
 if v_task.assigned_to is not null and v_task.assigned_to<>p_agent then return jsonb_build_object('error','Accès non autorisé','status',403);end if;
 select * into v_check from public.kitchen_task_checks where task_id=p_task_id and performed_on=v_today;
 if found then return jsonb_build_object('error','Tâche déjà validée aujourd’hui','status',409);end if;
 if exists(select 1 from public.kitchen_task_checks where photo_sha256=p_sha256) then return jsonb_build_object('error','Cette photo a déjà été utilisée. Prenez une nouvelle photo.','status',409);end if;
 insert into public.kitchen_task_checks(task_id,performed_on,performed_by,photo_path,photo_sha256,photo_bytes)
 values(p_task_id,v_today,p_agent,p_path,p_sha256,p_bytes) returning * into v_check;
 return jsonb_build_object('check',to_jsonb(v_check)-'photo_path'-'photo_sha256');
exception when unique_violation then return jsonb_build_object('error','Tâche déjà validée ou photo déjà utilisée. Actualisez.','status',409);
when check_violation then return jsonb_build_object('error','Preuve photographique introuvable ou invalide. Reprenez la photo.','status',409);
end $$;
revoke all on function public.kitchen_task_validate_photo(uuid,uuid,date,text,text,integer) from public,anon,authenticated;
grant execute on function public.kitchen_task_validate_photo(uuid,uuid,date,text,text,integer) to service_role;
notify pgrst,'reload schema';