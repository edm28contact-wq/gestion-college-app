alter table public.rental_mail_messages
 add column body_status text not null default 'complete',
 add column source_size bigint,
 add column body_note text,
 add constraint rental_mail_messages_body_status_check
  check(body_status in ('complete','metadata_only','truncated')),
 add constraint rental_mail_messages_source_size_check
  check(source_size is null or source_size>=0),
 add constraint rental_mail_messages_body_note_check
  check(
   (body_status='complete' and body_note is null)
   or (body_status='metadata_only' and body_note is not null
       and body_note in ('size_limit','invalid_size','parse_failed','no_text_part'))
   or (body_status='truncated' and body_note is not null and body_note='text_limit')
  );

create table public.rental_mail_sync_cursors(
 account_email text not null
  check(account_email=lower(btrim(account_email)) and account_email ~ '^[^[:space:]@]+@free\.fr$'),
 folder text not null check(folder='INBOX'),
 uidvalidity bigint not null check(uidvalidity between 1 and 4294967295),
 last_uid bigint not null default 0 check(last_uid between 0 and 4294967295),
 target_uid bigint not null check(target_uid between last_uid and 4294967295),
 lock_token uuid,
 locked_until timestamptz,
 last_progress_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(account_email,folder),
 constraint rental_mail_sync_cursor_lock_pair
  check((lock_token is null and locked_until is null)
        or (lock_token is not null and locked_until is not null))
);
alter table public.rental_mail_sync_cursors enable row level security;
revoke all on public.rental_mail_sync_cursors from public,anon,authenticated;
grant select,insert,update on public.rental_mail_sync_cursors to service_role;

create or replace function public.marne_mail_sync_claim(
 p_account text,p_folder text,p_uidvalidity bigint,p_target_uid bigint
) returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
 v_cursor public.rental_mail_sync_cursors%rowtype;
 v_now timestamptz;
 v_token uuid;
begin
 p_account:=lower(btrim(coalesce(p_account,'')));
 p_folder:=upper(btrim(coalesce(p_folder,'')));
 if p_account !~ '^[^[:space:]@]+@free\.fr$' or char_length(p_account)>254
 or p_folder<>'INBOX' or p_uidvalidity is null or p_uidvalidity not between 1 and 4294967295
 or p_target_uid is null or p_target_uid not between 0 and 4294967295 then
  raise exception 'MAIL_SYNC_INVALID_CLAIM' using errcode='22023';end if;
 insert into public.rental_mail_sync_cursors(account_email,folder,uidvalidity,target_uid)
 values(p_account,p_folder,p_uidvalidity,p_target_uid)
 on conflict(account_email,folder) do nothing;
 select * into v_cursor from public.rental_mail_sync_cursors
 where account_email=p_account and folder=p_folder for update;
 v_now:=clock_timestamp();
 if v_cursor.lock_token is not null and v_cursor.locked_until>v_now then
  return jsonb_build_object('claimed',false,'last_uid',v_cursor.last_uid,
   'target_uid',v_cursor.target_uid,'uidvalidity',v_cursor.uidvalidity,
   'locked_until',v_cursor.locked_until);
 end if;
 if p_uidvalidity<v_cursor.uidvalidity
 or (p_uidvalidity=v_cursor.uidvalidity and p_target_uid<v_cursor.last_uid) then
  raise exception 'MAIL_SYNC_STALE_MAILBOX' using errcode='55000';end if;
 v_token:=gen_random_uuid();
 update public.rental_mail_sync_cursors
 set uidvalidity=p_uidvalidity,
  last_uid=case when uidvalidity=p_uidvalidity then last_uid else 0 end,
  target_uid=p_target_uid,
  lock_token=v_token,locked_until=v_now+interval '120 seconds',
  last_progress_at=case when uidvalidity=p_uidvalidity then last_progress_at else null end,
  updated_at=v_now
 where account_email=p_account and folder=p_folder
 returning * into v_cursor;
 return jsonb_build_object('claimed',true,'token',v_token,'last_uid',v_cursor.last_uid,
  'target_uid',v_cursor.target_uid,'uidvalidity',v_cursor.uidvalidity,
  'locked_until',v_cursor.locked_until);
