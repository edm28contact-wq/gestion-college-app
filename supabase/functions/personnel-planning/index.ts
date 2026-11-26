import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, authorization, x-admin-session, apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const enc=new TextEncoder();
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
function client(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");return createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64(s:string){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4);return Uint8Array.from(atob(p),c=>c.charCodeAt(0))}
function enc64(b:Uint8Array){return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function session(db:any,req:Request){try{
 const token=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /,"")||"";
 const parts=token.split(".");if(token.length>4096||parts.length!==2)return null;const [body,sig]=parts;if(!body||!sig)return null;
 const setting=await db.from("system_settings").select("admin_token").eq("id",1).single();if(setting.error||!setting.data)return null;
 const key=await crypto.subtle.importKey("raw",enc.encode(String(setting.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signed=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(body)));
 if(enc64(signed)!==sig)return null;
 const p=JSON.parse(new TextDecoder().decode(b64(body)));if(typeof p?.u!=="string"||!p.u||p.u.length>80||(p.scope!==undefined&&p.scope!=="central-admin")||p.r!==undefined||!Number.isFinite(Number(p.exp))||Number(p.exp)<=Date.now()||!Number.isFinite(Number(p.v)))return null;
 const q=await db.from("admin_accounts").select("username,active,central_active,role,permissions,must_change_password,session_version").eq("username",p.u).maybeSingle();
 const a=q.data;if(q.error||!a?.active||a.central_active===false||a.must_change_password===true||Number(a.session_version)!==Number(p.v))return null;
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

const clockPattern=/^([01]\d|2[0-3]):[0-5]\d$/;
const clockMinutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
function easterSunday(year:number){
 const a=year%19,b=Math.floor(year/100),cc=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),
 g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(cc/4),k=cc%4,
 l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
 return Date.UTC(year,Math.floor(n/31)-1,n%31+1);
}
function publicHoliday(date:string){
 const year=Number(date.slice(0,4));
 if(new Set(["01-01","05-01","05-08","07-14","08-15","11-01","11-11","12-25"]).has(date.slice(5)))return true;
 const easter=easterSunday(year),target=Date.parse(date+"T00:00:00Z");
 return [1,39,50].some(offset=>target===easter+offset*86400000);
}
function scheduleSlotsForDay(slots:unknown,weekday:number){
 if(!Array.isArray(slots))throw Error("Horaires hebdomadaires non renseignés");
 const rows=slots.filter((slot:any)=>slot?.day===weekday).map((slot:any)=>{
  const start=String(slot.start??""),end=String(slot.end??"");
  if(!clockPattern.test(start)||!clockPattern.test(end)||start>=end)throw Error("Créneau de travail incomplet");
  return {start,end,from:clockMinutes(start),to:clockMinutes(end)};
 }).sort((a,b)=>a.from-b.from);
 if(!rows.length)throw Error("Aucun horaire de travail renseigné pour cette journée");
 if(rows.some((row,i)=>i>0&&row.from<rows[i-1].to))throw Error("Chevauchement des créneaux du salarié");
 return rows;
}
async function dailySchedule(db:any,personnel:any,date:string){
 const weekday=new Date(date+"T12:00:00Z").getUTCDay();
 const archive=await db.from("college_personnel_schedule_history")
  .select("source_start,source_end,vacation_periods,vacation_weekly_work_slots")
  .eq("personnel_id",personnel.id).eq("schedule_scope","individual")
  .lte("source_start",date).gte("source_end",date).order("source_start",{ascending:false}).limit(5);
 if(archive.error)throw archive.error;
 const vacation=(archive.data||[]).find((record:any)=>
  Array.isArray(record.vacation_periods)&&record.vacation_periods.some((p:any)=>
   typeof p?.start==="string"&&typeof p?.end==="string"&&date>=p.start&&date<=p.end));
 if(personnel.exclude_public_holidays===true&&publicHoliday(date))
  throw Error("Jour férié non travaillé selon la fiche du salarié");
 if(vacation&&personnel.exclude_school_holidays===true)
  throw Error("Vacances scolaires non travaillées selon la fiche du salarié");
 const days=Array.isArray(personnel.working_weekdays)?personnel.working_weekdays:[];
 if(!vacation&&!days.includes(weekday))throw Error("Ce jour est non travaillé dans le planning");
 const source=vacation?.vacation_weekly_work_slots??personnel.weekly_work_slots;
 const slots=scheduleSlotsForDay(source,weekday);
 return {slots,source:vacation?"vacances scolaires":"période scolaire",scheduled_minutes:slots.reduce((n,s)=>n+s.to-s.from,0)};
}
async function computedAbsence(db:any,personnel:any,date:string,departure:string,returnAt:string|null,noReturn:boolean){
 if(!clockPattern.test(departure)||returnAt!==null&&!clockPattern.test(returnAt))
  throw Error("Heures invalides : format attendu HH:mm");
 if(returnAt===null&&!noReturn||returnAt!==null&&noReturn)
  throw Error("Indiquez l’heure de retour ou cochez « Pas de retour dans la journée »");
 const schedule=await dailySchedule(db,personnel,date),from=clockMinutes(departure),
  lastEnd=schedule.slots[schedule.slots.length-1].to,
  until=returnAt===null?lastEnd:clockMinutes(returnAt);
 if(until<=from)throw Error("L’heure de retour doit être postérieure au départ");
 const minutes=schedule.slots.reduce((n,slot)=>
  n+Math.max(0,Math.min(slot.to,until)-Math.max(slot.from,from)),0);
 if(minutes<=0)throw Error("Aucune minute d’absence ne recoupe les horaires de travail");
 return {duration_minutes:minutes,scheduled_minutes:schedule.scheduled_minutes,
  schedule_source:schedule.source,day_end:schedule.slots[schedule.slots.length-1].end,
  slots:schedule.slots.map(s=>({start:s.start,end:s.end}))};
}

const bucket="personnel-incident-pdfs";
const maxPdf=6291456;
async function findEvent(db:any,id:string){return await db.from("personnel_events").select("id,attachment_path,attachment_name,attachment_size_bytes,review_status,version").eq("id",id).maybeSingle()}

function normalizeStaffBank(input:any){
 if(typeof input?.iban!=="string"||typeof input?.bic!=="string"||input.iban.length>80||input.bic.length>30)return null;
 const iban=input.iban.replace(/\s/g,"").toUpperCase(),bic=input.bic.trim().toUpperCase();
 if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith("FR")&&iban.length!==27)||!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic))return null;
 let remainder=0;
 for(const ch of iban.slice(4)+iban.slice(0,4)){
  const digits=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;
  for(const d of digits)remainder=(remainder*10+Number(d))%97;
 }
 return remainder===1?{iban,bic}:null;
}
function staffBankSummary(row:any){
 return row?{iban_last4:String(row.iban).slice(-4),bic:row.bic,version:row.version}:null;
}
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
    .select("id,event_date,personnel_id,personnel_name,event_type,review_status")
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
    const person=e.personnel_id||String(e.personnel_name||"").normalize("NFKC").replace(/\s+/g," ").trim().toLocaleLowerCase("fr");
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
 if(action==="staff-schedule-history"&&req.method==="GET"){
  if(!user.admin)return reply({error:"Consultation des archives horaires non autorisée"},403);
  const q=await db.from("college_personnel_schedule_history")
   .select("id,personnel_id,employee_name,schedule_scope,source_sheet_name,source_start,source_end,school_weekly_work_slots,vacation_weekly_work_slots,vacation_periods,source_document")
   .order("employee_name",{ascending:true}).order("source_start",{ascending:false}).limit(200);
  if(q.error)throw q.error;
  if((q.data||[]).length===200)return reply({error:"Liste des archives incomplète"},409);
  return reply({ok:true,history:q.data||[]});
 }
 if(action==="staff-bank-detail"&&req.method==="GET"){
  if(!user.salaryWrite)return reply({error:"Accès bancaire réservé aux droits de modification des salaires"},403);
  const id=new URL(req.url).searchParams.get("id");
  if(!isUuid(id))return reply({error:"Salarié invalide"},400);
  const person=await db.from("college_personnel").select("id").eq("id",id).maybeSingle();
  if(person.error)return reply({error:"Consultation bancaire indisponible"},500);
  if(!person.data)return reply({error:"Salarié introuvable"},404);
  const q=await db.from("college_personnel_bank_details").select("personnel_id,iban,bic,version").eq("personnel_id",id).maybeSingle();
  if(q.error)return reply({error:"Consultation bancaire indisponible"},500);
  return reply({ok:true,bank:q.data||null});
 }
 if(action==="staff-bank-payroll"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Accès bancaire réservé aux droits de modification des salaires"},403);
  const x=await req.json().catch(()=>null),ids=x?.ids;
  if(!Array.isArray(ids)||ids.length>500||!ids.every(isUuid)||new Set(ids).size!==ids.length)return reply({error:"Liste de salariés invalide"},400);
  const banks=[];
  for(let offset=0;offset<ids.length;offset+=50){
   const q=await db.from("college_personnel_bank_details").select("personnel_id,iban,bic,version").in("personnel_id",ids.slice(offset,offset+50));
   if(q.error)return reply({error:"Consultation bancaire indisponible"},500);
   banks.push(...(q.data||[]));
  }
  return reply({ok:true,banks});
 }
 if(action==="staff-bank-save"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification bancaire réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),bank=normalizeStaffBank(x);
  if(!isUuid(x?.id)||!Number.isInteger(x?.version)||x.version<0||x.version>=2147483647||!bank||x.confirmed!==true)return reply({error:"Vérifiez l’IBAN, le BIC et la confirmation du RIB."},400);
  const staff=await db.from("college_personnel").select("id").eq("id",x.id).maybeSingle();
  if(staff.error)return reply({error:"Enregistrement bancaire indisponible"},500);
  if(!staff.data)return reply({error:"Salarié introuvable"},404);
  const q=await db.rpc("college_save_personnel_bank",{p_personnel_id:x.id,p_iban:bank.iban,p_bic:bank.bic,p_version:x.version,p_actor:user.username});
  if(q.error)return reply({error:"Enregistrement bancaire refusé. Aucun changement confirmé."},500);
  if(q.data===null)return reply({error:"Coordonnées modifiées entre-temps. Fermez la fenêtre et rechargez la fiche."},409);
  return reply({ok:true,bank:staffBankSummary({...bank,version:q.data})});
 }
 if(action==="legal-navigo-annuel"&&req.method==="GET"){
  if(!user.admin)return reply({error:"Lecture des barèmes de paie non autorisée"},403);
  const rawYear=new URL(req.url).searchParams.get("year")||"";
  const year=Number(rawYear);
  const current=Number(new Intl.DateTimeFormat("en",{timeZone:"Europe/Paris",year:"numeric"}).format(new Date()));
  if(!/^\d{4}$/.test(rawYear)||year<2026||year>current+1)return reply({error:"Année de barème invalide"},400);
  const source="https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel";
  // Barème 2026 déjà vérifié et figé pour éviter de réécrire les anciens mois.
  if(year===2026)return reply({ok:true,rate:{year,annualCents:99880,paidMonthCents:9080,payments:11,months:12,
   status:"verified",effectiveFrom:"2026-01-01",source:"https://www.iledefrance-mobilites.fr/tarifs-titre-de-transport-en-commun-2026",sourceLabel:"Île-de-France Mobilités : tarifs 2026",
   verifiedAt:"2026-11-26",tariffVersion:"navigo-annuel-2026"}});
  const pending=(reason:string)=>reply({ok:true,rate:null,year,status:"pending",source,reason});
  try{
   const ctrl=AbortSignal.timeout(8000);
   const [page,prices]=await Promise.all([
    fetch(source,{signal:ctrl,headers:{"Accept":"text/html"},redirect:"follow"}),
    fetch("https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs/records?limit=50",
     {signal:ctrl,headers:{"Accept":"application/json"},redirect:"follow"})
   ]);
   if(!page.ok||!prices.ok)return pending("Données officielles momentanément indisponibles.");
   const html=await page.text(),payload=await prices.json();
   const item=Array.isArray(payload?.results)?payload.results.find((x:any)=>x?.product_name==="Forfait Navigo Annuel"&&x?.url===source):null;
   const rawPrice=String(item?.price||"").trim().replace(/[\u00a0\u202f ]/g,"");
   if(!/^\d{1,4},\d{2}€$/.test(rawPrice)||item?.price_period!=="par mois")return pending("Tarif officiel non lisible.");
   // Convertit strictement les euros en centimes, sans parseFloat susceptible de tronquer.
   const [eur,cts]=rawPrice.slice(0,-1).split(",");
   const cents=Number(eur)*100+Number(cts);
   const stripped=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&#x202f;|&thinsp;/gi," ")
    .replace(/&euro;/gi,"€").replace(/\s+/g," ");
   const confirmed=stripped.match(/Tarifs du forfait applicables au 1er janvier\s+(\d{4})/i);
   const price=stripped.match(/Toutes zones\s+1\s+à\s+5\s+(\d{1,4}[,.]\d{2})\s*€/i);
   if(!confirmed||Number(confirmed[1])!==year||!price||Math.round(Number(price[1].replace(",","."))*100)!==cents)
    return pending("Le tarif en vigueur pour cette année n’est pas encore publié et concordant.");
   if(cents<1000||cents>20000)return pending("Tarif hors plage de contrôle.");
   return reply({ok:true,rate:{year,annualCents:cents*11,paidMonthCents:cents,payments:11,months:12,
    status:"verified",effectiveFrom:year+"-01-01",source,sourceLabel:"Île-de-France Mobilités : Navigo Annuel toutes zones",
    verifiedAt:new Date().toISOString(),tariffVersion:"navigo-annuel-"+year}});
  }catch{return pending("Impossible de vérifier automatiquement le tarif officiel ; aucun montant n’est extrapolé.");}
 }
 if(action==="staff-list"&&req.method==="GET"){
  const q=await db.from("college_personnel").select("id,name,name_key,visible_in_planning,archived,working_weekdays,weekly_work_slots,benefits_in_kind,navigo_reimbursement,exclude_school_holidays,exclude_public_holidays,professional_role_id,created_at,updated_at").order("name",{ascending:true}).limit(500);
  if(q.error)throw q.error;
  if((q.data||[]).length===500)return reply({error:"Liste du personnel trop importante pour être affichée entièrement"},409);
  const roles=user.admin?await db.from("college_personnel_roles").select("id,label,updated_at").order("label"):null;
  if(roles?.error)throw roles.error;
  let salaryStaff=q.data||[];
  let bankAvailable=false;
  if(user.admin){
   const bank=await db.from("college_personnel_bank_details").select("personnel_id,iban,bic,version").limit(500);
   if(!bank.error){
    const summaries=new Map((bank.data||[]).map((r:any)=>[r.personnel_id,staffBankSummary(r)]));
    salaryStaff=salaryStaff.map((r:any)=>({...r,bank_summary:summaries.get(r.id)||null}));
    bankAvailable=true;
   }
  }
  return reply({ok:true,staff:user.admin?salaryStaff:(q.data||[]).filter((x:any)=>!x.archived&&x.visible_in_planning).map((x:any)=>({id:x.id,name:x.name,name_key:x.name_key,visible_in_planning:x.visible_in_planning,archived:x.archived})),roles:roles?.data||[],admin:user.admin,salary_write:user.salaryWrite,bank_available:bankAvailable});
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
 if(action==="staff-profile-update"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification du personnel réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),name=staffName(x?.name),key=staffKey(name);
  const roleId=x?.professional_role_id??null;
  if(!isUuid(x?.id)||name.length<2||name.length>120||key.length<2||key.length>120||
     (roleId!==null&&!isUuid(roleId))||typeof x?.updated_at!=="string"||!Number.isFinite(Date.parse(x.updated_at)))
   return reply({error:"Nom, rôle ou version de la fiche invalide"},400);
  const q=await db.rpc("college_update_personnel_profile",{p_id:x.id,p_name:name,p_name_key:key,p_role_id:roleId,p_updated_at:x.updated_at,p_actor:user.username});
  if(q.error)throw q.error;
  const errors:Record<string,[string,number]>={not_found:["Salarié introuvable",404],conflict:["La fiche a été modifiée. Actualisez avant de recommencer.",409],role_not_found:["Rôle professionnel introuvable",400],duplicate_name:["Ce nom est déjà utilisé par un autre salarié ou agent de cuisine.",409],kitchen_name_too_long:["Nom limité à 80 caractères pour un agent de cuisine.",400]};
  if(q.data?.error){const error=errors[q.data.error]||["Modification impossible",409];return reply({error:error[0]},error[1]);}
  if(!q.data?.staff)return reply({error:"Modification non confirmée"},500);
  return reply({ok:true,staff:q.data.staff});
 }
 if(action==="staff-role-save"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification des rôles réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),label=staffName(x?.label),key=staffKey(label);
  if(label.length<2||label.length>100||key.length<2||key.length>100||(x?.id!=null&&!isUuid(x.id)))
   return reply({error:"Intitulé de rôle invalide (2 à 100 caractères)"},400);
  const payload={label,label_key:key,updated_by:user.username,updated_at:new Date().toISOString()};
  const q=x?.id
   ?await db.from("college_personnel_roles").update(payload).eq("id",x.id).select("id,label,updated_at").maybeSingle()
   :await db.from("college_personnel_roles").insert(payload).select("id,label,updated_at").single();
  if(q.error?.code==="23505")return reply({error:"Ce rôle existe déjà"},409);
  if(q.error)throw q.error;if(!q.data)return reply({error:"Rôle introuvable"},404);
  return reply({ok:true,role:q.data},x?.id?200:201);
 }
 if(action==="staff-add"&&req.method==="POST"){
  if(!user.salaryWrite)return reply({error:"Modification du personnel réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null),name=staffName(x?.name),key=staffKey(name);
  if(name.length<2||name.length>120||key.length<2||key.length>120)return reply({error:"Nom invalide (2 à 120 caractères)"},400);
  const roleId=x?.professional_role_id??null;
  if(roleId!==null&&!isUuid(roleId))return reply({error:"Rôle invalide"},400);
  if(roleId!==null){const role=await db.from("college_personnel_roles").select("id").eq("id",roleId).maybeSingle();if(role.error)throw role.error;if(!role.data)return reply({error:"Rôle professionnel introuvable"},400);}
  const q=await db.from("college_personnel").insert({name,name_key:key,professional_role_id:roleId,visible_in_planning:x?.visible_in_planning===true,archived:false,created_by:user.username,updated_by:user.username}).select("id,name,visible_in_planning,archived,professional_role_id").single();
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
  if(!user.salaryWrite)return reply({error:"Modification du personnel réservée aux droits Salaires"},403);
  const x=await req.json().catch(()=>null);
  if(!isUuid(x?.id))return reply({error:"Salarié invalide"},400);
  const days=x?.working_weekdays;
  if(!Array.isArray(days)||days.length>7||!days.every((d:any)=>Number.isInteger(d)&&d>=0&&d<=6)||new Set(days).size!==days.length)
   return reply({error:"Jours travaillés invalides"},400);
  const benefits=x?.benefits_in_kind;
  const benefitTypes=new Set(["manual","meal","vehicle","housing","technology"]);
  const detailFields=new Set(["mealsCount","mealMode","employeePaidPerMeal","dutyMeal",
   "vehicleKind","vehicleEvaluation","vehicleAssignedDate","vehicleAge","vehicleFullMonth","vehicleElectric","vehicleEcoScore","vehicleFuelMode",
   "vehiclePurchasePrice","vehicleRentalAnnual","vehicleLessorPurchasePrice","vehicleFuelPrivateAnnual","vehicleFuelTotalAnnual","vehicleInsuranceAnnual",
   "vehicleMaintenanceAnnual","vehicleKmPrivate","vehicleKmTotal","vehicleEmployeeContribution",
   "housingMode","housingLeaseHolder","housingShared","housingServiceNecessity","housingWeeks","housingGross","housingRooms","housingRentalValue","housingExpenses","housingEmployeeContribution",
   "techMode","techPrivateUse","techIncidentalUse","techDeviceCost","techSubscriptionAnnual","techPrivateAnnual","techEmployeeContribution"]);
  if(!Array.isArray(benefits)||benefits.length>30||!benefits.every((b:any)=>{
   if(!b||typeof b.label!=="string"||!b.label.trim()||b.label.trim().length>100||
    typeof b.amount!=="number"||!Number.isFinite(b.amount)||b.amount<0||b.amount>100000||
    Math.abs(Math.round(b.amount*100)-b.amount*100)>=1e-7)return false;
   if(b.kind===undefined)return true; // Compatibilité des fiches historiques.
   if(!benefitTypes.has(b.kind)||!["ok","excluded","manual"].includes(b.status)||
    typeof b.confirmed!=="boolean"||b.kind==="manual"&&b.confirmed!==true||
    b.kind!=="manual"&&b.status==="manual")return false;
   if(typeof b.details!=="object"||!b.details||Array.isArray(b.details))return false;
   const fields=Object.entries(b.details);
   if(fields.length>45||!fields.every(([key,value])=>detailFields.has(key)&&typeof value==="string"&&value.length<=40&&
     !/[\u0000-\u001f]/.test(value)))return false;
   if(b.ruleVersion!==undefined&&(typeof b.ruleVersion!=="string"||b.ruleVersion.length>90))return false;
   return true;
  }))return reply({error:"Avantage incomplet : répondez aux questions obligatoires et vérifiez les calculs."},400);
  const clean=benefits.map((b:any)=>b.kind===undefined?{label:b.label.trim(),amount:b.amount}:
   {label:b.label.trim(),amount:b.amount,kind:b.kind,details:b.details,status:b.status,
    confirmed:b.confirmed,ruleVersion:String(b.ruleVersion||"").slice(0,90)});
  const school=x?.exclude_school_holidays,holidays=x?.exclude_public_holidays;
  if(school!==undefined&&typeof school!=="boolean"||holidays!==undefined&&typeof holidays!=="boolean")return reply({error:"Paramètres de calendrier invalides"},400);
  const current=await db.from("college_personnel").select("id,weekly_work_slots,updated_at").eq("id",x.id).maybeSingle();
  if(current.error)throw current.error;
  if(!current.data)return reply({error:"Salarié introuvable"},404);
  if(x.updated_at!==undefined&&(typeof x.updated_at!=="string"||x.updated_at!==current.data.updated_at))
   return reply({error:"La fiche a été modifiée. Fermez puis rouvrez la fiche avant de recommencer."},409);
  // Older clients may edit working days without sending the time slots.
  const slots=x.weekly_work_slots===undefined?(current.data.weekly_work_slots||[]).filter((slot:any)=>days.includes(slot.day)):x.weekly_work_slots;
  const time=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  if(!Array.isArray(slots)||slots.length>56||!slots.every((slot:any)=>slot&&typeof slot==="object"&&Number.isInteger(slot.day)&&days.includes(slot.day)&&typeof slot.start==="string"&&typeof slot.end==="string"&&time.test(slot.start)&&time.test(slot.end)&&slot.start<slot.end))
   return reply({error:"Créneaux horaires invalides : début et fin le même jour, sur un jour travaillé."},400);
  const cleanSlots=slots.map((slot:any)=>({day:slot.day,start:slot.start,end:slot.end})).sort((a:any,b:any)=>a.day-b.day||a.start.localeCompare(b.start));
  const valid=await db.rpc("college_valid_weekly_work_slots",{p_slots:cleanSlots,p_days:days});
  if(valid.error)throw valid.error;
  if(valid.data!==true)return reply({error:"Les créneaux ne doivent pas se chevaucher (8 créneaux maximum par jour)."},400);
  const payload:any={working_weekdays:[...days].sort((a:number,b:number)=>a-b),weekly_work_slots:cleanSlots,benefits_in_kind:clean,updated_at:new Date().toISOString(),updated_by:user.username};
  if(school!==undefined)payload.exclude_school_holidays=school;
  if(holidays!==undefined)payload.exclude_public_holidays=holidays;
  const q=await db.from("college_personnel").update(payload).eq("id",x.id).eq("updated_at",current.data.updated_at).select("id,name,working_weekdays,weekly_work_slots,benefits_in_kind,exclude_school_holidays,exclude_public_holidays,updated_at").maybeSingle();
  if(q.error)throw q.error;
  if(!q.data)return reply({error:"Modification concurrente : actualisez la fiche."},409);
  return reply({ok:true,staff:q.data});
 }
 if((action==="list"||action==="admin-list")&&req.method==="GET"){
  if(action==="admin-list"&&!user.admin)return reply({error:"Accès réservé à l’administration"},403);
  const url=new URL(req.url),month=url.searchParams.get("month")||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return reply({error:"Mois invalide"},400);
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1));
  const next=end.toISOString().slice(0,10);
  const q=await db.from("personnel_events").select("*").gte("event_date",month+"-01").lt("event_date",next).order("event_date",{ascending:true}).order("created_at",{ascending:true}).limit(1000);
  if(q.error)throw q.error;if((q.data||[]).length===1000)return reply({error:"Le nombre d’événements dépasse la limite de consultation. Contactez l’administration technique pour obtenir un export complet."},409);
  const events=q.data||[],ids=[...new Set(events.map((e:any)=>e.personnel_id).filter(Boolean))];
  const people=ids.length?await db.from("college_personnel").select("id,name").in("id",ids):null;
  if(people?.error)throw people.error;
  const names=new Map((people?.data||[]).map((p:any)=>[p.id,p.name]));
  return reply({events:events.map((e:any)=>({...e,personnel_name_snapshot:e.personnel_name,personnel_name:names.get(e.personnel_id)||e.personnel_name})),role:user.admin?"admin":"secretariat",read_only:user.readonly});
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
 if(action==="schedule-duration"&&req.method==="POST"){
  const x=await req.json().catch(()=>null);
  const date=x?.event_date,name=staffName(x?.personnel_name);
  const type=x?.event_type;
  if(!validDate(date)||name.length<2||!["absence","depart_anticipe"].includes(type))
   return reply({error:"Date, salarié ou type de sortie invalide"},400);
  const person=await db.from("college_personnel")
   .select("id,name,archived,visible_in_planning,working_weekdays,weekly_work_slots,exclude_public_holidays,exclude_school_holidays")
   .eq("name_key",staffKey(name)).maybeSingle();
  if(person.error)throw person.error;
  if(!person.data||person.data.archived||!person.data.visible_in_planning)
   return reply({error:"Salarié non actif dans le planning"},409);
  const departure=String(x.departure_time??""),ret=x.no_return===true?null:String(x.return_time??"");
  try{
   const calc=await computedAbsence(db,person.data,date,departure,ret,x.no_return===true);
   return reply({ok:true,...calc});
  }catch(error){return reply({error:error instanceof Error?error.message:"Horaires invalides"},422)}
 }
 if(action==="save"&&req.method==="POST"){
  if(user.readonly)return reply({error:"Lecture seule"},403);
  const x=await req.json(),name=staffName(x.personnel_name),date=x.event_date,type=x.event_type;
  if(!validDate(date)||!types.has(type)||name.length<2||name.length>150)return reply({error:"Date, catégorie ou nom invalide"},400);
  const existingId=x.id?String(x.id):null;
  const prior=existingId?await db.from("personnel_events").select("id,personnel_id,personnel_name,review_status,version").eq("id",existingId).maybeSingle():null;
  if(prior?.error)throw prior.error;
  if(existingId&&!prior?.data)return reply({error:"Événement introuvable"},404);
  if(existingId&&prior?.data?.review_status!=="a_verifier")return reply({error:"Événement déjà traité : modification impossible"},409);
  const key=staffKey(name);
  const personnel=await db.from("college_personnel").select("id,name,archived,visible_in_planning,working_weekdays,weekly_work_slots,exclude_public_holidays,exclude_school_holidays").eq("name_key",key).maybeSingle();
  if(personnel.error)throw personnel.error;
  const existingSameName=!!existingId&&(prior.data.personnel_id
   ?prior.data.personnel_id===personnel.data?.id
   :staffKey(prior.data.personnel_name)===key);
  if(!existingSameName&&(!personnel.data||personnel.data.archived||!personnel.data.visible_in_planning))
   return reply({error:"Ce salarié n’apparaît pas dans le planning. Sélectionnez un salarié actif."},409);
  const canonicalName=existingSameName?prior.data.personnel_name:personnel.data.name;
  const personnelId=existingSameName?(prior.data.personnel_id??personnel.data?.id??null):personnel.data.id;
  const all=Boolean(x.all_day),manualDuration=durationValue(x.duration_minutes),details=String(x.details||"").trim();
  if(details.length>2000)return reply({error:"Observation trop longue"},400);
  const auto=x.time_based===true;
  if(auto&&(!["absence","depart_anticipe"].includes(type)||all))
   return reply({error:"Le calcul horaire concerne uniquement les absences et départs anticipés partiels"},400);
  let duration:number|null=all?1440:manualDuration;
  let startTime:string|null=null,endTime:string|null=null;
  if(auto){
   if(!personnel.data||personnel.data.archived||!personnel.data.visible_in_planning)
    return reply({error:"Le calcul automatique exige un salarié actif avec horaires configurés"},409);
   const departure=String(x.departure_time??""),ret=x.no_return===true?null:String(x.return_time??"");
   try{
    const computed=await computedAbsence(db,personnel.data,date,departure,ret,x.no_return===true);
    duration=computed.duration_minutes;startTime=departure;endTime=ret;
   }catch(error){return reply({error:error instanceof Error?error.message:"Horaires de travail incorrects"},422)}
  }else if(!all&&(!Number.isInteger(duration)||duration<1||duration>1440))
   return reply({error:"Durée invalide : renseignez un départ/retour ou saisissez une durée valide"},400);
  const justification=just.has(x.justification_status)?x.justification_status:"non_requis";
  const input={event_date:date,personnel_id:personnelId,personnel_name:canonicalName,event_type:type,all_day:all,start_time:startTime,end_time:endTime,duration_minutes:duration,details,justification_status:justification,updated_by:user.username,updated_at:new Date().toISOString()};
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