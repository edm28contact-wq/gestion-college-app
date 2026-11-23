alter table public.rental_leases
 add column closed_at timestamptz,
 add column closed_by text,
 add constraint rental_leases_closure_audit check (
  (closed_at is null and closed_by is null)
  or (status='closed' and closed_at is not null and closed_by is not null and char_length(btrim(closed_by)) between 1 and 180));

create unique index rental_leases_one_draft_per_tenant
 on public.rental_leases(tenant_row_id) where status='draft' and tenant_row_id is not null;

alter table public.rental_installments
 add column amount_verified_at timestamptz,
 add column amount_verified_by text,
 add constraint rental_installments_amount_verification check (
  (amount_verified_at is null and amount_verified_by is null)
  or (amount_verified_at is not null and amount_verified_by is not null
   and char_length(btrim(amount_verified_by)) between 1 and 180));

alter table public.rental_irl_applications
 add column cancelled_at timestamptz,
 add column cancelled_by text,
 add column cancelled_reason text,
 drop constraint rental_irl_applications_status_check,
 drop constraint irl_application_status_check,
 add constraint rental_irl_applications_status_check check (status in ('scheduled','applied','cancelled')),
 add constraint irl_application_status_check check (
  (status='scheduled' and activated_at is null and cancelled_at is null and cancelled_by is null and cancelled_reason is null)
  or (status='applied' and activated_at is not null and cancelled_at is null and cancelled_by is null and cancelled_reason is null)
  or (status='cancelled' and activated_at is null and cancelled_at is not null
   and cancelled_by is not null and char_length(btrim(cancelled_by)) between 1 and 180
   and cancelled_reason is not null and char_length(btrim(cancelled_reason)) between 1 and 2000));

alter table public.rental_irl_proposals
 drop constraint rental_irl_proposals_status_check,
 add constraint rental_irl_proposals_status_check check (status in ('draft','scheduled','applied','cancelled'));


