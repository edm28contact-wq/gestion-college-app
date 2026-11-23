create or replace function public.marne_create_tenant(p_property_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
 v_property public.rental_properties%rowtype;
 v_row public.rental_tenant_rows%rowtype;
 v_number bigint;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>65536 then
  raise exception 'Fiche locataire invalide ou trop volumineuse' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-tenant-row-number',0));
 if p_property_id is not null then
  select * into v_property from public.rental_properties where id=p_property_id for key share;
  if not found or v_property.is_example
   or btrim(coalesce(p_data->>'Logement','')) is distinct from v_property.name then
   raise exception 'Logement inconnu ou incohérent avec la fiche locataire' using errcode='22023';end if;
 elsif nullif(btrim(coalesce(p_data->>'Logement','')),'') is not null then
  raise exception 'Une fiche avec logement doit être liée à ce logement' using errcode='22023';
 end if;
 select coalesce(max(row_number)::bigint,1)+1 into v_number from public.rental_tenant_rows;
 if v_number>2147483647 then
  raise exception 'Numérotation des fiches locataires épuisée' using errcode='22023';end if;
 insert into public.rental_tenant_rows(row_number,property_id,data)
 values(v_number::integer,p_property_id,p_data) returning * into v_row;
 return to_jsonb(v_row);
end;
$function$;

create or replace function public.marne_create_property(p_name text,p_address text)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
 v_property public.rental_properties%rowtype;
 v_row jsonb;
 v_data jsonb;
begin
 p_name:=btrim(coalesce(p_name,''));p_address:=btrim(coalesce(p_address,''));
 if char_length(p_name) not between 1 and 180 or char_length(p_address)>500 then
  raise exception 'Nom ou adresse de logement invalide' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-tenant-row-number',0));
 if exists(select 1 from public.rental_properties where name=p_name) then
  raise exception 'Ce logement existe déjà dans Mes Biens' using errcode='23505';end if;
 v_data:=jsonb_build_object(
  'Nom du logement',p_name,'Adresse',p_address,'Statut logement','Vacant','Date de mise en service','',
  'Loyer appliqué',null,'IRL de base',null,'IRL actuel',null,'Charge appliquée',null,
  'Date dernière révision','','Solde cumulé logement',0,'Notes','');
 insert into public.rental_properties(name,data,current_tenant,tenant_history,payment_schedule,source_sheet,is_example)
 values(p_name,v_data,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'Dossier_'||p_name,false)
 returning * into v_property;
 v_row:=public.marne_create_tenant(v_property.id,jsonb_build_object(
  'Logement',p_name,'Adresse logement',p_address,'IRL',null,'Révision détectée','NON',
  'Retard','NON','Solde précédent',0,'Solde',0,'Type d’alerte','OK'));
 return jsonb_build_object('property',to_jsonb(v_property),'row',v_row);
end;
$function$;

create or replace function public.marne_create_property_sheet(p_row_number integer,p_property jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
 v_row public.rental_tenant_rows%rowtype;
 v_property public.rental_properties%rowtype;
 v_name text;
 v_source text;
begin
 if p_row_number is null or p_row_number<2 or jsonb_typeof(p_property) is distinct from 'object'
 or octet_length(p_property::text)>262144
 or jsonb_typeof(p_property->'data') is distinct from 'object'
 or jsonb_typeof(p_property->'current_tenant') is distinct from 'object' then
  raise exception 'Fiche logement invalide ou trop volumineuse' using errcode='22023';end if;
 v_name:=btrim(coalesce(p_property->>'name',''));
 v_source:=coalesce(p_property->>'source_sheet','Dossier_'||v_name);
 if char_length(v_name) not between 1 and 180 or char_length(v_source)>200 then
  raise exception 'Nom de logement invalide' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-tenant-row-number',0));
 select * into v_row from public.rental_tenant_rows where row_number=p_row_number for update;
 if not found then raise exception 'Fiche locataire introuvable' using errcode='22023';end if;
 if v_name is distinct from btrim(coalesce(v_row.data->>'Logement','')) then
  raise exception 'Fiche locataire modifiée : rechargez la page' using errcode='22023';end if;
 if v_row.property_id is not null then
  select * into v_property from public.rental_properties where id=v_row.property_id;
  if not found or v_property.is_example then
   raise exception 'Lien du logement existant invalide' using errcode='22023';end if;
  return to_jsonb(v_property);
 end if;
 if exists(select 1 from public.rental_leases where tenant_row_id=v_row.id) then
  raise exception 'Le logement d’un locataire lié à un bail ne peut pas être réaffecté' using errcode='23503';end if;
 select * into v_property from public.rental_properties where name=v_name and is_example=false;
 if not found then
  insert into public.rental_properties(name,data,current_tenant,source_sheet,is_example)
  values(v_name,p_property->'data',p_property->'current_tenant',v_source,false)
  returning * into v_property;
 end if;
 update public.rental_tenant_rows set property_id=v_property.id,updated_at=now() where id=v_row.id;
 return to_jsonb(v_property);
end;
$function$;

revoke all on function public.marne_create_tenant(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.marne_create_property(text,text) from public,anon,authenticated;
revoke all on function public.marne_create_property_sheet(integer,jsonb) from public,anon,authenticated;
grant execute on function public.marne_create_tenant(uuid,jsonb) to service_role;
grant execute on function public.marne_create_property(text,text) to service_role;
grant execute on function public.marne_create_property_sheet(integer,jsonb) to service_role;

do $creation_audit$
declare
 v_name text:='QA-CREATE-'||gen_random_uuid()::text;
 v_sheet_name text:='QA-SHEET-'||gen_random_uuid()::text;
 v_orphan_name text:='QA-ORPHAN-'||gen_random_uuid()::text;
 v_property uuid;v_tenant uuid;v_number integer;v_sheet_number integer;v_sheet uuid;
 v_result jsonb;v_again jsonb;v_payload jsonb;v_count integer;v_rows integer;
begin
 begin
 select count(*) into v_count from public.rental_properties;
 select count(*) into v_rows from public.rental_tenant_rows;
 v_result:=public.marne_create_property(v_name,'1 rue QA');
 v_property:=(v_result#>>'{property,id}')::uuid;
 v_tenant:=(v_result#>>'{row,id}')::uuid;
 v_number:=(v_result#>>'{row,row_number}')::integer;
 if v_property is null or v_tenant is null
 or (v_result#>>'{row,property_id}')::uuid is distinct from v_property
 or not exists(select 1 from public.rental_properties where id=v_property and not is_example)
 or not exists(select 1 from public.rental_tenant_rows where id=v_tenant and property_id=v_property)
 then raise exception 'QA_CREATE_PROPERTY_AND_TENANT';end if;
 if (select count(*) from public.rental_properties)<>v_count+1
 or (select count(*) from public.rental_tenant_rows)<>v_rows+1
 then raise exception 'QA_CREATE_EXACT_COUNTS';end if;
 begin
  perform public.marne_create_property(v_name,'1 rue QA');
  raise exception 'QA_CREATE_DUPLICATE_NAME_ACCEPTED';
 exception when sqlstate '23505' then null;end;
 if (select count(*) from public.rental_properties)<>v_count+1
 or (select count(*) from public.rental_tenant_rows)<>v_rows+1
 then raise exception 'QA_CREATE_DUPLICATE_SIDE_EFFECT';end if;
 v_again:=public.marne_create_tenant(v_property,jsonb_build_object('Logement',v_name,'Locataire','QA extra'));
 if (v_again->>'row_number')::integer is distinct from v_number+1
 or (v_again->>'property_id')::uuid is distinct from v_property
 then raise exception 'QA_CREATE_UNIQUE_ROW_NUMBER';end if;
 begin
  perform public.marne_create_tenant(gen_random_uuid(),jsonb_build_object('Logement','QA missing'));
  raise exception 'QA_CREATE_UNKNOWN_PROPERTY_ACCEPTED';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.marne_create_tenant(null,'[]'::jsonb);
  raise exception 'QA_CREATE_INVALID_DATA_ACCEPTED';
 exception when sqlstate '22023' then null;end;
 select coalesce(max(row_number),1)+1 into v_sheet_number from public.rental_tenant_rows;
 insert into public.rental_tenant_rows(row_number,data)
 values(v_sheet_number,jsonb_build_object('Logement',v_sheet_name,'Locataire','QA sheet'));
 v_payload:=jsonb_build_object('name',v_sheet_name,'data','{}'::jsonb,
 'current_tenant','{}'::jsonb,'source_sheet','Dossier_'||v_sheet_name);
 v_result:=public.marne_create_property_sheet(v_sheet_number,v_payload);
 v_sheet:=(v_result->>'id')::uuid;
 if v_sheet is null or not exists(select 1 from public.rental_tenant_rows where row_number=v_sheet_number and property_id=v_sheet)
 then raise exception 'QA_SHEET_ATOMIC_LINK';end if;
 select count(*) into v_count from public.rental_properties;
 v_again:=public.marne_create_property_sheet(v_sheet_number,v_payload);
 if (v_again->>'id')::uuid is distinct from v_sheet or (select count(*) from public.rental_properties)<>v_count
 then raise exception 'QA_SHEET_IDEMPOTENCE';end if;
 update public.rental_properties set name=v_sheet_name||'_renamed' where id=v_sheet;
 v_again:=public.marne_create_property_sheet(v_sheet_number,v_payload);
 if (v_again->>'id')::uuid is distinct from v_sheet or (select count(*) from public.rental_properties)<>v_count
 then raise exception 'QA_SHEET_RENAMED_PROPERTY_DUPLICATED';end if;
 begin
  perform public.marne_create_property_sheet(v_sheet_number,jsonb_set(v_payload,'{name}',to_jsonb(v_sheet_name||'_stale')));
  raise exception 'QA_SHEET_STALE_PAYLOAD_ACCEPTED';
 exception when sqlstate '22023' then null;end;
 insert into public.rental_tenant_rows(row_number,data) values(2147483647,'{}'::jsonb);
 begin
  perform public.marne_create_property(v_orphan_name,'1 rue QA');
  raise exception 'QA_CREATE_SECOND_INSERT_SHOULD_FAIL';
 exception when sqlstate '22023' then null;end;
 if exists(select 1 from public.rental_properties where name=v_orphan_name)
 then raise exception 'QA_CREATE_ORPHAN_PROPERTY_AFTER_FAILURE';end if;
 raise sqlstate 'ZQ004' using message='QA creation assertions passed; discard fixtures';
 exception when sqlstate 'ZQ004' then null;
 end;
end $creation_audit$;

