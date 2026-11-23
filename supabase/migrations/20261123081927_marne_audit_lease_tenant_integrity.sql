alter table public.rental_tenant_rows
 add constraint rental_tenant_rows_id_property_key unique(id,property_id);

alter table public.rental_leases
 add constraint rental_leases_tenant_property_fk
 foreign key(tenant_row_id,property_id)
 references public.rental_tenant_rows(id,property_id)
 match simple on update restrict on delete restrict not deferrable;

do $lease_link_audit$
declare
 v_property uuid; v_property2 uuid; v_tenant uuid; v_lease uuid; v_draft uuid;
 v_row integer; v_constraint text;
begin
 begin
 insert into public.rental_properties(name,is_example)
 values('QA-LINK-'||gen_random_uuid()::text,true) returning id into v_property;
 insert into public.rental_properties(name,is_example)
 values('QA-LINK-'||gen_random_uuid()::text,true) returning id into v_property2;
 select coalesce(max(row_number),1)+1 into v_row from public.rental_tenant_rows;
 insert into public.rental_tenant_rows(row_number,property_id,data)
 values(v_row,v_property,jsonb_build_object('Locataire','QA link')) returning id into v_tenant;
 insert into public.rental_leases(property_id,tenant_row_id,tenant_name,status)
 values(v_property,v_tenant,'QA link','draft') returning id into v_lease;
 begin
  update public.rental_tenant_rows set property_id=v_property2 where id=v_tenant;
  raise exception 'QA_LINK_DRAFT_REASSIGNMENT_ACCEPTED';
 exception when sqlstate '23503' then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint is distinct from 'rental_leases_tenant_property_fk' then raise;end if;
 end;
 update public.rental_leases
 set status='active',start_date=(now() at time zone 'Europe/Paris')::date,
 monthly_rent=500,charges_amount=50,due_day=5,verified_at=now(),verified_by='qa-audit'
 where id=v_lease;
 if not exists(select 1 from public.rental_leases where id=v_lease and status='active'
 and tenant_row_id=v_tenant and property_id=v_property)
 then raise exception 'QA_LINK_VALID_ACTIVATION';end if;
 begin
  insert into public.rental_leases(property_id,tenant_row_id,tenant_name,status)
  values(v_property2,v_tenant,'QA wrong property','draft');
  raise exception 'QA_LINK_MISMATCH_ACCEPTED';
 exception when sqlstate '23503' then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint is distinct from 'rental_leases_tenant_property_fk' then raise;end if;
 end;
 begin
  update public.rental_tenant_rows set property_id=v_property2 where id=v_tenant;
  raise exception 'QA_LINK_REASSIGNMENT_ACCEPTED';
 exception when sqlstate '23503' then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint is distinct from 'rental_leases_tenant_property_fk' then raise;end if;
 end;
 begin
  update public.rental_tenant_rows set property_id=null where id=v_tenant;
  raise exception 'QA_LINK_UNLINK_ACCEPTED';
 exception when sqlstate '23503' then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint is distinct from 'rental_leases_tenant_property_fk' then raise;end if;
 end;
 insert into public.rental_leases(property_id,tenant_row_id,tenant_name,status)
 values(v_property2,null,'QA pending tenant','draft') returning id into v_draft;
 if not exists(select 1 from public.rental_leases where id=v_draft and tenant_row_id is null)
 then raise exception 'QA_LINK_DRAFT_NULL_TENANT_REJECTED';end if;
 update public.rental_leases set status='closed' where id=v_lease;
 begin
  update public.rental_tenant_rows set property_id=v_property2 where id=v_tenant;
  raise exception 'QA_LINK_CLOSED_HISTORY_REASSIGNMENT_ACCEPTED';
 exception when sqlstate '23503' then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint is distinct from 'rental_leases_tenant_property_fk' then raise;end if;
 end;
 raise sqlstate 'ZQ003' using message='QA lease link assertions passed; discard fixtures';
 exception when sqlstate 'ZQ003' then null;
 end;
end $lease_link_audit$;

