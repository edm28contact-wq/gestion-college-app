create table public.college_personnel_bank_details (
 personnel_id uuid primary key references public.college_personnel(id) on delete restrict,
 iban text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' and (left(iban,2)<>'FR' or length(iban)=27)),
 bic text not null check (bic ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
 version integer not null default 1 check (version>0),
 updated_at timestamptz not null default now(),
 updated_by text not null
);
alter table public.college_personnel_bank_details enable row level security;
revoke all on table public.college_personnel_bank_details from public, anon, authenticated, service_role;
grant select, insert, update on table public.college_personnel_bank_details to service_role;
comment on table public.college_personnel_bank_details is 'Coordonnees bancaires privees des salaries; acces serveur uniquement.';
create function public.college_save_personnel_bank(p_personnel_id uuid,p_iban text,p_bic text,p_version integer,p_actor text)
returns integer language plpgsql security invoker set search_path='' as $$
declare v integer;
begin
 if p_version=0 then
  insert into public.college_personnel_bank_details(personnel_id,iban,bic,updated_by)
  values(p_personnel_id,p_iban,p_bic,p_actor) on conflict(personnel_id) do nothing returning version into v;
 else
  update public.college_personnel_bank_details set iban=p_iban,bic=p_bic,version=version+1,updated_at=now(),updated_by=p_actor
  where personnel_id=p_personnel_id and version=p_version returning version into v;
 end if;
 if v is null then return null;end if;
 insert into public.admin_audit_log(username,action,entity_type,entity_id,details)
 values(p_actor,'staff-bank-save','college_personnel',p_personnel_id::text,jsonb_build_object('version',v));
 return v;
end;
$$;
revoke all on function public.college_save_personnel_bank(uuid,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.college_save_personnel_bank(uuid,text,text,integer,text) to service_role;