end;
$function$;

create or replace function public.marne_mail_sync_checkpoint(
 p_account text,p_folder text,p_token uuid,p_uidvalidity bigint,
 p_expected_last_uid bigint,p_scanned_through_uid bigint,p_message jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
 v_cursor public.rental_mail_sync_cursors%rowtype;
 v_now timestamptz;
 v_uid bigint;
 v_inserted boolean:=false;
 v_message_id uuid;
begin
 p_account:=lower(btrim(coalesce(p_account,'')));
 p_folder:=upper(btrim(coalesce(p_folder,'')));
 if p_account !~ '^[^[:space:]@]+@free\.fr$' or char_length(p_account)>254
 or p_folder<>'INBOX' or p_token is null or p_uidvalidity is null
 or p_uidvalidity not between 1 and 4294967295
 or p_expected_last_uid is null or p_expected_last_uid not between 0 and 4294967295
 or p_scanned_through_uid is null
 or p_scanned_through_uid not between p_expected_last_uid and 4294967295
 or (p_message is not null and (jsonb_typeof(p_message) is distinct from 'object'
     or octet_length(p_message::text)>262144)) then
  raise exception 'MAIL_SYNC_INVALID_CHECKPOINT' using errcode='22023';end if;
 select * into v_cursor from public.rental_mail_sync_cursors
 where account_email=p_account and folder=p_folder for update;
 v_now:=clock_timestamp();
 if not found or v_cursor.lock_token is distinct from p_token
 or v_cursor.uidvalidity is distinct from p_uidvalidity
 or v_cursor.locked_until is null or v_cursor.locked_until<=v_now then
  raise exception 'MAIL_SYNC_LOCK_LOST' using errcode='55000';end if;
 if p_scanned_through_uid>v_cursor.target_uid then
  raise exception 'MAIL_SYNC_CHECKPOINT_BEYOND_TARGET' using errcode='22023';end if;
 if p_message is not null then
  if coalesce(p_message->>'uid','') !~ '^[0-9]{1,10}$' then
   raise exception 'MAIL_SYNC_INVALID_MESSAGE_UID' using errcode='22023';end if;
  v_uid:=(p_message->>'uid')::bigint;
  if v_uid<1 or v_uid is distinct from p_scanned_through_uid
   or ((p_message ? 'account_email') and lower(btrim(p_message->>'account_email')) is distinct from p_account)
   or ((p_message ? 'folder') and p_message->>'folder' is distinct from p_folder)
   or ((p_message ? 'uidvalidity') and (p_message->>'uidvalidity')::bigint is distinct from p_uidvalidity)
  then raise exception 'MAIL_SYNC_MESSAGE_IDENTITY_MISMATCH' using errcode='22023';end if;
 end if;
 if v_cursor.last_uid<>p_expected_last_uid or p_scanned_through_uid=v_cursor.last_uid then
  if v_cursor.last_uid=p_scanned_through_uid
   and (p_message is null or exists(select 1 from public.rental_mail_messages
    where account_email=p_account and folder=p_folder and uidvalidity=p_uidvalidity and uid=v_uid)) then
   return jsonb_build_object('last_uid',v_cursor.last_uid,'inserted',false);
  end if;
  raise exception 'MAIL_SYNC_CURSOR_CONFLICT' using errcode='55000';
 end if;
 if p_message is not null then
  insert into public.rental_mail_messages(
   account_email,folder,uidvalidity,uid,message_id,sender_email,recipient_email,
   subject,plain_body,received_at,is_seen,has_attachments,attachment_count,
   body_status,source_size,body_note
  ) values(
   p_account,p_folder,p_uidvalidity,v_uid,nullif(p_message->>'message_id',''),
   coalesce(p_message->>'sender_email',''),coalesce(p_message->>'recipient_email',''),
   coalesce(p_message->>'subject',''),coalesce(p_message->>'plain_body',''),
   nullif(p_message->>'received_at','')::timestamptz,
   coalesce((p_message->>'is_seen')::boolean,false),
   coalesce((p_message->>'has_attachments')::boolean,false),
   coalesce((p_message->>'attachment_count')::integer,0),
   coalesce(p_message->>'body_status','complete'),
   nullif(p_message->>'source_size','')::bigint,nullif(p_message->>'body_note','')
  )
  on conflict(account_email,folder,uidvalidity,uid) do nothing
  returning id into v_message_id;
  v_inserted:=found;
 end if;
 v_now:=clock_timestamp();
 update public.rental_mail_sync_cursors
 set last_uid=p_scanned_through_uid,last_progress_at=v_now,
  updated_at=v_now,locked_until=v_now+interval '120 seconds'
 where account_email=p_account and folder=p_folder;
 return jsonb_build_object('last_uid',p_scanned_through_uid,'inserted',v_inserted);
end;
$function$;

create or replace function public.marne_mail_sync_release(
 p_account text,p_folder text,p_token uuid
) returns jsonb language plpgsql security invoker set search_path='' as $function$
declare v_count integer;
begin
 p_account:=lower(btrim(coalesce(p_account,'')));
 p_folder:=upper(btrim(coalesce(p_folder,'')));
 if p_account !~ '^[^[:space:]@]+@free\.fr$' or char_length(p_account)>254
 or p_folder<>'INBOX' or p_token is null then
  raise exception 'MAIL_SYNC_INVALID_RELEASE' using errcode='22023';end if;
 update public.rental_mail_sync_cursors
 set lock_token=null,locked_until=null,updated_at=clock_timestamp()
 where account_email=p_account and folder=p_folder and lock_token=p_token;
 get diagnostics v_count=row_count;
 return jsonb_build_object('released',v_count=1);
end;
$function$;

revoke all on function public.marne_mail_sync_claim(text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public.marne_mail_sync_checkpoint(text,text,uuid,bigint,bigint,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.marne_mail_sync_release(text,text,uuid) from public,anon,authenticated;
grant execute on function public.marne_mail_sync_claim(text,text,bigint,bigint) to service_role;
grant execute on function public.marne_mail_sync_checkpoint(text,text,uuid,bigint,bigint,bigint,jsonb) to service_role;
grant execute on function public.marne_mail_sync_release(text,text,uuid) to service_role;


do $imap_audit$
declare
 v_account text:='qa-imap-'||replace(gen_random_uuid()::text,'-','')||'@free.fr';
 v_claim jsonb;v_result jsonb;v_a uuid;v_b uuid;v_c uuid;v_cursor public.rental_mail_sync_cursors%rowtype;
 v_count integer;
begin
 begin
 insert into public.rental_mail_messages(account_email,folder,uidvalidity,uid,subject,plain_body)
 values(v_account,'INBOX',100,90,'QA cached tail','QA');
 v_claim:=public.marne_mail_sync_claim(v_account,'INBOX',100,100);
 v_a:=(v_claim->>'token')::uuid;
 if v_claim->>'claimed' is distinct from 'true' or v_a is null
 or (v_claim->>'last_uid')::bigint is distinct from 0::bigint
 then raise exception 'QA_IMAP_BOOTSTRAP_REPAIRS_OLD_GAPS';end if;
 if (v_claim->>'locked_until')::timestamptz-clock_timestamp() not between interval '115 seconds' and interval '121 seconds'
 then raise exception 'QA_IMAP_LEASE_TTL';end if;
 v_result:=public.marne_mail_sync_claim(v_account,'INBOX',101,100);
 if v_result->>'claimed' is distinct from 'false' or v_result ? 'token'
 then raise exception 'QA_IMAP_BUSY_CLAIM_EXPOSED_TOKEN';end if;
 if not exists(select 1 from public.rental_mail_sync_cursors where account_email=v_account
 and uidvalidity=100 and lock_token=v_a) then raise exception 'QA_IMAP_BUSY_MUTATED_CURSOR';end if;
 v_result:=public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,0,1,
 jsonb_build_object('uid',1,'subject','QA first','plain_body','QA'));
 if v_result->>'inserted' is distinct from 'true' or (v_result->>'last_uid')::bigint is distinct from 1::bigint
 or not exists(select 1 from public.rental_mail_messages where account_email=v_account and uidvalidity=100 and uid=1)
 or not exists(select 1 from public.rental_mail_sync_cursors where account_email=v_account and last_uid=1 and last_progress_at is not null)
 then raise exception 'QA_IMAP_MESSAGE_AND_CURSOR_ATOMIC';end if;
 v_result:=public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,0,1,
 jsonb_build_object('uid',1,'subject','QA first','plain_body','QA'));
 if v_result->>'inserted' is distinct from 'false'
 or (select count(*) from public.rental_mail_messages where account_email=v_account and uidvalidity=100 and uid=1)<>1
 then raise exception 'QA_IMAP_CHECKPOINT_RETRY';end if;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,1,10,
 jsonb_build_object('uid',10,'subject','QA gap','plain_body','QA'));
 select count(*) into v_count from public.rental_mail_messages where account_email=v_account;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,10,20,null);
 if (select last_uid from public.rental_mail_sync_cursors where account_email=v_account)<>20
 or (select count(*) from public.rental_mail_messages where account_email=v_account)<>v_count
 then raise exception 'QA_IMAP_EMPTY_SCANNED_RANGE';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,20,21,
  jsonb_build_object('uid',21,'subject',repeat('x',501),'plain_body','QA'));
  raise exception 'QA_IMAP_INVALID_MESSAGE_WAS_ACCEPTED';
 exception when sqlstate '23514' then null;end;
 if (select last_uid from public.rental_mail_sync_cursors where account_email=v_account)<>20
 or exists(select 1 from public.rental_mail_messages where account_email=v_account and uidvalidity=100 and uid=21)
 then raise exception 'QA_IMAP_FAILED_INSERT_ADVANCED_CURSOR';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',gen_random_uuid(),100,20,21,null);
  raise exception 'QA_IMAP_WRONG_TOKEN_ACCEPTED';
 exception when sqlstate '55000' then null;end;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,101,20,21,null);
  raise exception 'QA_IMAP_WRONG_EPOCH_ACCEPTED';
 exception when sqlstate '55000' then null;end;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,20,21,
  jsonb_build_object('uid',21,'account_email','qa-other@free.fr'));
  raise exception 'QA_IMAP_WRONG_ACCOUNT_ACCEPTED';
 exception when sqlstate '22023' then null;end;
 update public.rental_mail_sync_cursors set locked_until=clock_timestamp()-interval '1 second'
 where account_email=v_account;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,20,21,
  jsonb_build_object('uid',21,'subject','QA expired'));
  raise exception 'QA_IMAP_EXPIRED_WORKER_ACCEPTED';
 exception when sqlstate '55000' then null;end;
 v_result:=public.marne_mail_sync_claim(v_account,'INBOX',100,100);
 v_b:=(v_result->>'token')::uuid;
 if v_result->>'claimed' is distinct from 'true' or v_b is null or v_b=v_a
 or (v_result->>'last_uid')::bigint is distinct from 20::bigint
 then raise exception 'QA_IMAP_SUCCESSOR_CLAIM';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_a,100,20,21,
  jsonb_build_object('uid',21,'subject','QA stale worker'));
  raise exception 'QA_IMAP_OLD_WORKER_ADVANCED_SUCCESSOR';
 exception when sqlstate '55000' then null;end;
 v_result:=public.marne_mail_sync_release(v_account,'INBOX',v_a);
 if v_result->>'released' is distinct from 'false'
 or not exists(select 1 from public.rental_mail_sync_cursors where account_email=v_account and lock_token=v_b and last_uid=20)
 then raise exception 'QA_IMAP_OLD_WORKER_RELEASED_SUCCESSOR';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,0,30,null);
  raise exception 'QA_IMAP_WRONG_CAS_ACCEPTED';
 exception when sqlstate '55000' then null;end;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,20,101,null);
  raise exception 'QA_IMAP_CHECKPOINT_BEYOND_TARGET_ACCEPTED';
 exception when sqlstate '22023' then null;end;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,20,30,
 jsonb_build_object('uid',30,'subject','QA large','plain_body','QA metadata',
 'body_status','metadata_only','body_note','size_limit','source_size',700001));
 if not exists(select 1 from public.rental_mail_messages where account_email=v_account and uidvalidity=100
 and uid=30 and body_status='metadata_only' and body_note='size_limit' and source_size=700001)
 then raise exception 'QA_IMAP_METADATA_ONLY_EXPLICIT';end if;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,30,31,
 jsonb_build_object('uid',31,'subject','QA truncated','plain_body',repeat('x',30000),
 'body_status','truncated','body_note','text_limit','source_size',60000));
 if not exists(select 1 from public.rental_mail_messages where account_email=v_account and uidvalidity=100
 and uid=31 and body_status='truncated' and body_note='text_limit' and length(plain_body)=30000)
 then raise exception 'QA_IMAP_TRUNCATION_EXPLICIT';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,31,32,
  jsonb_build_object('uid',32,'body_status','truncated','plain_body','QA'));
  raise exception 'QA_IMAP_TRUNCATION_NOTE_MISSING_ACCEPTED';
 exception when sqlstate '23514' then null;end;
 v_result:=public.marne_mail_sync_release(v_account,'INBOX',v_b);
 if v_result->>'released' is distinct from 'true'
 or not exists(select 1 from public.rental_mail_sync_cursors where account_email=v_account
 and lock_token is null and locked_until is null and last_uid=31)
 then raise exception 'QA_IMAP_RELEASE_DESTROYED_PROGRESS';end if;
 select count(*) into v_count from public.rental_mail_messages where account_email=v_account;
 v_result:=public.marne_mail_sync_claim(v_account,'INBOX',101,5);
 v_c:=(v_result->>'token')::uuid;
 if v_c is null or v_c in(v_a,v_b) or (v_result->>'last_uid')::bigint is distinct from 0::bigint
 or (select count(*) from public.rental_mail_messages where account_email=v_account)<>v_count
 or not exists(select 1 from public.rental_mail_sync_cursors where account_email=v_account and last_progress_at is null)
 then raise exception 'QA_IMAP_EPOCH_RESET_PRESERVES_ARCHIVES';end if;
 begin
  perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_b,100,31,32,null);
  raise exception 'QA_IMAP_OLD_EPOCH_ADVANCED_NEW_CURSOR';
 exception when sqlstate '55000' then null;end;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_c,101,0,1,
 jsonb_build_object('uid',1,'subject','QA new epoch','plain_body','QA'));
 if (select count(*) from public.rental_mail_messages where account_email=v_account and uid=1)<>2
 then raise exception 'QA_IMAP_UID_REUSE_ACROSS_EPOCHS';end if;
 perform public.marne_mail_sync_checkpoint(v_account,'INBOX',v_c,101,1,2,
 jsonb_build_object('uid',2,'subject','QA HTML','plain_body','QA HTML non reproduit',
 'body_status','metadata_only','body_note','no_text_part'));
 if not exists(select 1 from public.rental_mail_messages where account_email=v_account
 and uidvalidity=101 and uid=2 and body_status='metadata_only' and body_note='no_text_part')
 then raise exception 'QA_IMAP_HTML_NOT_MARKED_COMPLETE';end if;
 perform public.marne_mail_sync_release(v_account,'INBOX',v_c);
 begin
  perform public.marne_mail_sync_claim(v_account,'INBOX',100,100);
  raise exception 'QA_IMAP_OLD_EPOCH_RECLAIM_ACCEPTED';
 exception when sqlstate '55000' then null;end;
 if has_function_privilege('anon','public.marne_mail_sync_claim(text,text,bigint,bigint)','EXECUTE')
 or has_function_privilege('authenticated','public.marne_mail_sync_checkpoint(text,text,uuid,bigint,bigint,bigint,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.marne_mail_sync_release(text,text,uuid)','EXECUTE')
 or has_table_privilege('anon','public.rental_mail_sync_cursors','SELECT,INSERT,UPDATE,DELETE')
 or has_table_privilege('authenticated','public.rental_mail_sync_cursors','SELECT,INSERT,UPDATE,DELETE')
 then raise exception 'QA_IMAP_PUBLIC_PRIVILEGE_EXPOSURE';end if;
 raise sqlstate 'ZQ005' using message='IMAP assertions passed; discard fixtures';
 exception when sqlstate 'ZQ005' then null;
 end;
end $imap_audit$;

