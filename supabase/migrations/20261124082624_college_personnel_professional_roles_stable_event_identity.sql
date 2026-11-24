create table public.college_personnel_roles (
 id uuid primary key default gen_random_uuid(),
 label text not null check (char_length(btrim(label)) between 2 and 100),
 label_key text not null unique check (char_length(label_key) between 2 and 100),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by text
);
alter table public.college_personnel_roles enable row level security;
revoke all on public.college_personnel_roles from public,anon,authenticated;
grant select,insert,update on public.college_personnel_roles to service_role;

insert into public.college_personnel_roles(label,label_key) values
 ('Direction','direction'),('Enseignement','enseignement'),('Secrétariat','secretariat'),
 ('Administration','administration'),('Cuisine / restauration','cuisinerestauration'),
 ('Entretien','entretien'),('Vie scolaire','viescolaire'),('Comptabilité','comptabilite')
 on conflict(label_key) do nothing;

alter table public.college_personnel add column professional_role_id uuid
 references public.college_personnel_roles(id) on delete restrict;
create index college_personnel_professional_role_idx on public.college_personnel(professional_role_id);

alter table public.personnel_events add column personnel_id uuid
 references public.college_personnel(id) on delete restrict;
create index personnel_events_personnel_id_idx on public.personnel_events(personnel_id,event_date);

-- Do not infer identities for ambiguous or unmatched historical names.
update public.personnel_events e set personnel_id=p.id
from public.college_personnel p
where e.personnel_id is null
 and p.name_key=regexp_replace(lower(regexp_replace(normalize(normalize(btrim(e.personnel_name),NFKC),NFD),U&'[\0300-\036f]','','g') collate "C"),'[^a-z0-9]+','','g');

-- Update the professional profile and any linked kitchen display name in one transaction.
create function public.college_update_personnel_profile(
 p_id uuid,p_name text,p_name_key text,p_role_id uuid,p_updated_at timestamptz,p_actor text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare old_row public.college_personnel%rowtype; new_row public.college_personnel%rowtype;
begin
 select * into old_row from public.college_personnel where id=p_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if old_row.updated_at is distinct from p_updated_at then return jsonb_build_object('error','conflict');end if;
 if p_role_id is not null and not exists(select 1 from public.college_personnel_roles where id=p_role_id) then
  return jsonb_build_object('error','role_not_found');
 end if;
 if exists(select 1 from public.college_personnel where name_key=p_name_key and id<>p_id) then
  return jsonb_build_object('error','duplicate_name');
 end if;
 if exists(select 1 from public.kitchen_staff where personnel_id=p_id) and char_length(p_name)>80 then
  return jsonb_build_object('error','kitchen_name_too_long');
 end if;
 if old_row.name=p_name and old_row.professional_role_id is not distinct from p_role_id then
  return jsonb_build_object('staff',to_jsonb(old_row));
 end if;
 update public.college_personnel set name=p_name,name_key=p_name_key,professional_role_id=p_role_id,
 updated_at=now(),updated_by=p_actor where id=p_id returning * into new_row;
 update public.kitchen_staff set name=p_name where personnel_id=p_id and name is distinct from p_name;
 return jsonb_build_object('staff',to_jsonb(new_row));
exception when unique_violation then
 return jsonb_build_object('error','duplicate_name');
end;
$$;
revoke execute on function public.college_update_personnel_profile(uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.college_update_personnel_profile(uuid,text,text,uuid,timestamptz,text) to service_role;
