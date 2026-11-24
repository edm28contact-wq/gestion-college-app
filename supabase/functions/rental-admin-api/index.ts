import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors = {
  "Access-Control-Allow-Origin": "https://edm28contact-wq.github.io",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const enc = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

const tenantHeaders = [
  "Locataire","Mail locataire","Téléphone locataire","Logement","Adresse logement","Date entrée locataire","Date fin de bail","Loyer de base","Charge","IRL","Révision détectée","Écart révision","Montant révisé","Loyer actualisé","Paiement dû","Paiement reçu","Dernière nouvelle","Retard","Solde précédent","Solde","Type d’alerte","Visal","Relance 7 jours envoyée","Date relance 7 jours","Relance 14 jours envoyée","Date relance 14 jours","Mail Visal envoyé","Date mail Visal","Sujet locataire","Corps locataire","Demande propriétaire envoyée","Date demande propriétaire","Réponse propriétaire","Date réponse propriétaire","Validation envoi locataire","Mail locataire envoyé","Date mail locataire","Notes","Dernier run",
];
const comments: Record<string,string> = {
  "Dernière nouvelle": "Date du dernier paiement reçu ou du dernier contact utile.",
  "Solde précédent": "Utilisé pour cumuler les impayés/avances.",
  "Visal": "Mettre OUI ou NON selon si le logement est couvert par Visal.",
  "Sujet locataire": "Le propriétaire doit répondre OUI/NON avant tout envoi au locataire.",
};
const commands = [
  { label: "Recalcul IRL", function: "actualiserSysteme", description: "Désactivé : l’ancien calcul ne respecte pas l’indice de base de chaque bail." },
  { label: "Nouveau locataire", function: "ajouterNouveauLocataire", description: "Demande les infos puis ajoute une nouvelle ligne" },
  { label: "Nouveau logement", function: "ajouterNouveauLogement", description: "Crée une nouvelle ligne logement et le dossier logement" },
  { label: "Créer fiche logement", function: "creerFicheLogementDepuisLigneActive", description: "Crée ou actualise la feuille dossier du logement actif" },
];

function db() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string,string>;
  const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !key) throw new Error("Configuration serveur indisponible");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function fromB64(s: string) { const raw = atob(s); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
function b64u(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function fromB64u(s: string) { const p = s.replace(/-/g,"+").replace(/_/g,"/") + "=".repeat((4 - s.length % 4) % 4); return fromB64(p); }
async function hmac(key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
function safeEq(a: Uint8Array,b: Uint8Array) { if (a.length !== b.length) return false; let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i]^b[i]; return diff === 0; }
async function verifyPassword(password:string,saltB64:string,hashB64:string,iters:number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:fromB64(saltB64), iterations:iters }, key, 256));
  return safeEq(bits, fromB64(hashB64));
}
async function serverSecret(client:any) {
  const { data, error } = await client.from("system_settings").select("admin_token").eq("id",1).single();
  if (error || !data?.admin_token) throw new Error("Secret serveur indisponible");
  return String(data.admin_token);
}
function marneAllowed(a:any) {
  const p=a?.permissions||{};
  return a?.role==="admin" || p.marne===true || p.marne_invest===true || p.marne_admin===true || p.marne_accounting===true || p.marne_tenants===true || p.marne_studios===true;
}
function apiUuid(v:any) { return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
function apiDate(v:any) {
  return typeof v==="string"&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)
    &&!Number.isNaN(Date.parse(v+"T00:00:00Z"))
    &&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
}
function apiAmount(v:any) {
  return (typeof v==="number"||typeof v==="string")&&/^\d{1,9}([.,]\d{1,2})?$/.test(String(v).trim())
    ? Number(String(v).trim().replace(",",".")) : NaN;
}
function dataObject(v:any) { return v!==null&&typeof v==="object"&&!Array.isArray(v); }
function tenantInputError(data:any,changed:any) {
  for(const [key,max] of [["Locataire",200],["Mail locataire",254],["Téléphone locataire",40],["Adresse logement",500]] as const){
    if(!(key in changed))continue;
    if(typeof data[key]!=="string"||data[key].trim().length>max)return "Champ locataire invalide : "+key;
    data[key]=data[key].trim();
  }
  if("Mail locataire" in changed&&data["Mail locataire"]&&!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(data["Mail locataire"]))
    return "Adresse e-mail du locataire invalide";
  for(const key of ["Date entrée locataire","Date fin de bail"]){
    if(key in changed&&data[key]!==""&&data[key]!==null&&!apiDate(data[key]))return "Date invalide : "+key+" (AAAA-MM-JJ)";
  }
  if(("Date entrée locataire" in changed||"Date fin de bail" in changed)&&apiDate(data["Date entrée locataire"])&&apiDate(data["Date fin de bail"])&&data["Date fin de bail"]<data["Date entrée locataire"])
    return "Fin de bail antérieure à l’entrée du locataire";
  for(const key of ["Loyer de base","Charge"]){
    if(!(key in changed)||data[key]===""||data[key]===null)continue;
    const amount=apiAmount(data[key]);
    if(!Number.isFinite(amount))return "Montant invalide : "+key;
    data[key]=amount;
  }
  return null;
}
async function tenantHasLease(client:any,tenantId:string) {
  const result=await client.from("rental_leases").select("id").eq("tenant_row_id",tenantId).limit(1);
  if(result.error)throw result.error;
  return (result.data||[]).length>0;
}
function paymentAllowed(a:any) {
  const p=a?.permissions||{};
  return a?.role==="admin" || p.marne_admin===true
    || p.marne_accounting===true || p.marne_invest===true;
}
function worksAllowed(a:any) {
 const p=a?.permissions||{};
 return a?.role==="admin" || p.marne_admin===true || p.marne_studios===true;
}
function tenantEditAllowed(a:any) {const p=a?.permissions||{};return a?.role==="admin"||p.marne_admin===true||p.marne_invest===true||p.marne_tenants===true;}
function propertyEditAllowed(a:any) {const p=a?.permissions||{};return a?.role==="admin"||p.marne_admin===true||p.marne_invest===true||p.marne_studios===true;}
function documentsAllowed(a:any) {return paymentAllowed(a);}
function mailAllowed(a:any) {return a?.role==="admin" || a?.permissions?.marne_admin===true;}
class MailConfigurationError extends Error {
 status:number;
 constructor(message:string,status=409){super(message);this.status=status;}
}
async function configuredFreeAccount(client:any,optional=false){
 const q=await client.from("rental_settings").select("value").eq("setting_key","sender_email").maybeSingle();
 if(q.error)throw new MailConfigurationError("La configuration de messagerie ne peut pas être vérifiée. Réessayez sans modifier l’adresse.",503);
 const result=String(q.data?.value??"").trim().toLowerCase();
 if(!result){
   if(optional)return "";
   throw new MailConfigurationError("Renseignez une adresse @free.fr dans Paramètres avant d’utiliser la messagerie.");
 }
 if(!/^[^\s@]+@free\.fr$/.test(result))throw new MailConfigurationError("Adresse Free non valide dans les paramètres");
 return result;
}
async function freePasswordConfigured(client:any,accountEmail:string,strict=false) {
 if(!accountEmail)return false;
 if(accountEmail==="ph.danglade@free.fr" && Deno.env.get("MARNE_FREE_MAIL_PASSWORD"))return true;
 const check=await client.rpc("marne_mail_password_exists",{p_account:accountEmail});
 if(check.error||typeof check.data!=="boolean"){
   if(strict)throw new MailConfigurationError("L’état des identifiants Free ne peut pas être vérifié. Conservez l’adresse et réessayez.",503);
   console.error("Mail vault status unavailable");return false;
 }
 return check.data===true;
}
function transportSecret() {
  const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}") as Record<string,string>;
  return keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
