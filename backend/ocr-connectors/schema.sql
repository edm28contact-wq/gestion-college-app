-- Multi-provider OCR connector settings. All external transmission is opt-in.
-- Credentials are held only in Supabase Vault; never in the browser or logs.
create table if not exists public.secretariat_ocr_connectors (
 provider text primary key check (provider in ('azure_invoice','ocrspace')),
 secret_id uuid,
 endpoint text not null default '',
 enabled boolean not null default false,
 consent_at timestamptz,
 monthly_request_cap integer not null default 25 check (monthly_request_cap between 1 and 100),
 updated_by text not null default 'system',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint consent_required_when_enabled check (not enabled or (secret_id is not null and consent_at is not null)),
 constraint azure_endpoint_required_when_enabled check (not enabled or provider <> 'azure_invoice' or endpoint <> '')
);
alter table public.secretariat_ocr_connectors enable row level security;
revoke all on public.secretariat_ocr_connectors from public,anon,authenticated;
grant select,insert,update on public.secretariat_ocr_connectors to service_role;

create table if not exists public.secretariat_ocr_provider_usage (
 provider text not null references public.secretariat_ocr_connectors(provider),
 month_date date not null,
 requests integer not null default 0 check (requests >= 0),
 primary key(provider,month_date)
);
alter table public.secretariat_ocr_provider_usage enable row level security;
revoke all on public.secretariat_ocr_provider_usage from public,anon,authenticated;
grant select,insert,update on public.secretariat_ocr_provider_usage to service_role;

-- Privileged RPC callable only by service_role Edge Functions after verifying an admin.
-- p_secret is never returned. Optional p_erase deletes credentials permanently.
create or replace function public.secretariat_ocr_connector_configure(
 p_provider text,
 p_secret text,
 p_endpoint text,
 p_enabled boolean,
 p_consent boolean,
 p_monthly_cap integer,
 p_actor text,
 p_erase boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_secret_id uuid;
 v_endpoint text;
 v_credential text;
 v_enabled boolean;
begin
 if p_provider is null or p_provider not in ('azure_invoice','ocrspace') then
  raise exception 'Unsupported provider';
 end if;
 if p_monthly_cap is null or p_monthly_cap < 1 or p_monthly_cap > 100 then
  raise exception 'Invalid monthly request limit';
 end if;
 if char_length(coalesce(p_actor,'')) < 2 or char_length(p_actor) > 90 then
  raise exception 'Invalid operator';
 end if;
 if p_erase and nullif(p_secret,'') is not null then
  raise exception 'Cannot replace and erase a secret in the same operation';
 end if;
 if p_secret is not null and char_length(p_secret) > 10240 then
  raise exception 'Credential too long';
 end if;
 v_endpoint := trim(trailing '/' from trim(coalesce(p_endpoint,'')));
 if p_provider = 'azure_invoice' then
  if v_endpoint <> '' and v_endpoint !~ '^https://[a-zA-Z0-9-]+[.]cognitiveservices[.]azure[.]com$'
    and v_endpoint !~ '^https://[a-zA-Z0-9-]+[.]api[.]cognitive[.]microsoft[.]com$' then
   raise exception 'Invalid Azure endpoint';
  end if;
 else
  if v_endpoint <> '' then
   raise exception 'OCR.space endpoint is managed by the server';
  end if;
 end if;
 select secret_id into v_secret_id
 from public.secretariat_ocr_connectors
 where provider = p_provider
 for update;

 if p_erase and v_secret_id is not null then
  delete from vault.secrets where id = v_secret_id;
  v_secret_id := null;
 end if;
 v_credential := nullif(trim(coalesce(p_secret,'')), '');
 if v_credential is not null then
  if v_secret_id is not null then
   perform vault.update_secret(v_secret_id, v_credential, 'college_ocr_' || p_provider, 'Gestion College OCR connector', null::uuid);
  else
   select vault.create_secret(v_credential, 'college_ocr_' || p_provider, 'Gestion College OCR connector', null::uuid)
   into v_secret_id;
  end if;
 end if;
 v_enabled := coalesce(p_enabled,false);
 if v_enabled and (v_secret_id is null or p_consent is distinct from true) then
  raise exception 'Credentials and explicit consent required';
 end if;
 if v_enabled and p_provider = 'azure_invoice' and v_endpoint = '' then
  raise exception 'Azure endpoint required';
 end if;
 insert into public.secretariat_ocr_connectors(
  provider,secret_id,endpoint,enabled,consent_at,monthly_request_cap,updated_by
 ) values (
  p_provider,v_secret_id,v_endpoint,v_enabled,
  case when v_enabled then now() else null end,p_monthly_cap,p_actor
 )
 on conflict(provider) do update
 set secret_id=excluded.secret_id,endpoint=excluded.endpoint,enabled=excluded.enabled,
     consent_at=excluded.consent_at,monthly_request_cap=excluded.monthly_request_cap,
     updated_by=excluded.updated_by,updated_at=now();
 return jsonb_build_object('provider',p_provider,'configured',v_secret_id is not null,'enabled',v_enabled,'monthly_request_cap',p_monthly_cap);
end;
$$;
revoke all on function public.secretariat_ocr_connector_configure(text,text,text,boolean,boolean,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.secretariat_ocr_connector_configure(text,text,text,boolean,boolean,integer,text,boolean) to service_role;

-- Never exposed through an end-user HTTP action; server-side driver use only.
create or replace function public.secretariat_ocr_connector_secret(p_provider text)
returns text
language sql stable
security definer
set search_path = ''
as $$
 select s.decrypted_secret
 from public.secretariat_ocr_connectors c
 join vault.decrypted_secrets s on s.id = c.secret_id
 where c.provider = p_provider and c.enabled = true and c.consent_at is not null
 limit 1;
$$;
revoke all on function public.secretariat_ocr_connector_secret(text) from public,anon,authenticated;
grant execute on function public.secretariat_ocr_connector_secret(text) to service_role;
