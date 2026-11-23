import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { ImapFlow } from "npm:imapflow@2.11.0";
import PostalMime from "npm:postal-mime@4.0.5";
import nodemailer from "npm:nodemailer@10.4.1";

const DEFAULT_ACCOUNT="ph.danglade@free.fr";
function response(body: unknown,status=200){return Response.json(body,{status,headers:{"cache-control":"no-store"}})}
function serviceKey(){
 const map=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}") as Record<string,string>;
 return map.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
function constantEqual(a:string,b:string) {
 if(!a||!b||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function database(){
 const url=Deno.env.get("SUPABASE_URL"),key=serviceKey();
 if(!url||!key)throw new Error("Missing server configuration");
 return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
async function credentials(){
 const client=database();
 const setting=await client.from("rental_settings").select("value").eq("setting_key","sender_email").maybeSingle();
 if(setting.error)throw new Error("Mail account not available");
 const account=String(setting.data?.value||DEFAULT_ACCOUNT).trim().toLowerCase();
 if(!/^[^\s@]+@free\.fr$/.test(account))throw new Error("Unsupported Free mailbox account");
 const secret=await client.rpc("marne_mail_password_get",{p_account:account});
 if(secret.error)throw new Error("Encrypted mail credential not accessible");
 const pass=String(secret.data|| (account===DEFAULT_ACCOUNT?Deno.env.get("MARNE_FREE_MAIL_PASSWORD"):"")||"");
 return {account,pass};
}
function validUuid(v:unknown){return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)}
function validEmail(v:unknown){return typeof v==="string"&&v.length<=254&&/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(v)}
function imapConnection(pass:string,account:string){
 const c=new ImapFlow({
  host:"imap.free.fr",port:993,secure:true,auth:{user:account,pass},logger:false,
  maxLiteralSize:1024*1024,maxResponseSize:3*1024*1024,socketTimeout:20000,
  greetingTimeout:10000,connectionTimeout:10000
 });
 c.on("error",()=>{});return c;
}
function syncError(code:string){return Object.assign(new Error("Mail synchronization requires retry"),{code})}
function syncUid(value:unknown,allowZero=false){
 if((typeof value!=="number"&&typeof value!=="bigint"&&typeof value!=="string")||(typeof value==="string"&&!/^\d+$/.test(value)))
  throw syncError("invalid_imap_uid");
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<(allowZero?0:1)||n>4294967295)throw syncError("invalid_imap_uid");
 return n;
}
function mailText(value:unknown,limit:number){return Array.from(String(value||"")).slice(0,limit).join("")}
async function nextInboxBatch(client:any,lastUid:number,targetUid:number,epoch:string,revision:()=>number,deadline:number){
 const generation=revision(),count=syncUid(client.mailbox?.exists,true);
 const stable=()=>{
  if(!client.mailbox||String(client.mailbox.uidValidity)!==epoch||revision()!==generation||client.mailbox.exists!==count)
   throw syncError("mailbox_changed");
 };
 stable();
 let low=1,high=count+1,probes=0;
 if(lastUid===0)high=1;
 while(low<high){
  if(Date.now()>=deadline)return null;
  if(++probes>32)throw syncError("imap_probe_limit");
  const mid=low+Math.floor((high-low)/2);
  const message=await client.fetchOne(mid,{uid:true},{uid:false});
  stable();
  if(!message||message.seq!==mid)throw syncError("imap_sequence_changed");
  if(syncUid(message.uid)<=lastUid)low=mid+1;else high=mid;
 }
 if(low>count)return {entries:[],atEnd:true};
 if(Date.now()>=deadline)return null;
 const end=Math.min(count,low+29);
 const fetched=await client.fetchAll(low+":"+end,{uid:true,envelope:true,size:true,flags:true,internalDate:true},{uid:false});
 stable();
 if(!Array.isArray(fetched)||fetched.length!==end-low+1)throw syncError("imap_incomplete_batch");
 const ordered=fetched.slice().sort((a:any,b:any)=>a.seq-b.seq);
 let previous=lastUid;
 for(const [offset,entry] of ordered.entries()){
  const uid=syncUid(entry.uid);
  if(entry.seq!==low+offset||uid<=previous)throw syncError("imap_incomplete_batch");
  previous=uid;
 }
 return {entries:ordered.filter((entry:any)=>entry.uid<=targetUid),atEnd:end===count||ordered.some((entry:any)=>entry.uid>targetUid)};
}
async function syncInbox(pass:string,account:string){
 const client=imapConnection(pass,account),db=database();
 const deadline=Date.now()+40000;
 let revision=0,token="",epoch="",lastUid=0,targetUid=0,total=0,imported=0,checked=0,metadataOnly=0,truncated=0,tooLarge=0;
 let lock:any;
 client.on("exists",()=>{revision++});
 client.on("expunge",()=>{revision++});
 client.on("mailboxClose",()=>{revision++});
 const timeout=setTimeout(()=>{try{client.close()}catch{}},55000);
 const validEpoch=()=>{
  if(!client.mailbox||String(client.mailbox.uidValidity)!==epoch)throw syncError("mailbox_changed");
 };
 const checkpoint=async(uid:number,message:any=null)=>{
  validEpoch();
  const saved=await db.rpc("marne_mail_sync_checkpoint",{
   p_account:account,p_folder:"INBOX",p_token:token,p_uidvalidity:epoch,
   p_expected_last_uid:lastUid,p_scanned_through_uid:uid,p_message:message
  });
  if(saved.error||Number(saved.data?.last_uid)!==uid)throw syncError(saved.error?.code==="55000"?"sync_lock_lost":"sync_checkpoint_failed");
  lastUid=uid;
  return saved.data?.inserted===true;
 };
 try{
  await client.connect();
  lock=await client.getMailboxLock("INBOX",{readOnly:true});
  const box=client.mailbox;if(!box)throw syncError("mailbox_not_selected");
  total=syncUid(box.exists,true);
  epoch=String(syncUid(box.uidValidity));
  const uidNext=Number(box.uidNext);
  if(!Number.isSafeInteger(uidNext)||uidNext<1||uidNext>4294967296)throw syncError("invalid_imap_uid");
  targetUid=uidNext-1;
  const claimed=await db.rpc("marne_mail_sync_claim",{p_account:account,p_folder:"INBOX",p_uidvalidity:epoch,p_target_uid:targetUid});
  if(claimed.error)throw syncError("sync_claim_failed");
  if(claimed.data?.claimed===false)
   return {ok:true,busy:true,imported:0,checked:0,metadata_only:0,truncated:0,has_more:null,mailbox_total:total};
  if(claimed.data?.claimed!==true||!validUuid(claimed.data?.token))throw syncError("sync_claim_failed");
  token=claimed.data.token;
  lastUid=syncUid(claimed.data.last_uid,true);
  if(String(claimed.data.uidvalidity)!==epoch||Number(claimed.data.target_uid)!==targetUid||lastUid>targetUid)
   throw syncError("sync_claim_failed");
  if(lastUid<targetUid&&Date.now()<deadline){
   const batch=await nextInboxBatch(client,lastUid,targetUid,epoch,()=>revision,deadline);
   let completed=!!batch;
   for(const entry of batch?.entries||[]){
    if(Date.now()>=deadline){completed=false;break;}
    validEpoch();
    checked++;
    let parsed:any=null,note:string|null=null,status="complete";
    const size=Number(entry.size),validSize=Number.isSafeInteger(size)&&size>0;
    if(!validSize)note="invalid_size";
    else if(size>700000){note="size_limit";tooLarge++;}
    else{
     const raw=await client.fetchOne(String(entry.uid),{uid:true,source:{start:0,maxLength:700001}},{uid:true});
     validEpoch();
     if(raw===false){await checkpoint(entry.uid);continue;}
     if(!raw||syncUid(raw.uid)!==entry.uid||!raw.source)throw syncError("imap_source_missing");
     if(raw.source.byteLength>700000){note="size_limit";tooLarge++;}
     else if(raw.source.byteLength!==size)note="parse_failed";
     else{
      try{parsed=await PostalMime.parse(raw.source)}catch{note="parse_failed";}
      if(!parsed||typeof parsed!=="object")note="parse_failed";
      else if(!String(parsed.text||"").trim())note="no_text_part";
     }
    }
    let plain=String(parsed?.text||"");
    if(note){
     status="metadata_only";
     plain=note==="size_limit"?"[Message dépassant 700 Ko — contenu à consulter dans la boîte Free]":
      note==="no_text_part"?"[Message sans version texte — contenu HTML ou pièce jointe à consulter dans la boîte Free]":
      "[En-têtes importés uniquement — contenu non exploitable, à consulter dans la boîte Free]";
    }else if(Array.from(plain).length>30000){status="truncated";note="text_limit";plain=mailText(plain,30000);}
    const date=entry.internalDate||parsed?.date||entry.envelope?.date;
    const isoDate=date&&!Number.isNaN(Date.parse(String(date)))?new Date(date).toISOString():null;
    const row={
     folder:"INBOX",account_email:account,uidvalidity:epoch,uid:entry.uid,
     message_id:mailText(entry.envelope?.messageId,250)||null,
     sender_email:mailText(parsed?.from?.address||entry.envelope?.from?.[0]?.address,254),
     recipient_email:mailText(parsed?.to?.[0]?.address||entry.envelope?.to?.[0]?.address||account,254),
     subject:mailText(parsed?.subject||entry.envelope?.subject,500),
     plain_body:plain,received_at:isoDate,is_seen:Boolean(entry.flags?.has("\\Seen")),
     has_attachments:(parsed?.attachments?.length||0)>0,attachment_count:parsed?.attachments?.length||0,
     body_status:status,body_note:note,source_size:validSize?size:null
    };
    if(await checkpoint(entry.uid,row)){
     imported++;
     if(status==="metadata_only")metadataOnly++;
     if(status==="truncated")truncated++;
    }
   }
   if(completed&&batch?.atEnd&&lastUid<targetUid)await checkpoint(targetUid);
  }
  return {ok:true,busy:false,imported,checked,metadata_only:metadataOnly,truncated,skipped_large:tooLarge,
   has_more:lastUid<targetUid,mailbox_total:total,attachment_handling:"metadata_only"};
 }finally{
  if(token){
   try{
    const released=await db.rpc("marne_mail_sync_release",{p_account:account,p_folder:"INBOX",p_token:token});
    if(released.error)console.error("Mail synchronization release failed",released.error.code||"UNKNOWN");
   }catch{console.error("Mail synchronization release failed","NETWORK");}
  }
  try{lock?.release()}catch{}
  try{await client.logout()}catch{try{client.close()}catch{}}
  clearTimeout(timeout);
 }
}
async function sendDraft(id:string,pass:string,account:string){
 const db=database();
 const lookup=await db.from("rental_mail_outbox").select("id,account_email,recipient_email,subject,plain_body,status,in_reply_to_message_id").eq("id",id).eq("account_email",account).maybeSingle();
 if(lookup.error)throw new Error("Database read error");
 const row=lookup.data;
 if(!row||row.status!=="sending")return {ok:false,error:"Draft not approved for send",code:"not_approved"};
 if(!validEmail(row.recipient_email))return {ok:false,error:"Invalid recipient",code:"bad_recipient"};
 const transporter=nodemailer.createTransport({
  host:"smtp.free.fr",port:465,secure:true,auth:{user:account,pass},
  connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
  tls:{minVersion:"TLSv1.2"}
 });
 try{
  let inReplyTo: string|undefined;
  if(row.in_reply_to_message_id){
    const parent=await db.from("rental_mail_messages").select("message_id").eq("id",row.in_reply_to_message_id).maybeSingle();
    const parentId=String(parent.data?.message_id||"");
    if(/^<[^\s<>]{1,245}>$/.test(parentId))inReplyTo=parentId;
  }
  const info=await transporter.sendMail({
   from:{name:"Marne Invest",address:account},
   to:row.recipient_email,subject:row.subject,text:row.plain_body,
   ...(inReplyTo?{inReplyTo,references:inReplyTo}:{})
  });
  if(!info.accepted?.some((item:string)=>item.toLowerCase()===row.recipient_email.toLowerCase()))
    throw new Error("SMTP did not accept recipient");
  return {ok:true,provider_message_id:String(info.messageId||"").slice(0,250)};
 }finally{transporter.close()}
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(req.method==="GET"&&url.searchParams.get("action")==="health"){
  return response({ok:true,service:"marne-mail-transport",sending_automatic:false});
 }
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 const serviceAuthorized=constantEqual(req.headers.get("x-marne-service-key")||"",serviceKey());
 let cronAuthorized=false;
 if(!serviceAuthorized && req.headers.get("x-marne-cron-token")){
   const token=await database().rpc("marne_mail_cron_token_get");
   cronAuthorized=!token.error && constantEqual(req.headers.get("x-marne-cron-token")||"",String(token.data||""));
 }
 if(!serviceAuthorized&&!cronAuthorized)return response({error:"Unauthorized"},401);
 try{
  const body=await req.json();
  if(cronAuthorized&&body?.action!=="sync")return response({error:"Cron authorization is read-only"},403);
  const {account,pass}=await credentials();
  if(!pass)return response({error:"Free mailbox credential not configured",code:"credentials_missing"},503);
  if(body?.action==="sync"){
   const db=database();
   if(cronAuthorized){
     const verified=await db.from("rental_mail_sync_state").select("imap_verified_at").eq("account_email",account).maybeSingle();
     if(verified.error)throw new Error("Unable to verify mailbox onboarding");
     if(!verified.data?.imap_verified_at)return response({error:"IMAP not verified; scheduled sync suspended"},409);
   }
   const result=await syncInbox(pass,account);
   if(result.busy)return response(result);
   const saved=await db.from("rental_mail_sync_state").upsert({
     account_email:account,last_sync_at:new Date().toISOString(),
     last_imported:result.imported,last_checked:result.checked,last_error_at:null,last_error_code:null,
     updated_at:new Date().toISOString()
   },{onConflict:"account_email"});
   if(saved.error)throw new Error("Mail synchronization status save failed");
   return response(result);
  }
  if(body?.action==="send"&&validUuid(body?.id)){
   const result=await sendDraft(body.id,pass,account);
   return response(result,result.ok?200:409);
  }
  if(body?.action==="test"){
   const c=imapConnection(pass,account);
   try{
    await c.connect();
    const status=await c.status("INBOX",{messages:true});
    const smtp=nodemailer.createTransport({
      host:"smtp.free.fr",port:465,secure:true,auth:{user:account,pass},
      connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
      tls:{minVersion:"TLSv1.2"}
    });
    let smtpAuthenticated=false;
    try{await smtp.verify();smtpAuthenticated=true}catch{}finally{smtp.close()}
    const db=database();
    const timestamp=new Date().toISOString();
    const saved=await db.from("rental_mail_sync_state").upsert({
      account_email:account,imap_verified_at:timestamp,
      ...(smtpAuthenticated?{smtp_verified_at:timestamp}:{smtp_verified_at:null}),
      last_error_at:null,last_error_code:null,updated_at:timestamp
    },{onConflict:"account_email"});
    if(saved.error)throw new Error("Mail connection status save failed");
    return response({ok:true,imap_authenticated:true,smtp_authenticated:smtpAuthenticated,
      mailbox_total:status.messages,notes:smtpAuthenticated?"IMAP and SMTP connection confirmed":"SMTP authentication not confirmed. Enable authenticated SMTP in Free."});
   }finally{try{await c.logout()}catch{try{c.close()}catch{}}}
  }
  return response({error:"Unknown action"},400);
 }catch(e){
  const code=String((e as {code?:string}).code||"");
  console.error("Marne mail transport operation failed",code||"UNKNOWN");
  return response({ok:false,error:"Connexion à la messagerie Free indisponible. Vérifiez les identifiants, l’accès réseau et les paramètres.",code:"mail_transport_failure"},502);
 }
});

