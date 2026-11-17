-- Azure invoice OCR: add a second real, independently attributed source.
-- NO stock writes. Existing OCR.space finalizer remains unchanged.
alter table public.secretariat_ocr_scan_results
  drop constraint secretariat_ocr_scan_results_provider_check;
alter table public.secretariat_ocr_scan_results
  add constraint secretariat_ocr_scan_results_provider_check
    check (provider in ('ocrspace','azure_invoice'));

alter table public.secretariat_ocr_scan_results
  add column if not exists structured_result jsonb;

-- Shared invoice lock and 3-read cap. A provider's monthly quota is reserved atomically.
create or replace function public.secretariat_ocr_claim(
 p_invoice_id uuid,
 p_provider text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_invoice public.secretariat_invoice_queue%rowtype;
 v_config public.secretariat_ocr_connectors%rowtype;
 v_used integer;
 v_month date := date_trunc('month',now())::date;
 v_attempt integer;
begin
 if p_provider not in ('ocrspace','azure_invoice') or p_invoice_id is null then
  return jsonb_build_object('claimed',false,'reason','unsupported_provider');
 end if;
 select * into v_invoice from public.secretariat_invoice_queue where id=p_invoice_id for update;
 if not found or v_invoice.state <> 'todo' then
  return jsonb_build_object('claimed',false,'reason','invoice_unavailable');
 end if;
 if p_provider='ocrspace' and v_invoice.file_bytes > 1000000 then
  return jsonb_build_object('claimed',false,'reason','free_pdf_size_limit');
 end if;
 if p_provider='azure_invoice' and v_invoice.file_bytes > 4000000 then
  return jsonb_build_object('claimed',false,'reason','free_pdf_size_limit');
 end if;
 if v_invoice.ocr_attempts >= 3 then
  return jsonb_build_object('claimed',false,'reason','maximum_attempts');
 end if;
 if v_invoice.ocr_status='processing' and
    coalesce(v_invoice.ocr_started_at,now()) >= now()-interval '5 minutes' then
  return jsonb_build_object('claimed',false,'reason','already_processing');
 end if;
 select * into v_config from public.secretariat_ocr_connectors where provider=p_provider;
 if not found or v_config.enabled is not true or
   v_config.secret_id is null or v_config.consent_at is null or
   (p_provider='azure_invoice' and v_config.endpoint='') then
  return jsonb_build_object('claimed',false,'reason','provider_not_configured');
 end if;
 insert into public.secretariat_ocr_provider_usage(provider,month_date,requests)
 values(p_provider,v_month,1)
 on conflict(provider,month_date)
 do update set requests=public.secretariat_ocr_provider_usage.requests+1
   where public.secretariat_ocr_provider_usage.requests < v_config.monthly_request_cap
 returning requests into v_used;
 if v_used is null then
  return jsonb_build_object('claimed',false,'reason','monthly_limit_reached');
 end if;
 v_attempt := v_invoice.ocr_attempts+1;
 update public.secretariat_invoice_queue
 set ocr_attempts=v_attempt,ocr_status='processing',ocr_started_at=now(),updated_at=now()
 where id=p_invoice_id;
 return jsonb_build_object('claimed',true,'attempt',v_attempt,
   'engine',case when p_provider='azure_invoice' then 1
        else case v_attempt when 1 then 2 when 2 then 3 else 1 end end,
   'storage_path',v_invoice.storage_path,'file_name',v_invoice.file_name,
   'file_hash',v_invoice.file_hash,'endpoint',v_config.endpoint);
end;
$$;
revoke all on function public.secretariat_ocr_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.secretariat_ocr_claim(uuid,text) to service_role;

-- Azure-only finalizer with source identifier and safe structured evidence.
create or replace function public.secretariat_ocr_finish_azure(
 p_invoice_id uuid,
 p_attempt integer,
 p_status text,
 p_ocr_text text,
 p_page_count integer,
 p_error_code text,
 p_structured_result jsonb
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_rows integer;
begin
 if p_attempt not between 1 and 3 or
    p_status not in ('review','failed') or
    coalesce(char_length(p_ocr_text),0)>200000 or
    p_page_count not between 0 and 2 or
    coalesce(octet_length(p_structured_result::text),0)>300000 or
    (p_status='failed' and (coalesce(p_ocr_text,'')<>'' or p_structured_result is not null)) then
  raise exception 'Invalid Azure OCR completion';
 end if;
 update public.secretariat_invoice_queue
 set ocr_status=p_status,ocr_finished_at=now(),updated_at=now()
 where id=p_invoice_id and ocr_attempts=p_attempt
   and ocr_status='processing' and state='todo';
 get diagnostics v_rows = row_count;
 if v_rows<>1 then return false; end if;
 insert into public.secretariat_ocr_scan_results
 (invoice_id,provider,attempt,engine,status,ocr_text,page_count,error_code,structured_result)
 values(p_invoice_id,'azure_invoice',p_attempt,1,p_status,
   coalesce(p_ocr_text,''),p_page_count,left(p_error_code,90),p_structured_result);
 return true;
end;
$$;
revoke all on function public.secretariat_ocr_finish_azure(uuid,integer,text,text,integer,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.secretariat_ocr_finish_azure(uuid,integer,text,text,integer,text,jsonb)
 to service_role;