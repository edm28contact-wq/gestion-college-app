import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import * as XLSX from "npm:xlsx@0.18.5";
import postgres from "npm:postgres@3.4.7";

const VERSION=16, TEMPLATE_KEY="chambertin-salaires";
const MODELS=["gemini-3.5-flash-lite","gemini-3.6-flash","gemini-3.5-flash","gemini-3.1-flash-lite","gemini-3.7-flash","gemini-3.8-flash"];
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, authorization","Access-Control-Allow-Methods":"POST, OPTIONS"};
const enc=new TextEncoder();
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
function db(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw new Error("Configuration serveur indisponible");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
let pg:any=null;function vaultDb(){if(!pg){const u=Deno.env.get("SUPABASE_DB_URL");if(!u)throw new Error("Connexion Vault indisponible");pg=postgres(u,{max:1,prepare:false,idle_timeout:5,connect_timeout:10})}return pg}
function b64u(b:Uint8Array){let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function from64u(s:string){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4),r=atob(p);return Uint8Array.from(r,c=>c.charCodeAt(0))}
async function hmac(k:string,d:string){const key=await crypto.subtle.importKey("raw",enc.encode(k),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(d)))}
async function verify(c:any,req:Request){const h=req.headers.get("authorization")||"",tok=h.startsWith("Bearer ")?h.slice(7):"",[body,sig]=tok.split(".");if(!body||!sig)return null;const st=await c.from("system_settings").select("admin_token").eq("id",1).single();if(st.error||!st.data?.admin_token)return null;const sec=String(st.data.admin_token),a=b64u(await hmac(sec+":accounting",body)),z=b64u(await hmac(sec,body));if(sig!==a&&sig!==z)return null;let p:any;try{p=JSON.parse(new TextDecoder().decode(from64u(body)))}catch{return null}if(!p?.u||Date.now()>Number(p?.exp||0))return null;const q=await c.from("admin_accounts").select("username,active,session_version,role,must_change_password,permissions").eq("username",p.u).maybeSingle();const d=q.data,perms=d?.permissions||{};if(!d?.active||d.must_change_password||Number(d.session_version)!==Number(p.v))return null;const write=perms.readonly!==true&&(perms.accounting===true||perms["accounting.write"]===true),ok=(sig===a&&p?.r==="comptabilite"&&d.role==="comptabilite"&&write)||(sig===z&&(d.role==="admin"||write));return ok?{username:String(d.username)}:null}
async function audit(c:any,u:string,a:string,id:string,d:any){const q=await c.from("admin_audit_log").insert({username:u,action:a,entity_type:"accounting_od_import",entity_id:id,details:d});if(q.error)throw q.error}
function norm(v:any){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9/]+/g," ").trim()}
function amount(v:any){if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/[\s\u00a0€]/g,"").replace(",",".").replace(/[^0-9+\-.]/g,""));return Number.isFinite(n)?Math.round(n*100)/100:null}
function dateIso(v:any){const s=String(v??"").trim();let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(m)return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);if(m){let y=Number(m[3]);if(m[3].length===2)y+=y>=70?1900:2000;return String(y)+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0")}return ""}
async function sha256(b:Uint8Array){const h=await crypto.subtle.digest("SHA-256",b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function findHeader(m:any[][]){for(let r=0;r<Math.min(m.length,60);r++){const a=(m[r]||[]).map(norm);if(a.includes("date")&&a.includes("journal")&&a.includes("compte")&&a.includes("montant")&&(a.includes("d/c")||a.includes("dc")||a.includes("d c")))return r}return -1}
function ci(h:any[],xs:string[]){const n=h.map(norm);for(const x of xs){const i=n.indexOf(x);if(i>=0)return i}return -1}
function parseTemplate(bytes:Uint8Array,sheet:string){const wb=XLSX.read(bytes,{type:"array",cellDates:true,cellFormula:true,cellText:false}),ws=wb.Sheets[sheet];if(!ws)throw new Error("Feuille Chambertin introuvable");const m=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:""}) as any[][],hr=findHeader(m);if(hr<0)throw new Error("En-tête OD introuvable dans Chambertin");const h=m[hr]||[],accountCol=ci(h,["compte"]),labelCol=ci(h,["libelle compte","libel compte"]),sideCol=ci(h,["d/c","dc","d c"]);let entryCol=ci(h,["libelecriture","libel ecriture","libelle ecriture"]);if(entryCol<0)entryCol=Math.max(labelCol+2,5);const lines:any[]=[];for(let i=hr+1;i<m.length;i++){const a=m[i]||[],account=String(a[accountCol]??"").replace(/\.0+$/,"").trim(),side=String(a[sideCol]??"").trim().toUpperCase();if(!/^\d{8}$/.test(account)||!["D","C"].includes(side))continue;lines.push({line_no:lines.length+1,source_row:i+1,account,account_label:String(a[labelCol]??"").trim(),entry_label:String(a[entryCol]??"").trim(),side})}if(!lines.length)throw new Error("Aucune ligne comptable exploitable dans Chambertin");return lines}
async function activeTemplate(c:any){const q=await c.from("accounting_od_templates").select("id,version,name,source_name,source_sheet,template_hash").eq("template_key",TEMPLATE_KEY).eq("active",true).order("version",{ascending:false}).limit(1).maybeSingle();if(q.error)throw q.error;if(!q.data)return null;const l=await c.from("accounting_od_template_lines").select("line_no,source_row,account,account_label,entry_label,side").eq("template_id",q.data.id).order("line_no");if(l.error)throw l.error;return {...q.data,lines:l.data||[]}}
async function learn(c:any,u:string,file:File,bytes:Uint8Array,sheet:string){const lines=parseTemplate(bytes,sheet),canon=lines.map(x=>[x.line_no,x.account,x.account_label,x.entry_label,x.side].join("|")).join("\n"),hash=await sha256(enc.encode(canon));const old=await c.from("accounting_od_templates").select("id,version,active").eq("template_key",TEMPLATE_KEY).eq("template_hash",hash).maybeSingle();if(old.error)throw old.error;if(old.data){await c.from("accounting_od_templates").update({active:false}).eq("template_key",TEMPLATE_KEY);await c.from("accounting_od_templates").update({active:true}).eq("id",old.data.id);return {id:old.data.id,version:old.data.version,line_count:lines.length,reused:true}}const vq=await c.from("accounting_od_templates").select("version").eq("template_key",TEMPLATE_KEY).order("version",{ascending:false}).limit(1);if(vq.error)throw vq.error;const version=Number(vq.data?.[0]?.version||0)+1,id=crypto.randomUUID();await c.from("accounting_od_templates").update({active:false}).eq("template_key",TEMPLATE_KEY);const ins=await c.from("accounting_od_templates").insert({id,template_key:TEMPLATE_KEY,version,name:"Chambertin salaires",source_name:file.name,source_sheet:sheet,template_hash:hash,active:true,created_by:u});if(ins.error)throw ins.error;const li=await c.from("accounting_od_template_lines").insert(lines.map(x=>({template_id:id,...x})));if(li.error){await c.from("accounting_od_templates").delete().eq("id",id);throw li.error}return {id,version,line_count:lines.length,reused:false}}
async function keys(){const out:any[]=[];try{const rows=await vaultDb().unsafe("select name,decrypted_secret from vault.decrypted_secrets where name='accounting_gemini_api_key' or name like 'accounting_gemini_api_key_%' order by case when name='accounting_gemini_api_key' then 0 else 1 end, name");for(const r of rows||[]){const k=String(r?.decrypted_secret||"").trim();if(k&&!out.some(x=>x.key===k))out.push({key:k})}}catch{}const e=String(Deno.env.get("GEMINI_API_KEY")||"").trim();if(e&&!out.some(x=>x.key===e))out.push({key:e});return out}
function outText(r:any){if(typeof r?.output_text==="string"&&r.output_text.trim())return r.output_text.trim();for(const s of [...(r?.steps||[])].reverse())for(const c of s?.content||[])if(typeof c?.text==="string"&&c.text.trim())return c.text.trim();return ""}
function templatePlan(t:any){
  const groups=new Map<string,any[]>(),taxLines=new Set<number>();
  for(const x of t.lines){
    const k=norm(x.account_label);
    if(k==="taxe sur les salaires"){taxLines.add(Number(x.line_no));continue}
    if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(x)
  }
  const mirrorOf=new Map<number,number>(),inputLines:any[]=[];
  for(const x of t.lines){
    if(taxLines.has(Number(x.line_no)))continue;
    const g=groups.get(norm(x.account_label))||[],first=g[0];
    const opposite=g.some((y:any)=>String(y.side)!==String(first?.side));
    if(opposite&&first&&Number(x.line_no)!==Number(first.line_no))mirrorOf.set(Number(x.line_no),Number(first.line_no));
    else inputLines.push(x);
  }
  return {inputLines,mirrorOf,taxLines}
}
function salaryTaxFromEmployees(employees:any[]){
  let total=0;
  for(const e of employees||[]){
    const g=Math.max(0,Number(e.gross||0));if(!Number.isFinite(g)||g<=0)continue;
    const normal=g*0.0425;
    const first=g<=762?0:(g>=1522?(1522-762)*0.0425:(1522-g)*0.0425);
    const second=g>1522?(g-1522)*0.0935:0;
    total+=normal+first+second;
  }
  return Math.round(total)
}
function schemaForRead(){
  return {type:"object",properties:{
    period_date:{type:"string"},
    lines:{type:"array",items:{type:"object",properties:{
      line_no:{type:"integer"},amount:{type:"number"},confidence:{type:"number"},evidence:{type:"string"}
    },required:["line_no","amount","confidence","evidence"]}},
    employer_contributions:{type:"number"},
    employee_contributions:{type:"number"},
    employees:{type:"array",items:{type:"object",properties:{name:{type:"string"},gross:{type:"number"},evidence:{type:"string"}},required:["name","gross","evidence"]}},
    contributions_confidence:{type:"number"},
    notes:{type:"string"}
  },required:["period_date","lines","employer_contributions","employee_contributions","employees","contributions_confidence","notes"]}
}
async function readOnce(bytes:Uint8Array,t:any,n:number){
  const ks=await keys();if(!ks.length)throw new Error("Gemini non configuré");
  const plan=templatePlan(t);
  let bin="";for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const hint=(x:any)=>{const l=norm(x.account_label),a=String(x.account);if(l==="salaires")return "TOTAL REMUNERATION BRUTE; jamais cout employeur, net, net social ou assiette";if(l.includes("remunerations"))return "NET REELLEMENT PAYE APRES PRELEVEMENT A LA SOURCE; jamais net social, net imposable ou brut";if(l.includes("prelevement a la source"))return "montant PAS uniquement";if(l.includes("acompte"))return "acomptes retenus uniquement";if(l.includes("avantage en nature"))return "avantage en nature uniquement";if(a.startsWith("645")||a==="63330000")return "PART EMPLOYEUR de cette cotisation uniquement; jamais total employeur+salarie";return ""};const modelText=plan.inputLines.map((x:any)=>String(x.line_no)+" | "+x.side+" | "+x.account+" | "+x.account_label+(hint(x)?" | "+hint(x):"")).join("\\n");
  const prompt="Tu es l'Agent Comptabilité Collège. Tu n'effectues AUCUNE décision comptable. Le modèle Excel Chambertin est la règle comptable et tu dois seulement lire le PDF et saisir les valeurs dans les cellules d'entrée.\\n"+
    "Règles strictes :\\n"+
    "- retourne uniquement les line_no listés ci-dessous ; les lignes miroir/calculées sont volontairement absentes ;\\n"+
    "- amount = valeur EXACTE de la rubrique dans le document, au centime ; aucune addition entre rubriques, aucun regroupement par compte ;\\n"+
    "- une rubrique réellement absente vaut 0 ; ne déduis jamais une valeur pour équilibrer l'écriture ;\\n"+
    "- employer_contributions = total des cotisations PART EMPLOYEUR imprimé dans le document ;\\n"+
    "- employee_contributions = uniquement les COTISATIONS SOCIALES PART SALARIALE imprimées dans le document ;\\n"+
    "- exclure impérativement de employee_contributions : prélèvement à la source, acomptes, avantage en nature et toute autre retenue non sociale ;\\n"+    "- employees = liste de TOUS les salariés visibles avec leur BRUT MENSUEL individuel servant au calcul de la taxe sur les salaires ; ne jamais mettre le net, net social ou net imposable ;\\n"+

    "- period_date au format YYYY-MM-DD ;\\n"+
    "- c'est une lecture indépendante "+n+"/3.\\n"+
    "CELLULES D'ENTRÉE DU MODÈLE :\\n"+modelText+(arguments.length>3&&String(arguments[3]||"")?"\\n\\nCONTROLE CIBLE DEMANDE :\\n"+String(arguments[3]):"");
  const schema=schemaForRead(),input=[{type:"text",text:prompt},{type:"document",data:btoa(bin),mime_type:"application/pdf"}];
  const preferred=MODELS[Math.max(0,Math.min(2,n-1))],models=[preferred,...MODELS.filter(x=>x!==preferred)];
  const errs:any[]=[];
  for(const model of [...new Set(models)]){
    let keyAttempts=0;
    for(const k of ks){
      if(keyAttempts>=2)break;keyAttempts++;
      const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),35000);
      try{
        const r=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"x-goog-api-key":k.key,"Content-Type":"application/json"},body:JSON.stringify({model,input,response_format:{type:"text",mime_type:"application/json",schema}}),signal:ctrl.signal});
        const d=await r.json().catch(()=>({})),msg=String(d?.error?.message||d?.message||"erreur");
        if(!r.ok){errs.push({model,status:r.status,message:msg.slice(0,220)});if([429,500,502,503,504,400,404].includes(r.status))break;if([401,403].includes(r.status))continue;break}
        const text=outText(d);if(!text){errs.push({model,status:502,message:"Réponse Gemini vide"});break}
        let parsed:any;try{parsed=JSON.parse(text)}catch{errs.push({model,status:502,message:"Réponse Gemini non structurée"});break}
        parsed.__model=model;return parsed;
      }catch(e){
        const aborted=e instanceof DOMException&&e.name==="AbortError";
        errs.push({model,status:aborted?504:502,message:aborted?"Délai de lecture dépassé":(e instanceof Error?e.message:String(e)).slice(0,220)});break;
      }finally{clearTimeout(tm)}
    }
  }
  throw new Error("Lecture Gemini indisponible sur les modèles de secours : "+errs.slice(0,6).map(x=>x.model+" ("+x.status+") : "+x.message).join(" | "))
}
function normalizeRead(r:any,t:any){
  const plan=templatePlan(t),m=new Map<number,any>((Array.isArray(r?.lines)?r.lines:[]).map((x:any)=>[Number(x.line_no),x]));
  const employees=(Array.isArray(r?.employees)?r.employees:[]).map((e:any)=>({name:String(e?.name||"").trim(),gross:Math.max(0,amount(e?.gross)||0)})).filter((e:any)=>e.name&&e.gross>0);
  return {
    period_date:dateIso(r?.period_date),
    lines:t.lines.map((x:any)=>{
      const derived=plan.mirrorOf.has(Number(x.line_no))||plan.taxLines.has(Number(x.line_no)),present=m.has(Number(x.line_no)),y=m.get(Number(x.line_no))||{};
      return {amount:derived?0:(amount(y.amount)||0),confidence:derived?1:Math.max(0,Math.min(1,Number(y.confidence||0))),derived,present,evidence:String(y.evidence||"")}
    }),
    employer_contributions:amount(r?.employer_contributions)||0,
    employee_contributions:amount(r?.employee_contributions)||0,
    employees,
    salary_tax:salaryTaxFromEmployees(employees),
    contributions_confidence:Math.max(0,Math.min(1,Number(r?.contributions_confidence||0)))
  }
}
function voteExact(values:number[]){
  const vals=values.map(v=>Number(v||0).toFixed(2)),cnt=new Map<string,number>();
  for(const v of vals)cnt.set(v,(cnt.get(v)||0)+1);
  const best=[...cnt].sort((a,b)=>b[1]-a[1])[0];
  return {value:best&&best[1]>=2?Number(best[0]):null,values:vals}
}
function consensus(rs:any[],t:any){
  const plan=templatePlan(t),amounts:any[]=t.lines.map(()=>0),bad:any[]=[];
  for(let i=0;i<t.lines.length;i++){
    const x=t.lines[i];if(plan.mirrorOf.has(Number(x.line_no))||plan.taxLines.has(Number(x.line_no)))continue;
    const v=voteExact(rs.map(r=>Number(r.lines[i]?.amount||0)));
    if(v.value===null)bad.push({line_no:x.line_no,account:x.account,account_label:x.account_label,entry_label:x.entry_label,side:x.side,values:v.values});
    else amounts[i]=v.value
  }
  const emp=voteExact(rs.map(r=>Number(r.employer_contributions||0))),sal=voteExact(rs.map(r=>Number(r.employee_contributions||0))),tax=voteExact(rs.map(r=>Number(r.salary_tax||0)));
  if(emp.value===null)bad.push({line_no:0,account:"CONTROLE",account_label:"Part employeur",entry_label:"Contrôle URSSAF",side:"",values:emp.values});
  if(sal.value===null)bad.push({line_no:0,account:"CONTROLE",account_label:"Part salariale",entry_label:"Contrôle URSSAF",side:"",values:sal.values});
  if(plan.taxLines.size&&tax.value===null)bad.push({line_no:0,account:"CONTROLE",account_label:"Taxe sur les salaires",entry_label:"Calcul Taxe Salaires",side:"",values:tax.values});
  for(let i=0;i<t.lines.length;i++){
    const x=t.lines[i],l=norm(x.account_label);
    if(plan.mirrorOf.has(Number(x.line_no))||plan.taxLines.has(Number(x.line_no)))continue;
    if(l==="salaires"||l.includes("remunerations")){
      const vals=rs.map(r=>Number(r.lines[i]?.amount||0).toFixed(2)),presentCount=rs.filter(r=>r.lines[i]?.present).length;
      if(Number(amounts[i]||0)<=0&&!bad.some(b=>Number(b.line_no)===Number(x.line_no)))bad.push({line_no:x.line_no,account:x.account,account_label:x.account_label,entry_label:x.entry_label,side:x.side,values:vals,reason:"rubrique obligatoire absente ou nulle"});
      else if(presentCount<2&&!bad.some(b=>Number(b.line_no)===Number(x.line_no)))bad.push({line_no:x.line_no,account:x.account,account_label:x.account_label,entry_label:x.entry_label,side:x.side,values:vals,reason:"rubrique obligatoire non retournée par deux lectures"});
    }
  }
  const dates=rs.map(r=>r.period_date).filter(Boolean),dc=new Map<string,number>();for(const d of dates)dc.set(d,(dc.get(d)||0)+1);const bd=[...dc].sort((a,b)=>b[1]-a[1])[0];
  return {amounts,bad,date:bd&&bd[1]>=2?bd[0]:"",employer_contributions:emp.value,employee_contributions:sal.value,salary_tax:tax.value||0}
}
function monthShortFr(date:string){const m=Number(String(date).slice(5,7));return ["","janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"][m]||""}
function entryLabel(date:string,label:string){const yy=String(date).slice(2,4);return "OD Salaires "+monthShortFr(date)+"-"+yy+": "+String(label||"")}
function sheetRowsFrom(t:any,c:any){
  if(!c.date)throw new Error("Date de paie non confirmée");
  const plan=templatePlan(t),byLine=new Map<number,number>();
  for(let i=0;i<t.lines.length;i++)if(!plan.mirrorOf.has(Number(t.lines[i].line_no))&&!plan.taxLines.has(Number(t.lines[i].line_no)))byLine.set(Number(t.lines[i].line_no),Number(c.amounts[i]||0));
  return t.lines.map((x:any)=>{
    const n=Number(x.line_no),source=plan.mirrorOf.get(n),isTax=plan.taxLines.has(n),v0=isTax?Number(c.salary_tax||0):(source?Number(byLine.get(source)||0):Number(byLine.get(n)||0));
    return {
      line_no:n,source_row:x.source_row,entry_date:c.date,date_compact:String(c.date).replace(/-/g,""),journal:"OD",
      account:String(x.account).padStart(8,"0"),account_label:String(x.account_label||""),entry_label:entryLabel(c.date,String(x.account_label||"")),
      amount:Math.round(Math.abs(v0)*100)/100,side:v0<0?flip(String(x.side)):String(x.side),
      derived:plan.mirrorOf.has(n)||isTax
    }
  })
}
function flip(side:string){return side==="D"?"C":"D"}
function aggregateRows(rows:any[]){
  const out:any[]=[],map=new Map<string,any>();
  for(const r of rows){
    const key=String(r.account)+"|"+String(r.side),cur=map.get(key);
    if(cur)cur.amount=Math.round((cur.amount+r.amount)*100)/100;
    else{const z={...r};map.set(key,z);out.push(z)}
  }
  return out
}
function rowsFrom(t:any,c:any){
  if(!c.date)throw new Error("Date de paie non confirmée par deux lectures");
  if(c.bad.length)throw new Error("Montants non confirmés pour "+c.bad.length+" rubrique(s)");
  const plan=templatePlan(t),byLine=new Map<number,number>();
  for(let i=0;i<t.lines.length;i++)if(!plan.mirrorOf.has(Number(t.lines[i].line_no))&&!plan.taxLines.has(Number(t.lines[i].line_no)))byLine.set(Number(t.lines[i].line_no),Number(c.amounts[i]||0));
  const raw:any[]=[];
  for(const x of t.lines){
    const n=Number(x.line_no),source=plan.mirrorOf.get(n),v0=plan.taxLines.has(n)?Number(c.salary_tax||0):(source?Number(byLine.get(source)||0):Number(byLine.get(n)||0));
    if(!v0)continue;
    const side=v0<0?flip(String(x.side)):String(x.side),v=Math.abs(v0);
    raw.push({source_row:x.source_row,entry_date:c.date,account:String(x.account).padStart(8,"0"),account_label:x.account_label,entry_label:entryLabel(c.date,String(x.account_label||"")),amount:Math.round(v*100)/100,side})
  }
  let rows=raw.slice();if(!rows.length)throw new Error("Aucune écriture exploitable détectée");
  const debit=Math.round(rows.filter(x=>x.side==="D").reduce((s,x)=>s+x.amount,0)*100)/100;
  const credit=Math.round(rows.filter(x=>x.side==="C").reduce((s,x)=>s+x.amount,0)*100)/100;
  const urssaf=Math.round((debit-credit)*100)/100;
  if(urssaf<0)throw new Error("Le modèle produit plus de crédits que de débits avant la contrepartie URSSAF : "+urssaf.toFixed(2)+" €");
  const employer=Number(c.employer_contributions||0),employeeRead=Number(c.employee_contributions||0);
  const deductionRows=raw.filter(x=>{
    if(x.side!=="C")return false;
    const l=norm(x.account_label);
    return l.includes("prelevement a la source")||l.includes("acompte")||l.includes("avantage en nature")||l.includes("retenue")||l.includes("retenus");
  }).map(x=>({label:String(x.account_label||""),account:String(x.account||""),amount:Math.round(Number(x.amount||0)*100)/100}));
  let employee=employeeRead,parts=Math.round((employer+employee)*100)/100;
  const reconciliation:any[]=[];
  if(urssaf>0){
    if(parts===0)throw new Error("Contrôle URSSAF impossible : part employeur et part salariale non lues dans le PDF");
    const excess=Math.round((parts-urssaf)*100)/100;
    if(excess>0){
      const target=Math.round(excess*100),cand=deductionRows.filter(x=>x.amount>0),solutions:any[][]=[];
      const maxMask=1<<cand.length;
      for(let mask=1;mask<maxMask;mask++){
        let sum=0;const chosen:any[]=[];
        for(let i=0;i<cand.length;i++)if(mask&(1<<i)){sum+=Math.round(cand[i].amount*100);chosen.push(cand[i])}
        if(sum===target)solutions.push(chosen);
      }
      if(solutions.length===1){
        reconciliation.push(...solutions[0]);
        const correction=Math.round(reconciliation.reduce((s,x)=>s+x.amount,0)*100)/100;
        employee=Math.round((employeeRead-correction)*100)/100;
        parts=Math.round((employer+employee)*100)/100;
      }else if(solutions.length>1){
        throw new Error("Contrôle URSSAF ambigu : plusieurs combinaisons de retenues déjà comptabilisées expliquent exactement l'écart de "+excess.toFixed(2)+" €. Validation humaine requise.");
      }
    }
    if(parts!==urssaf){
      const rawTotal=Math.round((employer+employeeRead)*100)/100;
      const listed=deductionRows.length?deductionRows.map(x=>x.label+" "+x.amount.toFixed(2)+" €").join(", "):"aucune";
      throw new Error("Contrôle URSSAF refusé : part employeur "+employer.toFixed(2)+" € + part salariale lue "+employeeRead.toFixed(2)+" € = "+rawTotal.toFixed(2)+" €. Le modèle attend "+urssaf.toFixed(2)+" €. Retenues déjà comptabilisées détectées : "+listed+".");
    }
    rows.push({source_row:null,entry_date:c.date,account:"43100000",account_label:"TESE",entry_label:entryLabel(c.date,"TESE"),amount:urssaf,side:"C"})
  }
  return {rows,control:{employer_contributions:employer,employee_contributions_read:employeeRead,employee_contributions:employee,urssaf_balance:urssaf,salary_tax:Number(c.salary_tax||0),reconciled_deductions:reconciliation,raw_contribution_total:Math.round((employer+employeeRead)*100)/100,adjusted_contribution_total:parts}}
}
function validate(rows:any[]){
  const d=Math.round(rows.filter(x=>x.side==="D").reduce((s,x)=>s+x.amount,0)*100)/100,c=Math.round(rows.filter(x=>x.side==="C").reduce((s,x)=>s+x.amount,0)*100)/100,diff=Math.round((d-c)*100)/100;
  if(diff!==0)throw new Error("Écriture déséquilibrée : débit "+d.toFixed(2)+" € / crédit "+c.toFixed(2)+" € / écart "+diff.toFixed(2)+" €");
  return {debit:d,credit:c,difference:diff}
}
async function analyze(bytes:Uint8Array,t:any){
  const a=normalizeRead(await readOnce(bytes,t,1),t),b=normalizeRead(await readOnce(bytes,t,2),t);let rs=[a,b],co=consensus(rs,t);
  if(co.bad.length||!co.date){const z=normalizeRead(await readOnce(bytes,t,3),t);rs=[a,b,z];co=consensus(rs,t)}
  const built=rowsFrom(t,co),v=validate(built.rows);return {rows:built.rows,control:built.control,validation:v,reads:rs.length,date:co.date}
}
const header=["Date","Journal","Compte","Libel Compte","","LibelEcriture","Montant","D/C","",""].join("\t");
function cp1252(s:string){const e:Record<number,number>={0x20ac:0x80,0x2013:0x96,0x2014:0x97,0x0152:0x8c,0x0153:0x9c,0x0178:0x9f};const o:number[]=[];for(const ch of s){const c=ch.codePointAt(0)!;o.push(c<=255?c:(e[c]??63))}return new Uint8Array(o)}
function txt(rows:any[],journal:string){return header+"\r\n"+rows.map(r=>[r.entry_date.replace(/-/g,""),journal,r.account,r.account_label,"",r.entry_label,r.amount.toFixed(2).replace(".",","),r.side,"",""].join("\t")).join("\r\n")+"\r\n"}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});try{const c=db(),u=await verify(c,req);if(!u)return json({error:"Session expirée ou accès Comptabilité non autorisé"},401);if(req.method!=="POST")return json({error:"Méthode non autorisée"},405);const url=new URL(req.url),mode=url.searchParams.get("mode")||"inspect",f=await req.formData(),file=f.get("file");if(!(file instanceof File))return json({error:"Fichier requis"},400);if(file.size>20*1024*1024)return json({error:"Fichier supérieur à 20 Mo"},413);const bytes=new Uint8Array(await file.arrayBuffer());
if(mode==="learn-template"){if(!/\.(xlsx|xlsm)$/i.test(file.name))return json({error:"Classeur Excel requis"},400);const wb=XLSX.read(bytes,{type:"array"}),sheet=String(f.get("sheet_name")||wb.SheetNames.find(n=>/chambertin/i.test(n))||"");if(!sheet)return json({error:"Feuille Chambertin introuvable"},400);const t=await learn(c,u.username,file,bytes,sheet);return json({ok:true,version:VERSION,template:t})}
if(!/\.pdf$/i.test(file.name))return json({error:"PDF requis pour l'Agent Comptable"},400);const t=await activeTemplate(c);if(!t)return json({error:"Aucun modèle Chambertin appris. Importez d'abord le classeur OD Injection salaires puis apprenez la feuille Chambertin."},409);
if(mode==="read"){
  const readNo=Math.max(1,Math.min(3,Number(f.get("read_no")||1)));
  try{
    const focus=String(f.get("focus")||"");const raw=await readOnce(bytes,t,readNo,focus),read=normalizeRead(raw,t);
    return json({ok:true,version:VERSION,template_version:t.version,read_no:readNo,model:String(raw.__model||MODELS[readNo-1]),read});
  }catch(e){
    return json({error:"Lecture PDF "+readNo+" impossible : "+(e instanceof Error?e.message:String(e)),version:VERSION,read_no:readNo},503);
  }
}
function submitted(name:string){const s=String(f.get(name)||"");if(!s)return null;try{return JSON.parse(s)}catch{throw new Error("Résultat de lecture "+name+" invalide")}}
const first=submitted("first"),second=submitted("second"),third=submitted("third");
if(mode==="compare"){
  if(!first||!second)return json({error:"Deux lectures Agent Comptable sont requises"},400);
  const rs=[first,second,...(third?[third]:[])],co=consensus(rs,t);
  if((co.bad.length||!co.date)&&!third)return json({ok:true,version:VERSION,template_version:t.version,requires_third_read:true,requires_third_retry:false,third_read_completed:false,disagreements:co.bad,date_confirmed:!!co.date});
  if(third&&(co.bad.length||!co.date))return json({ok:true,version:VERSION,template_version:t.version,requires_third_read:false,requires_third_retry:true,third_read_completed:true,reads:3,disagreements:co.bad,date_confirmed:!!co.date});
  try{
    const built=rowsFrom(t,co),rows=built.rows,v=validate(rows);
    return json({ok:true,version:VERSION,template_version:t.version,engine:"spreadsheet-deterministic",requires_third_read:false,reads:rs.length,candidates:[{sheet_name:"Chambertin (PDF)",line_count:rows.length,debit_total:v.debit,credit_total:v.credit,difference:v.difference,period_from:co.date,period_to:co.date,pdf_ready:true}],sheet_rows:sheetRowsFrom(t,co),control:built.control,consensus:{date:co.date,rows}});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(!third)return json({ok:true,version:VERSION,template_version:t.version,requires_third_read:true,requires_third_retry:false,third_read_completed:false,control_error:msg,focus_prompt:"Relecture de controle ciblee. Verifie prioritairement et independamment : 1) Salaires = TOTAL remuneration brute ; 2) Remunerations = NET reellement paye APRES PAS ; 3) part employeur totale ; 4) part salariale sociale hors PAS/acompte/avantage en nature ; 5) chaque rubrique 645/633 = part employeur de cette rubrique. Ne cherche jamais a equilibrer l OD et ne deduis aucune valeur du controle comptable.",sheet_rows:sheetRowsFrom(t,co)});
    if(third){
      const targeted={...co,employer_contributions:Number(third.employer_contributions||0),employee_contributions:Number(third.employee_contributions||0)};
      try{
        const built=rowsFrom(t,targeted),rows=built.rows,v=validate(rows);
        return json({ok:true,version:VERSION,template_version:t.version,engine:"spreadsheet-deterministic",requires_third_read:false,reads:rs.length,control_override:"targeted-third-read",candidates:[{sheet_name:"Chambertin (PDF)",line_count:rows.length,debit_total:v.debit,credit_total:v.credit,difference:v.difference,period_from:targeted.date,period_to:targeted.date,pdf_ready:true}],sheet_rows:sheetRowsFrom(t,targeted),control:{...built.control,targeted_read_used:true,targeted_employer:Number(third.employer_contributions||0),targeted_employee:Number(third.employee_contributions||0)},consensus:{date:targeted.date,rows}});
      }catch(e2){}
    }
    return json({error:msg,version:VERSION},422)
  }
}
if(mode!=="generate")return json({error:"Mode inconnu"},400);
if(!first||!second)return json({error:"Deux lectures Agent Comptable sont requises avant génération"},400);
const rs=[first,second,...(third?[third]:[])],co=consensus(rs,t);let a:any;
try{const built=rowsFrom(t,co),validation=validate(built.rows);a={rows:built.rows,control:built.control,validation,reads:rs.length,date:co.date}}catch(e){return json({error:e instanceof Error?e.message:String(e),version:VERSION},422)}
const journal=String(f.get("target_journal")||"OD").toUpperCase();if(!["AC","OD"].includes(journal))return json({error:"Journal cible invalide"},400);const hash=await sha256(bytes),dup=await c.from("accounting_od_imports").select("id,file_name,created_at").eq("source_hash",hash).eq("target_journal",journal).eq("sheet_name","Chambertin (PDF)").is("cancelled_at",null).maybeSingle();if(dup.error)throw dup.error;if(dup.data)return json({error:"Ce PDF a déjà été importé vers le journal "+journal,duplicate_id:dup.data.id},409);const month=a.date.slice(0,7)+"-01",closed=await c.from("accounting_period_closures").select("period_month").eq("active",true).eq("period_month",month);if(closed.error)throw closed.error;if(closed.data?.length)return json({error:"Import impossible : période comptable clôturée"},409);const bytesOut=cp1252(txt(a.rows,journal)),outHash=await sha256(bytesOut),id=crypto.randomUUID(),sourceBase=String(file.name||"PDF").replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim()||"PDF",fileName=`${a.date.slice(0,7)} OD Salaires - ${sourceBase}.txt`,path=`od/${a.date.slice(0,4)}/${id}-${fileName}`;const up=await c.storage.from("accounting-exports").upload(path,bytesOut,{contentType:"text/plain",upsert:false});if(up.error)throw up.error;const ins=await c.from("accounting_od_imports").insert({id,source_name:file.name,source_type:"pdf",sheet_name:"Chambertin (PDF)",target_journal:journal,source_hash:hash,status:"generated",period_from:a.date,period_to:a.date,line_count:a.rows.length,debit_total:a.validation.debit,credit_total:a.validation.credit,difference:0,file_name:fileName,storage_path:path,file_hash:outHash,source_details:{template_version:t.version,gemini_reads:a.reads,pdf_to_chambertin:true,engine:"spreadsheet-deterministic",control:a.control,encoding:"Windows-1252",line_ending:"CRLF"},created_by:u.username}).select().single();if(ins.error){await c.storage.from("accounting-exports").remove([path]);throw ins.error}const li=await c.from("accounting_od_lines").insert(a.rows.map((r:any,i:number)=>({od_import_id:id,line_no:i+1,source_row:r.source_row,entry_date:r.entry_date,journal,account:r.account,account_label:r.account_label,entry_label:r.entry_label,amount:r.amount,side:r.side})));if(li.error){await c.from("accounting_od_imports").delete().eq("id",id);await c.storage.from("accounting-exports").remove([path]);throw li.error}await audit(c,u.username,"accounting-payroll-pdf-generate",id,{journal,template_version:t.version,gemini_reads:a.reads,line_count:a.rows.length,debit_total:a.validation.debit});return new Response(bytesOut,{headers:{...cors,"Content-Type":"text/plain; charset=windows-1252","Content-Disposition":'attachment; filename="'+fileName+'"',"Cache-Control":"no-store","X-Line-Count":String(a.rows.length),"X-Version":String(VERSION)}})
}catch(e){console.error(e);return json({error:e instanceof Error?e.message:"Erreur Agent Comptable paie",version:VERSION},500)}});