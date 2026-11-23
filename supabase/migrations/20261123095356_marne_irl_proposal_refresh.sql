alter table public.rental_irl_lease_rules
 add column target_year smallint,
 add constraint rental_irl_rules_target_year check (target_year is null or target_year between 2001 and 2100);

alter table public.rental_irl_proposals
 add column draft_revision integer not null default 1 check (draft_revision>=1),
 add column draft_history jsonb not null default '[]'::jsonb check (jsonb_typeof(draft_history)='array'),
 add column updated_at timestamptz not null default now();

alter table public.rental_irl_indices
 add column registered_at timestamptz,
 add column registered_by text,
 add constraint rental_irl_index_registration check (
  (registered_at is null and registered_by is null)
  or (registered_at is not null and registered_by is not null and char_length(btrim(registered_by)) between 1 and 180));


-- Official INSEE publication dates, verified 2026-11-23. Values are comparison guards only.
-- 2024T1: https://www.insee.fr/fr/statistiques/8171954
-- 2024T2: https://www.insee.fr/fr/statistiques/8220551
-- 2024T3: https://www.insee.fr/fr/statistiques/8269850
-- 2024T4: https://www.insee.fr/fr/statistiques/8330737
-- 2025T1: https://www.insee.fr/fr/statistiques/8558868
-- 2025T2..2026T3: https://www.service-public.gouv.fr/particuliers/vosdroits/F13723
-- The last source distinguishes INSEE publication from Journal officiel publication.
do $publication_dates$
declare v_expected record;v_current public.rental_irl_indices%rowtype;
begin
 for v_expected in select * from (values
  (2024,1,143.46,date '2024-06-01',date '2024-04-12'),
  (2024,2,145.17,date '2024-07-18',date '2024-07-12'),
  (2024,3,144.51,date '2024-10-16',date '2024-10-15'),
  (2024,4,144.64,date '2025-01-16',date '2025-01-15'),
  (2025,1,145.47,date '2025-04-16',date '2025-04-15'),
  (2025,2,146.68,date '2025-07-13',date '2025-07-11'),
  (2025,3,145.77,date '2025-10-17',date '2025-10-15'),
  (2025,4,145.78,date '2026-01-16',date '2026-01-15'),
  (2026,1,146.60,date '2026-04-16',date '2026-04-15'),
  (2026,2,148.37,date '2026-07-12',date '2026-07-10'),
  (2026,3,148.06,date '2026-10-16',date '2026-10-15')
 ) as e(year,quarter,expected_value,previous_date,insee_date) loop
  select * into v_current from public.rental_irl_indices where year=v_expected.year and quarter=v_expected.quarter
   and geographic_scope='metropole' for update;
  if not found or v_current.value is distinct from v_expected.expected_value
   or v_current.published_on is null or v_current.published_on not in (v_expected.previous_date,v_expected.insee_date) then
   raise exception 'Référentiel IRL modifié depuis vérification : année %, trimestre %',v_expected.year,v_expected.quarter using errcode='55000';end if;
  if v_current.published_on<>v_expected.insee_date then
   if exists(select 1 from public.rental_irl_proposals where reference_quarter=v_expected.quarter
      and (target_year=v_expected.year or baseline_year=v_expected.year)) then
    raise exception 'Date IRL déjà utilisée dans une proposition : révision contrôlée requise' using errcode='55000';end if;
   update public.rental_irl_indices set published_on=v_expected.insee_date
    where year=v_expected.year and quarter=v_expected.quarter and geographic_scope='metropole';
  end if;
 end loop;
end;
$publication_dates$;
comment on column public.rental_irl_indices.published_on is 'Date de publication par INSEE, distincte de la parution au Journal officiel.';


