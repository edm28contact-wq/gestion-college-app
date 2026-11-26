import {createClient} from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, x-admin-session, authorization, apikey","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const enc=new TextEncoder();
function client(){
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const key=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key)throw Error("Service non configuré");
 return createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
const un64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
const en64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
async function actor(db:any,req:Request){
 try{
  const value=req.headers.get("x-admin-session")||req.headers.get("authorization")?.replace(/^Bearer /i,"")||"";
  const parts=value.split(".");
  if(value.length>4096||parts.length!==2||!parts[0]||!parts[1])return null;
  const keyRow=await db.from("system_settings").select("admin_token").eq("id",1).single();
  if(keyRow.error||!keyRow.data)return null;
  const key=await crypto.subtle.importKey("raw",enc.encode(String(keyRow.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(parts[0])));
  if(en64(signed)!==parts[1])return null;
  const payload=JSON.parse(new TextDecoder().decode(un64(parts[0])));
  if(typeof payload?.u!=="string"||!payload.u||payload.u.length>80||
   payload.scope!==undefined&&payload.scope!=="central-admin"||payload.r!==undefined||
   !Number.isFinite(Number(payload.exp))||Number(payload.exp)<=Date.now()||
   !Number.isSafeInteger(Number(payload.v)))return null;
  const row=await db.from("admin_accounts").select("username,active,central_active,role,permissions,session_version,must_change_password").eq("username",payload.u).maybeSingle();
  const a=row.data;
  if(row.error||!a?.active||a.central_active===false||a.must_change_password===true||Number(a.session_version)!==Number(payload.v))return null;
  const p=a.permissions||{};
  const write=p.readonly!==true&&(a.role==="admin"||p.college_admin===true||p["college.salaires.write"]===true);
  return write?{username:a.username}:null;
 }catch{return null}
}
const validMonth=(month:unknown)=>typeof month==="string"&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
const validUuid=(id:unknown)=>typeof id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const amount=(v:unknown)=>typeof v==="string"&&v.length<=16&&(!v.trim()||/^\d{1,9}(?:[.,]\d{1,2})?$/.test(v.trim().replace(/[\u00a0\u202f ]/g,"")));
const toCents=(value:string)=>{const s=value.trim().replace(/[\u00a0\u202f ]/g,"").replace(",",".").split(".");return Number(s[0])*100+Number((s[1]||"").padEnd(2,"0"))};
const field=(o:any,k:string,max:number)=>{const v=o?.[k];if(v===undefined)return "";if(typeof v!=="string"||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw Error("Champ invalide : "+k);return v};
const ledgerKeys=["salary","benefits","tese","unemployment","apec","retirement","health","insurance","training","transport","ppv","termination","advances","withholding","payable","tese_credit","salary_tax_credit","salary_tax_debit"];
const issuerKeys:Record<string,number>={name:70,iban:42,bic:11,number:35,date:10,filename:100,label:140};
const beneficiaryKeys:Record<string,number>={matricule:35,creditorName:70,rowOrder:4,country:2,postcode:16,city:35,address:70,comment:140};
const declarationKeys:Record<string,number>={nir:32,contract:100,function:160,status:100,start:10,end:10,hours:40,rate:40,gross:40,transport:40,health:40,adjustments:1000,absence:1000,absencePay:1000,comments:1000,internal:1000};
const preparationKeys:Record<string,number>={zone:12,ticketCost:16,weeklyHours:12,fullTimeHours:12,employerRate:12,mealsCount:5,employeePaidPerMeal:16,dutyMeal:3};
function safeDict(input:any,shape:Record<string,number>){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Champs invalides.");
 const output:Record<string,string>={};
 for(const [key,max] of Object.entries(shape))if(Object.hasOwn(input,key))output[key]=field(input,key,max);
 return output;
}
function safeDraft(raw:any,month:string){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||raw.month!==month||![1,2].includes(raw.version))throw Error("Dossier ou période invalide.");
 if(!raw.values||typeof raw.values!=="object"||Array.isArray(raw.values))throw Error("Lignes comptables invalides.");
 const values:Record<string,string>={};
 for(const k of ledgerKeys)if(Object.hasOwn(raw.values,k)){
  if(!amount(raw.values[k]))throw Error("Montant comptable invalide.");
  values[k]=raw.values[k];
 }
 if(!Array.isArray(raw.payments)||raw.payments.length>500||!Array.isArray(raw.bank?.beneficiaries)||raw.bank.beneficiaries.length>500||!Array.isArray(raw.declarations)||raw.declarations.length>500||(raw.preparation!==undefined&&(!Array.isArray(raw.preparation)||raw.preparation.length>500)))throw Error("Liste de salariés invalide.");
 const ids=new Set<string>(),payments:[string,string][]=[];
 for(const row of raw.payments){
  if(!Array.isArray(row)||row.length!==2||!validUuid(row[0])||ids.has(row[0])||!amount(row[1]))throw Error("Salarié ou net à payer invalide.");
  ids.add(row[0]);payments.push([row[0],row[1]]);
 }
 const bankIds=new Set<string>(),beneficiaries:[string,Record<string,string>][]=[];
 for(const row of raw.bank.beneficiaries){
  if(!Array.isArray(row)||row.length!==2||!ids.has(row[0])||bankIds.has(row[0]))throw Error("Bénéficiaire invalide.");
  bankIds.add(row[0]);beneficiaries.push([row[0],safeDict(row[1],beneficiaryKeys)]);
 }
 const declarationIds=new Set<string>(),declarations:[string,Record<string,string>][]=[];
 for(const row of raw.declarations){
  if(!Array.isArray(row)||row.length!==2||!validUuid(row[0])||declarationIds.has(row[0]))throw Error("Déclaration de salarié invalide.");
  declarationIds.add(row[0]);declarations.push([row[0],safeDict(row[1],declarationKeys)]);
 }
 const preparation:[string,Record<string,string>][]=[];
 const pids=new Set<string>();
 for(const item of raw.preparation||[]){
  if(!Array.isArray(item)||item.length!==2||!validUuid(item[0])||pids.has(item[0]))throw Error("Détails du mois invalides.");
  pids.add(item[0]);
  const values=safeDict(item[1],preparationKeys);
  if(values.zone&&!["none","1-5","2-3","3-4","4-5","custom"].includes(values.zone))throw Error("Abonnement Navigo invalide.");
  if(values.dutyMeal&&!["yes","no"].includes(values.dutyMeal))throw Error("Type de repas invalide.");
  const caps:Record<string,number>={ticketCost:10000,weeklyHours:60,fullTimeHours:60,employerRate:100,mealsCount:100,employeePaidPerMeal:100};
  for(const [key,cap] of Object.entries(caps)){
   const val=values[key];if(val===undefined||val==="")continue;
   if(!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(val)||Number(val.replace(",","."))>cap)throw Error("Valeur de calcul invalide : "+key);
  }
  preparation.push([item[0],values]);
 }
 const reason=field(raw.reconciliation||{},"reason",1000);
 const data={version:2,month,values,payments,
  reconciliation:{reason},
  bank:{issuer:safeDict(raw.bank.issuer||{},issuerKeys),beneficiaries},
  declarations,preparation};
 if(enc.encode(JSON.stringify(data)).length>180000)throw Error("Dossier trop volumineux.");
 return data;
}
async function validStaff(db:any,draft:any){
 const ids=[...new Set([...draft.payments.map((p:[string,string])=>p[0]),...draft.declarations.map((p:[string,unknown])=>p[0]),...draft.preparation.map((p:[string,unknown])=>p[0])])];
 for(let offset=0;offset<ids.length;offset+=100){
  const subset=ids.slice(offset,offset+100);
  const result=await db.from("college_personnel").select("id").in("id",subset);
  if(result.error)throw Error("Vérification du personnel indisponible.");
  if(result.data?.length!==subset.length)throw Error("Un salarié du dossier n'existe plus.");
 }
}
function totals(draft:any){
 let total=0,count=0;
 for(const [,value] of draft.payments){
  if(!value.trim())throw Error("Un montant net à payer est manquant.");
  const cents=toCents(value);
  if(!Number.isSafeInteger(cents)||cents<0)throw Error("Montant net invalide.");
  if(cents>0){total+=cents;count++;}
 }
 return {totalCents:total,count};
}
const publicFields="month,status,version,updated_at,updated_by,created_at,export_info,bank_reference,status_note";
async function history(db:any,month:string){
 const result=await db.from("college_payroll_audit").select("actor,action,old_status,new_status,version,note,created_at").eq("month",month).order("id",{ascending:false}).limit(30);
 if(result.error)throw Error("Historique inaccessible.");
 return result.data||[];
}
function defaultsFor(row:any,month:string){
 const old=row?.draft?.bank||{};
 const issuer:Record<string,string>={};
 for(const key of ["name","iban","bic","number"])if(typeof old.issuer?.[key]==="string")issuer[key]=old.issuer[key];
 issuer.filename="Salaires "+month.slice(5)+"-"+month.slice(0,4);
 const beneficiaries=(Array.isArray(old.beneficiaries)?old.beneficiaries:[]).filter((x:any)=>Array.isArray(x)&&validUuid(x[0])).map(([id,b]:[string,any])=>[id,safeDict(b||{},beneficiaryKeys)]);
 return {issuer,beneficiaries};
}
async function readBody(req:Request){
 const contentLength=Number(req.headers.get("content-length")||0);
 if(contentLength>210000)throw Error("Données trop volumineuses.");
 const text=await req.text();
 if(text.length>200000)throw Error("Données trop volumineuses.");
 try{return JSON.parse(text)}catch{throw Error("Corps JSON invalide.")}
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(!["GET","POST"].includes(req.method))return reply({error:"Méthode interdite"},405);
  const db=client(),a=await actor(db,req);
  if(!a)return reply({error:"Session expirée ou accès Compta salaire interdit."},401);
  const url=new URL(req.url),mode=url.searchParams.get("mode")||"load";
  if(mode==="list"&&req.method==="GET"){
   const result=await db.from("college_payroll_months").select("month,status,version,updated_at,updated_by,bank_reference,export_info").order("month",{ascending:false}).limit(72);
   if(result.error)throw Error("Liste de paie inaccessible.");
   return reply({ok:true,months:result.data||[]});
  }
  const body=req.method==="POST"?await readBody(req):{};
  const month=req.method==="GET"?url.searchParams.get("month"):body?.month;
  if(!validMonth(month))return reply({error:"Mois invalide."},400);
  if(mode==="load"&&req.method==="GET"){
   const row=await db.from("college_payroll_months").select(publicFields+",draft").eq("month",month).maybeSingle();
   if(row.error)throw Error("Dossier de paie inaccessible.");
   if(row.data)return reply({ok:true,exists:true,record:row.data,history:await history(db,month)});
   const previous=await db.from("college_payroll_months").select("draft").lt("month",month).order("month",{ascending:false}).limit(1);
   if(previous.error)throw Error("Paramètres de paie indisponibles.");
   return reply({ok:true,exists:false,record:null,defaults:defaultsFor(previous.data?.[0],month),history:[]});
  }
  if(mode==="save"&&req.method==="POST"){
   if(!Number.isInteger(body?.version)||body.version<0||body.version>2147483600)return reply({error:"Version du dossier invalide."},400);
   let draft;try{draft=safeDraft(body.draft,month)}catch(e){return reply({error:String((e as Error).message)},400)}
   await validStaff(db,draft);
   const stamp=new Date().toISOString();
   if(body.version===0){
    const created=await db.from("college_payroll_months").insert({month,draft,status:"draft",version:1,updated_by:a.username,updated_at:stamp}).select(publicFields).single();
    if(created.error){if(created.error.code==="23505")return reply({error:"Dossier déjà créé sur un autre onglet. Rechargez les données."},409);throw Error("Création de dossier indisponible.");}
    return reply({ok:true,record:created.data});
   }
   const updated=await db.from("college_payroll_months").update({draft,version:body.version+1,updated_at:stamp,updated_by:a.username}).eq("month",month).eq("version",body.version).eq("status","draft").select(publicFields).maybeSingle();
   if(updated.error)throw Error("Enregistrement indisponible.");
   if(!updated.data)return reply({error:"Le dossier a été modifié par un autre utilisateur ou son statut interdit la modification. Rechargez-le."},409);
   return reply({ok:true,record:updated.data});
  }
  if(mode==="status"&&req.method==="POST"){
   if(!Number.isInteger(body?.version)||body.version<1||body.version>2147483600)return reply({error:"Version de suivi invalide."},400);
   const row=await db.from("college_payroll_months").select(publicFields+",draft").eq("month",month).maybeSingle();
   if(row.error)throw Error("Suivi indisponible.");
   const record=row.data;
   if(!record||record.version!==body.version)return reply({error:"Dossier modifié depuis votre dernière lecture. Rechargez-le."},409);
   const action=body.action;
   const rule:Record<string,string[]>={exported:["draft"],submitted:["exported"],paid:["submitted"],rejected:["exported","submitted"],draft:["exported","rejected"]};
   if(typeof action!=="string"||!rule[action]?.includes(record.status))return reply({error:"Transition de suivi non autorisée."},409);
   let note="",reference=record.bank_reference||"",exportInfo=record.export_info||{};
   if(action==="exported"){
    const meta=body.exportInfo;
    if(!meta||typeof meta!=="object"||typeof meta.messageId!=="string"||!/^[A-Za-z0-9-]{12,35}$/.test(meta.messageId)||
     typeof meta.filename!=="string"||!meta.filename.endsWith(".xml")||meta.filename.length>100||
     typeof meta.sha256!=="string"||!/^[0-9a-f]{64}$/i.test(meta.sha256)||
     !Number.isSafeInteger(meta.totalCents)||!Number.isInteger(meta.count))return reply({error:"Métadonnées SEPA invalides."},400);
    const expected=totals(record.draft);
    if(expected.totalCents!==meta.totalCents||expected.count!==meta.count||expected.count===0)return reply({error:"Le XML ne correspond pas au dossier enregistré."},409);
    const payable=record.draft?.values?.payable;
    if(typeof payable!=="string"||!amount(payable)||toCents(payable)!==expected.totalCents)return reply({error:"Le compte 421 doit être égal au total des virements avant la génération du XML."},409);
    exportInfo={...meta,created_at:new Date().toISOString()};
    note="Fichier XML généré : "+meta.messageId;
   }else if(action==="submitted"){
    reference=field(body,"reference",120).trim();
    if(reference.length<4)return reply({error:"Référence du dépôt bancaire obligatoire (4 caractères minimum)."},400);
    note="Fichier remis à la banque : "+reference;
   }else if(action==="paid"){
    note=field(body,"note",500).trim();
    if(note.length<10||!reference)return reply({error:"Confirmez la date, la référence bancaire et le contrôle d'exécution."},400);
   }else{
    note=field(body,"note",500).trim();
    if(note.length<10)return reply({error:"Motif obligatoire (au moins 10 caractères)."},400);
    if(action==="draft"){reference="";exportInfo={};}
   }
   const changed=await db.from("college_payroll_months").update({status:action,version:body.version+1,updated_by:a.username,updated_at:new Date().toISOString(),status_note:note,bank_reference:reference,export_info:exportInfo}).eq("month",month).eq("version",body.version).eq("status",record.status).select(publicFields).maybeSingle();
   if(changed.error)throw Error("Actualisation du suivi indisponible.");
   if(!changed.data)return reply({error:"Le statut a changé sur un autre onglet. Rechargez le dossier."},409);
   return reply({ok:true,record:changed.data,history:await history(db,month)});
  }
  return reply({error:"Opération inconnue."},404);
 }catch(error){console.error("college-payroll-workflow: operation failed",String(error instanceof Error?error.message:error));return reply({error:"Opération impossible. Aucun changement confirmé."},500);}
});