CREATE OR REPLACE FUNCTION public.marne_activate_due_irl(p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_today date:=coalesce(p_as_of,(now() at time zone 'Europe/Paris')::date);
 v_app public.rental_irl_applications%rowtype;
 v_lease public.rental_leases%rowtype;
 v_count integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 for v_app in select * from public.rental_irl_applications
    where status='scheduled' and effective_on<=v_today
    order by effective_on,id for update
 loop
   select * into v_lease from public.rental_leases where id=v_app.lease_id for no key update;
   if not found or v_lease.status<>'active' or v_lease.verified_at is null
   then raise exception 'Bail non actif : application de la révision suspendue' using errcode='22023';end if;
   if v_lease.monthly_rent is distinct from v_app.old_monthly_rent then
     raise exception 'Montant de bail modifié : révision suspendue' using errcode='22023';end if;

   if exists(select 1 from public.rental_installments
     where lease_id=v_app.lease_id and period>=v_app.effective_on
       and period>=v_lease.start_date
       and (v_lease.end_date is null or (period+interval '1 month - 1 day')::date<=v_lease.end_date)
       and rent_amount<>v_app.new_monthly_rent) then
     raise exception 'Échéance future non cohérente : révision suspendue' using errcode='22023';end if;

   update public.rental_leases set monthly_rent=v_app.new_monthly_rent,
        updated_at=now() where id=v_app.lease_id;
   update public.rental_irl_applications set status='applied',activated_at=now()
       where id=v_app.id;
   update public.rental_irl_proposals set status='applied'
       where id=v_app.proposal_id;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('ok',true,'activated',v_count,'run_for',v_today);
end $function$;

CREATE OR REPLACE FUNCTION public.marne_generate_installments_daily(p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_date date:=coalesce(p_as_of,(now() at time zone 'Europe/Paris')::date);
 v_first date:=date_trunc('month',v_date)::date;
 v_month date;
 v_month_end date;
 v_due date;
 v_monthly_rent numeric(12,2);
 v_lease record;
 v_checked integer:=0;
 v_created integer:=0;
 v_skipped integer:=0;
 v_affected integer:=0;
 v_month_index integer;
 v_activation jsonb;
begin
 -- A previously approved revision only becomes active at its agreed date.
 v_activation:=public.marne_activate_due_irl(v_date);

 for v_lease in
   select id,property_id,start_date,end_date,due_day,monthly_rent,charges_amount
   from public.rental_leases
   where status='active' and verified_at is not null
     and start_date is not null and due_day between 1 and 31
     and monthly_rent is not null and charges_amount is not null
     and monthly_rent>=0 and charges_amount>=0
   order by id for no key update
 loop
   for v_month_index in 0..1 loop
     v_checked:=v_checked+1;
     v_month:=(v_first+make_interval(months=>v_month_index))::date;
     v_month_end:=(v_month+interval '1 month - 1 day')::date;
     if v_lease.start_date>v_month
       or (v_lease.end_date is not null and v_lease.end_date<v_month_end) then
       v_skipped:=v_skipped+1;
       continue;
     end if;
     v_due:=v_month+(least(v_lease.due_day,extract(day from v_month_end)::integer)-1);
     v_monthly_rent:=public.marne_irl_rent_for_period(v_lease.id,v_month);
     insert into public.rental_installments
       (lease_id,property_id,period,due_on,rent_amount,charges_amount,status)
     values
       (v_lease.id,v_lease.property_id,v_month,v_due,
        v_monthly_rent,v_lease.charges_amount,'scheduled')
     on conflict(lease_id,period) do nothing;
     get diagnostics v_affected = row_count;
     if v_affected=1 then v_created:=v_created+1;
     else v_skipped:=v_skipped+1;end if;
   end loop;
 end loop;
 insert into public.rental_automation_runs
   (job_key,run_for,inspected,created,skipped,notes)
 values('monthly_installments',v_date,v_checked,v_created,v_skipped,
  'Mois courant et suivant; montants IRL approuvés selon dates de prise d’effet; aucun paiement créé');
 return jsonb_build_object('ok',true,'inspected',v_checked,
        'created',v_created,'skipped',v_skipped,'run_for',v_date,
        'irl_activated',v_activation->'activated');
end $function$;

CREATE OR REPLACE FUNCTION public.marne_create_installment(p_lease_id uuid, p_period date, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_lease public.rental_leases%rowtype;
 v_inst public.rental_installments%rowtype;
 v_month_end date;
 v_due date;
 v_current_month date:=date_trunc('month',(now() at time zone 'Europe/Paris'))::date;
 v_monthly_rent numeric;
begin
 if p_lease_id is null or p_period is null or extract(day from p_period)<>1
   or p_period<v_current_month or nullif(btrim(coalesce(p_by,'')),'') is null then
   raise exception 'Mois de facturation invalide ou dans le passé' using errcode='22023';end if;

 perform public.marne_activate_due_irl((now() at time zone 'Europe/Paris')::date);
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if not found or v_lease.status<>'active' or v_lease.verified_at is null
   or v_lease.start_date is null or v_lease.monthly_rent is null or
   v_lease.charges_amount is null or v_lease.due_day is null then
   raise exception 'Bail non actif ou non validé' using errcode='22023';end if;

 v_month_end:=(p_period+interval '1 month - 1 day')::date;
 if v_lease.start_date>p_period or
   (v_lease.end_date is not null and v_lease.end_date<v_month_end) then
   raise exception 'Premier ou dernier mois incomplet : calcul manuel nécessaire' using errcode='22023';end if;

 v_due:=p_period+(least(v_lease.due_day,extract(day from v_month_end)::integer)-1);
 v_monthly_rent:=public.marne_irl_rent_for_period(v_lease.id,p_period);
 insert into public.rental_installments
 (lease_id,property_id,period,due_on,rent_amount,charges_amount,status)
 values(v_lease.id,v_lease.property_id,p_period,v_due,
        v_monthly_rent,v_lease.charges_amount,'scheduled')
 on conflict(lease_id,period) do nothing
 returning * into v_inst;
 if found then
  return jsonb_build_object('ok',true,'already_exists',false,'item',
    jsonb_build_object('id',v_inst.id,'period',v_inst.period,
      'due_on',v_inst.due_on,'total_due',v_inst.total_due));
 end if;
 select * into v_inst from public.rental_installments
  where lease_id=p_lease_id and period=p_period;
 return jsonb_build_object('ok',true,'already_exists',true,'item',
    jsonb_build_object('id',v_inst.id,'period',v_inst.period,
      'due_on',v_inst.due_on,'total_due',v_inst.total_due));
end $function$;

CREATE OR REPLACE FUNCTION public.marne_schedule_irl_application(p_proposal_id uuid, p_notice_sent_on date, p_notice_method text, p_approved_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_effective date := (date_trunc('month',(now() at time zone 'Europe/Paris'))+interval '1 month')::date;
 v_proposal public.rental_irl_proposals%rowtype;
 v_lease public.rental_leases%rowtype;
 v_rule public.rental_irl_lease_rules%rowtype;
 v_index public.rental_irl_indices%rowtype;
 v_inst record;
 v_id uuid;
 v_updated integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 if p_proposal_id is null or p_notice_method not in ('registered_post','hand_signed')
   or p_notice_sent_on is null or p_notice_sent_on>v_today
   or nullif(btrim(coalesce(p_approved_by,'')),'') is null
 then raise exception 'Attestation de notification datée et méthode vérifiée requises' using errcode='22023'; end if;

 select * into v_proposal from public.rental_irl_proposals where id=p_proposal_id for update;
 if not found or v_proposal.status<>'draft' then
   raise exception 'Proposition IRL absente ou déjà programmée' using errcode='22023';end if;

 select * into v_lease from public.rental_leases where id=v_proposal.lease_id for no key update;
 select * into v_rule from public.rental_irl_lease_rules where lease_id=v_proposal.lease_id;
 if v_lease.id is null or v_lease.status<>'active' or v_lease.lease_kind<>'residential'
   or v_lease.verified_at is null or v_rule.lease_id is null
   or not v_rule.has_revision_clause or v_rule.is_mobility_lease
   or v_rule.dpe_rating not in ('A','B','C','D','E')
   or v_rule.geographic_scope<>'metropole'
 then raise exception 'Bail ou clauses IRL non éligibles à une application' using errcode='22023';end if;

 if v_rule.revision_due_on<>v_proposal.revision_due_on
    or v_rule.reference_quarter<>v_proposal.reference_quarter
    or v_lease.monthly_rent<>v_proposal.base_monthly_rent
 then raise exception 'Bail modifié depuis la simulation : préparer une nouvelle proposition' using errcode='22023';end if;

 if p_notice_sent_on<v_rule.revision_due_on
    or p_notice_sent_on>=(v_rule.revision_due_on+interval '1 year')::date
    or v_effective < v_rule.revision_due_on
 then raise exception 'Notification hors du délai annuel ou date d’effet invalide' using errcode='22023';end if;

 if v_lease.end_date is not null
    and v_lease.end_date < (v_effective+interval '1 month - 1 day')::date
 then raise exception 'La révision nécessite un mois complet avant fin de bail' using errcode='22023';end if;

 select * into v_index from public.rental_irl_indices
 where year=v_proposal.target_year
   and quarter=v_proposal.reference_quarter and geographic_scope='metropole';
 if v_index.value is null or v_index.value<>v_proposal.target_index
    or v_index.published_on is null or v_index.published_on>p_notice_sent_on
    or v_index.published_on>v_rule.revision_due_on
 then raise exception 'Indice non officiellement publié avant la date contractuelle ou la notification' using errcode='22023';end if;

 if round(v_proposal.base_monthly_rent*v_proposal.target_index/v_proposal.baseline_index,2)
    <>v_proposal.proposed_monthly_rent
 then raise exception 'Calcul de proposition incohérent' using errcode='22023';end if;

 if exists(select 1 from public.rental_irl_applications
   where lease_id=v_proposal.lease_id and status='scheduled') then
   raise exception 'Une autre révision est déjà programmée pour ce bail' using errcode='22023';end if;

 -- Lock future monthly installments before testing allocations, which also lock
 -- these records in marne_record_payment. This prevents changing a paid invoice.
 for v_inst in
  select id,period,rent_amount,status from public.rental_installments
   where lease_id=v_proposal.lease_id and period>=v_effective
    and period>=v_lease.start_date
    and (v_lease.end_date is null or (period+interval '1 month - 1 day')::date<=v_lease.end_date)
   order by period for update
 loop
  if v_inst.status<>'scheduled' or v_inst.rent_amount<>v_proposal.base_monthly_rent
    or exists(select 1 from public.rental_payment_allocations where installment_id=v_inst.id)
  then raise exception 'Échéance future déjà payée, annulée ou modifiée : examen manuel requis' using errcode='22023';end if;
 end loop;

 insert into public.rental_irl_applications
 (proposal_id,lease_id,revision_due_on,notice_sent_on,notice_method,effective_on,
  old_monthly_rent,new_monthly_rent,approved_by,status)
 values(v_proposal.id,v_proposal.lease_id,v_proposal.revision_due_on,
        p_notice_sent_on,p_notice_method,v_effective,v_proposal.base_monthly_rent,
        v_proposal.proposed_monthly_rent,p_approved_by,'scheduled')
 returning id into v_id;

 update public.rental_installments
 set rent_amount=v_proposal.proposed_monthly_rent
 where lease_id=v_proposal.lease_id and period>=v_effective
   and period>=v_lease.start_date
   and (v_lease.end_date is null or (period+interval '1 month - 1 day')::date<=v_lease.end_date)
   and status='scheduled' and rent_amount=v_proposal.base_monthly_rent;
 get diagnostics v_updated = row_count;

 update public.rental_irl_proposals set status='scheduled' where id=v_proposal.id;
 return jsonb_build_object('ok',true,'application_id',v_id,
   'effective_on',v_effective,'rent_before',v_proposal.base_monthly_rent,
   'rent_after',v_proposal.proposed_monthly_rent,
   'updated_future_installments',v_updated,
   'current_month_changed',false,'payments_changed',false,'mail_sent',false);
end $function$;

CREATE OR REPLACE FUNCTION public.marne_record_payment(p_idempotency_key uuid, p_lease_id uuid, p_received_on date, p_amount numeric, p_method text, p_reference text, p_payer_name text, p_note text, p_recorded_by text, p_installment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_lease public.rental_leases%rowtype;
 v_inst public.rental_installments%rowtype;
 v_payment public.rental_payments%rowtype;
 v_payment_id uuid;
 v_previous numeric(12,2) := 0;
 v_allocated numeric(12,2) := 0;
 v_is_dup boolean := false;
 v_reference text := nullif(btrim(p_reference),'');
begin
 if p_idempotency_key is null or p_lease_id is null or p_received_on is null or
    p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or
    p_amount <> round(p_amount,2) or p_recorded_by is null or btrim(p_recorded_by)='' then
    raise exception 'Informations de paiement invalides' using errcode='22023';
 end if;
 if p_received_on > (now() at time zone 'Europe/Paris')::date then
    raise exception 'La date de réception ne peut pas être future' using errcode='22023';
 end if;
 if p_method not in ('virement','cheque','especes','carte','autre') or
    length(coalesce(v_reference,''))>120 or length(coalesce(p_payer_name,''))>180 or
    length(coalesce(p_note,''))>2000 then
    raise exception 'Mode, référence ou texte invalide' using errcode='22023';
 end if;
 select * into v_lease from public.rental_leases where id=p_lease_id;
 if not found or v_lease.status not in ('active','closed') or v_lease.verified_at is null then
    raise exception 'Bail actif ou clos vérifié requis' using errcode='22023';
 end if;
 select * into v_payment from public.rental_payments where idempotency_key=p_idempotency_key;
 if found then
   if v_payment.lease_id<>p_lease_id or v_payment.amount<>p_amount
     or v_payment.received_on<>p_received_on or v_payment.payment_method<>p_method
     or v_payment.reference is distinct from v_reference or v_payment.status<>'recorded'
   then raise exception 'Clé de saisie réutilisée pour un règlement différent' using errcode='23505'; end if;
   select coalesce(sum(a.amount),0) into v_allocated from public.rental_payment_allocations a where a.payment_id=v_payment.id;
   return jsonb_build_object('id',v_payment.id,'duplicate',true,'allocated',v_allocated,'unallocated',v_payment.amount-v_allocated);
 end if;
 if p_installment_id is not null then
   select * into v_inst from public.rental_installments where id=p_installment_id for update;
   if not found or v_inst.lease_id<>p_lease_id or v_inst.property_id<>v_lease.property_id or v_inst.status<>'scheduled' then
      raise exception 'Échéance non valide pour ce bail' using errcode='22023';
   end if;
   select coalesce(sum(a.amount),0) into v_previous
   from public.rental_payment_allocations a
   join public.rental_payments p on p.id=a.payment_id and p.status='recorded'
   where a.installment_id=p_installment_id;
   v_allocated := least(p_amount,greatest(0,v_inst.total_due-v_previous));
   if v_allocated<=0 then raise exception 'Échéance déjà intégralement réglée' using errcode='22023'; end if;
 end if;
 insert into public.rental_payments
  (lease_id,property_id,received_on,amount,payment_method,reference,payer_name,note,source,idempotency_key,recorded_by)
 values
  (p_lease_id,v_lease.property_id,p_received_on,p_amount,p_method,v_reference,nullif(btrim(p_payer_name),''),coalesce(p_note,''),'manual',p_idempotency_key,p_recorded_by)
 on conflict (idempotency_key) do nothing returning id into v_payment_id;
 if v_payment_id is null then
    select * into v_payment from public.rental_payments where idempotency_key=p_idempotency_key;
    if v_payment.id is null or v_payment.lease_id<>p_lease_id or v_payment.amount<>p_amount or
       v_payment.received_on<>p_received_on or v_payment.payment_method<>p_method or
       v_payment.reference is distinct from v_reference or v_payment.status<>'recorded'
       then raise exception 'Clé de saisie réutilisée' using errcode='23505'; end if;
    select coalesce(sum(a.amount),0) into v_allocated from public.rental_payment_allocations a where a.payment_id=v_payment.id;
    return jsonb_build_object('id',v_payment.id,'duplicate',true,'allocated',v_allocated,'unallocated',v_payment.amount-v_allocated);
 end if;
 if v_allocated>0 then
   insert into public.rental_payment_allocations(payment_id,installment_id,amount)
   values (v_payment_id,p_installment_id,v_allocated);
 end if;
 return jsonb_build_object('id',v_payment_id,'duplicate',v_is_dup,'allocated',v_allocated,'unallocated',p_amount-v_allocated);
end
$function$;


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
 if not found or v_lease.status not in ('active','closed') or v_lease.verified_at is null then
   raise exception 'Bail actif ou clos vérifié requis' using errcode='22023';end if;
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



CREATE OR REPLACE FUNCTION public.marne_prepare_reminders_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_rec record;
 v_finance jsonb;
 v_remaining numeric;
 v_unallocated numeric;
 v_stage integer;
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_prior timestamptz;
 v_recipient text;
 v_new_id uuid;
 v_total integer := 0;
 v_message text;
begin
 for v_rec in
  select i.id installment_id,i.lease_id,i.due_on,
         l.tenant_name,l.tenant_row_id,l.property_id,
         p.name property_name,t.data tenant_data
  from public.rental_installments i
  join public.rental_leases l on l.id=i.lease_id
  join public.rental_properties p on p.id=l.property_id
  join public.rental_tenant_rows t on t.id=l.tenant_row_id
  where i.status='scheduled'
    and l.status='active'
    and l.verified_at is not null
    and i.due_on <= v_today - 7
  order by i.due_on
  limit 500 for update of i
 loop
  v_recipient := btrim(coalesce(v_rec.tenant_data->>'Mail locataire',''));
  if v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then continue; end if;
  v_finance := public.marne_installment_status(v_rec.installment_id);
  v_remaining := (v_finance->>'remaining')::numeric;
  v_unallocated := (v_finance->>'unallocated_on_lease')::numeric;
  if v_remaining<=0.005 or v_unallocated>0.005 then continue; end if;
  foreach v_stage in array array[7,14] loop
   if v_today - v_rec.due_on < v_stage then continue; end if;
   if exists(select 1 from public.rental_reminder_drafts
     where installment_id=v_rec.installment_id and stage=v_stage) then continue; end if;
   if v_stage=14 then
     select declared_sent_at into v_prior
       from public.rental_reminder_drafts
       where installment_id=v_rec.installment_id and stage=7 and status='declared_sent';
     if v_prior is null or (v_prior at time zone 'Europe/Paris')::date > v_today - 7 then continue; end if;
   end if;
   v_message:=format(
     E'Bonjour %s,\n\nSauf erreur de notre part, au %s un solde de %s € reste à rapprocher pour l’échéance du %s concernant le logement %s.\n\nSi vous avez effectué un règlement récemment, merci de nous le signaler en indiquant sa date et sa référence afin de vérifier notre suivi.\n\nCeci est un rappel amiable, sous réserve de la vérification des paiements.\n\nCordialement,\nMarne Invest',
     v_rec.tenant_name,to_char(v_today,'DD/MM/YYYY'),
     replace(v_remaining::text,'.',','),to_char(v_rec.due_on,'DD/MM/YYYY'),
     v_rec.property_name
   );
   insert into public.rental_reminder_drafts
     (installment_id,lease_id,stage,recipient_email,subject,body,due_at_preparation,prepared_by,status)
   values
     (v_rec.installment_id,v_rec.lease_id,v_stage,v_recipient,
      format('Rappel amiable de l’échéance du %s — %s',to_char(v_rec.due_on,'DD/MM/YYYY'),v_rec.property_name),
      v_message,v_remaining,'system-cron','prepared')
   on conflict(installment_id,stage) do nothing
   returning id into v_new_id;
   if v_new_id is not null then v_total:=v_total+1; end if;
   v_new_id:=null;
  end loop;
 end loop;
 return v_total;
end
$function$;



create or replace function public.marne_prepare_lease(p_tenant_row_id uuid,p_by text)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_property_id uuid;
 v_property public.rental_properties%rowtype;
 v_tenant public.rental_tenant_rows%rowtype;
 v_lease public.rental_leases%rowtype;
 v_created boolean:=false;
 v_name text;
 v_start date;
 v_end date;
 v_rent numeric;
 v_charges numeric;
 v_raw text;
begin
 if p_tenant_row_id is null or char_length(btrim(coalesce(p_by,''))) not between 1 and 180 then
  raise exception 'Fiche locataire ou acteur invalide' using errcode='22023';end if;
 select property_id into v_property_id from public.rental_tenant_rows where id=p_tenant_row_id;
 if not found or v_property_id is null then
  raise exception 'Reliez la fiche locataire à un logement avant de préparer le bail' using errcode='22023';end if;
 select * into v_property from public.rental_properties where id=v_property_id for no key update;
 if not found or v_property.is_example then
  raise exception 'Logement réel introuvable' using errcode='22023';end if;
 select * into v_tenant from public.rental_tenant_rows where id=p_tenant_row_id for update;
 if not found or v_tenant.property_id is distinct from v_property_id then
  raise exception 'Fiche locataire modifiée : actualisez la page' using errcode='55000';end if;
 select * into v_lease from public.rental_leases where tenant_row_id=p_tenant_row_id
  order by case status when 'active' then 0 when 'closed' then 1 else 2 end,created_at,id
  limit 1 for no key update;
 if found and v_lease.status in ('active','closed') then
  return jsonb_build_object('lease',to_jsonb(v_lease),'created',false,'reused',true);end if;
 v_name:=case when jsonb_typeof(v_tenant.data->'Locataire')='string'
  then btrim(v_tenant.data->>'Locataire') else '' end;
 if char_length(v_name)>200 then raise exception 'Nom du locataire trop long' using errcode='22023';end if;
 v_raw:=btrim(coalesce(v_tenant.data->>'Date entrée locataire',''));
 if v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  begin v_start:=v_raw::date;
  exception when invalid_datetime_format or datetime_field_overflow then v_start:=null;end;
 end if;
 v_raw:=btrim(coalesce(v_tenant.data->>'Date fin de bail',''));
 if v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  begin v_end:=v_raw::date;
  exception when invalid_datetime_format or datetime_field_overflow then v_end:=null;end;
 end if;
 if v_end<coalesce(v_lease.start_date,v_start) then v_end:=null;end if;
 v_raw:=btrim(coalesce(v_tenant.data->>'Loyer de base',''));
 if v_raw ~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' then v_rent:=replace(v_raw,',','.')::numeric;end if;
 v_raw:=btrim(coalesce(v_tenant.data->>'Charge',''));
 if v_raw ~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' then v_charges:=replace(v_raw,',','.')::numeric;end if;
 if v_lease.id is null then
  select * into v_lease from public.rental_leases l
   where l.property_id=v_property_id and l.status='draft' and l.tenant_row_id is null
    and btrim(l.tenant_name)='' and l.start_date is null and l.end_date is null
    and l.monthly_rent is null and l.charges_amount is null and l.due_day is null
    and not exists(select 1 from public.rental_installments i where i.lease_id=l.id)
    and not exists(select 1 from public.rental_payments p where p.lease_id=l.id)
    and not exists(select 1 from public.rental_documents d where d.lease_id=l.id)
    and not exists(select 1 from public.rental_irl_proposals p where p.lease_id=l.id)
   order by l.created_at,l.id limit 1 for no key update;
 end if;
 if v_lease.id is null then
  insert into public.rental_leases(property_id,tenant_row_id,tenant_name,observed_move_in_date,
   start_date,end_date,monthly_rent,charges_amount,status,source)
  values(v_property_id,v_tenant.id,v_name,v_start,v_start,v_end,v_rent,v_charges,'draft','manual')
  returning * into v_lease;
  v_created:=true;
 else
  if v_lease.start_date is null and v_lease.end_date is not null and v_start>v_lease.end_date then v_start:=null;end if;
  update public.rental_leases set tenant_row_id=v_tenant.id,tenant_name=v_name,
   observed_move_in_date=coalesce(observed_move_in_date,v_start),
   start_date=coalesce(start_date,v_start),end_date=coalesce(end_date,v_end),
   monthly_rent=coalesce(monthly_rent,v_rent),charges_amount=coalesce(charges_amount,v_charges),
   updated_at=now()
   where id=v_lease.id and status='draft' returning * into v_lease;
 end if;
 return jsonb_build_object('lease',to_jsonb(v_lease),'created',v_created,'reused',not v_created);
end;
$function$;

create or replace function public.marne_save_lease(p_lease_id uuid,p_patch jsonb,p_by text,p_activate boolean default false)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_property_id uuid;
 v_tenant_id uuid;
 v_property public.rental_properties%rowtype;
 v_tenant public.rental_tenant_rows%rowtype;
 v_lease public.rental_leases%rowtype;
 v_key text;
 v_raw text;
 v_date date;
 v_first date:=date_trunc('month',now() at time zone 'Europe/Paris')::date;
 v_month date;
 v_month_end date;
 v_index integer;
 v_created integer:=0;
 v_affected integer;
 v_partial integer:=0;
 v_periods jsonb:='[]'::jsonb;
begin
 if p_lease_id is null or p_activate is null or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
  or jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>16384 then
  raise exception 'Bail, modification ou acteur invalide' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in
  ('start_date','end_date','monthly_rent','charges_amount','due_day','lease_kind',
   'issuer_name','issuer_address','receipt_email_consent','notes')) then
  raise exception 'Champ de bail non modifiable' using errcode='22023';end if;
 foreach v_key in array array['start_date','end_date'] loop
  if p_patch ? v_key and jsonb_typeof(p_patch->v_key)<>'null' then
   v_raw:=p_patch->>v_key;
   if jsonb_typeof(p_patch->v_key)<>'string' or v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Date invalide (AAAA-MM-JJ)' using errcode='22023';end if;
   begin v_date:=v_raw::date;
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Date inexistante' using errcode='22023';end;
  end if;
 end loop;
 foreach v_key in array array['monthly_rent','charges_amount'] loop
  if p_patch ? v_key and jsonb_typeof(p_patch->v_key)<>'null' then
   v_raw:=p_patch->>v_key;
   if jsonb_typeof(p_patch->v_key) not in ('string','number')
    or v_raw !~ '^[0-9]{1,9}([.][0-9]{1,2})?$' then
    raise exception 'Montant non négatif à deux décimales requis' using errcode='22023';end if;
  end if;
 end loop;
 if p_patch ? 'due_day' and jsonb_typeof(p_patch->'due_day')<>'null' then
  v_raw:=p_patch->>'due_day';
  if jsonb_typeof(p_patch->'due_day') not in ('string','number') or v_raw !~ '^[0-9]{1,2}$' then
   raise exception 'Jour de paiement invalide' using errcode='22023';end if;
  if v_raw::integer not between 1 and 31 then
   raise exception 'Jour de paiement entre 1 et 31' using errcode='22023';end if;
 end if;
 if p_patch ? 'lease_kind' and (jsonb_typeof(p_patch->'lease_kind') is distinct from 'string'
  or p_patch->>'lease_kind' not in ('unverified','residential','parking','commercial','other')) then
  raise exception 'Nature du bail invalide' using errcode='22023';end if;
 if p_patch ? 'receipt_email_consent' and jsonb_typeof(p_patch->'receipt_email_consent') is distinct from 'boolean' then
  raise exception 'Consentement invalide' using errcode='22023';end if;
 foreach v_key in array array['issuer_name','issuer_address','notes'] loop
  if p_patch ? v_key and jsonb_typeof(p_patch->v_key) not in ('string','null') then
   raise exception 'Texte de bail invalide' using errcode='22023';end if;
 end loop;
 if char_length(coalesce(p_patch->>'issuer_name',''))>200
  or char_length(coalesce(p_patch->>'issuer_address',''))>500
  or char_length(coalesce(p_patch->>'notes',''))>2000 then
  raise exception 'Texte de bail trop long' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select property_id,tenant_row_id into v_property_id,v_tenant_id from public.rental_leases where id=p_lease_id;
 if not found or v_tenant_id is null then
  raise exception 'Préparez un bail relié à une fiche locataire' using errcode='22023';end if;
 select * into v_property from public.rental_properties where id=v_property_id for no key update;
 if not found or v_property.is_example then raise exception 'Logement réel introuvable' using errcode='22023';end if;
 select * into v_tenant from public.rental_tenant_rows where id=v_tenant_id for update;
 if not found or v_tenant.property_id is distinct from v_property_id then
  raise exception 'Le locataire et le bail doivent appartenir au même logement' using errcode='55000';end if;
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if not found or v_lease.property_id is distinct from v_property_id or v_lease.tenant_row_id is distinct from v_tenant_id
  or v_lease.status<>'draft' then
  raise exception 'Seul un bail en brouillon peut être modifié : actualisez la page' using errcode='55000';end if;
 v_lease:=jsonb_populate_record(v_lease,p_patch);
 v_lease.tenant_name:=case when jsonb_typeof(v_tenant.data->'Locataire')='string'
  then btrim(v_tenant.data->>'Locataire') else '' end;
 v_lease.issuer_name:=nullif(btrim(coalesce(v_lease.issuer_name,'')),'');
 v_lease.issuer_address:=nullif(btrim(coalesce(v_lease.issuer_address,'')),'');
 v_lease.notes:=coalesce(v_lease.notes,'');
 if v_lease.end_date<v_lease.start_date or char_length(v_lease.tenant_name)>200 then
  raise exception 'Dates ou nom de locataire invalides' using errcode='22023';end if;
 if p_activate then
  if v_lease.issuer_name is null then
   select nullif(btrim(value #>> '{}'),'') into v_lease.issuer_name from public.rental_settings
    where setting_key='landlord_name' and jsonb_typeof(value)='string';end if;
  if v_lease.issuer_address is null then
   select nullif(btrim(value #>> '{}'),'') into v_lease.issuer_address from public.rental_settings
    where setting_key='landlord_address' and jsonb_typeof(value)='string';end if;
  if v_lease.start_date is null or v_lease.monthly_rent is null or v_lease.charges_amount is null
   or v_lease.due_day is null or v_lease.lease_kind='unverified' or v_lease.tenant_name=''
   or v_lease.issuer_name is null or v_lease.issuer_address is null
   or char_length(v_lease.issuer_name)>200 or char_length(v_lease.issuer_address)>500
   or nullif(btrim(coalesce(v_property.name,'')),'') is null
   or coalesce(nullif(btrim(v_property.data->>'Adresse'),''),nullif(btrim(v_tenant.data->>'Adresse logement'),'')) is null then
   raise exception 'Vérifiez le locataire, les dates, montants, jour, nature du bail et coordonnées du logement et du bailleur avant activation' using errcode='22023';end if;
  if exists(select 1 from public.rental_leases where property_id=v_property_id and status='active' and id<>p_lease_id) then
   raise exception 'Un bail actif existe déjà pour ce logement' using errcode='23505';end if;
  if exists(select 1 from public.rental_leases where property_id=v_property_id and id<>p_lease_id
   and status='closed' and verified_at is not null
   and start_date<=coalesce(v_lease.end_date,'infinity'::date)
   and coalesce(end_date,'infinity'::date)>=v_lease.start_date) then
   raise exception 'Les dates du nouveau bail chevauchent une occupation clôturée de ce logement' using errcode='22023';end if;
 end if;
 update public.rental_leases set tenant_name=v_lease.tenant_name,start_date=v_lease.start_date,end_date=v_lease.end_date,
  monthly_rent=v_lease.monthly_rent,charges_amount=v_lease.charges_amount,due_day=v_lease.due_day,
  lease_kind=v_lease.lease_kind,issuer_name=v_lease.issuer_name,issuer_address=v_lease.issuer_address,
  receipt_email_consent=v_lease.receipt_email_consent,notes=v_lease.notes,
  status=case when p_activate then 'active' else 'draft' end,
  verified_at=case when p_activate then now() else null end,
  verified_by=case when p_activate then btrim(p_by) else null end,updated_at=now()
  where id=p_lease_id returning * into v_lease;
 if p_activate then
  for v_index in 0..1 loop
   v_month:=(v_first+make_interval(months=>v_index))::date;
   v_month_end:=(v_month+interval '1 month - 1 day')::date;
   if v_lease.start_date>v_month_end or (v_lease.end_date is not null and v_lease.end_date<v_month) then continue;end if;
   if v_lease.start_date>v_month or (v_lease.end_date is not null and v_lease.end_date<v_month_end) then
    v_partial:=v_partial+1;v_periods:=v_periods||to_jsonb(v_month);continue;end if;
   insert into public.rental_installments(lease_id,property_id,period,due_on,rent_amount,charges_amount,status)
   values(v_lease.id,v_lease.property_id,v_month,
    v_month+(least(v_lease.due_day,extract(day from v_month_end)::integer)-1),
    public.marne_irl_rent_for_period(v_lease.id,v_month),v_lease.charges_amount,'scheduled')
   on conflict(lease_id,period) do nothing;
   get diagnostics v_affected=row_count;v_created:=v_created+v_affected;
  end loop;
 end if;
 return jsonb_build_object('lease',to_jsonb(v_lease),'installments_created',v_created,
  'skipped_partial_months',v_partial,'partial_periods',v_periods);
end;
$function$;

create or replace function public.marne_close_lease(p_lease_id uuid,p_end_date date,p_by text,p_final_month_confirmed boolean default false)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_property_id uuid;
 v_lease public.rental_leases%rowtype;
 v_inst record;
 v_cancelled integer:=0;
 v_reminders integer:=0;
 v_irl integer:=0;
 v_partial boolean;
begin
 if p_lease_id is null or p_end_date is null or p_end_date>(now() at time zone 'Europe/Paris')::date
  or char_length(btrim(coalesce(p_by,''))) not between 1 and 180 then
  raise exception 'Date de départ effective et acteur valides requis' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select property_id into v_property_id from public.rental_leases where id=p_lease_id;
 if not found then raise exception 'Bail introuvable' using errcode='22023';end if;
 perform 1 from public.rental_properties where id=v_property_id for no key update;
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if v_lease.status='closed' then
  if v_lease.end_date is distinct from p_end_date then
   raise exception 'Le bail est déjà clos à une autre date' using errcode='55000';end if;
  return jsonb_build_object('lease',to_jsonb(v_lease),'already_closed',true,
   'cancelled_installments',0,'cancelled_reminders',0,'cancelled_irl_applications',0,
   'partial_final_month',extract(day from p_end_date+1)<>1);
 end if;
 if v_lease.status<>'active' or v_lease.verified_at is null or v_lease.start_date is null or p_end_date<v_lease.start_date then
  raise exception 'Bail actif vérifié et départ postérieur au début requis' using errcode='22023';end if;
 v_partial:=extract(day from p_end_date+1)<>1;
 if v_partial and p_final_month_confirmed is distinct from true then
  raise exception 'Confirmez le montant du dernier mois : aucun prorata ne sera calculé automatiquement' using errcode='22023';end if;
 for v_inst in select id,period from public.rental_installments
  where lease_id=p_lease_id and status='scheduled' and period>p_end_date order by period,id for update
 loop
  if exists(select 1 from public.rental_payment_allocations a join public.rental_payments p on p.id=a.payment_id
   where a.installment_id=v_inst.id and p.status='recorded') then
   raise exception 'Une échéance après le départ possède un paiement affecté : vérifiez ce règlement avant clôture' using errcode='55000';end if;
 end loop;
 update public.rental_installments set status='cancelled'
  where lease_id=p_lease_id and status='scheduled' and period>p_end_date;
 get diagnostics v_cancelled=row_count;
 update public.rental_reminder_drafts r set status='cancelled',cancelled_at=now(),
  cancelled_reason='Bail clos : échéance postérieure au départ du '||p_end_date::text
  where r.lease_id=p_lease_id and r.status='prepared'
   and exists(select 1 from public.rental_installments i where i.id=r.installment_id and i.period>p_end_date and i.status='cancelled');
 get diagnostics v_reminders=row_count;
 update public.rental_irl_applications set status='cancelled',cancelled_at=now(),cancelled_by=btrim(p_by),
  cancelled_reason='Bail clos avec départ effectif le '||p_end_date::text
  where lease_id=p_lease_id and status='scheduled';
 get diagnostics v_irl=row_count;
 update public.rental_irl_proposals p set status='cancelled',note=p.note||E'\nBail clos avec départ effectif le '||p_end_date::text
  where p.lease_id=p_lease_id and p.status='scheduled'
   and exists(select 1 from public.rental_irl_applications a where a.proposal_id=p.id and a.status='cancelled');
 update public.rental_leases set status='closed',end_date=p_end_date,closed_at=now(),closed_by=btrim(p_by),updated_at=now()
  where id=p_lease_id returning * into v_lease;
 return jsonb_build_object('lease',to_jsonb(v_lease),'already_closed',false,
  'cancelled_installments',v_cancelled,'cancelled_reminders',v_reminders,
  'cancelled_irl_applications',v_irl,'partial_final_month',v_partial);
end;
$function$;

create or replace function public.marne_set_partial_installment(p_lease_id uuid,p_period date,p_rent numeric,p_charges numeric,p_by text,p_confirmed boolean default false)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_lease public.rental_leases%rowtype;
 v_inst public.rental_installments%rowtype;
 v_month_end date;
 v_created boolean:=false;
 v_updated boolean:=false;
begin
 if p_lease_id is null or p_period is null or extract(day from p_period)<>1
  or p_confirmed is distinct from true or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
  or p_rent is null or p_charges is null or p_rent<0 or p_charges<0
  or p_rent>999999999.99 or p_charges>999999999.99
  or p_rent<>round(p_rent,2) or p_charges<>round(p_charges,2) then
  raise exception 'Mois, montants explicites à deux décimales et confirmation requis' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if not found or v_lease.status not in ('active','closed') or v_lease.verified_at is null
  or v_lease.start_date is null or v_lease.due_day is null then
  raise exception 'Bail actif ou clos vérifié requis' using errcode='22023';end if;
 v_month_end:=(p_period+interval '1 month - 1 day')::date;
 if v_lease.start_date>v_month_end or (v_lease.end_date is not null and v_lease.end_date<p_period)
  or not(v_lease.start_date>p_period or (v_lease.end_date is not null and v_lease.end_date<v_month_end)) then
  raise exception 'Cette saisie est réservée au premier ou dernier mois réellement incomplet du bail' using errcode='22023';end if;
 select * into v_inst from public.rental_installments where lease_id=p_lease_id and period=p_period for update;
 if found then
  if v_inst.status<>'scheduled' then raise exception 'Une échéance annulée ne peut pas être réactivée' using errcode='55000';end if;
  if v_inst.rent_amount is distinct from p_rent or v_inst.charges_amount is distinct from p_charges then
   perform 1 from public.rental_reminder_drafts where installment_id=v_inst.id order by id for update;
   if exists(select 1 from public.rental_payment_allocations where installment_id=v_inst.id)
    or exists(select 1 from public.rental_reminder_drafts where installment_id=v_inst.id and status='declared_sent') then
    raise exception 'Échéance déjà affectée à un paiement ou rappel déclaré envoyé : correction directe interdite' using errcode='55000';end if;
   update public.rental_installments set rent_amount=p_rent,charges_amount=p_charges,
    amount_verified_at=now(),amount_verified_by=btrim(p_by) where id=v_inst.id returning * into v_inst;
   update public.rental_reminder_drafts set status='cancelled',cancelled_at=now(),
    cancelled_reason='Montants du mois partiel corrigés et confirmés par '||btrim(p_by)
    where installment_id=v_inst.id and status='prepared';
   v_updated:=true;
  end if;
  if v_inst.amount_verified_at is null then
   update public.rental_installments set amount_verified_at=now(),amount_verified_by=btrim(p_by)
    where id=v_inst.id returning * into v_inst;
   v_updated:=true;
  end if;
 else
  insert into public.rental_installments(lease_id,property_id,period,due_on,rent_amount,charges_amount,status,amount_verified_at,amount_verified_by)
  values(p_lease_id,v_lease.property_id,p_period,p_period+(least(v_lease.due_day,extract(day from v_month_end)::integer)-1),p_rent,p_charges,'scheduled',now(),btrim(p_by))
  returning * into v_inst;
  v_created:=true;
 end if;
 return jsonb_build_object('ok',true,'item',to_jsonb(v_inst),'created',v_created,'updated',v_updated);
end;
$function$;

revoke all on function public.marne_prepare_lease(uuid,text) from public,anon,authenticated;
revoke all on function public.marne_save_lease(uuid,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.marne_close_lease(uuid,date,text,boolean) from public,anon,authenticated;
revoke all on function public.marne_set_partial_installment(uuid,date,numeric,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.marne_prepare_lease(uuid,text) to service_role;
grant execute on function public.marne_save_lease(uuid,jsonb,text,boolean) to service_role;
grant execute on function public.marne_close_lease(uuid,date,text,boolean) to service_role;
grant execute on function public.marne_set_partial_installment(uuid,date,numeric,numeric,text,boolean) to service_role;


do $regression$
declare
 v_prefix text:='qa-lease-lifecycle-'||gen_random_uuid()::text;
 v_first date:=date_trunc('month',now() at time zone 'Europe/Paris')::date;
 v_today date:=(now() at time zone 'Europe/Paris')::date;
 v_result jsonb;
 v_saved jsonb;
 v_patch jsonb;
 v_bad jsonb;
 v_before jsonb;
 v_after jsonb;
 v_property uuid;
 v_tenant uuid;
 v_lease uuid;
 v_other_tenant uuid;
 v_other_lease uuid;
 v_partial_lease uuid;
 v_final_lease uuid;
 v_atomic_lease uuid;
 v_installment uuid;
 v_payment uuid;
 v_proposal uuid;
 v_application uuid;
 v_import uuid;
 v_line uuid;
 v_period date;
 v_stamp timestamptz;
 v_signature text;
 v_checks integer:=0;
begin
 select jsonb_build_array((select count(*) from public.rental_properties),
  (select count(*) from public.rental_tenant_rows),(select count(*) from public.rental_leases),
  (select count(*) from public.rental_installments),(select count(*) from public.rental_payments),
  (select count(*) from public.rental_payment_allocations),(select count(*) from public.rental_reminder_drafts),
  (select count(*) from public.rental_irl_proposals),(select count(*) from public.rental_irl_applications),
  (select count(*) from public.rental_bank_imports),(select count(*) from public.rental_bank_lines)) into v_before;
 begin
  v_result:=public.marne_create_property(v_prefix||'-main','Adresse QA');
  v_property:=(v_result->'property'->>'id')::uuid;v_tenant:=(v_result->'row'->>'id')::uuid;
  update public.rental_tenant_rows set data=data||jsonb_build_object('Locataire','Locataire QA',
   'Date entrée locataire',(v_first-interval '2 months')::date,'Loyer de base','800,00','Charge',50)
   where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-regression');v_lease:=(v_result->'lease'->>'id')::uuid;
  if v_result->>'created'<>'true' or v_result->'lease'->>'status'<>'draft'
   or v_result->'lease'->>'tenant_name'<>'Locataire QA' or (v_result->'lease'->>'monthly_rent')::numeric<>800
   or v_result->'lease'->>'lease_kind'<>'unverified' or v_result->'lease'->>'due_day' is not null
   or v_result->'lease'->>'verified_at' is not null then raise exception 'L01 prepare verified nothing';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-repeat');
  if (v_result->'lease'->>'id')::uuid<>v_lease or v_result->>'created'<>'false'
   or (select count(*) from public.rental_leases where tenant_row_id=v_tenant)<>1 then raise exception 'L02 prepare idempotent';end if;v_checks:=v_checks+1;
  begin
   insert into public.rental_leases(property_id,tenant_row_id) values(v_property,v_tenant);
   raise exception 'L03 duplicate draft accepted';
  exception when unique_violation then null;end;v_checks:=v_checks+1;
  foreach v_bad in array array['{"status":"active"}'::jsonb,'{"monthly_rent":-1}'::jsonb,
   '{"monthly_rent":1.001}'::jsonb,'{"start_date":"2026-02-30"}'::jsonb,
   '{"due_day":32}'::jsonb,'{"receipt_email_consent":"true"}'::jsonb] loop
   begin perform public.marne_save_lease(v_lease,v_bad,'qa-invalid',false);
    raise exception 'L04 invalid patch accepted';exception when invalid_parameter_value then null;end;
   v_checks:=v_checks+1;
  end loop;
  begin perform public.marne_save_lease(v_lease,'{}','qa-invalid',true);
   raise exception 'L05 incomplete activation accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  v_patch:=jsonb_build_object('start_date',(v_first-interval '2 months')::date,'end_date',null,
   'monthly_rent',800,'charges_amount',50,'due_day',31,'lease_kind','residential',
   'issuer_name','Bailleur QA','issuer_address','Adresse bailleur QA','receipt_email_consent',false,'notes','Note QA');
  v_result:=public.marne_save_lease(v_lease,v_patch,'qa-activation',true);v_saved:=v_result->'lease';
  if v_result->'lease'->>'status'<>'active' or v_result->'lease'->>'verified_by'<>'qa-activation'
   or (v_result->>'installments_created')::integer<>2 or (v_result->>'skipped_partial_months')::integer<>0
   or jsonb_array_length(v_result->'partial_periods')<>0 then raise exception 'L06 atomic activation full months';end if;v_checks:=v_checks+1;
  if (select count(*) from public.rental_installments where lease_id=v_lease and due_on=(period+interval '1 month - 1 day')::date)<>2
   or exists(select 1 from public.rental_payments where lease_id=v_lease) then raise exception 'L07 due day clamped and no payment invented';end if;v_checks:=v_checks+1;
  update public.rental_tenant_rows set data=data||'{"Locataire":"Contact corrigé QA"}'::jsonb where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-active');
  if v_result->'lease' is distinct from v_saved then raise exception 'L08 active snapshot mutated';end if;v_checks:=v_checks+1;
  begin perform public.marne_save_lease(v_lease,'{"monthly_rent":900}','qa-active-edit',false);
   raise exception 'L09 active modification accepted';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  v_result:=public.marne_create_tenant(v_property,jsonb_build_object('Logement',v_prefix||'-main','Locataire','Nouveau QA'));
  v_other_tenant:=(v_result->>'id')::uuid;
  v_result:=public.marne_prepare_lease(v_other_tenant,'qa-next-draft');v_other_lease:=(v_result->'lease'->>'id')::uuid;
  if v_result->'lease'->>'status'<>'draft' or (select status from public.rental_leases where id=v_lease)<>'active' then
   raise exception 'L10 next occupation draft unavailable';end if;v_checks:=v_checks+1;
  begin perform public.marne_save_lease(v_other_lease,v_patch||jsonb_build_object('start_date',(v_first+interval '1 month')::date),'qa-conflict',true);
   raise exception 'L10b second active occupation accepted';exception when unique_violation then null;end;v_checks:=v_checks+1;
  begin perform public.marne_close_lease(v_lease,(v_first-interval '1 month')::date+9,'qa-close',false);
   raise exception 'L11 partial departure without confirmation';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  select id into v_installment from public.rental_installments where lease_id=v_lease and period=v_first;
  v_result:=public.marne_record_payment(gen_random_uuid(),v_lease,v_today,100,'virement','QA',null,'','qa-payment',v_installment);
  v_payment:=(v_result->>'id')::uuid;
  begin perform public.marne_close_lease(v_lease,v_first-1,'qa-close',true);
   raise exception 'L12 paid future installment cancelled';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  if (select status from public.rental_leases where id=v_lease)<>'active'
   or (select status from public.rental_installments where id=v_installment)<>'scheduled' then raise exception 'L13 failed close atomic';end if;v_checks:=v_checks+1;
  update public.rental_payments set status='void',voided_at=now(),voided_by='qa',void_reason='Fixture seulement' where id=v_payment;
  insert into public.rental_reminder_drafts(installment_id,lease_id,stage,recipient_email,subject,body,due_at_preparation,prepared_by)
   values(v_installment,v_lease,7,'qa@example.invalid','QA','QA',850,'qa');
  insert into public.rental_irl_proposals(lease_id,revision_due_on,prepared_on,prepared_by,reference_quarter,baseline_year,target_year,
   baseline_index,target_index,base_monthly_rent,proposed_monthly_rent,status)
   values(v_lease,v_first-1,v_today,'qa',1,2000,2001,100,110,800,880,'scheduled') returning id into v_proposal;
  insert into public.rental_irl_applications(proposal_id,lease_id,revision_due_on,notice_sent_on,notice_method,effective_on,
   old_monthly_rent,new_monthly_rent,approved_by,status)
   values(v_proposal,v_lease,v_first-1,v_first-1,'hand_signed',(v_first+interval '1 month')::date,800,880,'qa','scheduled') returning id into v_application;
  v_result:=public.marne_close_lease(v_lease,v_first-1,'qa-close',true);v_saved:=v_result->'lease';
  if v_saved->>'status'<>'closed' or v_saved->>'closed_by'<>'qa-close' or v_saved->>'closed_at' is null
   or (v_result->>'cancelled_installments')::integer<>2 or (v_result->>'cancelled_reminders')::integer<>1
   or (v_result->>'cancelled_irl_applications')::integer<>1 then raise exception 'L14 close future unpaid and audits';end if;v_checks:=v_checks+1;
  if (select status from public.rental_irl_applications where id=v_application)<>'cancelled'
   or (select cancelled_by from public.rental_irl_applications where id=v_application)<>'qa-close'
   or (select status from public.rental_irl_proposals where id=v_proposal)<>'cancelled'
   or not exists(select 1 from public.rental_payment_allocations where payment_id=v_payment and amount=100)
   or (select status from public.rental_payments where id=v_payment)<>'void' then raise exception 'L15 archives preserved';end if;v_checks:=v_checks+1;
  v_result:=public.marne_close_lease(v_lease,v_first-1,'qa-close-repeat',true);
  if v_result->>'already_closed'<>'true' or v_result->'lease' is distinct from v_saved then raise exception 'L16 close idempotent';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-history');
  if v_result->'lease' is distinct from v_saved or (select count(*) from public.rental_leases where tenant_row_id=v_tenant)<>1 then raise exception 'L17 historic tenant no new lease';end if;v_checks:=v_checks+1;
  v_result:=public.marne_prepare_lease(v_other_tenant,'qa-next');v_other_lease:=(v_result->'lease'->>'id')::uuid;
  begin perform public.marne_save_lease(v_other_lease,v_patch,'qa-overlap',true);
   raise exception 'L18 historic dates overlap accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  v_result:=public.marne_save_lease(v_other_lease,v_patch||jsonb_build_object('start_date',v_first),'qa-next',true);
  if v_result->'lease'->>'status'<>'active' or (select count(*) from public.rental_leases where property_id=v_property and status='active')<>1 then raise exception 'L19 new tenant after closure';end if;v_checks:=v_checks+1;

  v_result:=public.marne_create_property(v_prefix||'-partial','Adresse QA');v_tenant:=(v_result->'row'->>'id')::uuid;
  update public.rental_tenant_rows set data=data||jsonb_build_object('Locataire','Partiel QA','Date entrée locataire','2026-02-30',
   'Loyer de base','NaN','Charge','50.001') where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-invalid-source');v_partial_lease:=(v_result->'lease'->>'id')::uuid;
  if v_result->'lease'->>'start_date' is not null or v_result->'lease'->>'monthly_rent' is not null
   or v_result->'lease'->>'charges_amount' is not null then raise exception 'L20 invalid source values not invented';end if;v_checks:=v_checks+1;
  v_result:=public.marne_save_lease(v_partial_lease,v_patch||jsonb_build_object('start_date',v_first+9),'qa-partial',true);
  if (v_result->>'installments_created')::integer<>1 or (v_result->>'skipped_partial_months')::integer<>1
   or v_result->'partial_periods' is distinct from jsonb_build_array(v_first)
   or exists(select 1 from public.rental_installments where lease_id=v_partial_lease and period=v_first) then raise exception 'L21 no automatic prorata';end if;v_checks:=v_checks+1;
  begin perform public.marne_set_partial_installment(v_partial_lease,v_first,300,20,'qa',false);
   raise exception 'L22 partial without confirmation';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_set_partial_installment(v_partial_lease,(v_first+interval '1 month')::date,300,20,'qa',true);
   raise exception 'L23 manual full month accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_set_partial_installment(v_partial_lease,(v_first-interval '1 month')::date,300,20,'qa',true);
   raise exception 'L24 outside lease accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_set_partial_installment(v_partial_lease,v_first,1.001,20,'qa',true);
   raise exception 'L25 fractional cent accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  v_result:=public.marne_set_partial_installment(v_partial_lease,v_first,300,20,'qa-amount-first',true);
  v_installment:=(v_result->'item'->>'id')::uuid;v_stamp:=(v_result->'item'->>'amount_verified_at')::timestamptz;
  if v_result->>'created'<>'true' or v_result->'item'->>'amount_verified_by'<>'qa-amount-first'
   or v_stamp is null or (v_result->'item'->>'total_due')::numeric<>320 then raise exception 'L26 partial audit and explicit amount';end if;v_checks:=v_checks+1;
  v_result:=public.marne_set_partial_installment(v_partial_lease,v_first,300,20,'qa-amount-repeat',true);
  if v_result->>'created'<>'false' or v_result->>'updated'<>'false'
   or v_result->'item'->>'amount_verified_by'<>'qa-amount-first'
   or (v_result->'item'->>'amount_verified_at')::timestamptz is distinct from v_stamp then raise exception 'L27 identical repeat audit preserved';end if;v_checks:=v_checks+1;
  insert into public.rental_reminder_drafts(installment_id,lease_id,stage,recipient_email,subject,body,due_at_preparation,prepared_by)
   values(v_installment,v_partial_lease,7,'qa@example.invalid','QA','QA',320,'qa');
  v_result:=public.marne_set_partial_installment(v_partial_lease,v_first,310,25,'qa-amount-correction',true);
  if v_result->>'updated'<>'true' or (v_result->'item'->>'total_due')::numeric<>335
   or v_result->'item'->>'amount_verified_by'<>'qa-amount-correction'
   or (select status from public.rental_reminder_drafts where installment_id=v_installment and stage=7)<>'cancelled' then raise exception 'L28 unpaid correction and reminder invalidation';end if;v_checks:=v_checks+1;
  perform public.marne_record_payment(gen_random_uuid(),v_partial_lease,v_today,100,'virement','QA',null,'','qa-payment',v_installment);
  begin perform public.marne_set_partial_installment(v_partial_lease,v_first,320,25,'qa-paid-correction',true);
   raise exception 'L29 paid partial changed';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  v_result:=public.marne_set_partial_installment(v_partial_lease,v_first,310,25,'qa-paid-repeat',true);
  if v_result->>'updated'<>'false' or (v_result->'item'->>'total_due')::numeric<>335 then raise exception 'L30 identical paid partial retry';end if;v_checks:=v_checks+1;

  v_result:=public.marne_create_property(v_prefix||'-final','Adresse QA');v_tenant:=(v_result->'row'->>'id')::uuid;
  v_property:=(v_result->'property'->>'id')::uuid;
  update public.rental_tenant_rows set data=data||'{"Locataire":"Départ QA"}'::jsonb where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-final');v_final_lease:=(v_result->'lease'->>'id')::uuid;
  perform public.marne_save_lease(v_final_lease,v_patch,'qa-final',true);
  v_period:=(v_first-interval '1 month')::date;
  v_result:=public.marne_close_lease(v_final_lease,v_period+9,'qa-final',true);
  if v_result->>'partial_final_month'<>'true' or (v_result->'lease'->>'end_date')::date<>v_period+9 then raise exception 'L31 partial final confirmed';end if;v_checks:=v_checks+1;
  v_result:=public.marne_set_partial_installment(v_final_lease,v_period,200,15,'qa-final-amount',true);v_installment:=(v_result->'item'->>'id')::uuid;
  v_result:=public.marne_record_payment(gen_random_uuid(),v_final_lease,v_today,50,'virement','QA',null,'','qa-late-payment',v_installment);
  if (v_result->>'allocated')::numeric<>50 then raise exception 'L32 late payment on closed lease';end if;v_checks:=v_checks+1;
  insert into public.rental_bank_imports(original_filename,file_sha256,account_label,imported_by,row_count)
   values('qa.csv',repeat('a',64),v_prefix,'qa',1) returning id into v_import;
  insert into public.rental_bank_lines(import_id,row_number,booking_date,description,amount)
   values(v_import,1,v_today,'Crédit QA historique',25) returning id into v_line;
  v_result:=public.marne_bank_confirm_line(v_line,v_final_lease,v_installment,'qa-bank');
  if v_result->>'ok'<>'true' or (v_result->>'allocated')::numeric<>25
   or not exists(select 1 from public.rental_payments where id=(v_result->>'payment_id')::uuid and status='recorded' and source='bank') then raise exception 'L33 late bank credit on closed lease';end if;v_checks:=v_checks+1;
  v_result:=public.marne_bank_confirm_line(v_line,v_final_lease,v_installment,'qa-bank-repeat');
  if v_result->>'duplicate'<>'true' then raise exception 'L34 closed bank retry';end if;v_checks:=v_checks+1;

  v_result:=public.marne_create_property(v_prefix||'-atomic','Adresse QA');v_tenant:=(v_result->'row'->>'id')::uuid;
  update public.rental_tenant_rows set data=data||'{"Locataire":"Atomic QA"}'::jsonb where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-atomic');v_atomic_lease:=(v_result->'lease'->>'id')::uuid;
  insert into public.rental_irl_proposals(lease_id,revision_due_on,prepared_on,prepared_by,reference_quarter,baseline_year,target_year,
   baseline_index,target_index,base_monthly_rent,proposed_monthly_rent,status)
   values(v_atomic_lease,v_first-1,v_today,'qa',1,2000,2001,100,110,800,9999999999.99,'scheduled') returning id into v_proposal;
  insert into public.rental_irl_applications(proposal_id,lease_id,revision_due_on,notice_sent_on,notice_method,effective_on,
   old_monthly_rent,new_monthly_rent,approved_by,status)
   values(v_proposal,v_atomic_lease,v_first-1,v_first-1,'hand_signed',(v_first+interval '1 month')::date,800,9999999999.99,'qa','scheduled');
  begin perform public.marne_save_lease(v_atomic_lease,v_patch,'qa-atomic',true);
   raise exception 'L35 forced second installment failure absent';exception when numeric_value_out_of_range then null;end;v_checks:=v_checks+1;
  if (select status from public.rental_leases where id=v_atomic_lease)<>'draft'
   or (select verified_at from public.rental_leases where id=v_atomic_lease) is not null
   or exists(select 1 from public.rental_installments where lease_id=v_atomic_lease) then raise exception 'L36 activation and first insertion rolled back';end if;v_checks:=v_checks+1;

  foreach v_signature in array array['public.marne_prepare_lease(uuid,text)',
   'public.marne_save_lease(uuid,jsonb,text,boolean)','public.marne_close_lease(uuid,date,text,boolean)',
   'public.marne_set_partial_installment(uuid,date,numeric,numeric,text,boolean)'] loop
   if has_function_privilege('anon',v_signature,'EXECUTE') or has_function_privilege('authenticated',v_signature,'EXECUTE')
    or not has_function_privilege('service_role',v_signature,'EXECUTE')
    or (select prosecdef from pg_proc where oid=v_signature::regprocedure) then raise exception 'L37 function ACL or invoker';end if;
   v_checks:=v_checks+1;
  end loop;
  raise exception using errcode='ZL021',message='Rollback all lifecycle fixtures';
 exception when sqlstate 'ZL021' then null;
 end;
 select jsonb_build_array((select count(*) from public.rental_properties),
  (select count(*) from public.rental_tenant_rows),(select count(*) from public.rental_leases),
  (select count(*) from public.rental_installments),(select count(*) from public.rental_payments),
  (select count(*) from public.rental_payment_allocations),(select count(*) from public.rental_reminder_drafts),
  (select count(*) from public.rental_irl_proposals),(select count(*) from public.rental_irl_applications),
  (select count(*) from public.rental_bank_imports),(select count(*) from public.rental_bank_lines)) into v_after;
 if v_before is distinct from v_after or exists(select 1 from public.rental_properties where name like v_prefix||'%') then
  raise exception 'L38 fixtures escaped rollback';end if;v_checks:=v_checks+1;
 raise notice 'Lease lifecycle regression: % assertions passed; all fixtures rolled back',v_checks;
end;
$regression$;