CREATE OR REPLACE FUNCTION public.marne_irl_prepare_proposal(p_lease_id uuid, p_prepared_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
 v_lease public.rental_leases%rowtype;
 v_rule public.rental_irl_lease_rules%rowtype;
 v_old public.rental_irl_indices%rowtype;
 v_new public.rental_irl_indices%rowtype;
 v_proposal public.rental_irl_proposals%rowtype;
 v_today date:=(now() at time zone 'Europe/Paris')::date;
 v_target_year integer;
 v_proposed numeric(12,2);
 v_created boolean:=false;
 v_refreshed boolean:=false;
begin
 if p_lease_id is null or char_length(btrim(coalesce(p_prepared_by,''))) not between 1 and 180 then
   raise exception 'Bail et auteur requis' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if not found or v_lease.status<>'active' or v_lease.verified_at is null
    or v_lease.lease_kind<>'residential' then
   raise exception 'Seul un bail habitation actif et validé est éligible' using errcode='22023';end if;
 select * into v_rule from public.rental_irl_lease_rules where lease_id=p_lease_id for update;
 if not found then
   raise exception 'Clause IRL du bail à vérifier avant le calcul' using errcode='22023';end if;
 if not v_rule.has_revision_clause or v_rule.is_mobility_lease
    or v_rule.dpe_rating not in ('A','B','C','D','E')
    or v_rule.geographic_scope<>'metropole' then
   raise exception 'Révision IRL bloquée : clause absente, bail mobilité, DPE ou région non éligible' using errcode='22023';end if;
 if v_lease.start_date is null or
    v_rule.revision_due_on<(v_lease.start_date+interval '1 year')::date then
   raise exception 'Date de révision trop proche du début du bail' using errcode='22023';end if;
 if v_rule.revision_due_on>v_today or
    v_today>=(v_rule.revision_due_on+interval '1 year')::date then
   raise exception 'Date de révision future ou délai d’un an expiré' using errcode='22023';end if;
 if v_lease.monthly_rent is null or v_lease.monthly_rent<0 or
    (v_lease.end_date is not null and v_rule.revision_due_on>v_lease.end_date) then
   raise exception 'Loyer ou fin de bail non éligible' using errcode='22023';end if;
 if v_rule.target_year is null then
   raise exception 'Choisissez et confirmez l’année de l’indice cible dans la fiche IRL' using errcode='22023';end if;
 v_target_year:=v_rule.target_year;
 select * into v_proposal from public.rental_irl_proposals
  where lease_id=p_lease_id and revision_due_on=v_rule.revision_due_on for update;
 if found and v_proposal.status<>'draft' then
  raise exception 'Une proposition programmée, appliquée ou annulée est conservée sans modification' using errcode='55000';end if;
 select * into v_old from public.rental_irl_indices
    where year=v_target_year-1 and quarter=v_rule.reference_quarter and geographic_scope='metropole' for share;
 select * into v_new from public.rental_irl_indices
    where year=v_target_year and quarter=v_rule.reference_quarter and geographic_scope='metropole' for share;
 if v_old.value is null or v_new.value is null or v_old.published_on is null or v_new.published_on is null
   or v_old.published_on>least(v_today,v_rule.revision_due_on)
   or v_new.published_on>least(v_today,v_rule.revision_due_on)
   or v_new.published_on<=(v_rule.revision_due_on-interval '1 year')::date then
   raise exception 'Couple IRL exact absent, non publié à la date contractuelle ou trop ancien : vérifiez l’année choisie et complétez les indices INSEE dans Paramètres' using errcode='22023';end if;
 if exists(select 1 from public.rental_irl_applications a join public.rental_irl_proposals p on p.id=a.proposal_id
   where a.lease_id=p_lease_id and a.status in ('scheduled','applied')
    and (a.revision_due_on>(v_rule.revision_due_on-interval '1 year')::date
      or p.target_year*4+p.reference_quarter>=v_target_year*4+v_rule.reference_quarter)) then
   raise exception 'Une révision existe déjà pour ce cycle ou cet indice : choisissez le prochain cycle annuel' using errcode='55000';end if;
 v_proposed:=round(v_lease.monthly_rent*v_new.value/v_old.value,2);
 if v_proposal.id is null then
  insert into public.rental_irl_proposals(
   lease_id,revision_due_on,prepared_on,prepared_by,reference_quarter,
   baseline_year,target_year,baseline_index,target_index,
   base_monthly_rent,proposed_monthly_rent)
  values(p_lease_id,v_rule.revision_due_on,v_today,btrim(p_prepared_by),v_rule.reference_quarter,
   v_target_year-1,v_target_year,v_old.value,v_new.value,v_lease.monthly_rent,v_proposed)
  returning * into v_proposal;
  v_created:=true;
 elsif row(v_proposal.reference_quarter,v_proposal.baseline_year,v_proposal.target_year,
   v_proposal.baseline_index,v_proposal.target_index,v_proposal.base_monthly_rent,v_proposal.proposed_monthly_rent)
   is distinct from row(v_rule.reference_quarter,v_target_year-1,v_target_year,
   v_old.value,v_new.value,v_lease.monthly_rent,v_proposed) then
  update public.rental_irl_proposals set
   draft_history=draft_history||jsonb_build_array(jsonb_build_object(
    'replaced_at',clock_timestamp(),'replaced_by',btrim(p_prepared_by),'snapshot',to_jsonb(v_proposal)-'draft_history')),
   draft_revision=draft_revision+1,prepared_on=v_today,prepared_by=btrim(p_prepared_by),
   reference_quarter=v_rule.reference_quarter,baseline_year=v_target_year-1,target_year=v_target_year,
   baseline_index=v_old.value,target_index=v_new.value,base_monthly_rent=v_lease.monthly_rent,
   proposed_monthly_rent=v_proposed,updated_at=now()
   where id=v_proposal.id and status='draft' returning * into v_proposal;
  v_refreshed:=true;
 end if;
 return jsonb_build_object(
  'ok',true,'created',v_created,'refreshed',v_refreshed,'draft_revision',v_proposal.draft_revision,'proposal_id',v_proposal.id,
  'base_rent',v_proposal.base_monthly_rent,'proposed_rent',v_proposal.proposed_monthly_rent,
  'quarter',v_proposal.reference_quarter,'baseline_year',v_proposal.baseline_year,
  'target_year',v_proposal.target_year,'baseline_index',v_proposal.baseline_index,
  'target_index',v_proposal.target_index,
  'revision_due_on',v_proposal.revision_due_on,
  'status',v_proposal.status,'applies_to_lease',false,'sends_mail',false
 );
end $function$;



drop function public.marne_schedule_irl_application(uuid,date,text,text);

CREATE OR REPLACE FUNCTION public.marne_schedule_irl_application(p_proposal_id uuid, p_notice_sent_on date, p_notice_method text, p_approved_by text, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
 v_today date := (now() at time zone 'Europe/Paris')::date;
 v_effective date := (date_trunc('month',(now() at time zone 'Europe/Paris'))+interval '1 month')::date;
 v_proposal public.rental_irl_proposals%rowtype;
 v_lease public.rental_leases%rowtype;
 v_rule public.rental_irl_lease_rules%rowtype;
 v_index public.rental_irl_indices%rowtype;
 v_baseline public.rental_irl_indices%rowtype;
 v_inst record;
 v_id uuid;
 v_updated integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 if p_expected_revision is null or p_expected_revision<1 then
   raise exception 'Version de simulation obligatoire : rouvrez la notification' using errcode='22023';end if;
 if p_proposal_id is null or p_notice_method not in ('registered_post','hand_signed')
   or p_notice_sent_on is null or p_notice_sent_on>v_today
   or nullif(btrim(coalesce(p_approved_by,'')),'') is null
 then raise exception 'Attestation de notification datée et méthode vérifiée requises' using errcode='22023'; end if;

 select * into v_proposal from public.rental_irl_proposals where id=p_proposal_id for update;
 if not found or v_proposal.status<>'draft' then
   raise exception 'Proposition IRL absente ou déjà programmée' using errcode='22023';end if;
 if v_proposal.draft_revision is distinct from p_expected_revision then
   raise exception 'Simulation recalculée depuis votre affichage : rouvrez la notification et vérifiez les montants' using errcode='55000';end if;

 select * into v_lease from public.rental_leases where id=v_proposal.lease_id for no key update;
 select * into v_rule from public.rental_irl_lease_rules where lease_id=v_proposal.lease_id for update;
 if v_lease.id is null or v_lease.status<>'active' or v_lease.lease_kind<>'residential'
   or v_lease.verified_at is null or v_rule.lease_id is null
   or not v_rule.has_revision_clause or v_rule.is_mobility_lease
   or v_rule.dpe_rating not in ('A','B','C','D','E')
   or v_rule.geographic_scope<>'metropole'
 then raise exception 'Bail ou clauses IRL non éligibles à une application' using errcode='22023';end if;

 if v_rule.revision_due_on<>v_proposal.revision_due_on
    or v_rule.reference_quarter<>v_proposal.reference_quarter
    or v_rule.target_year is distinct from v_proposal.target_year
    or v_proposal.baseline_year<>v_proposal.target_year-1
    or v_lease.monthly_rent<>v_proposal.base_monthly_rent
 then raise exception 'Bail modifié depuis la simulation : préparer une nouvelle proposition' using errcode='22023';end if;

 if p_notice_sent_on<v_rule.revision_due_on
    or p_notice_sent_on>=(v_rule.revision_due_on+interval '1 year')::date
    or v_effective < v_rule.revision_due_on
 then raise exception 'Notification hors du délai annuel ou date d’effet invalide' using errcode='22023';end if;

 if v_lease.end_date is not null
    and v_lease.end_date < (v_effective+interval '1 month - 1 day')::date
 then raise exception 'La révision nécessite un mois complet avant fin de bail' using errcode='22023';end if;

 select * into v_baseline from public.rental_irl_indices
 where year=v_proposal.baseline_year and quarter=v_proposal.reference_quarter and geographic_scope='metropole' for share;
 if v_baseline.value is null or v_baseline.value<>v_proposal.baseline_index
    or v_baseline.published_on is null or v_baseline.published_on>p_notice_sent_on
    or v_baseline.published_on>v_rule.revision_due_on then
   raise exception 'Indice de base annuel absent ou modifié : préparer une nouvelle simulation' using errcode='22023';end if;
 select * into v_index from public.rental_irl_indices
 where year=v_proposal.target_year
   and quarter=v_proposal.reference_quarter and geographic_scope='metropole' for share;
 if v_index.value is null or v_index.value<>v_proposal.target_index
    or v_index.published_on is null or v_index.published_on>p_notice_sent_on
    or v_index.published_on>v_rule.revision_due_on
    or v_index.published_on<=(v_rule.revision_due_on-interval '1 year')::date
 then raise exception 'Indice non officiellement publié avant la date contractuelle ou la notification' using errcode='22023';end if;

 if round(v_proposal.base_monthly_rent*v_proposal.target_index/v_proposal.baseline_index,2)
    <>v_proposal.proposed_monthly_rent
 then raise exception 'Calcul de proposition incohérent' using errcode='22023';end if;

 if exists(select 1 from public.rental_irl_applications a join public.rental_irl_proposals p on p.id=a.proposal_id
   where a.lease_id=v_proposal.lease_id and a.status='applied'
    and (a.revision_due_on>(v_rule.revision_due_on-interval '1 year')::date
      or p.target_year*4+p.reference_quarter>=v_proposal.target_year*4+v_proposal.reference_quarter)) then
   raise exception 'Une révision existe déjà pour ce cycle ou cet indice' using errcode='55000';end if;
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

revoke all on function public.marne_schedule_irl_application(uuid,date,text,text,integer) from public,anon,authenticated;
grant execute on function public.marne_schedule_irl_application(uuid,date,text,text,integer) to service_role;


create or replace function public.marne_register_irl_index(p_year integer,p_quarter integer,p_value numeric,p_published_on date,
 p_source_url text,p_by text,p_confirmed boolean)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_item public.rental_irl_indices%rowtype;
 v_created boolean:=false;
 v_quarter_end date;
begin
 if p_confirmed is distinct from true or p_year is null or p_year not between 2000 and 2100
  or p_quarter is null or p_quarter not between 1 and 4 or p_value is null or p_value<=0 or p_value>99999.99
  or p_value<>round(p_value,2) or p_published_on is null or p_published_on>(now() at time zone 'Europe/Paris')::date
  or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
  or coalesce(p_source_url,'') !~ '^https://www[.]insee[.]fr/fr/statistiques/[0-9]+$' then
  raise exception 'Année, trimestre, valeur, date INSEE, source officielle et confirmation obligatoires' using errcode='22023';end if;
 v_quarter_end:=(make_date(p_year,p_quarter*3,1)+interval '1 month - 1 day')::date;
 if p_published_on<=v_quarter_end then
  raise exception 'La publication doit être postérieure à la fin du trimestre concerné' using errcode='22023';end if;
 insert into public.rental_irl_indices(year,quarter,geographic_scope,value,published_on,source_url,registered_at,registered_by)
 values(p_year,p_quarter,'metropole',p_value,p_published_on,p_source_url,now(),btrim(p_by))
 on conflict(year,quarter,geographic_scope) do nothing returning * into v_item;
 if found then v_created:=true;
 else
  select * into v_item from public.rental_irl_indices where year=p_year and quarter=p_quarter and geographic_scope='metropole';
  if v_item.value is distinct from p_value or v_item.published_on is distinct from p_published_on then
   raise exception 'Cet indice existe avec une valeur ou date différente ; aucune donnée existante ne sera remplacée' using errcode='23505';end if;
 end if;
 return jsonb_build_object('ok',true,'item',to_jsonb(v_item),'already_exists',not v_created);
end;
$function$;
revoke all on function public.marne_register_irl_index(integer,integer,numeric,date,text,text,boolean) from public,anon,authenticated;
grant execute on function public.marne_register_irl_index(integer,integer,numeric,date,text,text,boolean) to service_role;
revoke all on function public.marne_irl_prepare_proposal(uuid,text) from public,anon,authenticated;
grant execute on function public.marne_irl_prepare_proposal(uuid,text) to service_role;


create or replace function public.marne_save_irl_rule(p_lease_id uuid,p_rule jsonb,p_by text)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
 v_lease public.rental_leases%rowtype;
 v_rule public.rental_irl_lease_rules%rowtype;
begin
 if p_lease_id is null or char_length(btrim(coalesce(p_by,''))) not between 1 and 180
  or jsonb_typeof(p_rule) is distinct from 'object' or octet_length(p_rule::text)>4096 then
  raise exception 'Règle IRL ou auteur invalide' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_rule) k where k not in
  ('has_revision_clause','dpe_rating','is_mobility_lease','geographic_scope','revision_due_on','reference_quarter','target_year')) then
  raise exception 'Champ IRL non modifiable' using errcode='22023';end if;
 if jsonb_typeof(p_rule->'has_revision_clause') is distinct from 'boolean'
  or jsonb_typeof(p_rule->'is_mobility_lease') is distinct from 'boolean'
  or coalesce(p_rule->>'dpe_rating','') not in ('A','B','C','D','E','F','G','unknown')
  or coalesce(p_rule->>'geographic_scope','') not in ('metropole','corse','outre_mer')
  or coalesce(p_rule->>'revision_due_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_rule->>'reference_quarter','') !~ '^[1-4]$'
  or coalesce(p_rule->>'target_year','') !~ '^[0-9]{4}$' then
  raise exception 'Complétez les clauses, la date, le trimestre et l’année cible de la règle IRL' using errcode='22023';end if;
 begin v_rule:=jsonb_populate_record(null::public.rental_irl_lease_rules,p_rule);
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Date IRL inexistante' using errcode='22023';end;
 if v_rule.target_year not between 2001 and 2100 then
  raise exception 'Année cible entre 2001 et 2100 requise' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('marne-lease-financial-transition',0));
 select * into v_lease from public.rental_leases where id=p_lease_id for no key update;
 if not found or v_lease.status<>'active' or v_lease.verified_at is null or v_lease.lease_kind<>'residential'
  or v_lease.start_date is null or v_rule.revision_due_on<(v_lease.start_date+interval '1 year')::date then
  raise exception 'Bail habitation actif vérifié et révision annuelle postérieure au début requis' using errcode='22023';end if;
 if exists(select 1 from public.rental_irl_proposals where lease_id=p_lease_id and status in ('scheduled','cancelled')) then
  raise exception 'Une proposition programmée ou annulée conserve ses règles : modification refusée' using errcode='55000';end if;
 if exists(select 1 from public.rental_irl_applications a join public.rental_irl_proposals p on p.id=a.proposal_id
  where a.lease_id=p_lease_id and a.status='applied'
   and (a.revision_due_on>(v_rule.revision_due_on-interval '1 year')::date
    or p.target_year*4+p.reference_quarter>=v_rule.target_year*4+v_rule.reference_quarter)) then
  raise exception 'Choisissez une nouvelle date annuelle et un indice postérieur à la révision appliquée' using errcode='55000';end if;
 insert into public.rental_irl_lease_rules(lease_id,has_revision_clause,dpe_rating,is_mobility_lease,geographic_scope,
  revision_due_on,reference_quarter,target_year,verified_by,verified_at,updated_at)
 values(p_lease_id,v_rule.has_revision_clause,v_rule.dpe_rating,v_rule.is_mobility_lease,v_rule.geographic_scope,
  v_rule.revision_due_on,v_rule.reference_quarter,v_rule.target_year,btrim(p_by),now(),now())
 on conflict(lease_id) do update set has_revision_clause=excluded.has_revision_clause,dpe_rating=excluded.dpe_rating,
  is_mobility_lease=excluded.is_mobility_lease,geographic_scope=excluded.geographic_scope,revision_due_on=excluded.revision_due_on,
  reference_quarter=excluded.reference_quarter,target_year=excluded.target_year,
  verified_by=excluded.verified_by,verified_at=excluded.verified_at,updated_at=excluded.updated_at
 returning * into v_rule;
 return jsonb_build_object('ok',true,'rule',to_jsonb(v_rule));
