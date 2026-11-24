alter table public.kitchen_cold_rooms
 add column auto_collection_enabled boolean not null default true,
 add column auto_collection_mode text not null default 'interval',
 add column auto_collection_interval_minutes integer not null default 10,
 add column auto_collection_times text[] not null default '{}'::text[],
 add column auto_collection_updated_at timestamptz not null default now(),
 add column auto_collection_last_slot_at timestamptz,
 add constraint kitchen_auto_collection_mode_check check (auto_collection_mode in ('interval','times')),
 add constraint kitchen_auto_collection_interval_check check (auto_collection_interval_minutes between 5 and 1440),
 add constraint kitchen_auto_collection_times_check check (
  cardinality(auto_collection_times)<=24
  and array_position(auto_collection_times,null::text) is null
  and (cardinality(auto_collection_times)=0 or array_to_string(auto_collection_times,',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$')
  and (auto_collection_mode<>'times' or cardinality(auto_collection_times)>0)
 );

-- Les intervalles sont continus; les heures fixes suivent l'heure de Paris.
-- Les horaires inexistants lors du passage a l'heure d'ete sont ignores.
create function public.kitchen_collection_slots(p_mode text,p_interval integer,p_times text[],p_now timestamptz)
returns table(previous_slot_at timestamptz,next_slot_at timestamptz)
language plpgsql stable security invoker set search_path=''
as $$
begin
 if p_mode='interval' and p_interval between 5 and 1440 then
  return query select x.slot, x.slot+make_interval(mins=>p_interval)
  from (select date_bin(make_interval(mins=>p_interval),p_now,timestamptz '2000-01-01 00:00:00+00') as slot) x;
 elsif p_mode='times' then
  return query
  with local_slots as (
   select ((p_now at time zone 'Europe/Paris')::date+days.n+times.t::time) as local_slot
   from generate_series(-2,2) as days(n) cross join unnest(p_times) as times(t)
  ), candidates as (
   select local_slot,local_slot at time zone 'Europe/Paris' as slot from local_slots
  )
  select max(slot) filter (where slot<=p_now),min(slot) filter (where slot>p_now)
  from candidates where (slot at time zone 'Europe/Paris')=local_slot;
 else
  return query select null::timestamptz,null::timestamptz;
 end if;
end;
$$;

create function public.kitchen_govee_due_rooms(p_now timestamptz)
returns table(room_id uuid,sensor_id uuid,slot_at timestamptz)
language sql stable security invoker set search_path=''
as $$
 select r.id,d.id,s.previous_slot_at
 from public.kitchen_cold_rooms r
 join public.kitchen_connected_devices d on d.room_id=r.id and d.kind='cold_room' and d.provider='govee'
 cross join lateral public.kitchen_collection_slots(r.auto_collection_mode,r.auto_collection_interval_minutes,r.auto_collection_times,p_now) s
 where r.archived_at is null and r.deleted_at is null and r.auto_collection_enabled
 and s.previous_slot_at>=r.auto_collection_updated_at
 and s.previous_slot_at>p_now-interval '3 minutes'
 and (r.auto_collection_last_slot_at is null or r.auto_collection_last_slot_at<s.previous_slot_at);
$$;

-- Reservation atomique: deux invocations concurrentes ne prennent pas le meme creneau.
create function public.kitchen_claim_govee_due()
returns table(sensor jsonb,slot_at timestamptz)
language sql volatile security invoker set search_path=''
as $$
 with candidates as materialized (
  select q.room_id,q.sensor_id,q.slot_at
  from public.kitchen_govee_due_rooms(now()) q
  join public.kitchen_cold_rooms r on r.id=q.room_id
  order by q.slot_at,q.room_id
  limit 10
  for update of r skip locked
 ), claimed as (
  update public.kitchen_cold_rooms r set auto_collection_last_slot_at=q.slot_at
  from candidates q
  where r.id=q.room_id and r.auto_collection_enabled
    and r.archived_at is null and r.deleted_at is null
    and r.auto_collection_updated_at<=q.slot_at
    and (r.auto_collection_last_slot_at is null or r.auto_collection_last_slot_at<q.slot_at)
  returning r.id,q.sensor_id,q.slot_at
 )
 select to_jsonb(d),c.slot_at
 from claimed c join public.kitchen_connected_devices d on d.id=c.sensor_id and d.room_id=c.id;
$$;

-- Derniere mesure valide de chaque chambre, independamment de la pagination globale.
create function public.kitchen_cold_room_overview()
returns table(room_id uuid,last_reading jsonb,previous_slot_at timestamptz,next_slot_at timestamptz)
language sql stable security invoker set search_path=''
as $$
 select r.id,to_jsonb(m),
 case when r.auto_collection_enabled and d.id is not null and s.previous_slot_at>=r.auto_collection_updated_at then s.previous_slot_at end,
 case when r.auto_collection_enabled and d.id is not null then s.next_slot_at end
 from public.kitchen_cold_rooms r
 left join public.kitchen_connected_devices d on d.room_id=r.id and d.kind='cold_room' and d.provider='govee'
 cross join lateral public.kitchen_collection_slots(r.auto_collection_mode,r.auto_collection_interval_minutes,r.auto_collection_times,now()) s
 left join lateral (
  select x.* from public.kitchen_cold_readings x
  where x.room_id=r.id and x.invalidated_at is null
    and ((d.id is not null and x.source='govee_cloud' and x.connected_device_id=d.id)
      or (d.id is null and x.source='manual'))
  order by x.measured_at desc,x.id desc limit 1
 ) m on true
 where r.archived_at is null and r.deleted_at is null;
$$;

revoke execute on function public.kitchen_collection_slots(text,integer,text[],timestamptz) from public,anon,authenticated;
revoke execute on function public.kitchen_govee_due_rooms(timestamptz) from public,anon,authenticated;
revoke execute on function public.kitchen_claim_govee_due() from public,anon,authenticated;
revoke execute on function public.kitchen_cold_room_overview() from public,anon,authenticated;
grant execute on function public.kitchen_collection_slots(text,integer,text[],timestamptz),public.kitchen_govee_due_rooms(timestamptz),public.kitchen_claim_govee_due(),public.kitchen_cold_room_overview() to service_role;