async function callMailTransport(body:any) {
  const base=Deno.env.get("SUPABASE_URL")||"";
  const key=transportSecret();
  if(!base||!key)throw new Error("Passerelle de messagerie indisponible");
  const signal=AbortSignal.timeout(body?.action==="sync"?65000:40000);
  const r=await fetch(base+"/functions/v1/marne-mail-transport",{
    method:"POST",headers:{"Content-Type":"application/json","x-marne-service-key":key},
    body:JSON.stringify(body),signal
  });
  const data=await r.json().catch(()=>({ok:false,error:"Réponse de la passerelle illisible"}));
  if(!r.ok)throw new Error(String(data.error||"Erreur de transport"));
  return data;
}
function paymentVoidAllowed(a:any) {
  return a?.role==="admin" || a?.permissions?.marne_admin===true;
}
async function issueToken(client:any,username:string,sessionVersion:number) {
  const payload={u:username,v:sessionVersion,exp:Date.now()+TOKEN_TTL_MS,n:crypto.randomUUID()};
  const body=b64u(enc.encode(JSON.stringify(payload)));
  const sig=b64u(await hmac(await serverSecret(client),body));
  return `${body}.${sig}`;
}
async function verifyToken(client:any,req:Request) {
  try {
    const auth=req.headers.get("authorization")||"";
    const token=auth.startsWith("Bearer ")?auth.slice(7):req.headers.get("x-admin-session")||"";
    const parts=token.split(".");if(token.length>4096||parts.length!==2)return null;
    const [body,sig]=parts;if(!body||!sig)return null;
    const expected=await hmac(await serverSecret(client),body);
    if(!safeEq(expected,fromB64u(sig)))return null;
    const p:any=JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if(typeof p?.u!=="string"||!p.u||p.u.length>80||(p.scope!==undefined&&p.scope!=="central-admin")||p.r!==undefined||!Number.isFinite(Number(p.exp))||Number(p.exp)<=Date.now()||!Number.isFinite(Number(p.v)))return null;
    const q=await client.from("admin_accounts").select("username,active,central_active,session_version,role,display_name,permissions,must_change_password").eq("username",p.u).maybeSingle();
    if(q.error)throw q.error;
    const a=q.data;
    if(!a?.active||a.central_active===false||Number(a.session_version)!==Number(p.v)||!marneAllowed(a))return null;
    return {...a,permissions:a.permissions||{}};
  } catch { return null; }
}
function ip(req: Request) { return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown"; }
async function audit(client:any,username:string,action:string,entityType?:string,entityId?:string,details:any={}) {
  const result=await client.from("admin_audit_log").insert({ username, action, entity_type:entityType||null, entity_id:entityId||null, details });
  if(result.error)console.error("Rental audit insert failed",result.error.code||"unknown",action);
}
function round2(v: number) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function money(v: number) { return Number(v || 0).toFixed(2).replace(".",","); }
function isoDay(v: any) {
  if (!v) return "";
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : s;
}
function revisionBody(name: string, logement: string, oldRent: number, newRent: number, diff: number) {
  return `Bonjour ${name},\n\nJ’espère que vous allez bien.\n\nJe vous contacte pour vous informer qu’une révision du loyer de votre logement ${logement} a été effectuée, conformément à l’évolution de l’indice de référence des loyers (IRL).\n\nVoici le détail de cette mise à jour :\n- Ancien loyer : ${money(oldRent)} €\n- Nouveau loyer : ${money(newRent)} €\n- Différence : ${money(diff)} €\n\nCette révision s’appliquera conformément aux dispositions prévues dans votre bail.\n\nJe reste bien entendu à votre disposition si vous avez la moindre question.\n\nBien cordialement`;
}
function propertyFromTenant(row: any) {
  const d = row.data || {};
  return {
    name: String(d["Logement"] || `Logement ${row.row_number}`),
    data: {
      "Nom du logement": d["Logement"] || "",
      "Adresse": d["Adresse logement"] || "",
      "Statut logement": d["Locataire"] ? "Occupé" : "Vacant",
      "Date de mise en service": isoDay(d["Date entrée locataire"]),
      "Loyer appliqué": d["Loyer actualisé"] ?? d["Loyer de base"] ?? null,
      "IRL de base": null,
      "IRL actuel": d["IRL"] ?? null,
      "Charge appliquée": d["Charge"] ?? null,
      "Date dernière révision": d["Révision détectée"] === "OUI" ? isoDay(d["Dernier run"]) : "",
      "Solde cumulé logement": d["Solde"] ?? 0,
      "Notes": d["Notes"] || "",
    },
    current_tenant: {
      "Locataire actuel": d["Locataire"] || "",
      "Mail locataire": d["Mail locataire"] || "",
      "Date entrée locataire": isoDay(d["Date entrée locataire"]),
      "Date fin de bail": isoDay(d["Date fin de bail"]),
      "Loyer actuel": d["Loyer actualisé"] ?? d["Loyer de base"] ?? null,
      "Charges": d["Charge"] ?? null,
      "Solde actuel": d["Solde"] ?? 0,
      "Retard": d["Retard"] || "NON",
      "Statut": d["Locataire"] ? "En cours" : "Vacant",
      "Notes": d["Notes"] || "",
    },
    source_sheet: `Dossier_${String(d["Logement"] || row.row_number)}`,
  };
}
class IncompleteDataError extends Error {}
async function loadCompleteRows(query:()=>any,label:string,key="id") {
  const rows:any[]=[],seen=new Set<string>();
  const pageSize=500,maxRows=10000;
  let expected:number|null=null;
  while(true){
    const result=await query().range(rows.length,rows.length+pageSize-1);
    if(result.error)throw result.error;
    if(!Number.isInteger(result.count)||result.count<0||!Array.isArray(result.data))
      throw new IncompleteDataError("Chargement incomplet : "+label+". Actualisez avant toute opération.");
    if(result.count>maxRows)
      throw new IncompleteDataError("Volume trop important : "+label+". Une pagination dédiée est nécessaire ; aucun total partiel n’est affiché.");
    if(expected!==null&&result.count!==expected)
      throw new IncompleteDataError("Données modifiées pendant le chargement : "+label+". Actualisez avant toute opération.");
    expected=result.count;
    if(result.data.length===0&&rows.length<expected)
      throw new IncompleteDataError("Chargement incomplet : "+label+". Actualisez avant toute opération.");
    for(const row of result.data){
      if(typeof row[key]!=="string"||seen.has(row[key]))
        throw new IncompleteDataError("Lecture incohérente : "+label+". Actualisez avant toute opération.");
      seen.add(row[key]);rows.push(row);
    }
    if(rows.length>expected)
      throw new IncompleteDataError("Lecture incohérente : "+label+". Actualisez avant toute opération.");
    if(rows.length===expected)return {data:rows,error:null};
  }
}
async function loadData(client: any, account:any) {
  const financeAccess=paymentAllowed(account);
  const currentMailAccount=mailAllowed(account)?await configuredFreeAccount(client,true):"";
  const healthReportsQuery=paymentVoidAllowed(account)
    ? client.from("rental_health_runs").select("id,checked_at,trigger_type,status,critical_count,warning_count,checks,metrics").order("checked_at",{ascending:false}).limit(20)
    : Promise.resolve({data:[],error:null});
  const irlRulesQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_irl_lease_rules").select("lease_id,has_revision_clause,dpe_rating,is_mobility_lease,geographic_scope,revision_due_on,reference_quarter,target_year,verified_by,verified_at,updated_at",{count:"exact"}).order("lease_id"),"règles IRL","lease_id")
    : Promise.resolve({data:[],error:null});
  const irlProposalsQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_irl_proposals").select("id,lease_id,revision_due_on,prepared_on,prepared_by,reference_quarter,baseline_year,target_year,baseline_index,target_index,base_monthly_rent,proposed_monthly_rent,status,draft_revision,draft_history,created_at",{count:"exact"}).order("created_at",{ascending:false}).order("id"),"propositions IRL")
    : Promise.resolve({data:[],error:null});
  const irlApplicationsQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_irl_applications").select("id,proposal_id,lease_id,revision_due_on,notice_sent_on,notice_method,effective_on,old_monthly_rent,new_monthly_rent,approved_by,approved_at,activated_at,status",{count:"exact"}).order("effective_on",{ascending:false}).order("id"),"révisions IRL")
    : Promise.resolve({data:[],error:null});
  const irlCandidatesQuery=financeAccess
    ? client.from("rental_irl_candidates").select("id,year,quarter,value,source_url,detected_at,status,reviewed_by,reviewed_at").order("detected_at",{ascending:false}).limit(30)
    : Promise.resolve({data:[],error:null});
  const irlIndicesQuery=financeAccess
    ? client.from("rental_irl_indices").select("year,quarter,geographic_scope,value,published_on,source_url").order("year",{ascending:false}).order("quarter",{ascending:false}).limit(50)
    : Promise.resolve({data:[],error:null});
  const bankImportsQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_bank_imports").select("id,account_label,original_filename,row_count,imported_by,imported_at",{count:"exact"}).order("imported_at",{ascending:false}).order("id"),"imports bancaires")
    : Promise.resolve({data:[],error:null});
  const bankLinesQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_bank_lines").select("id,import_id,row_number,booking_date,amount,description,bank_reference,status,matched_lease_id,matched_payment_id,reviewed_by,reviewed_at,review_note",{count:"exact"}).order("booking_date",{ascending:false}).order("id"),"mouvements bancaires")
    : Promise.resolve({data:[],error:null});
  const documentsAccess=documentsAllowed(account);
  const documentsQuery=documentsAccess
    ? loadCompleteRows(()=>client.from("rental_documents").select("id,property_id,lease_id,category,label,original_name,mime_type,byte_size,uploaded_by,created_at",{count:"exact"}).order("created_at",{ascending:false}).order("id"),"documents")
    : Promise.resolve({data:[],error:null});
  const paymentsQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_payments").select("id,lease_id,property_id,received_on,amount,payment_method,reference,payer_name,note,source,status,recorded_by,recorded_at,voided_at,void_reason",{count:"exact"}).order("recorded_at",{ascending:false}).order("id"),"paiements")
    : Promise.resolve({data:[],error:null});
  const allocationsQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_payment_allocations").select("id,payment_id,installment_id,amount,created_at",{count:"exact"}).order("created_at",{ascending:false}).order("id"),"affectations de paiements")
    : Promise.resolve({data:[],error:null});
  const reminderQuery=financeAccess
    ? loadCompleteRows(()=>client.from("rental_reminder_drafts").select("id,lease_id,installment_id,stage,recipient_email,subject,body,due_at_preparation,status,prepared_at,declared_sent_at,declared_sent_by,cancelled_at,cancelled_reason",{count:"exact"}).order("prepared_at",{ascending:false}).order("id"),"relances")
    : Promise.resolve({data:[],error:null});
  const inboxQuery=!!currentMailAccount
    ? client.from("rental_mail_messages").select("id,sender_email,recipient_email,subject,received_at,is_seen,has_attachments,attachment_count,imported_at,body_status,source_size,body_note").eq("account_email",currentMailAccount).order("received_at",{ascending:false,nullsFirst:false}).limit(150)
    : Promise.resolve({data:[],error:null});
  const syncStateQuery=!!currentMailAccount
    ? client.from("rental_mail_sync_state").select("account_email,imap_verified_at,smtp_verified_at,last_sync_at,last_imported,last_checked,last_error_at,last_error_code").eq("account_email",currentMailAccount).maybeSingle()
    : Promise.resolve({data:null,error:null});
  const syncCursorQuery=!!currentMailAccount
    ? client.from("rental_mail_sync_cursors").select("last_uid,target_uid,last_progress_at").eq("account_email",currentMailAccount).eq("folder","INBOX").maybeSingle()
    : Promise.resolve({data:null,error:null});
  const outboxQuery=!!currentMailAccount
    ? client.from("rental_mail_outbox").select("id,recipient_email,subject,plain_body,in_reply_to_message_id,status,created_at,created_by,approved_at,sent_at,provider_message_id,last_error").eq("account_email",currentMailAccount).order("created_at",{ascending:false}).limit(150)
    : Promise.resolve({data:[],error:null});
  const worksAccess=worksAllowed(account);
  const workOrdersQuery=worksAccess
    ? loadCompleteRows(()=>client.from("rental_work_orders").select("id,property_id,lease_id,title,description,category,priority,status,provider_name,provider_contact,estimate_amount,actual_amount,scheduled_for,completed_on,approved_at,approved_by,created_at,updated_at",{count:"exact"}).order("created_at",{ascending:false}).order("id"),"interventions")
    : Promise.resolve({data:[],error:null});
  const automationQuery=financeAccess
    ? client.from("rental_automation_runs").select("job_key,run_at,run_for,inspected,created,skipped").eq("job_key","monthly_installments").order("run_at",{ascending:false}).limit(12)
    : Promise.resolve({data:[],error:null});
  const [s,t,p,l,e,pay,alloc,reminders,inbox,outbox,automations,works,documents,bankImports,bankLines,syncState,irlRules,irlProposals,irlIndices,irlCandidates,irlApplications,healthReports,syncCursor] = await Promise.all([
    client.from("rental_settings").select("setting_key,label,value,comment,sort_order,updated_at").order("sort_order"),
    loadCompleteRows(()=>client.from("rental_tenant_rows").select("id,row_number,property_id,data,created_at,updated_at",{count:"exact"}).order("row_number").order("id"),"locataires"),
    loadCompleteRows(()=>client.from("rental_properties").select("id,name,data,current_tenant,tenant_history,payment_schedule,source_sheet,is_example,created_at,updated_at",{count:"exact"}).order("is_example",{ascending:false}).order("name").order("id"),"biens immobiliers"),
    loadCompleteRows(()=>client.from("rental_leases").select("id,property_id,tenant_row_id,tenant_name,observed_move_in_date,start_date,end_date,monthly_rent,charges_amount,due_day,lease_kind,issuer_name,issuer_address,receipt_email_consent,status,source,verified_at,verified_by,notes",{count:"exact"}).order("created_at").order("id"),"baux"),
    loadCompleteRows(()=>client.from("rental_installments").select("id,lease_id,property_id,period,due_on,rent_amount,charges_amount,total_due,status,amount_verified_at,amount_verified_by",{count:"exact"}).order("period",{ascending:false}).order("id"),"échéances"),
    paymentsQuery,
    allocationsQuery,
    reminderQuery,
    inboxQuery,
    outboxQuery,
    automationQuery,
    workOrdersQuery,
    documentsQuery,
    bankImportsQuery,
    bankLinesQuery,
    syncStateQuery,
    irlRulesQuery,
    irlProposalsQuery,
    irlIndicesQuery,
    irlCandidatesQuery,
    irlApplicationsQuery,
    healthReportsQuery,
    syncCursorQuery,
  ]);
  for (const q of [s,t,p,l,e,pay,alloc,reminders,inbox,outbox,automations,works,documents,bankImports,bankLines,syncState,irlRules,irlProposals,irlIndices,irlCandidates,irlApplications,healthReports,syncCursor]) if (q.error) throw q.error;
  const mailConfigured=currentMailAccount?await freePasswordConfigured(client,currentMailAccount):false;
  const mailSyncState=syncState.data||syncCursor.data?{...(syncState.data||{}),catchup_pending:syncCursor.data?Number(syncCursor.data.target_uid)>Number(syncCursor.data.last_uid):null,last_progress_at:syncCursor.data?.last_progress_at||null}:null;
  return { current_user:{username:account.username,role:account.role,display_name:account.display_name||account.username,permissions:account.permissions||{},read_only:account.role!=="admin"&&account.permissions?.readonly===true,payment_access:financeAccess,payment_void_access:paymentVoidAllowed(account),work_access:worksAccess,document_access:documentsAccess,bank_access:financeAccess,mail_access:mailAllowed(account),mail_configured:mailConfigured,mail_account:currentMailAccount}, mail_sync_state:mailSyncState, settings:paymentVoidAllowed(account)?s.data||[]:[], tenants:t.data||[], properties:p.data||[], leases:financeAccess?l.data||[]:[], installments:financeAccess?e.data||[]:[], payments:pay.data||[], payment_allocations:alloc.data||[], reminder_drafts:reminders.data||[], mail_inbox:inbox.data||[], mail_outbox:outbox.data||[], automation_runs:automations.data||[], work_orders:works.data||[], documents:documents.data||[], bank_imports:bankImports.data||[], bank_lines:bankLines.data||[], irl_rules:irlRules.data||[], irl_proposals:irlProposals.data||[], irl_indices:irlIndices.data||[], irl_candidates:irlCandidates.data||[], irl_applications:irlApplications.data||[], health_reports:healthReports.data||[], tenant_headers:tenantHeaders, comments, commands, server_time:new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const client = db();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "data";

    if (action === "login" && req.method === "POST") {
      const addr=ip(req),since=new Date(Date.now()-15*60*1000).toISOString();
      const {count}=await client.from("admin_login_attempts").select("id",{count:"exact",head:true}).eq("ip",addr).eq("success",false).gte("attempted_at",since);
      if((count||0)>=10)return json({error:"Trop de tentatives. Réessayez plus tard."},429);
      const body=await req.json(),requested=String(body?.username||"").trim().toLowerCase(),username=requested==="holding-admin"?"admin":requested,password=String(body?.password||"");
      const q=await client.from("admin_accounts").select("username,password_salt,password_hash,password_iterations,active,central_active,session_version,role,display_name,permissions,must_change_password,failed_login_count,locked_until").eq("username",username).maybeSingle();
      if(q.error)throw q.error;
      const a=q.data,locked=!!a?.locked_until&&new Date(a.locked_until).getTime()>Date.now(),ok=!!a?.active&&a.central_active!==false&&!locked&&marneAllowed(a)&&await verifyPassword(password,String(a.password_salt||""),String(a.password_hash||""),Number(a.password_iterations||0));
      await client.from("admin_login_attempts").insert({ip:addr,success:ok});
      if(!ok){if(a){const fails=Number(a.failed_login_count||0)+1;await client.from("admin_accounts").update({failed_login_count:fails>=5?0:fails,locked_until:fails>=5?new Date(Date.now()+15*60*1000).toISOString():a.locked_until,updated_at:new Date().toISOString()}).eq("username",username)}return json({error:"Identifiants incorrects, accès non autorisé ou compte temporairement verrouillé"},401)}
      await client.from("admin_accounts").update({last_login_at:new Date().toISOString(),failed_login_count:0,locked_until:null}).eq("username",username);
      await audit(client,username,"rental-login",undefined,undefined,{role:a.role,requested_username:requested});
      return json({ok:true,token:await issueToken(client,username,Number(a.session_version)),expires_in:14400,role:a.role,display_name:a.display_name||a.username,permissions:a.permissions||{},must_change_password:!!a.must_change_password});
    }

    const account=await verifyToken(client,req);
    if(!account)return json({error:"Session expirée, compte désactivé ou accès 9 Marne non autorisé"},401);
    if(account.must_change_password)return json({error:"Vous devez changer votre mot de passe depuis la gestion centrale avant d’utiliser 9 Marne."},403);
    const readOnly=account.role!=="admin"&&account.permissions?.readonly===true;
    if(req.method==="POST"&&action!=="login"&&readOnly)return json({error:"Compte en lecture seule"},403);

    if(action==="data"&&req.method==="GET")return json(await loadData(client,account));

    if (action === "save-tenant" && req.method === "POST") {
      if(!tenantEditAllowed(account))return json({error:"Pouvoir insuffisant pour cette opération"},403);
      const body = await req.json().catch(()=>null);
      const id = String(body?.id || "");
      if((id&&!apiUuid(id))||!dataObject(body?.data)||enc.encode(JSON.stringify(body.data)).length>64000)
        return json({error:"Fiche locataire invalide ou trop volumineuse"},400);
      let previous: any = null;
      if (id) {
        const existing = await client.from("rental_tenant_rows").select("property_id,data").eq("id",id).maybeSingle();
        if (existing.error) throw existing.error;
        if (!existing.data) return json({error:"Fiche locataire introuvable"},404);
        previous = existing.data;
      }
      const data = {...(dataObject(previous?.data)?previous.data:{}),...body.data};
      const invalid=tenantInputError(data,body.data);
      if(invalid)return json({error:invalid},400);
      if(enc.encode(JSON.stringify(data)).length>64000)return json({error:"Fiche locataire trop volumineuse"},400);
      const housingName = String(data["Logement"] || "").trim();
      let propertyId: string | null = null;
      if("property_id" in body){
        propertyId=body.property_id===null||body.property_id===""?null:body.property_id;
        if(propertyId!==null&&!apiUuid(propertyId))return json({error:"Logement invalide"},400);
      }else if(previous?.property_id&&String(previous.data?.["Logement"]||"").trim()===housingName){
        propertyId=previous.property_id;
      }else if(housingName){
          const matched = await client.from("rental_properties").select("id").eq("name",housingName).eq("is_example",false).maybeSingle();
          if (matched.error) throw matched.error;
          if (!matched.data) return json({error:"Logement inconnu. Créez d’abord sa fiche dans Mes Biens."},400);
          propertyId = matched.data.id;
      }
      if(propertyId){
        const property=await client.from("rental_properties").select("id,name,is_example,data").eq("id",propertyId).maybeSingle();
        if(property.error)throw property.error;
        if(!property.data||property.data.is_example)return json({error:"Choisissez un logement réel existant dans Mes Biens."},400);
        data["Logement"]=property.data.name;
        if(!id&&!("Adresse logement" in body.data)&&property.data.data?.["Adresse"])data["Adresse logement"]=String(property.data.data["Adresse"]);
      }else if("property_id" in body){
        data["Logement"]="";
      }
      const propertyChanged=!!id&&previous?.property_id!==propertyId;
      if(propertyChanged&&await tenantHasLease(client,id))
        return json({error:"Cette fiche locataire est liée à un bail. Conservez son logement pour préserver l’historique et créez une nouvelle fiche pour le nouveau logement."},409);
      let q;
      if (id) q = await client.from("rental_tenant_rows").update({ data, property_id:propertyId, updated_at:new Date().toISOString() }).eq("id",id).select().single();
      else {
        q = await client.rpc("marne_create_tenant",{p_property_id:propertyId,p_data:data});
      }
      if (q.error) {
        if(propertyChanged&&q.error.code==="23503")return json({error:"Le logement de cette fiche est désormais référencé par un bail. Actualisez et créez une nouvelle fiche locataire pour changer de logement."},409);
        if(q.error.code==="22023")return json({error:q.error.message},400);
        if(q.error.code==="23505"||q.error.code==="23503")return json({error:"Le logement ou la fiche locataire a changé. Actualisez avant de poursuivre."},409);
        throw q.error;
      }
      await audit(client,account.username,"rental-save-tenant","rental_tenant",q.data.id,{ row_number:q.data.row_number });
      return json({ ok:true,item:q.data });
    }

    if (action === "new-property" && req.method === "POST") {
      if(!propertyEditAllowed(account))return json({error:"Pouvoir insuffisant pour cette opération"},403);
      const body = await req.json();
      const name = String(body?.name || "").trim();
      const address = String(body?.address || "").trim();
      if (!name) return json({ error:"Nom du logement obligatoire" },400);
      const duplicate = await client.from("rental_properties").select("id").eq("name",name).maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) return json({error:"Ce logement existe déjà dans Mes Biens."},409);
      const created=await client.rpc("marne_create_property",{p_name:name,p_address:address});
      if(created.error){
        if(created.error.code==="22023")return json({error:created.error.message},400);
        if(created.error.code==="23505")return json({error:"Ce logement existe déjà. Actualisez Mes Biens avant de poursuivre."},409);
        throw created.error;
      }
      const {property:prop,row}=created.data;
      await audit(client,account.username,"rental-new-property","rental_property",prop.id,{ name,row_number:row.row_number });
      return json({ ok:true,property:prop,row });
    }

    if (action === "create-property-sheet" && req.method === "POST") {
      if(!propertyEditAllowed(account))return json({error:"Pouvoir insuffisant pour cette opération"},403);
      const body = await req.json();
      const rowNumber = Number(body?.row_number);
      if (!Number.isInteger(rowNumber)) return json({ error:"Ligne locataire invalide" },400);
      const { data:row,error:re } = await client.from("rental_tenant_rows").select("id,row_number,property_id,data").eq("row_number",rowNumber).maybeSingle();
      if (re) throw re;
      if(!row)return json({error:"Fiche locataire introuvable"},404);
      if (!String(row.data?.["Logement"] || "").trim()) return json({ error:"Le logement de cette ligne est vide" },400);
      const p = propertyFromTenant(row);
      const existing = await client.from("rental_properties").select("id").eq("name",p.name).eq("is_example",false).maybeSingle();
      if (existing.error) throw existing.error;
      if(existing.data?.id!==row.property_id&&await tenantHasLease(client,row.id))
        return json({error:"Cette fiche locataire est liée à un bail. Conservez son logement pour préserver l’historique et créez une nouvelle fiche pour le nouveau logement."},409);
      const created=await client.rpc("marne_create_property_sheet",{p_row_number:rowNumber,p_property:p});
      if (created.error) {
        if(created.error.code==="22023")return json({error:created.error.message},409);
        if(created.error.code==="23505")return json({error:"Ce logement existe déjà. Actualisez avant de poursuivre."},409);
        if(created.error.code==="23503")return json({error:"Le logement de cette fiche est désormais référencé par un bail. Actualisez avant de poursuivre."},409);
        throw created.error;
      }
      const prop=created.data;
      await audit(client,account.username,"rental-create-property-sheet","rental_property",prop.id,{ name:p.name,row_number:rowNumber });
      return json({ ok:true,property:prop });
    }

    if (action === "save-property" && req.method === "POST") {
      if(!propertyEditAllowed(account))return json({error:"Pouvoir insuffisant pour cette opération"},403);
      const body = await req.json().catch(()=>null);
      const id = String(body?.id || "");
      if (!apiUuid(id)||(!("name" in body)&&!("data" in body))) return json({ error:"Dossier logement invalide" },400);
      if(("name" in body&&typeof body.name!=="string")||("data" in body&&!dataObject(body.data)))return json({error:"Informations du logement invalides"},400);
      const previous=await client.from("rental_properties").select("id,name,data,is_example").eq("id",id).maybeSingle();
      if(previous.error)throw previous.error;
      if(!previous.data||previous.data.is_example)return json({error:"Logement réel introuvable"},404);
      const name=String(body.name??previous.data.name).trim();
      const details={...(dataObject(previous.data.data)?previous.data.data:{}),...(body.data||{}),"Nom du logement":name};
      if(!name||name.length>180)return json({error:"Nom du logement obligatoire, limité à 180 caractères"},400);
      for(const [key,max] of [["Adresse",500],["Ville",120],["Code postal",20],["Type de bien",100],["Notes",4000]] as const){
        if(body.data&&key in body.data){
          if(typeof details[key]!=="string"||details[key].trim().length>max)return json({error:"Information du logement invalide : "+key},400);
          details[key]=details[key].trim();
        }
      }
      if(enc.encode(JSON.stringify(details)).length>250000)return json({error:"Fiche logement trop volumineuse"},400);
      const payload = {
        name,data:details,
        updated_at:new Date().toISOString(),
      };
      const { data,error } = await client.from("rental_properties").update(payload).eq("id",id).select().maybeSingle();
      if(error?.code==="23505")return json({error:"Ce nom est déjà utilisé par un autre logement."},409);
      if (error) throw error;
      if(!data)return json({error:"Dossier logement modifié ou supprimé. Actualisez avant de poursuivre."},409);
      await audit(client,account.username,"rental-save-property","rental_property",id,{ name:payload.name });
      return json({ ok:true,item:data });
    }

    if (action === "prepare-lease" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Gestion des baux réservée au personnel habilité"},403);
      const body=await req.json().catch(()=>null),tenantId=body?.tenant_row_id;
      if(!apiUuid(tenantId))return json({error:"Fiche locataire invalide"},400);
      const result=await client.rpc("marne_prepare_lease",{p_tenant_row_id:tenantId,p_by:account.username});
      if(result.error){
        if(["22023","23503","23505","40001","55000"].includes(result.error.code))return json({error:result.error.message||"Le dossier a changé. Actualisez avant de préparer le bail."},409);
        throw result.error;
      }
      await audit(client,account.username,"rental-prepare-lease","rental_lease",result.data.lease?.id,{tenant_row_id:tenantId,created:result.data.created===true});
      return json({ok:true,...result.data,already_exists:result.data.created!==true});
    }

    if (action === "close-lease" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Gestion des baux réservée au personnel habilité"},403);
      const body=await req.json().catch(()=>null),leaseId=body?.id,end=body?.end_date;
      if(!apiUuid(leaseId)||!apiDate(end)||body?.confirmed!==true)
        return json({error:"Confirmez la clôture du bail avec une date de fin réelle (AAAA-MM-JJ)."},400);
      if(body?.final_month_confirmed!==true)return json({error:"Vérifiez et confirmez le montant du dernier mois avant de clôturer le bail."},400);
      const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      if(end>today)return json({error:"La clôture effective ne peut pas être datée dans le futur."},400);
      const result=await client.rpc("marne_close_lease",{p_lease_id:leaseId,p_end_date:end,p_by:account.username,p_final_month_confirmed:true});
      if(result.error){
        if(["22023","23503","23505","40001","55000"].includes(result.error.code))return json({error:result.error.message||"La situation du bail a changé. Actualisez avant de poursuivre."},409);
        throw result.error;
      }
      if(!result.data.already_closed)await audit(client,account.username,"rental-close-lease","rental_lease",leaseId,{end_date:end,final_month_confirmed:true,cancelled_installments:result.data.cancelled_installments||0});
      return json({ok:true,...result.data});
    }

    if (action === "save-lease" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Gestion des baux réservée au personnel habilité"},403);
      const body=await req.json().catch(()=>null),leaseId=String(body?.id||"");
      if(!apiUuid(leaseId))return json({error:"Bail invalide"},400);
      const current=await client.from("rental_leases").select("id,status,property_id,tenant_row_id,tenant_name").eq("id",leaseId).maybeSingle();
      if(current.error)throw current.error;
      if(!current.data)return json({error:"Bail introuvable"},404);
      if(current.data.status!=="draft")return json({error:"Seul un bail en brouillon peut être modifié. Un bail actif exige un avenant ou un nouveau bail."},409);
      const dateVal=(v:any)=>v===null||v===""?null:apiDate(v)?v:undefined;
      const start=dateVal(body?.start_date),end=dateVal(body?.end_date);
      if(start===undefined||end===undefined)return json({error:"Date invalide (AAAA-MM-JJ)"},400);
      if(start&&end&&end<start)return json({error:"Fin de bail antérieure au début"},400);
      const parseMoney=(v:any)=>v===null||v===""?null:apiAmount(v);
      const rent=parseMoney(body?.monthly_rent),charges=parseMoney(body?.charges_amount);
      if((rent!==null&&(!Number.isFinite(rent)||rent<0))||(charges!==null&&(!Number.isFinite(charges)||charges<0)))return json({error:"Montant invalide"},400);
      const day=body?.due_day===null||body?.due_day===""?null:(typeof body?.due_day==="number"||typeof body?.due_day==="string")&&/^\d{1,2}$/.test(String(body.due_day).trim())?Number(body.due_day):NaN;
      if(day!==null&&(!Number.isInteger(day)||day<1||day>31))return json({error:"Jour de paiement entre 1 et 31"},400);
      const kind=String(body?.lease_kind||"unverified");
      if(!["unverified","residential","parking","commercial","other"].includes(kind))
         return json({error:"Nature du bail invalide"},400);
      if((body?.issuer_name!=null&&typeof body.issuer_name!=="string")||(body?.issuer_address!=null&&typeof body.issuer_address!=="string"))
        return json({error:"Identité du bailleur invalide"},400);
      let issuerName=String(body?.issuer_name??"").trim(),issuerAddress=String(body?.issuer_address??"").trim();
      if(!issuerName||!issuerAddress){
        const defaults=await client.from("rental_settings").select("setting_key,value").in("setting_key",["landlord_name","landlord_address"]);
        if(defaults.error)throw defaults.error;
        const settings=Object.fromEntries((defaults.data||[]).map((s:any)=>[s.setting_key,s.value]));
        issuerName=issuerName||String(settings.landlord_name||"").trim();
        issuerAddress=issuerAddress||String(settings.landlord_address||"").trim();
      }
      if(issuerName.length>200||issuerAddress.length>500)return json({error:"Identité du bailleur trop longue"},400);
      const consent=body?.receipt_email_consent===true;
      const activate=body?.activate===true;
      if(activate&&kind==="unverified")return json({error:"Sélectionnez la nature juridique du bail avant activation."},400);
      if(activate&&(!start||rent===null||charges===null||day===null))return json({error:"Début de bail, loyer, charges et jour d’échéance sont obligatoires pour activer."},400);
      if(activate){
        if(!apiUuid(current.data.tenant_row_id))
          return json({error:"Reliez un locataire identifié au bail avant son activation."},409);
        const [tenant,property]=await Promise.all([
          client.from("rental_tenant_rows").select("id,property_id,data").eq("id",current.data.tenant_row_id).maybeSingle(),
          client.from("rental_properties").select("id,is_example,data").eq("id",current.data.property_id).maybeSingle()
        ]);
        if(tenant.error)throw tenant.error;
        if(property.error)throw property.error;
        if(!property.data||property.data.is_example||!tenant.data||tenant.data.property_id!==current.data.property_id||!String(tenant.data.data?.["Locataire"]||"").trim())
          return json({error:"Le bail et son locataire doivent être reliés au même logement réel avant activation."},409);
        if(String(tenant.data.data["Locataire"]).trim().length>200)return json({error:"Le nom du locataire doit être limité à 200 caractères."},400);
        if(!String(property.data.data?.["Adresse"]||tenant.data.data?.["Adresse logement"]||"").trim())
          return json({error:"Complétez l’adresse du logement dans sa fiche avant d’activer le bail."},409);
        if(!issuerName||!issuerAddress)
          return json({error:"Complétez le nom et l’adresse du bailleur dans Paramètres ou dans le bail avant activation."},409);
      }
      const payload={start_date:start,end_date:end,monthly_rent:rent,charges_amount:charges,due_day:day,lease_kind:kind,issuer_name:issuerName||null,issuer_address:issuerAddress||null,receipt_email_consent:consent,notes:String(body?.notes??"").slice(0,2000)};
      const updated=await client.rpc("marne_save_lease",{p_lease_id:leaseId,p_patch:payload,p_by:account.username,p_activate:activate});
      if(updated.error){
        if(["22023","23503","23505","40001","55000"].includes(updated.error.code))return json({error:updated.error.message||"Bail modifié simultanément : actualisez avant de poursuivre."},409);
        throw updated.error;
      }
      await audit(client,account.username,"rental-save-lease","rental_lease",leaseId,{activate,status:updated.data.lease?.status});
      return json({ok:true,...updated.data});
    }



    if (action==="work-create" && req.method==="POST") {
      if(!worksAllowed(account))return json({error:"Gestion des interventions non autorisée"},403);
      const body=await req.json();
      const key=String(body?.client_key||""),propertyId=String(body?.property_id||"");
      const title=String(body?.title||"").trim(),description=String(body?.description||"").trim();
      const category=String(body?.category||"autre"),priority=String(body?.priority||"standard");
      if(!apiUuid(key)||!apiUuid(propertyId)||title.length<5||title.length>180||description.length>4000
        ||!["plomberie","electricite","chauffage","serrurerie","entretien","autre"].includes(category)
        ||!["standard","urgent"].includes(priority))return json({error:"Informations du signalement invalides"},400);
      const prop=await client.from("rental_properties").select("id,is_example").eq("id",propertyId).maybeSingle();
      if(prop.error)throw prop.error;
      if(!prop.data||prop.data.is_example)return json({error:"Bien réel introuvable"},404);
      const earlier=await client.from("rental_work_orders").select("id,property_id,title").eq("client_key",key).maybeSingle();
      if(earlier.error)throw earlier.error;
      if(earlier.data){
        if(earlier.data.property_id!==propertyId||earlier.data.title!==title)
          return json({error:"Cette clé de demande a déjà été utilisée pour une autre intervention"},409);
        return json({ok:true,id:earlier.data.id,duplicate:true});
      }
      const created=await client.from("rental_work_orders").insert({
        client_key:key,property_id:propertyId,title,description,category,priority,status:"open",
        created_by:account.username,updated_by:account.username
      }).select("id").single();
      if(created.error){if(created.error.code==="23505")return json({error:"Signalement déjà créé, actualisez le site"},409);throw created.error}
      await audit(client,account.username,"rental-work-created","rental_work_order",created.data.id,{property_id:propertyId,priority});
      return json({ok:true,id:created.data.id,duplicate:false});
    }

    if (action==="work-details" && req.method==="POST") {
      if(!worksAllowed(account))return json({error:"Gestion des interventions non autorisée"},403);
      const body=await req.json(),id=String(body?.id||"");
      if(!apiUuid(id))return json({error:"Intervention invalide"},400);
      const existing=await client.from("rental_work_orders").select("id,status").eq("id",id).maybeSingle();
      if(existing.error)throw existing.error;
      if(!existing.data||["completed","cancelled"].includes(existing.data.status))
        return json({error:"Intervention clôturée ou introuvable"},409);
      const rawMoney=(v:any)=>{
        if(v===null||v===""||v===undefined)return null;
        const val=String(v).trim();
        if(!/^\d{1,10}([.,]\d{1,2})?$/.test(val))return NaN;
        return Number(val.replace(",","."));
      };
      const quoted=rawMoney(body?.estimate_amount),actual=rawMoney(body?.actual_amount);
      if((quoted!==null&&(!Number.isFinite(quoted)||quoted<0||quoted>9999999999))
        ||(actual!==null&&(!Number.isFinite(actual)||actual<0||actual>9999999999)))
          return json({error:"Montant de travaux invalide"},400);
      const provider=String(body?.provider_name||"").trim(),contact=String(body?.provider_contact||"").trim();
      const scheduled=body?.scheduled_for===null||body?.scheduled_for===""?null:String(body?.scheduled_for||"");
      if(provider.length>180||contact.length>220||(scheduled!==null&&!apiDate(scheduled)))
        return json({error:"Prestataire ou date invalide"},400);
      const fields:any={updated_by:account.username,updated_at:new Date().toISOString(),actual_amount:actual,scheduled_for:scheduled};
      if(["open","in_review","quoted"].includes(existing.data.status)){
        fields.provider_name=provider;fields.provider_contact=contact;fields.estimate_amount=quoted;
      }
      const changed=await client.from("rental_work_orders").update(fields).eq("id",id).eq("status",existing.data.status).select("id").maybeSingle();
      if(changed.error)throw changed.error;
      if(!changed.data)return json({error:"Intervention modifiée simultanément, actualisez"},409);
      await audit(client,account.username,"rental-work-updated","rental_work_order",id,{updated_fields:Object.keys(fields)});
      return json({ok:true});
    }

    if (action==="work-transition" && req.method==="POST") {
      if(!worksAllowed(account))return json({error:"Gestion des interventions non autorisée"},403);
      const body=await req.json(),id=String(body?.id||""),next=String(body?.next||"");
      if(!apiUuid(id)||body?.confirmed!==true)return json({error:"Transition non confirmée"},400);
      const permitted:any={
        open:["in_review","cancelled"],in_review:["quoted","cancelled"],
        quoted:["approved","cancelled"],approved:["in_progress","cancelled"],
        in_progress:["completed","cancelled"]
      };
      const current=await client.from("rental_work_orders").select("id,status,provider_name,estimate_amount").eq("id",id).maybeSingle();
      if(current.error)throw current.error;
      if(!current.data||!permitted[current.data.status]?.includes(next))
        return json({error:"Cette transition de statut n’est pas autorisée"},409);
      if(["quoted","approved"].includes(next)&&(!current.data.provider_name||current.data.estimate_amount===null||Number(current.data.estimate_amount)<=0))
        return json({error:"Prestataire et montant du devis nécessaires avant validation"},409);
      const timestamp=new Date().toISOString();
      const fields:any={status:next,updated_by:account.username,updated_at:timestamp};
      if(next==="approved"){fields.approved_at=timestamp;fields.approved_by=account.username}
      if(next==="completed")fields.completed_on=timestamp.slice(0,10);
      const saved=await client.from("rental_work_orders").update(fields).eq("id",id).eq("status",current.data.status).select("id").maybeSingle();
      if(saved.error)throw saved.error;
      if(!saved.data)return json({error:"Intervention modifiée, actualisez"},409);
      await audit(client,account.username,"rental-work-status-changed","rental_work_order",id,{from:current.data.status,to:next});
      return json({ok:true,status:next});
    }


    if (action==="document-upload" && req.method==="POST") {
      if(!documentsAllowed(account))return json({error:"Archivage réservé au personnel habilité"},403);
      const maxBytes=4194304;
      const length=Number(req.headers.get("content-length")||"0");
      if(length>maxBytes+100000)return json({error:"Document trop volumineux (maximum 4 Mo)"},413);
      if(!String(req.headers.get("content-type")||"").startsWith("multipart/form-data;"))
        return json({error:"Envoi de fichier requis"},400);
      const form=await req.formData();
      const file=form.get("file"),propertyId=String(form.get("property_id")||"");
      const category=String(form.get("category")||""),label=String(form.get("label")||"").trim();
      const leaseId=String(form.get("lease_id")||"").trim();
      if(!apiUuid(propertyId)|| (leaseId!==""&&!apiUuid(leaseId)))
        return json({error:"Bien ou bail invalide"},400);
      if(!["bail","diagnostic","assurance","facture","etat_des_lieux","quittance_importee","travaux","autre"].includes(category))
        return json({error:"Catégorie invalide"},400);
      if(label.length<3||label.length>180)return json({error:"Intitulé de 3 à 180 caractères requis"},400);
      if(!(file instanceof File)||file.size<1||file.size>maxBytes)
        return json({error:"Fichier absent ou dépassant 4 Mo"},413);
      const type=String(file.type).toLowerCase();
      const ext=type==="application/pdf"?".pdf":type==="image/jpeg"?".jpg":type==="image/png"?".png":null;
      if(!ext)return json({error:"Formats acceptés : PDF, JPEG et PNG uniquement"},400);
      const original=String(file.name||"").split(/[\\/]/).pop()?.trim()||"";
      if(original.length<3||original.length>180||!/\.(pdf|jpe?g|png)$/i.test(original))
         return json({error:"Nom de fichier ou extension invalide"},400);
      if(!(
        (ext===".pdf"&&/\.pdf$/i.test(original))||
        (ext===".jpg"&&/\.jpe?g$/i.test(original))||
        (ext===".png"&&/\.png$/i.test(original))
      ))return json({error:"Extension incompatible avec le type de fichier"},400);
      const prop=await client.from("rental_properties").select("id,is_example").eq("id",propertyId).maybeSingle();
      if(prop.error)throw prop.error;
      if(!prop.data||prop.data.is_example)return json({error:"Bien immobilier réel introuvable"},404);
      if(leaseId){
        const lease=await client.from("rental_leases").select("id").eq("id",leaseId).eq("property_id",propertyId).maybeSingle();
        if(lease.error)throw lease.error;
        if(!lease.data)return json({error:"Ce bail n’appartient pas au bien sélectionné"},409);
      }
      const body=new Uint8Array(await file.arrayBuffer());
      const signatureValid=ext===".pdf"
        ? body.length>=5&&body[0]===37&&body[1]===80&&body[2]===68&&body[3]===70&&body[4]===45
        : ext===".png"
          ? body.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>body[i]===v)
          : body.length>=3&&body[0]===255&&body[1]===216&&body[2]===255;
      if(!signatureValid)return json({error:"Signature du fichier incompatible avec son format"},400);
      const id=crypto.randomUUID(),path=propertyId+"/"+id+ext;
      const stored=await client.storage.from("marne-invest-private-docs").upload(path,body,{
        contentType:type,upsert:false,cacheControl:"0"
      });
      if(stored.error)return json({error:"Échec de l’archivage privé du document"},502);
      const saved=await client.from("rental_documents").insert({
        id,property_id:propertyId,lease_id:leaseId||null,category,label,original_name:original,
        mime_type:type,byte_size:file.size,object_path:path,uploaded_by:account.username
      }).select("id,property_id,category,label,original_name,byte_size,created_at").single();
      if(saved.error){
        await client.storage.from("marne-invest-private-docs").remove([path]);
        throw saved.error;
      }
      await audit(client,account.username,"rental-document-archived","rental_document",id,
        {property_id:propertyId,category,byte_size:file.size});
      return json({ok:true,item:saved.data});
    }

    if(action==="document-download"&&req.method==="GET"){
      if(!documentsAllowed(account))return json({error:"Accès aux documents non autorisé"},403);
      const id=String(url.searchParams.get("id")||"");
      if(!apiUuid(id))return json({error:"Document invalide"},400);
      const q=await client.from("rental_documents")
         .select("id,object_path,original_name,property_id").eq("id",id).maybeSingle();
      if(q.error)throw q.error;
      if(!q.data)return json({error:"Document introuvable"},404);
      const result=await client.storage.from("marne-invest-private-docs")
        .createSignedUrl(q.data.object_path,60,{download:q.data.original_name});
      if(result.error||!result.data?.signedUrl)return json({error:"Document temporairement indisponible"},502);
      await audit(client,account.username,"rental-document-download","rental_document",id,
        {property_id:q.data.property_id});
      return json({ok:true,url:result.data.signedUrl,valid_seconds:60});
    }




    if(action==="health-run" && req.method==="POST"){
      if(!paymentVoidAllowed(account)||readOnly)
        return json({error:"Diagnostic serveur réservé à l’administrateur"},403);
      const body=await req.json().catch(()=>null);
      if(body?.confirmed!==true)return json({error:"Confirmation du diagnostic requise"},400);
      const result=await client.rpc("marne_run_health_check",{p_trigger:"manual"});
      if(result.error){
        console.error("Rental diagnostics failure",result.error.code);
        return json({error:"Diagnostic indisponible : vérifiez le journal serveur"},503);
      }
      await audit(client,account.username,"rental-health-diagnostic","rental_health_run",result.data.id,{
        status:result.data.status,critical_count:result.data.critical_count,
        warning_count:result.data.warning_count
      });
      return json({ok:true,report:result.data});
    }

    if(action==="irl-check"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Surveillance INSEE réservée aux gestionnaires habilités"},403);
      try{
        const serviceBase=Deno.env.get("SUPABASE_URL")||"";
        const key=transportSecret();
        if(!key||!serviceBase)throw new Error("Service unavailable");
        const r=await fetch(serviceBase+"/functions/v1/marne-irl-review",{
          method:"POST",headers:{"Content-Type":"application/json","x-marne-service-key":key},
          body:'{"action":"check"}',signal:AbortSignal.timeout(25000)
        });
        const data=await r.json().catch(()=>({ok:false}));
        if(!r.ok)return json({error:"Indice Insee non confirmé. Aucun changement effectué."},503);
        if(data.changed)await audit(client,account.username,"rental-new-irl-candidate-detected",
          "rental_irl_candidate",data.candidate_id,{period:data.period});
        return json({ok:true,...data});
      }catch{return json({error:"Source INSEE momentanément indisponible. Les indices vérifiés restent inchangés."},503)}
    }

    if(action==="irl-approve"&&req.method==="POST"){
      if(!paymentVoidAllowed(account))return json({error:"Validation des nouveaux indices réservée à l’administrateur"},403);
      const body=await req.json().catch(()=>null),id=String(body?.candidate_id||""),date=String(body?.published_on||"");
      if(!apiUuid(id)||body?.confirmed!==true||
        !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)||
        Number.isNaN(Date.parse(date+"T00:00:00Z"))||
        new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)
        return json({error:"Confirmez l’indice officiel et renseignez sa date de publication réelle."},400);
      const result=await client.rpc("marne_irl_approve_candidate",{
        p_candidate_id:id,p_published_on:date,p_reviewer:account.username
      });
      if(result.error){
        if(result.error.code==="22023")return json({error:result.error.message},409);
        throw result.error;
      }
      await audit(client,account.username,"rental-irl-index-verified","rental_irl_candidate",id,
        {year:result.data.year,quarter:result.data.quarter,value:result.data.value,published_on:date});
      return json({ok:true,...result.data});
    }

    if(action==="irl-register"&&req.method==="POST"){
      if(!paymentVoidAllowed(account))return json({error:"Enregistrement des indices officiels réservé à l’administrateur"},403);
      const body=await req.json().catch(()=>null),year=Number(body?.year),quarter=Number(body?.quarter);
      const value=apiAmount(body?.value),publishedOn=String(body?.published_on||""),sourceUrl=String(body?.source_url||"").trim();
      const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const quarterEnd=Number.isInteger(year)&&year>=2000&&year<=2100&&[1,2,3,4].includes(quarter)
        ? new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10):"";
      if(body?.confirmed!==true||!Number.isInteger(year)||year<2000||year>2100||![1,2,3,4].includes(quarter)
        ||!Number.isFinite(value)||value<=0||value>99999.99||!apiDate(publishedOn)||publishedOn>today
        ||publishedOn<=quarterEnd||!/^https:\/\/www\.insee\.fr\/fr\/statistiques\/[0-9]+$/.test(sourceUrl))
        return json({error:"Confirmez l’indice publié par l’INSEE : année, trimestre, valeur positive à deux décimales maximum, date réelle après le trimestre et lien officiel."},400);
      const result=await client.rpc("marne_register_irl_index",{
        p_year:year,p_quarter:quarter,p_value:value,p_published_on:publishedOn,
        p_source_url:sourceUrl,p_by:account.username,p_confirmed:true
      });
      if(result.error){
        if(["22023","23505","40001","55000"].includes(result.error.code))return json({error:result.error.message},409);
        throw result.error;
      }
      if(!result.data?.already_exists)await audit(client,account.username,"rental-irl-index-registered","rental_irl_index",undefined,
        {year,quarter,value,published_on:publishedOn,source_url:sourceUrl});
      return json({ok:true,...result.data});
    }

    if(action==="save-irl-rule"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Gestion IRL non autorisée"},403);
      const body=await req.json().catch(()=>null);
      const leaseId=String(body?.lease_id||"");
      const due=String(body?.revision_due_on||"");
      const quarter=Number(body?.reference_quarter),targetYear=Number(body?.target_year),dpe=String(body?.dpe_rating||"unknown");
      const scope=String(body?.geographic_scope||"metropole");
      const validDate=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(due)
        &&!Number.isNaN(Date.parse(due+"T00:00:00Z"))
        &&new Date(due+"T00:00:00Z").toISOString().slice(0,10)===due;
      if(!apiUuid(leaseId)||!validDate||![1,2,3,4].includes(quarter)
        ||!Number.isInteger(targetYear)||targetYear<2001||targetYear>2100
        ||!["A","B","C","D","E","F","G","unknown"].includes(dpe)
        ||!["metropole","corse","outre_mer"].includes(scope)
        ||typeof body?.has_revision_clause!=="boolean"
        ||typeof body?.is_mobility_lease!=="boolean"
        ||body?.confirmed!==true)
        return json({error:"Vérifiez la clause de révision, le DPE, la région, le trimestre et l’année de l’indice cible."},400);
      const lease=await client.from("rental_leases").select("id,start_date,status,lease_kind,verified_at").eq("id",leaseId).maybeSingle();
      if(lease.error)throw lease.error;
      if(!lease.data||lease.data.status!=="active"||!lease.data.verified_at||lease.data.lease_kind!=="residential")
        return json({error:"Configuration IRL disponible uniquement sur les baux d’habitation actifs validés"},409);
      const previous=await client.from("rental_irl_lease_rules").select("lease_id,reference_quarter,target_year,revision_due_on,dpe_rating,has_revision_clause,is_mobility_lease,geographic_scope").eq("lease_id",leaseId).maybeSingle();
      if(previous.error)throw previous.error;
      if(previous.data){
        const existing=await client.from("rental_irl_proposals").select("id,status").eq("lease_id",leaseId).eq("revision_due_on",previous.data.revision_due_on).limit(1);
        if(existing.error)throw existing.error;
        if(existing.data?.some(p=>["scheduled","cancelled"].includes(p.status)) && (
           previous.data.revision_due_on!==due ||
           previous.data.reference_quarter!==quarter ||
           previous.data.target_year!==targetYear ||
           previous.data.dpe_rating!==dpe ||
           previous.data.has_revision_clause!==body.has_revision_clause ||
           previous.data.is_mobility_lease!==body.is_mobility_lease ||
           previous.data.geographic_scope!==scope))
          return json({error:"Une révision programmée ou annulée protège les règles contractuelles de son historique."},409);
        if(existing.data?.some(p=>p.status==="applied") &&
           due<=previous.data.revision_due_on)
          return json({error:"Pour une nouvelle révision, choisissez une échéance contractuelle postérieure à la révision appliquée."},409);
      }
      const saved=await client.rpc("marne_save_irl_rule",{
        p_lease_id:leaseId,p_by:account.username,p_rule:{
          revision_due_on:due,reference_quarter:quarter,target_year:targetYear,
          dpe_rating:dpe,geographic_scope:scope,has_revision_clause:body.has_revision_clause,
          is_mobility_lease:body.is_mobility_lease
        }
      });
      if(saved.error){
        if(["22023","23505","40001","55000"].includes(saved.error.code))return json({error:saved.error.message},409);
        throw saved.error;
      }
      await audit(client,account.username,"rental-irl-rule-verified","rental_lease",leaseId,
        {revision_due_on:due,reference_quarter:quarter,target_year:targetYear,dpe_rating:dpe,scope});
      return json({ok:true,lease_id:leaseId});
    }

    if(action==="prepare-irl"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Simulation IRL non autorisée"},403);
      const body=await req.json().catch(()=>null),leaseId=String(body?.lease_id||"");
      if(!apiUuid(leaseId)||body?.confirmed!==true)
        return json({error:"Confirmation et bail valides requis"},400);
      const q=await client.rpc("marne_irl_prepare_proposal",{p_lease_id:leaseId,p_prepared_by:account.username});
      if(q.error){
        if(["22023","55000"].includes(q.error.code))return json({error:q.error.message},409);
        throw q.error;
      }
      if(q.data?.created)await audit(client,account.username,"rental-irl-proposal-prepared","rental_lease",leaseId,
        {proposal_id:q.data.proposal_id,base_rent:q.data.base_rent,proposed_rent:q.data.proposed_rent});
      return json({ok:true,...q.data});
    }

    if (action === "run-installments" && req.method === "POST") {
      if(!paymentAllowed(account))
        return json({error:"Action réservée aux gestionnaires autorisés"},403);
      const result=await client.rpc("marne_generate_installments_daily");
      if(result.error)throw result.error;
      await audit(client,account.username,"rental-automatic-installments-run","rental_automation_run",undefined,
        {created:Number(result.data?.created||0),skipped:Number(result.data?.skipped||0)});
      return json({ok:true,...result.data});
    }


    if(action==="schedule-irl"&&req.method==="POST"){
      if(!paymentVoidAllowed(account))
        return json({error:"Programmation de révision réservée à l’administrateur"},403);
      const body=await req.json().catch(()=>null);
      const proposalId=String(body?.proposal_id||"");
      const expectedRevision=Number(body?.expected_revision);
      const noticeOn=String(body?.notice_sent_on||"");
      const method=String(body?.notice_method||"");
      const isDate=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(noticeOn)
       &&!Number.isNaN(Date.parse(noticeOn+"T00:00:00Z"))
       &&new Date(noticeOn+"T00:00:00Z").toISOString().slice(0,10)===noticeOn;
      if(body?.confirmed!==true||!apiUuid(proposalId)||!isDate||!["number","string"].includes(typeof body?.expected_revision)
         ||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||expectedRevision>2147483647
         ||!["registered_post","hand_signed"].includes(method))
        return json({error:"Confirmez une notification réellement effectuée, avec date et mode valides"},400);
      const result=await client.rpc("marne_schedule_irl_application",{
        p_proposal_id:proposalId,p_notice_sent_on:noticeOn,
        p_notice_method:method,p_approved_by:account.username,p_expected_revision:expectedRevision
      });
      if(result.error){
        if(["22023","23505","55000"].includes(result.error.code))
          return json({error:result.error.message},409);
        throw result.error;
      }
      await audit(client,account.username,"rental-irl-application-scheduled",
        "rental_irl_application",result.data.application_id,{
          proposal_id:proposalId,effective_on:result.data.effective_on,
          before:result.data.rent_before,after:result.data.rent_after,
          updated_future_installments:result.data.updated_future_installments,
          notice_sent_on:noticeOn,notice_method:method
        });
      return json({ok:true,...result.data});
    }

    if (action === "save-partial-installment" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Gestion des échéances réservée au personnel habilité"},403);
      const body=await req.json().catch(()=>null),leaseId=body?.lease_id,period=body?.period;
      const rent=apiAmount(body?.rent_amount),charges=apiAmount(body?.charges_amount);
      if(!apiUuid(leaseId)||typeof period!=="string"||!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(period)
        ||!Number.isFinite(rent)||!Number.isFinite(charges)||body?.confirmed!==true)
        return json({error:"Confirmez le mois partiel et ses montants de loyer et de charges vérifiés, avec deux décimales maximum."},400);
      const result=await client.rpc("marne_set_partial_installment",{
        p_lease_id:leaseId,p_period:period+"-01",p_rent:rent,p_charges:charges,p_by:account.username,p_confirmed:true
      });
      if(result.error){
        if(["22023","23503","23505","40001","55000"].includes(result.error.code))return json({error:result.error.message||"Cette échéance ne peut pas être modifiée. Vérifiez le bail et ses règlements."},409);
        throw result.error;
      }
      if(result.data.created||result.data.updated)await audit(client,account.username,"rental-partial-installment-saved","rental_installment",result.data.item?.id,
        {lease_id:leaseId,period:period+"-01",rent_amount:rent,charges_amount:charges});
      return json({ok:true,...result.data});
    }

    if (action === "generate-installment" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Création d’échéances réservée au personnel habilité"},403);
      const body=await req.json().catch(()=>null);
      const leaseId=String(body?.lease_id||""),period=String(body?.period||"");
      if(!apiUuid(leaseId)||!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(period))
        return json({error:"Bail ou mois invalide"},400);
      const q=await client.rpc("marne_create_installment",{
        p_lease_id:leaseId,p_period:period+"-01",p_by:account.username
      });
      if(q.error){
        if(q.error.code==="22023")return json({error:q.error.message},409);
        throw q.error;
      }
      if(!q.data.already_exists)
        await audit(client,account.username,"rental-generate-installment",
          "rental_installment",q.data.item?.id,{lease_id:leaseId,period:period+"-01"});
      return json({ok:true,...q.data});
    }

    if(action==="bank-import"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Import bancaire réservé à la gestion financière"},403);
      const length=Number(req.headers.get("content-length")||0);
      if(length>180000)return json({error:"Import trop volumineux (200 lignes maximum)"},413);
      const body=await req.json().catch(()=>null);
      const label=String(body?.account_label||"").trim(),filename=String(body?.filename||"").trim();
      const input=body?.rows;
      if(label.length<2||label.length>80||filename.length<3||filename.length>160
         ||!Array.isArray(input)||input.length<1||input.length>200)
         return json({error:"Relevé ou libellé de compte invalide (200 mouvements maximum)"},400);
      const rows:any[]=[];
      for(const [i,row] of input.entries()){
        if(!row||typeof row!=="object"||Array.isArray(row))
          return json({error:"Ligne bancaire "+(i+1)+" invalide"},400);
        const booking_date=String(row.booking_date||"");
        const amount=String(row.amount??"").trim().replace(",",".");
        const description=String(row.description||"").trim(),reference=String(row.reference||"").trim();
        if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(booking_date)
           ||Number.isNaN(Date.parse(booking_date+"T00:00:00Z"))
           ||new Date(booking_date+"T00:00:00Z").toISOString().slice(0,10)!==booking_date
           ||!/^[+-]?\d{1,9}(\.\d{1,2})?$/.test(amount)
           ||description.length<2||description.length>500||reference.length>120)
          return json({error:"Format invalide à la ligne "+(i+1)},400);
        rows.push({booking_date,amount,description,reference});
      }
      const bytes=new TextEncoder().encode(JSON.stringify(rows));
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
      const fingerprint=Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
      const q=await client.rpc("marne_bank_import_rows",{
        p_account_label:label,p_original_filename:filename,p_file_sha256:fingerprint,p_rows:rows,p_imported_by:account.username
      });
      if(q.error){
        if(q.error.code==="22023"||q.error.code==="22008")return json({error:"Ligne du relevé invalide : vérifiez les dates et les montants"},400);
        throw q.error;
      }
      if(!q.data?.duplicate)await audit(client,account.username,"rental-bank-csv-import","rental_bank_import",q.data?.batch_id,{
        account_label:label,rows:q.data.rows
      });
      return json({ok:true,...q.data});
    }

    if(action==="bank-confirm"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Rapprochement bancaire non autorisé"},403);
      const body=await req.json().catch(()=>null);
      if(body?.confirmed!==true||!apiUuid(body?.bank_line_id)||!apiUuid(body?.lease_id)
         ||(body?.installment_id && !apiUuid(body.installment_id)))
        return json({error:"Sélection du bail et confirmation du rapprochement obligatoires"},400);
      const q=await client.rpc("marne_bank_confirm_line",{
        p_line_id:body.bank_line_id,p_lease_id:body.lease_id,
        p_installment_id:body.installment_id||null,p_reviewed_by:account.username
      });
      if(q.error){
        if(q.error.code==="22023")return json({error:q.error.message},409);
        if(q.error.code==="23505")return json({error:"Mouvement déjà enregistré : vérifier le rapprochement existant"},409);
        throw q.error;
      }
      if(!q.data?.duplicate)await audit(client,account.username,"rental-bank-payment-confirmed","rental_bank_line",body.bank_line_id,{
        lease_id:body.lease_id,installment_id:body.installment_id||null,payment_id:q.data?.payment_id
      });
      return json({ok:true,...q.data});
    }

    if(action==="bank-ignore"&&req.method==="POST"){
      if(!paymentAllowed(account))return json({error:"Exclusion bancaire non autorisée"},403);
      const body=await req.json().catch(()=>null);
      const reason=String(body?.reason||"").trim();
      if(body?.confirmed!==true||!apiUuid(body?.bank_line_id)||reason.length<6||reason.length>500)
        return json({error:"Motif d’exclusion entre 6 et 500 caractères obligatoire"},400);
      const q=await client.rpc("marne_bank_ignore_line",{
        p_line_id:body.bank_line_id,p_reason:reason,p_reviewed_by:account.username
      });
      if(q.error){if(q.error.code==="22023")return json({error:q.error.message},409);throw q.error}
      if(!q.data?.duplicate)await audit(client,account.username,"rental-bank-line-ignored","rental_bank_line",body.bank_line_id,{reason});
      return json({ok:true,...q.data});
    }

    if (action === "record-payment" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Accès aux paiements non autorisé"},403);
      const body=await req.json();
      if(body?.confirmed!==true)return json({error:"Confirmez que le paiement a réellement été reçu"},400);
      const uuid=(v:any)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const value=String(body?.amount??"").trim().replace(",",".");
      const date=String(body?.received_on??"");
      if(!uuid(body?.idempotency_key)||!uuid(body?.lease_id)||!apiDate(date)||
        !/^\d{1,10}(\.\d{1,2})?$/.test(value)||
        (body?.installment_id!=null && !uuid(body.installment_id)))
        return json({error:"Date, montant ou identifiants invalides"},400);
      const params={
        p_idempotency_key:body.idempotency_key,
        p_lease_id:body.lease_id,
        p_received_on:date,
        p_amount:value,
        p_method:String(body?.payment_method||""),
        p_reference:String(body?.reference||"").trim(),
        p_payer_name:String(body?.payer_name||"").trim(),
        p_note:String(body?.note||"").trim(),
        p_recorded_by:account.username,
        p_installment_id:body.installment_id||null
      };
      const q=await client.rpc("marne_record_payment",params);
      if(q.error){
        if(q.error.code==="23505")return json({error:"Un paiement avec cette référence existe déjà ou cette saisie a déjà été utilisée"},409);
        if(q.error.code==="22023")return json({error:q.error.message},400);
        throw q.error;
      }
      if(!q.data?.duplicate)await audit(client,account.username,"rental-record-payment","rental_payment",q.data.id,{lease_id:body.lease_id,amount:value,received_on:date,allocated:q.data.allocated});
      return json({ok:true,...q.data});
    }

    if (action === "allocate-payment" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Accès aux paiements non autorisé"},403);
      const body=await req.json(),uuid=(v:any)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const amount=String(body?.amount??"").trim().replace(",",".");
      if(body?.confirmed!==true||!uuid(body?.payment_id)||!uuid(body?.installment_id)||!/^\d{1,10}(\.\d{1,2})?$/.test(amount))
         return json({error:"Affectation non confirmée ou invalide"},400);
      const q=await client.rpc("marne_allocate_payment",{p_payment_id:body.payment_id,p_installment_id:body.installment_id,p_amount:amount});
      if(q.error){if(q.error.code==="22023")return json({error:q.error.message},400);throw q.error;}
      await audit(client,account.username,"rental-allocate-payment","rental_payment",body.payment_id,{installment_id:body.installment_id,amount});
      return json({ok:true,...q.data});
    }

    if (action === "void-payment" && req.method === "POST") {
      if(!paymentVoidAllowed(account))return json({error:"Annulation réservée à l’administration immobilière"},403);
      const body=await req.json();
      if(body?.confirmed!==true||typeof body?.payment_id!=="string"||!apiUuid(body.payment_id))
        return json({error:"Annulation non confirmée ou paiement invalide"},400);
      const reason=String(body?.reason||"").trim();
      if(reason.length<6||reason.length>500)return json({error:"Motif obligatoire de 6 à 500 caractères"},400);
      const q=await client.rpc("marne_void_payment",{p_payment_id:body.payment_id,p_reason:reason,p_voided_by:account.username});
      if(q.error){if(q.error.code==="22023")return json({error:q.error.message},400);throw q.error;}
      if(!q.data?.already_void)await audit(client,account.username,"rental-void-payment","rental_payment",body.payment_id,{reason});
      return json({ok:true,...q.data});
    }


    if (action === "receipt-preview" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Accès aux documents financiers non autorisé"},403);
      const body=await req.json(),installmentId=String(body?.installment_id||"");
      if(!apiUuid(installmentId))return json({error:"Échéance invalide"},400);
      const i=await client.from("rental_installments").select("id,lease_id,property_id,period,due_on,rent_amount,charges_amount,total_due,status").eq("id",installmentId).maybeSingle();
      if(i.error)throw i.error;
      if(!i.data||i.data.status!=="scheduled")return json({error:"Échéance inexistante ou annulée"},404);
      const [lease,property,status]=await Promise.all([
        client.from("rental_leases").select("id,tenant_row_id,tenant_name,status,verified_at,start_date,end_date,lease_kind,issuer_name,issuer_address,receipt_email_consent").eq("id",i.data.lease_id).single(),
        client.from("rental_properties").select("name,data").eq("id",i.data.property_id).single(),
        client.rpc("marne_installment_status",{p_installment_id:installmentId})
      ]);
      for(const q of [lease,property,status])if(q.error)throw q.error;
      if(!lease.data||!["active","closed"].includes(lease.data.status)||!lease.data.verified_at)
        return json({error:"Le bail doit avoir été validé avant l’établissement du document."},409);
      if(lease.data.lease_kind!=="residential")
        return json({error:"Ce modèle de quittance est réservé aux baux d’habitation vérifiés."},409);
      const issuer=String(lease.data.issuer_name||"").trim(),issuerAddress=String(lease.data.issuer_address||"").trim();
      const tenant=String(lease.data.tenant_name||"").trim();
      let address=String(property.data?.data?.["Adresse"]||"").trim();
      if(address){
        const locality=[property.data?.data?.["Code postal"],property.data?.data?.["Ville"]]
          .map(value=>String(value||"").trim()).filter(Boolean).join(" ");
        if(locality)address+="\n"+locality;
      }
      if(!address&&lease.data.tenant_row_id){
        const q=await client.from("rental_tenant_rows").select("data").eq("id",lease.data.tenant_row_id).maybeSingle();
        if(q.error)throw q.error;
        address=String(q.data?.data?.["Adresse logement"]||"").trim();
      }
      if(!issuer||!issuerAddress||!tenant||!address)
        return json({error:"Complétez le nom et l’adresse du bailleur, le locataire et l’adresse du logement avant la quittance."},409);
      const paid=Number(status.data?.allocated||0),due=Number(status.data?.due||0);
      if(!Number.isFinite(paid)||!Number.isFinite(due)||due<=0||paid<=0)
        return json({error:"Aucun règlement enregistré sur cette échéance."},409);
      const complete=Math.round(paid*100)>=Math.round(due*100);
      const period=String(i.data.period).slice(0,7),year=Number(period.slice(0,4)),month=Number(period.slice(5,7));
      const monthFrom=period+"-01",monthTo=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
      const from=lease.data.start_date&&lease.data.start_date>monthFrom?lease.data.start_date:monthFrom;
      const to=lease.data.end_date&&lease.data.end_date<monthTo?lease.data.end_date:monthTo;
      if(from>to)return json({error:"Cette échéance ne recouvre pas la période du bail. Vérifiez ses dates avant le document."},409);
      await audit(client,account.username,"rental-payment-document-preview","rental_installment",installmentId,{type:complete?"quittance":"recu",paid,due});
      return json({
        ok:true,document_type:complete?"quittance":"recu",issuer,issuer_address:issuerAddress,
        tenant,address,property_name:property.data?.name||"",
        period,period_from:from,period_to:to,generated_on:new Date().toISOString().slice(0,10),
        rent:Number(i.data.rent_amount),charges:Number(i.data.charges_amount),
        total_due:due,paid,remaining:Math.max(0,due-paid),
        is_email_consent_given:lease.data.receipt_email_consent===true,
        note:"Aperçu imprimable, non transmis et non archivé comme PDF."
      });
    }

    if (action === "prepare-reminder" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Accès aux relances non autorisé"},403);
      const body=await req.json(),installmentId=String(body?.installment_id||""),stage=Number(body?.stage);
      if(!apiUuid(installmentId)||![7,14].includes(stage))return json({error:"Relance invalide"},400);
      const i=await client.from("rental_installments").select("id,lease_id,period,due_on,status").eq("id",installmentId).maybeSingle();
      if(i.error)throw i.error;
      if(!i.data||i.data.status!=="scheduled")return json({error:"Échéance non active"},409);
      const l=await client.from("rental_leases").select("id,tenant_row_id,tenant_name,status,verified_at,property_id").eq("id",i.data.lease_id).single();
      if(l.error)throw l.error;
      if(l.data.status!=="active"||!l.data.verified_at||!l.data.tenant_row_id)
        return json({error:"Bail non vérifié ou locataire non relié"},409);
      const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const days=Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(i.data.due_on+"T00:00:00Z"))/86400000);
      if(!Number.isInteger(days)||days<stage)return json({error:"Délai de relance non atteint"},409);
      if(stage===14){
        const prior=await client.from("rental_reminder_drafts").select("status,declared_sent_at").eq("installment_id",installmentId).eq("stage",7).maybeSingle();
        if(prior.error)throw prior.error;
        if(prior.data?.status!=="declared_sent"||!prior.data.declared_sent_at)
           return json({error:"La relance J+7 doit d’abord avoir été envoyée et confirmée."},409);
        const sentDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(prior.data.declared_sent_at));
        if(Math.floor((Date.parse(today+"T00:00:00Z")-Date.parse(sentDate+"T00:00:00Z"))/86400000)<7)
           return json({error:"Attendez sept jours après le premier rappel pour préparer le second."},409);
      }
      const v=await client.rpc("marne_installment_status",{p_installment_id:installmentId});
      if(v.error)throw v.error;
      const due=Number(v.data?.remaining||0),waiting=Number(v.data?.unallocated_on_lease||0);
      if(due<=0.005)return json({error:"Cette échéance est déjà soldée"},409);
      if(waiting>0.005)return json({error:"Un paiement non affecté existe pour ce bail : rapprochez-le avant toute relance."},409);
      const row=await client.from("rental_tenant_rows").select("data").eq("id",l.data.tenant_row_id).single();
      if(row.error)throw row.error;
      const recipient=String(row.data.data?.["Mail locataire"]||"").trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
        return json({error:"Adresse e-mail du locataire manquante ou invalide"},409);
      const property=await client.from("rental_properties").select("name").eq("id",l.data.property_id).single();
      if(property.error)throw property.error;
      const msg="Bonjour "+String(l.data.tenant_name||"")+",\n\nSauf erreur de notre part, au "+today+
        " un solde de "+due.toFixed(2).replace(".",",")+" € reste à rapprocher pour l’échéance du "+
        i.data.due_on+" concernant "+String(property.data.name)+".\n\nSi vous avez effectué un règlement récemment, merci de nous le signaler en précisant sa date et sa référence afin que nous puissions vérifier notre suivi.\n\nCeci est un rappel amiable, sous réserve de la vérification des paiements.\n\nCordialement,\nMarne Invest";
      const subject="Rappel amiable de l’échéance du "+i.data.due_on+" — "+String(property.data.name);
      const saved=await client.rpc("marne_prepare_reminder_draft",{
        p_installment_id:installmentId,p_stage:stage,p_expected_remaining:due,
        p_recipient_email:recipient,p_subject:subject,p_body:msg,p_by:account.username
      });
      if(saved.error){
        if(["22023","23505","40001","55000"].includes(saved.error.code))
          return json({error:saved.error.message},409);
        throw saved.error;
      }
      if(!saved.data.already_exists)await audit(client,account.username,"rental-reminder-prepared","rental_reminder",saved.data.item.id,
        {installment_id:installmentId,stage,reprepared:saved.data.reprepared===true});
      return json(saved.data);
    }

    if (action === "declare-reminder-sent" && req.method === "POST") {
      if(!paymentAllowed(account))return json({error:"Accès aux relances non autorisé"},403);
      const body=await req.json(),id=String(body?.id||""),preparedAt=String(body?.prepared_at||"");
      if(!apiUuid(id)||body?.confirmed!==true)
        return json({error:"Confirmation de l’envoi manuel obligatoire"},400);
      if(!apiDate(preparedAt.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(preparedAt)
        ||Number.isNaN(Date.parse(preparedAt)))
        return json({error:"Version du brouillon manquante ou invalide : actualisez avant de confirmer l’envoi."},400);
      const result=await client.rpc("marne_declare_reminder_sent",{
        p_reminder_id:id,p_expected_prepared_at:preparedAt,p_by:account.username
      });
      if(result.error){
        if(["22023","40001","55000"].includes(result.error.code))return json({error:result.error.message},409);
        throw result.error;
      }
      if(result.data?.ok!==true)return json(result.data,result.data?.code==="reminder_missing"?404:409);
      if(!result.data.already_exists)await audit(client,account.username,"rental-reminder-declared-sent","rental_reminder",id,{manual:true});
      return json(result.data);
    }


    if (action==="mail-message"&&req.method==="GET") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      const id=String(url.searchParams.get("id")||"");
      if(!apiUuid(id))return json({error:"Identifiant invalide"},400);
      const q=await client.from("rental_mail_messages")
        .select("id,sender_email,recipient_email,subject,plain_body,received_at,is_seen,has_attachments,attachment_count,message_id,body_status,source_size,body_note")
        .eq("id",id).eq("account_email",await configuredFreeAccount(client)).maybeSingle();
      if(q.error)throw q.error;
      if(!q.data)return json({error:"Courriel introuvable"},404);
      return json({ok:true,item:q.data});
    }

    if (action==="mail-mark-read"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      const body=await req.json(),id=String(body?.id||"");
      if(!apiUuid(id))return json({error:"Identifiant invalide"},400);
      const q=await client.from("rental_mail_messages").update({is_seen:true,viewed_at:new Date().toISOString()})
        .eq("id",id).eq("account_email",await configuredFreeAccount(client)).select("id").maybeSingle();
      if(q.error)throw q.error;
      return json({ok:true});
    }

    if (action==="mail-status"&&req.method==="GET") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      const mailAddress=await configuredFreeAccount(client,true);
      return json({ok:true,account:mailAddress,credential_configured:await freePasswordConfigured(client,mailAddress),
        smtp_mode:"465/TLS",imap_mode:"993/TLS",autonomous_sending:false,
        transport_testing_required:true});
    }

    if (action==="mail-test"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      if(!await freePasswordConfigured(client,await configuredFreeAccount(client)))return json({error:"Configurez le mot de passe Free depuis Paramètres → Messagerie."},409);
      try{const result=await callMailTransport({action:"test"});return json(result)}
      catch{return json({error:"Le test IMAP n’a pas abouti. Vérifiez le mot de passe et la connexion Free."},502)}
    }

    if (action==="mail-sync"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      if(!await freePasswordConfigured(client,await configuredFreeAccount(client)))return json({error:"La boîte Free n’est pas encore connectée : renseignez le mot de passe dans Paramètres."},409);
      try{
        const result=await callMailTransport({action:"sync"});
        await audit(client,account.username,"rental-mail-sync",undefined,undefined,{imported:result.imported||0,checked:result.checked||0,metadata_only:result.metadata_only||0,has_more:result.has_more===true,busy:result.busy===true});
        return json(result);
      }catch{return json({error:"Synchronisation IMAP non aboutie. Aucun courriel existant n’a été supprimé."},502)}
    }

    if (action==="mail-create-draft"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      const mailAddress=await configuredFreeAccount(client);
      const body=await req.json(),key=String(body?.client_key||"");
      const to=String(body?.recipient_email||"").trim().toLowerCase(),subject=String(body?.subject||"").trim(),plain=String(body?.plain_body||"").trim();
      if(!apiUuid(key)||!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)||to.length>254
         ||subject.length<1||subject.length>250||plain.length<1||plain.length>20000)
         return json({error:"Vérifiez le destinataire, l’objet et le contenu du courriel."},400);
      const reply=body?.in_reply_to_message_id||null;
      if(reply&&!apiUuid(reply))return json({error:"Réponse à un message invalide"},400);
      if(reply){
        const parent=await client.from("rental_mail_messages").select("id").eq("id",reply).eq("account_email",mailAddress).maybeSingle();
        if(parent.error)throw parent.error;
        if(!parent.data)return json({error:"Message d’origine introuvable"},404);
      }
      const found=await client.from("rental_mail_outbox").select("id,status,recipient_email,subject,plain_body")
          .eq("client_key",key).eq("account_email",mailAddress).maybeSingle();
      if(found.error)throw found.error;
      if(found.data){
        if(found.data.recipient_email!==to||found.data.subject!==subject||found.data.plain_body!==plain)
            return json({error:"Cette clé de brouillon correspond à un autre message"},409);
        return json({ok:true,id:found.data.id,status:found.data.status,duplicate:true});
      }
      const created=await client.from("rental_mail_outbox").insert({
        account_email:mailAddress,client_key:key,recipient_email:to,subject,plain_body:plain,in_reply_to_message_id:reply,status:"draft",created_by:account.username
      }).select("id,status").single();
      if(created.error){
        if(created.error.code==="23505")return json({error:"Brouillon déjà enregistré : rechargez la messagerie"},409);
        throw created.error;
      }
      await audit(client,account.username,"rental-mail-draft-created","rental_mail_outbox",created.data.id,{recipient:to});
      return json({ok:true,...created.data,duplicate:false});
    }

    if (action==="mail-cancel-draft"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      const body=await req.json(),id=String(body?.id||"");
      if(!apiUuid(id))return json({error:"Identifiant invalide"},400);
      const q=await client.from("rental_mail_outbox").update({status:"cancelled"})
         .eq("id",id).eq("account_email",await configuredFreeAccount(client)).eq("status","draft").select("id").maybeSingle();
      if(q.error)throw q.error;
      if(!q.data)return json({error:"Seuls les brouillons non envoyés peuvent être annulés."},409);
      await audit(client,account.username,"rental-mail-draft-cancelled","rental_mail_outbox",id,{});
      return json({ok:true});
    }

    if (action==="mail-send"&&req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Accès à la messagerie interdit"},403);
      if(!await freePasswordConfigured(client,await configuredFreeAccount(client)))return json({error:"Messagerie Free non connectée. Aucun envoi effectué."},409);
      const body=await req.json(),id=String(body?.id||"");
      if(!apiUuid(id)||body?.confirmed!==true)return json({error:"Validation explicite de l’envoi obligatoire"},400);
      const since=new Date(Date.now()-86400000).toISOString();
      const sentCount=await client.from("rental_mail_outbox").select("id",{count:"exact",head:true}).eq("account_email",await configuredFreeAccount(client)).eq("status","sent").gte("sent_at",since);
      if(sentCount.error)throw sentCount.error;
      if(Number(sentCount.count||0)>=25)return json({error:"Limite de sécurité de 25 courriels par 24 heures atteinte."},429);
      const claimed=await client.from("rental_mail_outbox").update({
         status:"sending",approved_by:account.username,approved_at:new Date().toISOString()
      }).eq("id",id).eq("account_email",await configuredFreeAccount(client)).eq("status","draft").select("id,recipient_email,subject").maybeSingle();
      if(claimed.error)throw claimed.error;
      if(!claimed.data)return json({error:"Ce brouillon n’est plus disponible pour l’envoi. Aucun nouvel envoi lancé."},409);
      await audit(client,account.username,"rental-mail-approved","rental_mail_outbox",id,{recipient:claimed.data.recipient_email});
      try{
        const result=await callMailTransport({action:"send",id});
        const updated=await client.from("rental_mail_outbox").update({
          status:"sent",sent_at:new Date().toISOString(),provider_message_id:result.provider_message_id||null,last_error:null
        }).eq("id",id).eq("status","sending").select("id,status").maybeSingle();
        if(updated.error)throw updated.error;
        await audit(client,account.username,"rental-mail-sent","rental_mail_outbox",id,{});
        return json({ok:true,sent:true,id});
      }catch{
        await client.from("rental_mail_outbox").update({
          status:"uncertain",last_error:"Résultat SMTP incertain. Vérifier directement la boîte Free avant toute nouvelle tentative."
        }).eq("id",id).eq("status","sending");
        await audit(client,account.username,"rental-mail-send-uncertain","rental_mail_outbox",id,{});
        return json({error:"Envoi non confirmé. Vérifiez la boîte Free : ne renvoyez pas ce message sans contrôle."},502);
      }
    }


    if (action==="save-site-config" && req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Configuration réservée à l’administration Marne Invest"},403);
      const body=await req.json().catch(()=>null);
      const input=body?.settings;
      if(!input||typeof input!=="object"||Array.isArray(input))return json({error:"Paramètres invalides"},400);
      const required=["landlord_name","landlord_address","owner_email","sender_email"];
      const allowed=[...required,"bank_account_label"];
      if(Object.keys(input).some(k=>!allowed.includes(k))||required.some(k=>typeof input[k]!=="string")||
         (input.bank_account_label!==undefined&&typeof input.bank_account_label!=="string"))
        return json({error:"Champs non autorisés ou incomplets"},400);
      const cleaned=Object.fromEntries(allowed.filter(k=>typeof input[k]==="string").map(k=>[k,String(input[k]).trim()]));
      if(cleaned.bank_account_label!==undefined&&cleaned.bank_account_label.length>80)
        return json({error:"Libellé du compte bancaire trop long"},400);
      if(cleaned.landlord_name.length>200||cleaned.landlord_address.length>500)
        return json({error:"Nom du bailleur ou adresse trop long"},400);
      if(cleaned.owner_email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.owner_email)||cleaned.owner_email.length>254))
        return json({error:"Adresse du propriétaire invalide"},400);
      if(cleaned.sender_email&&(!/^[^\s@]+@free\.fr$/i.test(cleaned.sender_email)||cleaned.sender_email.length>254))
        return json({error:"Le compte IMAP/SMTP Free doit être une adresse @free.fr valide"},400);
      cleaned.sender_email=cleaned.sender_email.toLowerCase();
      if(!cleaned.sender_email){
        const previous=await configuredFreeAccount(client,true);
        if(previous){
          const [configured,state]=await Promise.all([
            freePasswordConfigured(client,previous,true),
            client.from("rental_mail_sync_state").select("imap_verified_at,smtp_verified_at").eq("account_email",previous).maybeSingle()
          ]);
          if(state.error)throw new MailConfigurationError("L’état de la boîte Free ne peut pas être vérifié. Conservez l’adresse et réessayez.",503);
          if(configured||state.data?.imap_verified_at||state.data?.smtp_verified_at)
            return json({error:"Cette boîte Free possède des identifiants ou une connexion vérifiée. Conservez son adresse ; elle ne peut pas être effacée implicitement."},409);
        }
      }
      const definition=[
        ["landlord_name","Nom du bailleur / mandataire",91,"Coordonnées par défaut pour les nouveaux baux et documents."],
        ["landlord_address","Adresse du bailleur / mandataire",92,"Adresse de référence pour les nouveaux baux et quittances."],
        ["owner_email","Mail propriétaire",2,"Courriel de contact du propriétaire, sans envoi automatique."],
        ["sender_email","Adresse e-mail expéditeur",95,"Compte utilisé pour l’authentification IMAP et SMTP Free."],
        ["bank_account_label","Libellé du compte bancaire",97,"Nom du compte à utiliser pour le rapprochement des relevés CSV."]
      ];
      const updated=await client.from("rental_settings").upsert(definition.filter(([k])=>k in cleaned).map(([k,label,order,comment])=>({
         setting_key:k,label,value:cleaned[k],sort_order:order,comment,updated_at:new Date().toISOString()
      })),{onConflict:"setting_key"}).select("setting_key");
      if(updated.error)throw updated.error;
      await audit(client,account.username,"rental-central-config-saved","rental_settings","central",{fields:Object.keys(cleaned)});
      return json({ok:true,updated_fields:Object.keys(cleaned)});
    }

    if (action==="mail-configure" && req.method==="POST") {
      if(!mailAllowed(account))return json({error:"Seul l’administrateur peut configurer la boîte Free"},403);
      const body=await req.json().catch(()=>null);
      const password=body?.password;
      if(typeof password!=="string"||password.length<6||password.length>256)
        return json({error:"Mot de passe Free invalide"},400);
      const mailAddress=await configuredFreeAccount(client);
      const result=await client.rpc("marne_mail_password_set",{p_password:password,p_account:mailAddress});
      if(result.error){console.error("Vault password update error",result.error.code);return json({error:"Stockage sécurisé indisponible. Aucun identifiant n’a été publié."},503);}
      const invalidation=await client.from("rental_mail_sync_state").upsert({
        account_email:mailAddress,imap_verified_at:null,smtp_verified_at:null,
        last_error_code:null,last_error_at:null,updated_at:new Date().toISOString()
      },{onConflict:"account_email"});
      if(invalidation.error)throw invalidation.error;
      await audit(client,account.username,"rental-mail-credential-updated","vault_secret","marne_free_mail_password_v1",{stored:true});
      return json({ok:true,stored:true,connection_test_required:true});
    }

    if (action === "save-setting" && req.method === "POST") {
      if(!mailAllowed(account))return json({error:"Configuration réservée à l’administration Marne Invest"},403);
      return json({error:"Les paramètres historiques sont en lecture seule. Utilisez Paramètres → Configuration centralisée."},409);
    }

    if (action === "update-system" && req.method === "POST") {
      return json({error:"Recalcul IRL désactivé : l’ancien algorithme utilise un indice de base fixe et ne contrôle pas les clauses des baux."},409);
    }

    return json({ error:"Action inconnue" },404);
  } catch (error) {
    console.error(error);
    if(error instanceof IncompleteDataError)return json({error:error.message},503);
    if(error instanceof MailConfigurationError)return json({error:error.message},error.status);
    return json({ error:error instanceof Error ? error.message : "Erreur serveur" },500);
  }
});

