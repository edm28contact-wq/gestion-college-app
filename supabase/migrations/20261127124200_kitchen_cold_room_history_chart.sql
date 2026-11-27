-- Graphiques historiques des chambres froides : mesures du registre HACCP uniquement.
-- Toute mesure valide contribue aux agrégations, aucune limite de pagination.
create or replace function public.kitchen_cold_room_history_chart(
 p_room_id uuid,
 p_period text,
 p_anchor date
)
returns table(
 window_start timestamptz,
 window_end timestamptz,
 bucket_at timestamptz,
 min_c numeric,
 mean_c numeric,
 max_c numeric,
 sample_count bigint,
 alert_count bigint,
 sum_c numeric
)
language sql stable security invoker
set search_path = ''
as $$
 with local_bounds as (
  select case p_period
   when 'day' then p_anchor
   when 'week' then date_trunc('week',p_anchor::timestamp)::date
   when 'month' then date_trunc('month',p_anchor::timestamp)::date
   when 'year' then date_trunc('year',p_anchor::timestamp)::date
   else null::date
  end as day_start
 ),
 period_bounds as (
  select day_start::timestamp at time zone 'Europe/Paris' as start_at,
   (case p_period
     when 'day' then day_start+1
     when 'week' then day_start+7
     when 'month' then (day_start+interval '1 month')::date
     when 'year' then (day_start+interval '1 year')::date
     else null::date
   end)::timestamp at time zone 'Europe/Paris' as end_at
  from local_bounds
 ),
 grouped as (
  select case p_period
    when 'day' then date_bin('5 minutes',r.measured_at,timestamptz '2000-01-01 00:00:00+00')
    when 'week' then date_trunc('hour',r.measured_at)
    when 'month' then date_trunc('day',r.measured_at,'Europe/Paris')
    when 'year' then date_trunc('month',r.measured_at,'Europe/Paris')
   end as sample_bucket,
   round(min(r.temperature_c),2) as min_c,
   round(avg(r.temperature_c),2) as mean_c,
   round(max(r.temperature_c),2) as max_c,
   count(*)::bigint as sample_count,
   count(*) filter (where r.is_alert)::bigint as alert_count,
   sum(r.temperature_c) as sum_c
  from public.kitchen_cold_readings r
  cross join period_bounds b
  where r.room_id=p_room_id and r.invalidated_at is null
   and r.measured_at>=b.start_at and r.measured_at<b.end_at
   and p_period in ('day','week','month','year')
  group by 1
 )
 select b.start_at,b.end_at,g.sample_bucket,g.min_c,g.mean_c,g.max_c,
  coalesce(g.sample_count,0),coalesce(g.alert_count,0),g.sum_c
 from period_bounds b
 left join grouped g on true
 order by g.sample_bucket nulls last;
$$;
revoke all on function public.kitchen_cold_room_history_chart(uuid,text,date) from public,anon,authenticated;
grant execute on function public.kitchen_cold_room_history_chart(uuid,text,date) to service_role;
comment on function public.kitchen_cold_room_history_chart(uuid,text,date) is
 'Températures enregistrées valides par chambre et période locale Europe/Paris ; accès réservé au service backend authentifié.';
