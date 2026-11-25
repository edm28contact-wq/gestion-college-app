-- Dossiers mensuels de paie internes. Aucun accès direct depuis le navigateur.
create table if not exists public.college_payroll_months (
  month text primary key check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  draft jsonb not null default '{}'::jsonb check(jsonb_typeof(draft)='object' and octet_length(draft::text)<=190000),
  status text not null default 'draft' check(status in ('draft','exported','submitted','paid','rejected')),
  version integer not null default 1 check(version>0),
  export_info jsonb not null default '{}'::jsonb check(jsonb_typeof(export_info)='object' and octet_length(export_info::text)<=10000),
  bank_reference text not null default '' check(length(bank_reference)<=120),
  status_note text not null default '' check(length(status_note)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null check(length(updated_by) between 1 and 80)
);
create table if not exists public.college_payroll_audit (
  id bigint generated always as identity primary key,
  month text not null references public.college_payroll_months(month) on delete restrict,
  actor text not null,
  action text not null check(action in ('created','saved','status_changed')),
  old_status text,
  new_status text not null,
  version integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists college_payroll_audit_month_idx on public.college_payroll_audit(month,created_at desc,id desc);
alter table public.college_payroll_months enable row level security;
alter table public.college_payroll_audit enable row level security;
revoke all on public.college_payroll_months from public,anon,authenticated;
revoke all on public.college_payroll_audit from public,anon,authenticated;
revoke all on sequence public.college_payroll_audit_id_seq from public,anon,authenticated;
grant select,insert,update on public.college_payroll_months to service_role;
grant select,insert on public.college_payroll_audit to service_role;
grant usage,select on sequence public.college_payroll_audit_id_seq to service_role;
create or replace function public.college_payroll_audit_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.college_payroll_audit(month,actor,action,old_status,new_status,version,note)
 values (
  new.month,new.updated_by,
  case when tg_op='INSERT' then 'created' when old.status is distinct from new.status then 'status_changed' else 'saved' end,
  case when tg_op='INSERT' then null else old.status end,
  new.status,new.version,
  case when tg_op='INSERT' then '' when old.status is distinct from new.status then new.status_note else '' end
 );
 return new;
end;
$$;
revoke all on function public.college_payroll_audit_write() from public,anon,authenticated;
grant execute on function public.college_payroll_audit_write() to service_role;
drop trigger if exists college_payroll_audit_changes on public.college_payroll_months;
create trigger college_payroll_audit_changes after insert or update on public.college_payroll_months for each row execute function public.college_payroll_audit_write();
