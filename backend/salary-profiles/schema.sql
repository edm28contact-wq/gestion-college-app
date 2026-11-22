-- Données de paie mensuelle confidentielles. Aucun accès direct client/Data API.
create table if not exists public.college_salary_monthly (
  employee_id uuid not null references public.college_personnel(id) on delete restrict,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_salary_gross numeric(12,2) not null check (base_salary_gross between 0 and 1000000),
  bonus_gross numeric(12,2) not null default 0 check (bonus_gross between 0 and 1000000),
  weekly_hours numeric(6,2) not null check (weekly_hours > 0 and weekly_hours <= 60),
  actual_hours numeric(7,2) null check (actual_hours >= 0 and actual_hours <= 744),
  working_days smallint[] not null default array[1,2,3,4,5]::smallint[]
    check (array_length(working_days,1) between 1 and 5
      and working_days <@ array[1,2,3,4,5]::smallint[]
),
  benefits_in_kind jsonb not null default '[]'::jsonb
    check (jsonb_typeof(benefits_in_kind)='array' and jsonb_array_length(benefits_in_kind)<=20),
  version integer not null default 1 check (version >= 1),
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(employee_id, month)
);
alter table public.college_salary_monthly enable row level security;
revoke all on public.college_salary_monthly from PUBLIC, anon, authenticated;
grant select, insert, update on public.college_salary_monthly to service_role;
-- Intentionnellement aucune policy : seul le service serveur avec rôle privilégié peut accéder.
