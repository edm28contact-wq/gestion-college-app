create function public.college_valid_weekly_work_slots(p_slots jsonb,p_days integer[])
returns boolean language plpgsql immutable security invoker set search_path=''
as $$
declare item jsonb; day_number integer; start_time text; end_time text;
begin
 if p_slots is null or jsonb_typeof(p_slots)<>'array' or p_days is null then return false; end if;
 if jsonb_array_length(p_slots)>56 or cardinality(p_days)>7 or array_position(p_days,null::integer) is not null then return false; end if;
 if exists(select 1 from unnest(p_days) as d(v) where v<0 or v>6) or cardinality(p_days)<>(select count(distinct v) from unnest(p_days) as d(v)) then return false; end if;
 for item in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'day') is distinct from 'number'
    or jsonb_typeof(item->'start') is distinct from 'string' or jsonb_typeof(item->'end') is distinct from 'string'
    or (item->>'day') !~ '^[0-6]$' then return false; end if;
  day_number:=(item->>'day')::integer;
  start_time:=item->>'start';end_time:=item->>'end';
  if not(day_number=any(p_days)) or start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or start_time::time>=end_time::time then return false;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_slots) as a(v) group by a.v->>'day' having count(*)>8) then return false;end if;
 if exists(
  select 1 from jsonb_array_elements(p_slots) with ordinality as a(v,n)
  join jsonb_array_elements(p_slots) with ordinality as b(v,n)
  on a.n<b.n and a.v->>'day'=b.v->>'day'
  where (a.v->>'start')::time<(b.v->>'end')::time and (b.v->>'start')::time<(a.v->>'end')::time
 ) then return false; end if;
 return true;
end;
$$;
revoke execute on function public.college_valid_weekly_work_slots(jsonb,integer[]) from public,anon,authenticated;
grant execute on function public.college_valid_weekly_work_slots(jsonb,integer[]) to service_role;
alter table public.college_personnel add column weekly_work_slots jsonb not null default '[]'::jsonb;
alter table public.college_personnel add constraint college_personnel_weekly_work_slots_check check(public.college_valid_weekly_work_slots(weekly_work_slots,working_weekdays));
