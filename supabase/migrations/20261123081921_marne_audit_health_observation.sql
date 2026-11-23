CREATE OR REPLACE FUNCTION public.marne_run_health_check(p_trigger text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_issues jsonb:='[]'::jsonb;
 v_metrics jsonb;
 v_status text;
 v_critical integer:=0;
 v_warning integer:=0;
 v_count integer;
 v_properties integer;
 v_leases integer;
 v_verified integer;
 v_pending integer;
 v_expected timestamptz;
 v_schedule text;
 v_observed integer:=0;
 v_utc timestamp;
 v_expected_utc timestamp;
 v_job record;
 v_last record;
 v_id uuid;
 v_now timestamptz:=now();
begin
 if p_trigger not in ('manual','daily') or p_trigger is null then
   raise exception 'Type de contrôle invalide' using errcode='22023';
 end if;

 select count(*) into v_properties from public.rental_properties where is_example=false;
 select count(*),count(*) filter(where status='active' and verified_at is not null),
   count(*) filter(where status='draft')
 into v_leases,v_verified,v_pending from public.rental_leases;
 v_metrics:=jsonb_build_object('properties',v_properties,'leases',v_leases,
   'verified_leases',v_verified,'draft_leases',v_pending,
   'bank_pending_credits',(select count(*) from public.rental_bank_lines where status='pending' and amount>0),
   'documents',(select count(*) from public.rental_documents),
   'mail_verified',(select count(*) from public.rental_mail_sync_state where imap_verified_at is not null),
   'cron_jobs',(select count(*) from cron.job where jobname like 'marne-%' and active=true));

 select count(*) into v_count from (
   select property_id from public.rental_leases where status='active'
   group by property_id having count(*)>1
 ) x;
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','DUPLICATE_ACTIVE_LEASE','severity','critical','count',v_count,
     'message','Plusieurs baux actifs pour un même logement'));
 end if;

 select count(*) into v_count from (
   select i.id,i.total_due,coalesce(sum(a.amount),0) as allocated
   from public.rental_installments i
   left join public.rental_payment_allocations a on a.installment_id=i.id
   left join public.rental_payments p on p.id=a.payment_id
   group by i.id,i.total_due
   having coalesce(sum(a.amount) filter(where p.status='recorded'),0)>i.total_due+0.005
 ) x;
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','INSTALLMENT_OVERPAID','severity','critical','count',v_count,
     'message','Sommes affectées supérieures aux échéances'));
 end if;

 select count(*) into v_count from (
   select p.id,p.amount,coalesce(sum(a.amount),0) as used
   from public.rental_payments p
   left join public.rental_payment_allocations a on a.payment_id=p.id
   where p.status='recorded'
   group by p.id,p.amount
   having coalesce(sum(a.amount),0)>p.amount+0.005
 ) x;
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','PAYMENT_OVERALLOCATED','severity','critical','count',v_count,
     'message','Paiements affectés au-delà du montant encaissé'));
 end if;

 select count(*) into v_count
 from public.rental_bank_lines b
 left join public.rental_payments p on p.id=b.matched_payment_id
 where b.status='matched' and (p.id is null or p.status<>'recorded');
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','BANK_PAYMENT_INVALID','severity','critical','count',v_count,
     'message','Rapprochements liés à un paiement annulé ou absent'));
 end if;

 select count(*) into v_count from public.rental_documents d
 left join storage.objects o on o.bucket_id='marne-invest-private-docs' and o.name=d.object_path
 where o.id is null;
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','DOCUMENT_MISSING','severity','critical','count',v_count,
     'message','Documents archivés dont le fichier privé est introuvable'));
 end if;

 select count(*) into v_count from public.rental_irl_applications
 where status='scheduled' and effective_on<(v_now at time zone 'Europe/Paris')::date;
 if v_count>0 then
   v_critical:=v_critical+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','IRL_ACTIVATION_DELAY','severity','critical','count',v_count,
     'message','Révisions IRL approuvées mais non activées après leur date d’effet'));
 end if;

 select count(*) into v_count from public.rental_bank_lines
 where status='pending' and amount>0 and booking_date<(v_now at time zone 'Europe/Paris')::date-14;
 if v_count>0 then
   v_warning:=v_warning+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','BANK_BACKLOG','severity','warning','count',v_count,
     'message','Crédits bancaires de plus de 14 jours en attente de rapprochement'));
 end if;

 select count(*) into v_count from public.rental_mail_sync_state
 where imap_verified_at is not null and (last_sync_at is null or last_sync_at<v_now-interval '24 hours');
 if v_count>0 then
   v_warning:=v_warning+1;
   v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
     'code','MAIL_SYNC_STALE','severity','warning','count',v_count,
     'message','Messagerie vérifiée mais réception non actualisée depuis 24 heures'));
 end if;

 for v_job in
  select name,expected_schedule from (values
   ('marne-monthly-installments-daily','10 5 * * *'),
   ('marne-reminders-drafts-daily','20 7 * * *'),
   ('marne-imap-inbox-hourly','0 6-21 * * *'),
   ('marne-irl-official-weekly','20 7 * * 1'),
   ('marne-health-audit-daily','5 9 * * *')
  ) x(name,expected_schedule)
 loop
   if not exists(select 1 from cron.job where jobname=v_job.name and active=true) then
     v_critical:=v_critical+1;
     v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
      'code','CRON_NOT_ACTIVE','severity','critical','count',1,
      'message','Tâche planifiée absente ou désactivée : '||v_job.name));
   else
     select schedule into v_schedule from cron.job where jobname=v_job.name and active=true;
     select j.status,j.start_time into v_last
     from cron.job_run_details j
     join cron.job c on c.jobid=j.jobid
     where c.jobname=v_job.name
     order by j.start_time desc limit 1;
     if found then v_observed:=v_observed+1;end if;
     if v_last.start_time is null then
       v_warning:=v_warning+1;
       v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'code','CRON_NEVER_RUN','severity','warning','count',1,
        'message','Aucune exécution SQL encore observée ; premier passage à vérifier : '||v_job.name));
     elsif v_last.status='failed' then
       v_warning:=v_warning+1;
       v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'code','CRON_LAST_FAILURE','severity','warning','count',1,
        'message','Dernière exécution SQL en échec : '||v_job.name));
     elsif v_last.status<>'succeeded' and v_last.start_time<v_now-interval '10 minutes' then
       v_warning:=v_warning+1;
       v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'code','CRON_STALLED','severity','warning','count',1,
        'message','Exécution SQL non terminée après 10 minutes : '||v_job.name));
     else
       v_utc:=(v_now-interval '15 minutes') at time zone 'UTC';
       v_expected_utc:=case v_job.name
         when 'marne-monthly-installments-daily' then date_trunc('day',v_utc)+interval '5 hours 10 minutes'
         when 'marne-reminders-drafts-daily' then date_trunc('day',v_utc)+interval '7 hours 20 minutes'
         when 'marne-health-audit-daily' then date_trunc('day',v_utc)+interval '9 hours 5 minutes'
         when 'marne-irl-official-weekly' then date_trunc('week',v_utc)+interval '7 hours 20 minutes'
         else date_trunc('hour',v_utc) end;
       if v_job.name='marne-imap-inbox-hourly' then
         if extract(hour from v_expected_utc)<6 then
           v_expected_utc:=date_trunc('day',v_expected_utc)-interval '3 hours';
         elsif extract(hour from v_expected_utc)>21 then
           v_expected_utc:=date_trunc('day',v_expected_utc)+interval '21 hours';
         end if;
       elsif v_expected_utc>v_utc then
         v_expected_utc:=v_expected_utc-case when v_job.name='marne-irl-official-weekly'
           then interval '7 days' else interval '1 day' end;
       end if;
       v_expected:=v_expected_utc at time zone 'UTC';
       if v_schedule=v_job.expected_schedule and v_last.start_time<v_expected then
         v_warning:=v_warning+1;
         v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
          'code','CRON_STALE','severity','warning','count',1,
          'message','Passage SQL attendu non observé après 15 minutes de marge : '||v_job.name));
       end if;
     end if;
     if v_schedule<>v_job.expected_schedule then
       v_warning:=v_warning+1;
       v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'code','CRON_SCHEDULE_CHANGED','severity','warning','count',1,
        'message','Horaire SQL différent de la planification attendue : '||v_job.name));
     end if;
   end if;
 end loop;

 v_metrics:=v_metrics||jsonb_build_object('cron_jobs_observed',v_observed,
   'cron_evidence','SQL scheduler only; HTTP and mail delivery require their own verification');
 v_status:=case when v_critical>0 then 'anomaly'
   when v_warning>0 then 'attention' else 'ok' end;

 insert into public.rental_health_runs
  (trigger_type,status,critical_count,warning_count,checks,metrics)
 values(p_trigger,v_status,v_critical,v_warning,v_issues,v_metrics)
 returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'status',v_status,
    'critical_count',v_critical,'warning_count',v_warning,
    'checks',v_issues,'metrics',v_metrics,'checked_at',v_now);
