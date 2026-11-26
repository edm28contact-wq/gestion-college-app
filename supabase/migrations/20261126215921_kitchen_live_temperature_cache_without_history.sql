-- Dernier état de consultation Govee (une seule valeur par sonde, hors historique HACCP).
alter table public.kitchen_connected_devices
 add column live_requested_at timestamptz,
 add column live_request_id uuid,
 add column live_state jsonb;
create function public.kitchen_govee_reset_live()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.room_id,new.model,new.raw_unit,new.device_identifier) is distinct from (old.room_id,old.model,old.raw_unit,old.device_identifier) then
  new.live_requested_at:=null;new.live_request_id:=null;new.live_state:=null;
 end if;
 return new;
end $$;
revoke all on function public.kitchen_govee_reset_live() from public,anon,authenticated;
create trigger kitchen_govee_reset_live before update of room_id,model,raw_unit,device_identifier on public.kitchen_connected_devices
for each row execute function public.kitchen_govee_reset_live();
create function public.kitchen_claim_govee_live()
returns jsonb language sql security invoker set search_path='' as $$
 with claimed as (
  update public.kitchen_connected_devices d
  set live_requested_at=now(),live_request_id=gen_random_uuid()
  from public.kitchen_cold_rooms r
  where d.provider='govee' and d.kind='cold_room' and d.room_id=r.id
   and r.archived_at is null and r.deleted_at is null
   and (d.live_requested_at is null or d.live_requested_at<=now()-interval '60 seconds')
  returning d.id,d.room_id,d.model,d.raw_unit,d.device_identifier,d.live_request_id
 )
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) from claimed;
$$;
revoke all on function public.kitchen_claim_govee_live() from public,anon,authenticated;
grant execute on function public.kitchen_claim_govee_live() to service_role;

-- Consultation MEATER en l'absence de collecte de production.
-- Le verrou et la génération existante empêchent une consultation de devenir un relevé de production.
create function public.kitchen_meater_claim_preview()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.kitchen_meater_settings%rowtype;
begin
 select * into s from public.kitchen_meater_settings where id=1 for update;
 if s.enabled or s.vault_secret_id is null then return jsonb_build_object('skipped',true);end if;
 return public.kitchen_meater_claim(true);
end $$;
revoke all on function public.kitchen_meater_claim_preview() from public,anon,authenticated;
grant execute on function public.kitchen_meater_claim_preview() to service_role;
