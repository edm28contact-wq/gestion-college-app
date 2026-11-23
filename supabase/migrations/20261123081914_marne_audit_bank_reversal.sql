CREATE OR REPLACE FUNCTION public.marne_bank_confirm_line(p_line_id uuid, p_lease_id uuid, p_installment_id uuid, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_line public.rental_bank_lines%rowtype;
 v_account text;
 v_lease public.rental_leases%rowtype;
 v_result jsonb;
 v_payment_id uuid;
 v_payment public.rental_payments%rowtype;
 v_idempotency_key uuid;
begin
 if p_line_id is null or p_lease_id is null or nullif(btrim(p_reviewed_by),'') is null then
   raise exception 'Validation bancaire incomplète' using errcode='22023'; end if;
 select bl.* into v_line from public.rental_bank_lines bl where bl.id=p_line_id;
 if not found then raise exception 'Ligne bancaire inconnue' using errcode='22023'; end if;
 select account_label into v_account from public.rental_bank_imports where id=v_line.import_id;
 perform pg_advisory_xact_lock(hashtextextended(
   'marne-bank-line:'||jsonb_build_array(lower(btrim(v_account)),v_line.booking_date,
     v_line.amount,lower(btrim(v_line.description)))::text,0));
 select bl.* into v_line from public.rental_bank_lines bl where bl.id=p_line_id for update;
 if not found then raise exception 'Ligne bancaire inconnue' using errcode='22023'; end if;
 if v_line.status='matched' then
   if v_line.matched_lease_id<>p_lease_id
     then raise exception 'Ce mouvement est déjà affecté à un autre bail' using errcode='22023';end if;
   select * into v_payment from public.rental_payments where id=v_line.matched_payment_id for update;
   if not found or v_payment.status<>'recorded' or v_payment.lease_id<>p_lease_id
     or v_payment.amount<>v_line.amount then
     raise exception 'Rapprochement bancaire incohérent : paiement absent ou annulé' using errcode='22023';end if;
   return jsonb_build_object('ok',true,'duplicate',true,'payment_id',v_line.matched_payment_id);
 end if;
 if v_line.status<>'pending' or v_line.amount<=0 then
   raise exception 'Seuls les crédits en attente peuvent devenir des loyers' using errcode='22023'; end if;
 select * into v_lease from public.rental_leases where id=p_lease_id;
 if not found or v_lease.status<>'active' or v_lease.verified_at is null then
   raise exception 'Bail non actif ou non vérifié' using errcode='22023';end if;
 select account_label into v_account from public.rental_bank_imports where id=v_line.import_id;
 if exists(
  select 1 from public.rental_bank_lines other
  join public.rental_bank_imports ib on ib.id=other.import_id
  where other.id<>v_line.id and other.status='matched'
    and lower(btrim(ib.account_label))=lower(btrim(v_account))
    and other.booking_date=v_line.booking_date and other.amount=v_line.amount
    and lower(btrim(other.description))=lower(btrim(v_line.description))
 ) then
   raise exception 'Mouvement identique déjà rapproché dans un autre import : vérifier le doublon avant toute saisie' using errcode='22023';
 end if;
 v_idempotency_key:=gen_random_uuid();
 v_result:=public.marne_record_payment(
   v_idempotency_key,p_lease_id,v_line.booking_date,v_line.amount,'virement',
   'BANQUE-'||v_line.id::text,
   left(v_line.description,180),
   left('Import bancaire vérifié : '||v_line.description,2000),
   p_reviewed_by,p_installment_id
 );
 v_payment_id:=(v_result->>'id')::uuid;
 update public.rental_payments set source='bank' where id=v_payment_id and status='recorded';
 update public.rental_bank_lines set
    status='matched',matched_lease_id=p_lease_id,
    matched_payment_id=v_payment_id,reviewed_by=p_reviewed_by,reviewed_at=now()
 where id=p_line_id;
 return jsonb_build_object('ok',true,'duplicate',false,'payment_id',v_payment_id,
   'allocated',v_result->'allocated','unallocated',v_result->'unallocated');
end;
$function$;

CREATE OR REPLACE FUNCTION public.marne_void_payment(p_payment_id uuid, p_reason text, p_voided_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_payment public.rental_payments%rowtype;v_reopened integer:=0;
begin
 if p_payment_id is null or length(btrim(coalesce(p_reason,'')))<6 or
 length(p_reason)>500 or nullif(btrim(coalesce(p_voided_by,'')),'') is null
 then raise exception 'Motif d’annulation obligatoire (6 caractères minimum)' using errcode='22023'; end if;
 perform 1 from public.rental_bank_lines where matched_payment_id=p_payment_id for update;
 select * into v_payment from public.rental_payments where id=p_payment_id for update;
 if not found then raise exception 'Paiement inexistant' using errcode='22023'; end if;
 if v_payment.status='void' then return jsonb_build_object('id',p_payment_id,'already_void',true); end if;
 update public.rental_payments set status='void',voided_at=now(),voided_by=p_voided_by,void_reason=btrim(p_reason)
 where id=p_payment_id;
 update public.rental_bank_lines
 set status='pending',matched_payment_id=null,matched_lease_id=null,
   reviewed_at=null,reviewed_by=null,
   review_note=concat_ws(E'\n',nullif(review_note,''),
     'Paiement '||p_payment_id::text||' annulé par '||p_voided_by||' : '||btrim(p_reason))
 where matched_payment_id=p_payment_id and status='matched';
 get diagnostics v_reopened=row_count;
 return jsonb_build_object('id',p_payment_id,'already_void',false,'bank_lines_reopened',v_reopened);
end;
$function$;

revoke all on function public.marne_bank_confirm_line(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.marne_void_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.marne_bank_confirm_line(uuid,uuid,uuid,text) to service_role;
grant execute on function public.marne_void_payment(uuid,text,text) to service_role;

do $audit$
declare
 v_property uuid; v_property2 uuid; v_lease uuid; v_lease2 uuid;
 v_batch uuid; v_line uuid; v_line2 uuid; v_payment uuid; v_replacement uuid; v_inst uuid; v_inst2 uuid;
 v_result jsonb; v_check public.rental_bank_lines%rowtype; v_hash text;
begin
 begin
 insert into public.rental_properties(name,is_example) values('QA-AUDIT-'||gen_random_uuid()::text,true) returning id into v_property;
 insert into public.rental_properties(name,is_example) values('QA-AUDIT-'||gen_random_uuid()::text,true) returning id into v_property2;
 insert into public.rental_leases(property_id,tenant_name,start_date,monthly_rent,charges_amount,due_day,status,verified_at,verified_by,lease_kind)
 values(v_property,'QA audit',date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,500,50,5,'active',now(),'qa-audit','residential') returning id into v_lease;
 insert into public.rental_leases(property_id,tenant_name,start_date,monthly_rent,charges_amount,due_day,status,verified_at,verified_by,lease_kind)
 values(v_property2,'QA audit corrected',date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,500,50,5,'active',now(),'qa-audit','residential') returning id into v_lease2;
 insert into public.rental_installments(lease_id,property_id,period,due_on,rent_amount,charges_amount)
 values(v_lease,v_property,date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,500,50) returning id into v_inst;
 insert into public.rental_installments(lease_id,property_id,period,due_on,rent_amount,charges_amount)
 values(v_lease2,v_property2,date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,date_trunc('month',(now() at time zone 'Europe/Paris')::date)::date,500,50) returning id into v_inst2;
 v_hash:=encode(sha256(gen_random_uuid()::text::bytea),'hex');
 v_result:=public.marne_bank_import_rows('QA AUDIT','audit.csv',v_hash,
 jsonb_build_array(jsonb_build_object('booking_date',(now() at time zone 'Europe/Paris')::date::text,'amount','550.00','description','QA AUDIT VOID')),'qa-audit');
 v_batch:=(v_result->>'batch_id')::uuid;
 select id into v_line from public.rental_bank_lines where import_id=v_batch;
 v_result:=public.marne_bank_import_rows('QA AUDIT','audit.csv',v_hash,
 jsonb_build_array(jsonb_build_object('booking_date',(now() at time zone 'Europe/Paris')::date::text,'amount','550.00','description','QA AUDIT VOID')),'qa-audit');
 if v_result->>'duplicate' is distinct from 'true' or (v_result->>'batch_id')::uuid is distinct from v_batch then raise exception 'QA_IMPORT_IDEMPOTENCE';end if;
 v_result:=public.marne_bank_confirm_line(v_line,v_lease,v_inst,'qa-audit');
 v_payment:=(v_result->>'payment_id')::uuid;
 if (v_result->>'allocated')::numeric is distinct from 550::numeric then raise exception 'QA_FIRST_ALLOCATION';end if;
 v_result:=public.marne_bank_confirm_line(v_line,v_lease,v_inst,'qa-audit');
 if v_result->>'duplicate' is distinct from 'true' or (v_result->>'payment_id')::uuid is distinct from v_payment then raise exception 'QA_FIRST_CONFIRM_IDEMPOTENCE';end if;
 v_result:=public.marne_void_payment(v_payment,'Correction QA du bail','qa-audit');
 if (v_result->>'bank_lines_reopened')::integer is distinct from 1 then raise exception 'QA_VOID_REOPEN_COUNT';end if;
 select * into v_check from public.rental_bank_lines where id=v_line;
 if v_check.status is distinct from 'pending' or v_check.matched_payment_id is not null or v_check.matched_lease_id is not null
 or v_check.reviewed_at is not null or v_check.reviewed_by is not null or position(v_payment::text in v_check.review_note)=0
 then raise exception 'QA_VOID_BANK_REOPEN';end if;
 if not exists(select 1 from public.rental_payments where id=v_payment and status='void' and void_reason='Correction QA du bail')
 or not exists(select 1 from public.rental_payment_allocations where payment_id=v_payment and installment_id=v_inst and amount=550)
 then raise exception 'QA_VOID_PRESERVES_HISTORY';end if;
 v_result:=public.marne_installment_status(v_inst);
 if (v_result->>'remaining')::numeric is distinct from 550::numeric then raise exception 'QA_VOID_REOPENS_INSTALLMENT';end if;
 v_result:=public.marne_bank_confirm_line(v_line,v_lease2,v_inst2,'qa-audit');
 v_replacement:=(v_result->>'payment_id')::uuid;
 if v_replacement is null or v_replacement=v_payment or (v_result->>'allocated')::numeric is distinct from 550::numeric then raise exception 'QA_REMATCH_NEW_PAYMENT';end if;
 v_result:=public.marne_bank_confirm_line(v_line,v_lease2,v_inst2,'qa-audit');
 if v_result->>'duplicate' is distinct from 'true' or (v_result->>'payment_id')::uuid is distinct from v_replacement then raise exception 'QA_REMATCH_IDEMPOTENCE';end if;
 v_result:=public.marne_void_payment(v_payment,'Correction QA répétée','qa-audit');
 if v_result->>'already_void' is distinct from 'true' or not exists(select 1 from public.rental_bank_lines where id=v_line and status='matched' and matched_payment_id=v_replacement)
 then raise exception 'QA_REPEAT_VOID_PRESERVES_NEW_MATCH';end if;
 begin
  perform public.marne_bank_confirm_line(v_line,v_lease,v_inst,'qa-audit');
  raise exception 'QA_WRONG_LEASE_DUPLICATE_ACCEPTED';
 exception when sqlstate '22023' then null; end;
 v_result:=public.marne_bank_import_rows('qa audit','audit2.csv',encode(sha256(gen_random_uuid()::text::bytea),'hex'),
 jsonb_build_array(jsonb_build_object('booking_date',(now() at time zone 'Europe/Paris')::date::text,'amount','550.00','description','QA AUDIT VOID')),'qa-audit');
 select id into v_line2 from public.rental_bank_lines where import_id=(v_result->>'batch_id')::uuid;
 begin
  perform public.marne_bank_confirm_line(v_line2,v_lease,v_inst,'qa-audit');
  raise exception 'QA_CROSS_IMPORT_DUPLICATE_ACCEPTED';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.marne_allocate_payment(v_replacement,v_inst2,1);
  raise exception 'QA_OVERALLOCATION_ACCEPTED';
 exception when sqlstate '22023' then null; end;
 if (select count(*) from public.rental_payments where lease_id in(v_lease,v_lease2) and status='recorded')<>1 then raise exception 'QA_RECORDED_PAYMENT_COUNT';end if;
 if (select count(*) from public.rental_payments where lease_id in(v_lease,v_lease2) and status='void')<>1 then raise exception 'QA_VOID_PAYMENT_COUNT';end if;
 raise sqlstate 'ZQ001' using message='QA assertions passed; discard fixtures';
 exception when sqlstate 'ZQ001' then null;
 end;
end $audit$;