end;
$function$;


do $health_audit$
declare
 v_report jsonb; v_expected integer; v_observed integer; v_reports integer;
 v_properties integer; v_leases integer; v_payments integer; v_lines integer; v_import jsonb;
begin
 begin
 select count(*) into v_reports from public.rental_health_runs;
 select count(*) into v_properties from public.rental_properties;
 select count(*) into v_leases from public.rental_leases;
 select count(*) into v_payments from public.rental_payments;
 select count(*) into v_lines from public.rental_bank_lines;
 select count(*) into v_observed from cron.job c
 where c.jobname in ('marne-monthly-installments-daily','marne-reminders-drafts-daily',
 'marne-imap-inbox-hourly','marne-irl-official-weekly','marne-health-audit-daily')
 and c.active and exists(select 1 from cron.job_run_details d where d.jobid=c.jobid);
 select count(*) into v_expected from cron.job c
 where c.jobname in ('marne-monthly-installments-daily','marne-reminders-drafts-daily',
 'marne-imap-inbox-hourly','marne-irl-official-weekly','marne-health-audit-daily')
 and c.active and not exists(select 1 from cron.job_run_details d where d.jobid=c.jobid);
 v_report:=public.marne_run_health_check('manual');
 if v_report->>'ok' is distinct from 'true' or jsonb_typeof(v_report->'checks') is distinct from 'array'
 or jsonb_typeof(v_report->'metrics') is distinct from 'object'
 then raise exception 'QA_HEALTH_RESULT_SHAPE';end if;
 if (v_report#>>'{metrics,cron_jobs_observed}')::integer is distinct from v_observed
 then raise exception 'QA_HEALTH_CRON_OBSERVED';end if;
 if (select count(*) from jsonb_array_elements(v_report->'checks') c where c->>'code'='CRON_NEVER_RUN')<>v_expected
 then raise exception 'QA_HEALTH_NEVER_RUN';end if;
 if v_expected>0 and v_report->>'status'='ok'
 then raise exception 'QA_HEALTH_NO_FALSE_SUCCESS';end if;
 if (select count(*) from public.rental_health_runs)<>v_reports+1
 then raise exception 'QA_HEALTH_REPORT_PERSISTENCE';end if;
 if (select count(*) from public.rental_properties)<>v_properties
 or (select count(*) from public.rental_leases)<>v_leases
 or (select count(*) from public.rental_payments)<>v_payments
 or (select count(*) from public.rental_bank_lines)<>v_lines
 then raise exception 'QA_HEALTH_CHANGED_BUSINESS_ROWS';end if;
 v_import:=public.marne_bank_import_rows('QA HEALTH AUDIT','audit.csv',
 encode(sha256(gen_random_uuid()::text::bytea),'hex'),
 jsonb_build_array(jsonb_build_object('booking_date',((now() at time zone 'Europe/Paris')::date-20)::text,
 'amount','1.00','description','QA HEALTH BACKLOG')),'qa-audit');
 v_report:=public.marne_run_health_check('manual');
 if not exists(select 1 from jsonb_array_elements(v_report->'checks') c
 where c->>'code'='BANK_BACKLOG' and (c->>'count')::integer>=1)
 or v_report->>'status'='ok' then raise exception 'QA_HEALTH_BACKLOG_NOT_DETECTED';end if;
 raise sqlstate 'ZQ002' using message='QA health assertions passed; discard fixtures';
 exception when sqlstate 'ZQ002' then null;
 end;
end $health_audit$;