end;
$function$;
revoke all on function public.marne_save_irl_rule(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marne_save_irl_rule(uuid,jsonb,text) to service_role;


do $regression$
declare
 v_prefix text:='qa-irl-explicit-'||gen_random_uuid()::text;
 v_today date:=(now() at time zone 'Europe/Paris')::date;
 v_due date;
 v_year integer;
 v_unused integer;
 v_result jsonb;
 v_rule jsonb;
 v_property uuid;
 v_tenant uuid;
 v_lease uuid;
 v_proposal uuid;
 v_other_proposal uuid;
 v_old public.rental_irl_indices%rowtype;
 v_new public.rental_irl_indices%rowtype;
 v_snapshot jsonb;
 v_before jsonb;
 v_after jsonb;
 v_state text;
 v_sig text;
 v_checks integer:=0;
begin
 v_due:=make_date(extract(year from v_today)::integer,1,31);
 if v_due>v_today then v_due:=(v_due-interval '1 year')::date;end if;
 v_year:=extract(year from v_due)::integer-1;
 select jsonb_build_array((select count(*) from public.rental_properties),(select count(*) from public.rental_leases),
  (select count(*) from public.rental_irl_indices),(select count(*) from public.rental_irl_proposals),
  (select count(*) from public.rental_irl_applications),(select count(*) from public.rental_installments)) into v_before;
 begin
  select y into v_unused from generate_series(2001,2020) y where not exists(
   select 1 from public.rental_irl_indices where year in (y-1,y) and quarter=1) order by y limit 1;
  if v_unused is null then raise exception 'IRL test fixture years unavailable';end if;
  v_result:=public.marne_register_irl_index(v_unused,1,101.25,make_date(v_unused,4,15),
   'https://www.insee.fr/fr/statistiques/9999999','qa-register',true);
  v_snapshot:=v_result->'item';
  if v_result->>'already_exists'<>'false' or v_snapshot->>'registered_by'<>'qa-register'
   or v_snapshot->>'registered_at' is null then raise exception 'I01 explicit index registration audit';end if;v_checks:=v_checks+1;
  v_result:=public.marne_register_irl_index(v_unused,1,101.25,make_date(v_unused,4,15),
   'https://www.insee.fr/fr/statistiques/9999998','qa-repeat',true);
  if v_result->>'already_exists'<>'true' or v_result->'item' is distinct from v_snapshot then
   raise exception 'I02 registration idempotent without overwrite';end if;v_checks:=v_checks+1;
  begin perform public.marne_register_irl_index(v_unused,1,102,make_date(v_unused,4,15),
    'https://www.insee.fr/fr/statistiques/9999999','qa-divergent',true);
   raise exception 'I03 divergent index overwritten';exception when unique_violation then null;end;v_checks:=v_checks+1;
  begin perform public.marne_register_irl_index(v_unused,1,101.25,make_date(v_unused,4,15),
    'https://example.invalid/','qa-invalid-source',true);
   raise exception 'I04 untrusted index source accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_register_irl_index(v_unused,1,101.25,make_date(v_unused,4,15),
    'https://www.insee.fr/fr/statistiques/9999999','qa-no-consent',false);
   raise exception 'I05 index without confirmation';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_register_irl_index(v_unused,1,101.251,make_date(v_unused,4,15),
    'https://www.insee.fr/fr/statistiques/9999999','qa-precision',true);
   raise exception 'I06 index fractional cent accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_register_irl_index(v_unused,1,101.25,make_date(v_unused,3,31),
    'https://www.insee.fr/fr/statistiques/9999999','qa-date',true);
   raise exception 'I07 index published before quarter ended';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;

  if not exists(select 1 from public.rental_irl_indices where year=v_year-1 and quarter=4 and geographic_scope='metropole') then
   perform public.marne_register_irl_index(v_year-1,4,100,make_date(v_year,1,15),'https://www.insee.fr/fr/statistiques/9999999','qa-fixture',true);end if;
  if not exists(select 1 from public.rental_irl_indices where year=v_year and quarter=4 and geographic_scope='metropole') then
   perform public.marne_register_irl_index(v_year,4,102,make_date(v_year+1,1,15),'https://www.insee.fr/fr/statistiques/9999999','qa-fixture',true);end if;
  if not exists(select 1 from public.rental_irl_indices where year=v_year-1 and quarter=3 and geographic_scope='metropole') then
   perform public.marne_register_irl_index(v_year-1,3,100,make_date(v_year-1,10,15),'https://www.insee.fr/fr/statistiques/9999999','qa-fixture',true);end if;
  if not exists(select 1 from public.rental_irl_indices where year=v_year and quarter=3 and geographic_scope='metropole') then
   perform public.marne_register_irl_index(v_year,3,103,make_date(v_year,10,15),'https://www.insee.fr/fr/statistiques/9999999','qa-fixture',true);end if;
  select * into v_old from public.rental_irl_indices where year=v_year-1 and quarter=4 and geographic_scope='metropole';
  select * into v_new from public.rental_irl_indices where year=v_year and quarter=4 and geographic_scope='metropole';
  v_result:=public.marne_create_property(v_prefix,'Adresse QA');v_property:=(v_result->'property'->>'id')::uuid;v_tenant:=(v_result->'row'->>'id')::uuid;
  update public.rental_tenant_rows set data=data||'{"Locataire":"IRL explicite QA"}'::jsonb where id=v_tenant;
  v_result:=public.marne_prepare_lease(v_tenant,'qa-irl');v_lease:=(v_result->'lease'->>'id')::uuid;
  perform public.marne_save_lease(v_lease,jsonb_build_object('start_date',(v_due-interval '2 years')::date,
   'monthly_rent',800,'charges_amount',50,'due_day',5,'lease_kind','residential','issuer_name','QA','issuer_address','Adresse QA'),'qa-irl',true);
  v_rule:=jsonb_build_object('has_revision_clause',true,'dpe_rating','C','is_mobility_lease',false,
   'geographic_scope','metropole','revision_due_on',v_due,'reference_quarter',4,'target_year',v_year);
  v_result:=public.marne_save_irl_rule(v_lease,v_rule,'qa-rule');
  if (v_result->'rule'->>'target_year')::integer<>v_year or v_result->'rule'->>'verified_by'<>'qa-rule' then
   raise exception 'I08 rule target explicit and actor';end if;v_checks:=v_checks+1;
  begin perform public.marne_save_irl_rule(v_lease,v_rule-'target_year','qa-rule');
   raise exception 'I09 missing target accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  update public.rental_irl_lease_rules set target_year=null where lease_id=v_lease;
  begin perform public.marne_irl_prepare_proposal(v_lease,'qa-no-target');
   raise exception 'I10 legacy rule target invented';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  perform public.marne_save_irl_rule(v_lease,v_rule||jsonb_build_object('target_year',v_unused,'reference_quarter',1),'qa-missing-base');
  begin perform public.marne_irl_prepare_proposal(v_lease,'qa-missing-base');
   raise exception 'I11 missing exact baseline substituted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  perform public.marne_register_irl_index(v_unused-1,1,100,make_date(v_unused-1,4,15),
   'https://www.insee.fr/fr/statistiques/9999999','qa-old-base',true);
  begin perform public.marne_irl_prepare_proposal(v_lease,'qa-old-pair');
   raise exception 'I12 arbitrarily old target accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  perform public.marne_save_irl_rule(v_lease,v_rule||jsonb_build_object('revision_due_on',v_new.published_on-1),'qa-not-yet-published');
  begin perform public.marne_irl_prepare_proposal(v_lease,'qa-not-yet-published');
   raise exception 'I13 target after contractual date accepted';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  perform public.marne_save_irl_rule(v_lease,v_rule,'qa-jan-t4');
  v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-jan-t4');v_proposal:=(v_result->>'proposal_id')::uuid;
  if (v_result->>'target_year')::integer<>v_year or (v_result->>'baseline_year')::integer<>v_year-1
   or (v_result->>'quarter')::integer<>4 or (v_result->>'proposed_rent')::numeric<>round(800*v_new.value/v_old.value,2)
   or (v_result->>'draft_revision')::integer<>1 or v_result->>'created'<>'true' then
   raise exception 'I14 January T4 uses explicit previous year pair';end if;v_checks:=v_checks+1;
  if (select monthly_rent from public.rental_leases where id=v_lease)<>800
   or exists(select 1 from public.rental_installments where lease_id=v_lease and rent_amount<>800)
   or exists(select 1 from public.rental_irl_applications where lease_id=v_lease) then
   raise exception 'I15 proposal no financial application';end if;v_checks:=v_checks+1;
  perform public.marne_save_irl_rule(v_lease,v_rule||'{"reference_quarter":3}'::jsonb,'qa-correct-quarter');
  v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-refresh');
  if (v_result->>'proposal_id')::uuid<>v_proposal or v_result->>'refreshed'<>'true' or (v_result->>'draft_revision')::integer<>2
   or (select jsonb_array_length(draft_history) from public.rental_irl_proposals where id=v_proposal)<>1
   or (select draft_history->0->'snapshot'->>'reference_quarter' from public.rental_irl_proposals where id=v_proposal)<>'4' then
   raise exception 'I16 draft refreshed and original snapshot archived';end if;v_checks:=v_checks+1;
  select to_jsonb(p) into v_snapshot from public.rental_irl_proposals p where id=v_proposal;
  v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-no-change');
  if v_result->>'refreshed'<>'false' or (select to_jsonb(p) from public.rental_irl_proposals p where id=v_proposal) is distinct from v_snapshot then
   raise exception 'I17 unchanged recalculation idempotent';end if;v_checks:=v_checks+1;
  foreach v_state in array array['scheduled','applied','cancelled'] loop
   update public.rental_irl_proposals set status=v_state where id=v_proposal;
   select to_jsonb(p) into v_snapshot from public.rental_irl_proposals p where id=v_proposal;
   begin perform public.marne_irl_prepare_proposal(v_lease,'qa-history');
    raise exception 'I18 historical proposal recalculated';exception when object_not_in_prerequisite_state then null;end;
   if (select to_jsonb(p) from public.rental_irl_proposals p where id=v_proposal) is distinct from v_snapshot then
    raise exception 'I18 historical snapshot overwritten';end if;v_checks:=v_checks+1;
   update public.rental_irl_proposals set status='draft' where id=v_proposal;
  end loop;
  select to_jsonb(p) into v_snapshot from public.rental_irl_proposals p where id=v_proposal;
  perform public.marne_save_irl_rule(v_lease,v_rule||jsonb_build_object('revision_due_on',v_due-1,'reference_quarter',3),'qa-date-correction');
  v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-date-correction');v_other_proposal:=(v_result->>'proposal_id')::uuid;
  if v_other_proposal=v_proposal or v_result->>'created'<>'true'
   or (select to_jsonb(p) from public.rental_irl_proposals p where id=v_proposal) is distinct from v_snapshot then
   raise exception 'I19 changed date keeps previous draft';end if;v_checks:=v_checks+1;
  perform public.marne_save_irl_rule(v_lease,v_rule,'qa-restore-date');
  v_result:=public.marne_irl_prepare_proposal(v_lease,'qa-return-to-draft');
  if (v_result->>'proposal_id')::uuid<>v_proposal or (v_result->>'draft_revision')::integer<>3 then
   raise exception 'I20 previous date draft can be refreshed';end if;v_checks:=v_checks+1;
  begin perform public.marne_schedule_irl_application(v_other_proposal,v_today,'hand_signed','qa-stale-rule',1);
   raise exception 'I21 stale rule proposal scheduled';exception when invalid_parameter_value then null;end;v_checks:=v_checks+1;
  begin perform public.marne_schedule_irl_application(v_proposal,v_today,'hand_signed','qa-stale-version',2);
   raise exception 'I22 unseen refreshed proposal scheduled';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  if to_regprocedure('public.marne_schedule_irl_application(uuid,date,text,text)') is not null then
   raise exception 'I23 old schedule overload bypass remains';end if;v_checks:=v_checks+1;
  v_result:=public.marne_schedule_irl_application(v_proposal,v_today,'hand_signed','qa-current-version',3);
  if v_result->>'ok'<>'true' or (select status from public.rental_irl_proposals where id=v_proposal)<>'scheduled' then
   raise exception 'I24 reviewed current version scheduled';end if;v_checks:=v_checks+1;
  begin perform public.marne_save_irl_rule(v_lease,v_rule||'{"reference_quarter":3}'::jsonb,'qa-after-schedule');
   raise exception 'I25 rule changed after scheduling';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  if (select reference_quarter from public.rental_irl_lease_rules where lease_id=v_lease)<>4 then
   raise exception 'I26 failed rule edit atomic';end if;v_checks:=v_checks+1;
  update public.rental_irl_applications set status='applied',activated_at=now() where proposal_id=v_proposal;
  update public.rental_irl_proposals set status='applied' where id=v_proposal;
  begin perform public.marne_save_irl_rule(v_lease,v_rule||jsonb_build_object('revision_due_on',(v_due+interval '1 year')::date),'qa-reused-target');
   raise exception 'I27 next cycle reused old target';exception when object_not_in_prerequisite_state then null;end;v_checks:=v_checks+1;
  v_result:=public.marne_save_irl_rule(v_lease,v_rule||jsonb_build_object('revision_due_on',(v_due+interval '1 year')::date,'target_year',v_year+1),'qa-next-cycle');
  if (v_result->'rule'->>'target_year')::integer<>v_year+1 then raise exception 'I28 new annual cycle remains editable';end if;v_checks:=v_checks+1;

  foreach v_sig in array array['public.marne_register_irl_index(integer,integer,numeric,date,text,text,boolean)',
   'public.marne_save_irl_rule(uuid,jsonb,text)','public.marne_irl_prepare_proposal(uuid,text)',
   'public.marne_schedule_irl_application(uuid,date,text,text,integer)'] loop
   if has_function_privilege('anon',v_sig,'EXECUTE') or has_function_privilege('authenticated',v_sig,'EXECUTE')
    or not has_function_privilege('service_role',v_sig,'EXECUTE')
    or (select prosecdef from pg_proc where oid=v_sig::regprocedure) then raise exception 'I29 IRL ACL/invoker';end if;v_checks:=v_checks+1;
  end loop;
  raise exception using errcode='ZL022',message='Rollback IRL fixtures';
 exception when sqlstate 'ZL022' then null;
 end;
 select jsonb_build_array((select count(*) from public.rental_properties),(select count(*) from public.rental_leases),
  (select count(*) from public.rental_irl_indices),(select count(*) from public.rental_irl_proposals),
  (select count(*) from public.rental_irl_applications),(select count(*) from public.rental_installments)) into v_after;
 if v_before is distinct from v_after or exists(select 1 from public.rental_properties where name=v_prefix) then
  raise exception 'I30 IRL fixtures escaped rollback';end if;v_checks:=v_checks+1;
 raise notice 'IRL explicit-year regression: % assertions passed; all fixtures rolled back',v_checks;
end;
$regression$;

