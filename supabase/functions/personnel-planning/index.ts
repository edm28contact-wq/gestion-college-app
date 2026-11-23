import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, authorization, x-admin-session, apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const enc=new TextEncoder();
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
function client(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");return createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64(s:string){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4);return Uint8Array.from(atob(p),c=>c.charCodeAt(0))}
function enc64(b:Uint8Array){return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function session(db:any,req:Request){try{
 const token=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 const [body,sig]=token.split(".");if(!body||!sig)return null;
 const setting=await db.from("system_settings").select("admin_token").eq("id",1).single();if(setting.error||!setting.data)return null;
 const key=await crypto.subtle.importKey("raw",enc.encode(String(setting.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signed=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(body)));
 if(enc64(signed)!==sig)return null;
 const p=JSON.parse(new TextDecoder().decode(b64(body)));if(!p.u||Date.now()>Number(p.exp||0))return null;
 const q=await db.from("admin_accounts").select("username,active,role,permissions,must_change_password,session_version").eq("username",p.u).maybeSingle();
 const a=q.data;if(!a?.active||a.must_change_password===true||Number(a.session_version)!==Number(p.v))return null;
 const perms=a.permissions||{},admin=a.role==="admin",visitor=!admin&&perms.readonly===true;
 const salaryRead=admin||(a.role==="admin_limited"&&perms.college_admin===true)||perms["college.salaires.read"]===true||perms["college.salaires.write"]===true;
 const salaryWrite=!visitor&&(admin||(a.role==="admin_limited"&&perms.college_admin===true)||perms["college.salaires.write"]===true);
 const planningRead=salaryRead||perms.secretariat===true||perms["secretariat.read"]===true||perms["personnel.planning.read"]===true||perms["personnel.planning.write"]===true||perms["*"]===true;
 const planningWrite=!visitor&&(admin||perms.secretariat===true||perms["secretariat.write"]===true||perms["personnel.planning.write"]===true);
 return planningRead?{username:a.username,admin:salaryRead,salaryWrite,readonly:!planningWrite}:null;
}catch{return null}}
const types=new Set(["absence","retard","depart_anticipe","incident"]);
const just=new Set(["non_requis","a_fournir","recu"]);
const reviews=new Set(["a_verifier","valide","sans_suite"]);
const payroll=new Set(["a_examiner","a_transmettre","sans_impact"]);
const validDate=(s:any)=>{if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const [year,month,day]=s.split("-").map(Number),d=new Date(Date.UTC(year,month-1,day));return year>=2000&&year<=2100&&d.getUTCFullYear()===year&&d.getUTCMonth()+1===month&&d.getUTCDate()===day;};
const durationValue=(x:any)=>x===null||x===undefined||x===""?null:Number(x);
const isUuid=(v:any)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const bucket="personnel-incident-pdfs";
const maxPdf=6291456;
async function findEvent(db:any,id:string){return await db.from("personnel_events").select("id,attachment_path,attachment_name,attachment_size_bytes,review_status,version").eq("id",id).maybeSingle()}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
 const db=client(),user=await session(db,req);if(!user)return reply({error:"Session non autorisée. Connectez-vous depuis le secrétariat ou l’administration."},401);
 const action=new URL(req.url).searchParams.get("action")||"list";
 if(action==="admin-months"&&req.method==="GET"){
  if(!user.admin)return reply({error:"Lecture Salaires non autorisée"},403);
  const summaries=new Map<string,{month:string,events:number,people:Set<string>,pending:number,absences:number,retards:number,departures:number,incidents:number}>();
  const batchSize=500,maxEvents=20000;
  for(let offset=0;offset<=maxEvents;offset+=batchSize){
   const q=await db.from("personnel_events")
    .select("id,event_date,personnel_name,event_type,review_status")
    .order("event_date",{ascending:true}).order("id",{ascending:true})
    .range(offset,offset+batchSize-1);
   if(q.error)throw q.error;
   const events=q.data||[];
   if(offset===maxEvents&&events.length)return reply({error:"L’historique dépasse la limite de consultation. Contactez l’administration technique."},409);
   for(const e of events){
    const month=String(e.event_date||"").slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))continue;
    let value=summaries.get(month);
    if(!value){
     value={month,events:0,people:new Set<string>(),pending:0,absences:0,retards:0,departures:0,incidents:0};
     summaries.set(month,value);
    }
    value.events++;
    const person=String(e.personnel_name||"").normalize("NFKC").replace(/\s+/g," ").trim().toLocaleLowerCase("fr");
    if(person)value.people.add(person);
    if(e.review_status==="a_verifier")value.pending++;
    if(e.event_type==="absence")value.absences++;
    else if(e.event_type==="retard")value.retards++;
    else if(e.event_type==="depart_anticipe")value.departures++;
    else if(e.event_type==="incident")value.incidents++;
   }
   if(events.length<batchSize)break;
  }
  const months=[...summaries.values()].sort((a,b)=>b.month.localeCompare(a.month))
   .map(x=>({month:x.month,events:x.events,employees:x.people.size,pending:x.pending,
    absences:x.absences,retards:x.retards,departures:x.departures,incidents:x.incidents}));
  return reply({ok:true,months});
 }

 const staffName=(x:any)=>String(x??"").normalize("NFKC").replace(/\s+/g," ").trim();
 const staffKey=(x:any)=>staffName(x).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
 if(action==="staff-list"&&req.method==="GET"){
  const q=await db.from("college_personnel").select("id,name,name_key,visible_in_planning,archived,working_weekdays,benefits_in_kind,exclude_school_holidays,exclude_public_holidays,created_at,updated_at").order("name",{ascending:true}).limit(500);
  if(q.error)throw q.error;
  if((q.data||[]).length===500)return reply({error:"Liste du personnel trop importante pour être affichée entièrement"},409);
  return reply({ok:true,staff:user.admin?q.data:(q.data||[]).filter((x:any)=>!x.archived&&x.visible_in_planning).map((x:any)=>({id:x.id,name:x.name,name_key:x.name_key,visible_in_planning:x.visible_in_planning,archived:x.archived})),admin:user.admin});
 }
 if(action==="calendar-month"&&req.method==="GET"){
  if(!user.admin)return reply({error:"Lecture Salaires non autorisée"},403);
  const month=new URL(req.url).searchParams.get("month")||"";
  if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(month))return reply({error:"Mois invalide"},400);
  const [year,m]=month.split("-").map(Number),next=m===12?(year+1)+"-01":year+"-"+String(m+1).padStart(2,"0");
  const where='zones="Zone C" AND end_date >= "'+month+'-01" AND start_date < "'+next+'-01"';
  const schoolUrl=new URL("https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records");
  schoolUrl.searchParams.set("where",where);
  schoolUrl.searchParams.set("limit","100");
  schoolUrl.searchParams.set("select","description,start_date,end_date,zones,population");
  const safeFetch=async(url:string)=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);try{const response=await fetch(url,{signal:controller.signal,headers:{accept:"application/json"}});if(!response.ok)throw new Error("HTTP "+response.status);return await response.json()}finally{clearTimeout(timeout)}};
  const [holidayResult,schoolResult]=await Promise.allSettled([safeFetch("https://calendrier.api.gouv.fr/jours-feries/metropole/"+year+".json"),safeFetch(schoolUrl.toString())]);
  const holidays=holidayResult.status==="fulfilled"&&holidayResult.value&&typeof holidayResult.value==="object"?Object.entries(holidayResult.value).filter(([day])=>day.startsWith(month)).map(([date,name])=>({date,name})):null;
  const vacationRows=schoolResult.status==="fulfilled"&&Array.isArray(schoolResult.value?.results)?schoolResult.value.results:null;
  const vacations=vacationRows===null?null:[...new Map(vacationRows.filter((x:any)=>x&&typeof x.start_date==="string"&&typeof x.end_date==="string"&&(!x.population||/élèves|eleves|tous/i.test(x.population))).map((x:any)=>[x.description+"|"+x.start_date+"|"+x.end_date,{name:x.description,start:x.start_date.slice(0,10),end:x.end_date.slice(0,10)}])).values()];
  return reply({month,zone:"C",holidays,vacations,public_holidays_verified:holidays!==null,school_holidays_verified:vacations!==null,source_holidays:"https://calendrier.api.gouv.fr/jours-feries/metropole/"+year+".json",source_school:schoolUrl.toString()});
 }
 if(action==="staff-add"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification du personnel réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),name=staffName(x?.name),key=staffKey(name);
  if(name.length<2||name.length>120||key.length<2||key.length>120)return reply({error:"Nom invalide (2 à 120 caractères)"},400);
  const q=await db.from("college_personnel").insert({name,name_key:key,visible_in_planning:x?.visible_in_planning===true,archived:false,created_by:user.username,updated_by:user.username}).select("id,name,visible_in_planning,archived").single();
  if(q.error?.code==="23505")return reply({error:"Ce salarié existe déjà. Réactivez-le dans la liste au lieu de le créer en double."},409);
  if(q.error)throw q.error;
  return reply({ok:true,staff:q.data},201);
 }
 if(action==="staff-update"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification du personnel réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),id=String(x?.id||"");
  if(!isUuid(id)||typeof x?.visible_in_planning!=="boolean"||typeof x?.archived!=="boolean")return reply({error:"Salarié ou état invalide"},400);
  if(x.archived&&x.visible_in_planning)return reply({error:"Un salarié archivé ne peut pas apparaître dans le planning"},400);
  const q=await db.from("college_personnel").update({archived:x.archived,visible_in_planning:x.visible_in_planning,updated_by:user.username,updated_at:new Date().toISOString()}).eq("id",id).select("id,name,archived,visible_in_planning").maybeSingle();
  if(q.error)throw q.error;
  if(!q.data)return reply({error:"Salarié introuvable"},404);
  return reply({ok:true,staff:q.data});
 }
 if(action==="staff-payroll-update"&&req.method==="POST"){
  if(!user.admin)return reply({error:"Lecture Salaires non autorisée"},403);
  const x=await req.json().catch(()=>null);
  if(!isUuid(x?.id))return reply({error:"Salarié invalide"},400);
  const days=x?.working_weekdays;
  if(!Array.isArray(days)||days.length>7||!days.every((d:any)=>Number.isInteger(d)&&d>=0&&d<=6)||new Set(days).size!==days.length)
   return reply({error:"Jours travaillés invalides"},400);
  const benefits=x?.benefits_in_kind;
  if(!Array.isArray(benefits)||benefits.length>30||!benefits.every((b:any)=>b&&typeof b.label==="string"&&b.label.trim().length>=1&&b.label.trim().length<=100&&typeof b.amount==="number"&&Number.isFinite(b.amount)&&b.amount>=0&&b.amount<=100000&&Math.abs(Math.round(b.amount*100)-b.amount*100)<1e-7))
   return reply({error:"Avantages en nature invalides"},400);
  const clean=benefits.map((b:any)=>({label:b.label.trim(),amount:b.amount}));
  const school=x?.exclude_school_holidays,holidays=x?.exclude_public_holidays;
  if(school!==undefined&&typeof school!=="boolean"||holidays!==undefined&&typeof holidays!=="boolean")return reply({error:"Paramètres de calendrier invalides"},400);
  const payload:any={working_weekdays:[...days].sort((a:number,b:number)=>a-b),benefits_in_kind:clean,updated_at:new Date().toISOString(),updated_by:user.username};
  if(school!==undefined)payload.exclude_school_holidays=school;
  if(holidays!==undefined)payload.exclude_public_holidays=holidays;
  const q=await db.from("college_personnel").update(payload).eq("id",x.id).select("id,name,working_weekdays,benefits_in_kind").maybeSingle();
  if(q.error)throw q.error;
  if(!q.data)return reply({error:"Salarié introuvable"},404);
  return reply({ok:true,staff:q.data});
 }
 if((action==="list"||action==="admin-list")&&req.method==="GET"){
  if(action==="admin-list"&&!user.admin)return reply({error:"Accès réservé à l’administration"},403);
  const url=new URL(req.url),month=url.searchParams.get("month")||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return reply({error:"Mois invalide"},400);
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1));
  const next=end.toISOString().slice(0,10);
  const q=await db.from("personnel_events").select("*").gte("event_date",month+"-01").lt("event_date",next).order("event_date",{ascending:true}).order("created_at",{ascending:true}).limit(1000);
  if(q.error)throw q.error;if((q.data||[]).length===1000)return reply({error:"Le nombre d’événements dépasse la limite de consultation. Contactez l’administration technique pour obtenir un export complet."},409);return reply({events:q.data||[],role:user.admin?"admin":"secretariat",read_only:user.readonly});
 }
 if(action==="attachment-url"&&req.method==="GET"){
  const id=new URL(req.url).searchParams.get("id")||"";
  if(!isUuid(id))return reply({error:"Identifiant invalide"},400);
  const existing=await findEvent(db,id);if(existing.error)throw existing.error;
  if(!existing.data?.attachment_path)return reply({error:"Aucun PDF pour cet incident"},404);
  const file=await db.storage.from(bucket).createSignedUrl(existing.data.attachment_path,60,{download:existing.data.attachment_name||"justificatif.pdf"});
  if(file.error)throw file.error;
  return reply({ok:true,url:file.data.signedUrl,expires_in:60});
 }
 if(action==="attachment-upload"&&req.method==="POST"){
  if(user.readonly)return reply({error:"Lecture seule"},403);
  const form=await req.formData();
  const id=String(form.get("id")||"");
  const pdf=form.get("pdf");
  if(!isUuid(id)||!(pdf instanceof File))return reply({error:"Incident ou fichier invalide"},400);
  if(pdf.size<5||pdf.size>maxPdf||pdf.type!=="application/pdf")return reply({error:"PDF requis, taille maximale 6 Mo"},400);
  const bytes=new Uint8Array(await pdf.arrayBuffer());
  if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")return reply({error:"Le fichier n'est pas un PDF valide"},400);
  const old=await findEvent(db,id);if(old.error)throw old.error;
  if(!old.data)return reply({error:"Incident introuvable"},404);
  if(old.data.review_status!=="a_verifier")return reply({error:"Incident déjà traité : justificatif non modifiable"},409);
  const path=id+"/"+crypto.randomUUID()+".pdf";
  const uploaded=await db.storage.from(bucket).upload(path,bytes,{contentType:"application/pdf",upsert:false,cacheControl:"0"});
  if(uploaded.error)throw uploaded.error;
  const originalName=pdf.name.replace(/[\\/\x00-\x1f]/g," ").trim().slice(0,160)||"justificatif.pdf";
  const save=await db.from("personnel_events").update({
   attachment_path:path,attachment_name:originalName,attachment_size_bytes:pdf.size,
   attachment_uploaded_at:new Date().toISOString(),updated_by:user.username,updated_at:new Date().toISOString(),version:old.data.version+1
  }).eq("id",id).eq("version",old.data.version).eq("review_status","a_verifier").select("id").maybeSingle();
  if(save.error||!save.data){await db.storage.from(bucket).remove([path]);if(save.error)throw save.error;return reply({error:"L'incident a été modifié. Actualisez et réessayez."},409)}
  if(old.data.attachment_path&&old.data.attachment_path!==path){
   const cleanup=await db.storage.from(bucket).remove([old.data.attachment_path]);if(cleanup.error)console.error("PDF précédent non supprimé",cleanup.error.message);
  }
  return reply({ok:true,id,attachment_name:originalName,attachment_size_bytes:pdf.size});
 }
 if(action==="attachment-remove"&&req.method==="POST"){
  if(user.readonly)return reply({error:"Lecture seule"},403);
  const x=await req.json(),id=String(x.id||"");
  if(!isUuid(id))return reply({error:"Identifiant invalide"},400);
  const old=await findEvent(db,id);if(old.error)throw old.error;
  if(!old.data)return reply({error:"Incident introuvable"},404);
  if(old.data.review_status!=="a_verifier")return reply({error:"Incident déjà traité : justificatif non modifiable"},409);
  if(!old.data.attachment_path)return reply({ok:true});
  const saved=await db.from("personnel_events").update({
    attachment_path:null,attachment_name:null,attachment_size_bytes:null,attachment_uploaded_at:null,
    version:old.data.version+1,updated_by:user.username,updated_at:new Date().toISOString()
  }).eq("id",id).eq("version",old.data.version).eq("review_status","a_verifier").select("id").maybeSingle();
  if(saved.error)throw saved.error;if(!saved.data)return reply({error:"Modification concurrente"},409);
  const cleanup=await db.storage.from(bucket).remove([old.data.attachment_path]);if(cleanup.error)console.error("PDF non supprimé",cleanup.error.message);
  return reply({ok:true});
 }
 if(action==="delete"&&req.method==="POST"){
  if(user.readonly)return reply({error:"Compte en lecture seule"},403);
  const x=await req.json().catch(()=>null);
  const id=x?.id,version=x?.version;
  if(!isUuid(id)||!Number.isInteger(version)||version<1)return reply({error:"Identifiant ou version d'incident invalide"},400);
  const previous=await db.from("personnel_events").select("id,event_date,personnel_name,event_type,review_status,payroll_action,attachment_path,version").eq("id",id).maybeSingle();
  if(previous.error)throw previous.error;
  if(!previous.data)return reply({error:"Incident introuvable ou déjà supprimé"},404);
  if(!user.admin&&previous.data.review_status!=="a_verifier")return reply({error:"Seul un administrateur peut supprimer un incident déjà traité"},403);
  if(previous.data.version!==version)return reply({error:"Cet incident a été modifié. Actualisez avant de le supprimer."},409);
  // Audit préalable obligatoire : aucune suppression sans trace vérifiable.
  const audit=await db.from("admin_audit_log").insert({
   username:user.username,action:"personnel_incident_delete_requested",entity_type:"personnel_events",entity_id:id,
   details:{
    event_date:previous.data.event_date,event_type:previous.data.event_type,personnel_name:previous.data.personnel_name,
    review_status:previous.data.review_status,payroll_action:previous.data.payroll_action,
    pdf_attached:Boolean(previous.data.attachment_path),version,requested_by:user.username
   }
  }).select("id").single();
  if(audit.error)throw audit.error;
  let remove=db.from("personnel_events").delete().eq("id",id).eq("version",version);
  if(!user.salaryWrite)remove=remove.eq("review_status","a_verifier");
  const deleted=await remove.select("id,attachment_path").maybeSingle();
  if(deleted.error||!deleted.data){
   const reason=deleted.error?"failure":"conflict";
   await db.from("admin_audit_log").update({action:"personnel_incident_delete_"+reason}).eq("id",audit.data.id);
   if(deleted.error)throw deleted.error;
   return reply({error:"Suppression impossible : incident modifié entre-temps. Actualisez."},409);
  }
  let pdfRemoved=true;
  if(deleted.data.attachment_path){
   const storage=await db.storage.from(bucket).remove([deleted.data.attachment_path]);
   if(storage.error){pdfRemoved=false;console.error("Incident PDF cleanup failed",storage.error.message)}
  }
  const auditResult=await db.from("admin_audit_log").update({
   action:"personnel_incident_deleted",
   details:{
    event_date:previous.data.event_date,event_type:previous.data.event_type,personnel_name:previous.data.personnel_name,
    review_status:previous.data.review_status,payroll_action:previous.data.payroll_action,
    pdf_attached:Boolean(previous.data.attachment_path),pdf_removed:pdfRemoved,version,deleted_by:user.username
   }
  }).eq("id",audit.data.id);
  if(auditResult.error)console.error("Incident deletion audit finalization failed",auditResult.error.message);
  return reply({ok:true,deleted_id:id,pdf_removed:pdfRemoved,
   warning:pdfRemoved?null:"Incident supprimé, mais le PDF n'a pas pu être effacé du stockage privé. Contacter l'administration."});
 }
 if(action==="save"&&req.method==="POST"){
  if(user.readonly)return reply({error:"Lecture seule"},403);
  const x=await req.json(),name=staffName(x.personnel_name),date=x.event_date,type=x.event_type;
  if(!validDate(date)||!types.has(type)||name.length<2||name.length>150)return reply({error:"Date, catégorie ou nom invalide"},400);
  const existingId=x.id?String(x.id):null;
  const prior=existingId?await db.from("personnel_events").select("id,personnel_name,review_status,version").eq("id",existingId).maybeSingle():null;
  if(prior?.error)throw prior.error;
  if(existingId&&!prior?.data)return reply({error:"Événement introuvable"},404);
  if(existingId&&prior?.data?.review_status!=="a_verifier")return reply({error:"Événement déjà traité : modification impossible"},409);
  const key=staffKey(name);
  const personnel=await db.from("college_personnel").select("id,name,archived,visible_in_planning").eq("name_key",key).maybeSingle();
  if(personnel.error)throw personnel.error;
  const existingSameName=!!existingId&&staffKey(prior.data.personnel_name)===key;
  if(!existingSameName&&(!personnel.data||personnel.data.archived||!personnel.data.visible_in_planning))
   return reply({error:"Ce salarié n’apparaît pas dans le planning. Sélectionnez un salarié actif."},409);
  const canonicalName=existingSameName?prior.data.personnel_name:personnel.data.name;
  const all=Boolean(x.all_day),duration=durationValue(x.duration_minutes),details=String(x.details||"").trim();
  if(details.length>2000||(!all&&(!Number.isInteger(duration)||duration<1||duration>1440)))
   return reply({error:"Durée invalide : indiquez entre 1 et 1440 minutes, ou cochez journée entière."},400);
  const justification=just.has(x.justification_status)?x.justification_status:"non_requis";
  const input={event_date:date,personnel_name:canonicalName,event_type:type,all_day:all,start_time:null,end_time:null,duration_minutes:all?1440:duration,details,justification_status:justification,updated_by:user.username,updated_at:new Date().toISOString()};
  if(x.id){
   const q=await db.from("personnel_events").select("id,review_status,version").eq("id",x.id).maybeSingle();if(q.error)throw q.error;if(!q.data)return reply({error:"Événement introuvable"},404);
   if(q.data.review_status!=="a_verifier")return reply({error:"Événement déjà traité : modification impossible"},409);
   const patch={...input,review_status:"a_verifier",payroll_action:"a_examiner",payroll_note:"",version:q.data.version+1};
   const upd=await db.from("personnel_events").update(patch).eq("id",x.id).eq("version",q.data.version).select("id").maybeSingle();if(upd.error)throw upd.error;if(!upd.data)return reply({error:"Modification concurrente, actualisez"},409);
   return reply({ok:true,id:upd.data.id});
  }
  const ins=await db.from("personnel_events").insert({...input,created_by:user.username}).select("id").single();if(ins.error)throw ins.error;return reply({ok:true,id:ins.data.id});
 }
 if(action==="review"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Validation réservée aux droits Salaires"},403);
  const x=await req.json();if(!reviews.has(x.review_status)||!payroll.has(x.payroll_action))return reply({error:"Décision invalide"},400);
  if(x.review_status==="valide"&&x.payroll_action==="a_examiner")return reply({error:"Précisez le traitement de paie"},400);
  const note=String(x.payroll_note||"").trim();if(note.length>1000)return reply({error:"Note trop longue"},400);
  const old=await db.from("personnel_events").select("id,version").eq("id",x.id).maybeSingle();if(old.error)throw old.error;if(!old.data)return reply({error:"Événement introuvable"},404);
  const q=await db.from("personnel_events").update({review_status:x.review_status,payroll_action:x.payroll_action,payroll_note:note,reviewed_by:user.username,reviewed_at:new Date().toISOString(),updated_by:user.username,updated_at:new Date().toISOString(),version:old.data.version+1}).eq("id",x.id).eq("version",old.data.version).select("id").maybeSingle();
  if(q.error)throw q.error;if(!q.data)return reply({error:"Modification concurrente, actualisez"},409);return reply({ok:true});
 }
 return reply({error:"Action inconnue"},404);
 }catch(e){console.error("planning-personnel error",e);return reply({error:"Erreur interne, veuillez réessayer"},500)}
});