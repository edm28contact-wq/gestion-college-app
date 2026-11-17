-- OCR.space scanning: ordered attempts, quota reservation, and private evidence.
-- This schema never performs stock writes or automatic product approval.
alter table public.secretariat_invoice_queue
 add column if not exists ocr_started_at timestamptz,
 add column if not exists ocr_finished_at timestamptz;

create table if not exists public.secretariat_ocr_scan_results (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.secretariat_invoice_queue(id) on delete restrict,
 provider text not null check(provider in ('ocrspace')),
 attempt smallint not null check(attempt between 1 and 3),
 engine smallint not null check(engine between 1 and 3),
 status text not null check(status in ('review','failed')),
 ocr_text text not null default '' check(char_length(ocr_text)<=200000),
 page_count smallint not null default 0 check(page_count between 0 and 3),
 error_code text check(error_code is null or char_length(error_code)<=90),
 created_at timestamptz not null default now(),
 unique(invoice_id,attempt)
);
alter table public.secretariat_ocr_scan_results enable row level security;
revoke all on public.secretariat_ocr_scan_results from public,anon,authenticated;
grant select,insert on public.secretariat_ocr_scan_results to service_role;
create index if not exists secretariat_ocr_scan_results_invoice_idx
 on public.secretariat_ocr_scan_results(invoice_id,attempt desc);

-- Explicit server-side claim. One request quota is reserved before transmitting a PDF.
-- Concurrency: a locked invoice row + atomic provider quota UPSERT prevent double scans.
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
 if p_provider <> 'ocrspace' or p_invoice_id is null then
  return jsonb_build_object('claimed',false,'reason','unsupported_provider');
 end if;
 select * into v_invoice from public.secretariat_invoice_queue where id=p_invoice_id for update;
 if not found or v_invoice.state <> 'todo' then
  return jsonb_build_object('claimed',false,'reason','invoice_unavailable');
 end if;
 if v_invoice.file_bytes > 1000000 then
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
   v_config.secret_id is null or v_config.consent_at is null then
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
   'engine',case v_attempt when 1 then 2 when 2 then 3 else 1 end,
   'storage_path',v_invoice.storage_path,'file_name',v_invoice.file_name,
   'file_hash',v_invoice.file_hash);
end;
$$;
revoke all on function public.secretariat_ocr_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.secretariat_ocr_claim(uuid,text) to service_role;

-- Finish only the claimed attempt, so a late response cannot replace a newer reading.
create or replace function public.secretariat_ocr_finish(
 p_invoice_id uuid,
 p_attempt integer,
 p_engine integer,
 p_status text,
 p_ocr_text text,
 p_page_count integer,
 p_error_code text default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
 v_rows integer;
begin
 if p_attempt not between 1 and 3 or p_engine not between 1 and 3 or
    p_status not in ('review','failed') or
    coalesce(char_length(p_ocr_text),0)>200000 or
    p_page_count not between 0 and 3 then
   raise exception 'Invalid OCR completion';
 end if;
 update public.secretariat_invoice_queue
 set ocr_status=p_status,ocr_finished_at=now(),updated_at=now()
 where id=p_invoice_id and ocr_attempts=p_attempt and ocr_status='processing' and state='todo';
 get diagnostics v_rows = row_count;
 if v_rows<>1 then
  return false;
 end if;
 insert into public.secretariat_ocr_scan_results
 (invoice_id,provider,attempt,engine,status,ocr_text,page_count,error_code)
 values(p_invoice_id,'ocrspace',p_attempt,p_engine,p_status,
   coalesce(p_ocr_text,''),p_page_count,left(p_error_code,90));
 return true;
end;
$$;
revoke all on function public.secretariat_ocr_finish(uuid,integer,integer,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.secretariat_ocr_finish(uuid,integer,integer,text,text,integer,text) to service_role;
