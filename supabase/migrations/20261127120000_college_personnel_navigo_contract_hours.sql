alter table public.college_personnel
 add column if not exists navigo_contract_weekly_hours numeric(5,2),
 add column if not exists navigo_full_time_weekly_hours numeric(5,2);
do $$
begin
 if not exists(select 1 from pg_constraint where conname='college_personnel_navigo_hours_valid') then
  alter table public.college_personnel
   add constraint college_personnel_navigo_hours_valid check (
     (navigo_contract_weekly_hours is null and navigo_full_time_weekly_hours is null)
     or (navigo_contract_weekly_hours > 0 and navigo_full_time_weekly_hours > 0
         and navigo_contract_weekly_hours <= navigo_full_time_weekly_hours
         and navigo_full_time_weekly_hours <= 60)
   );
 end if;
end $$;
comment on column public.college_personnel.navigo_contract_weekly_hours is 'Contractual weekly hours, never inferred from roster; used for Navigo reimbursement proposals.';
comment on column public.college_personnel.navigo_full_time_weekly_hours is 'Full-time contractual benchmark weekly hours, validated by payroll administrator.';