(()=>{
"use strict";
const $=id=>document.getElementById(id);
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-classification-catalog";
let catalog=null,rows=[],excluded=[],allRaw=[],lastSource="",catalogTimestamp="";const CORE=window.InvoiceClassify;
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const num=s=>{if(s===null||s===undefined||String(s).trim()==="")return null;const n=Number(String(s).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null};
function note(s){$("status").textContent=s}
function match(line){
 const tokens=norm(line).split(" "),hits=(catalog?.products||[]).filter(p=>tokens.includes(norm(p.code))&&norm(p.code).length>=3);
 return hits.length===1?hits[0]:null;
}
function account(line){
 const keywords=(catalog?.keywords||[]).filter(k=>k.keyword&&norm(line).includes(norm(k.keyword))&&(!k.supplier_key||norm(k.supplier_key)===norm($("supplier").value)));
 const matches=[...new Set(keywords.map(x=>x.expense_account))];return matches.length===1?matches[0]:"";
}
function classify(){
 if(!catalog)return note("Aucune fiche catalogue. Connectez Supabase ou importez votre fiche JSON.");
 const result=CORE.classify(allRaw.length?allRaw:rows,catalog,$("supplier").value);
 rows=result.matched;excluded=result.excluded;render();renderExcluded();
 note(rows.length+" produits reconnus, "+excluded.length+" lignes hors tableau. Quantités et prix à contrôler avant export.");
}
const CACHE_KEY="college_invoice_catalog_v1";
function validCatalog(d){return d&&d.read_only===true&&Array.isArray(d.products)&&Array.isArray(d.accounts)&&Array.isArray(d.keywords)&&Array.isArray(d.supplier_rules)&&Array.isArray(d.supplier_charges)&&Array.isArray(d.learned_products)}
function activateCatalog(d,stamp,mode){
 if(!validCatalog(d))throw Error("Fiche catalogue incomplète ou invalide.");
 catalog=d;catalogTimestamp=stamp;$("classify").disabled=false;$("saveCatalog").disabled=false;
 $("syncStatus").textContent=mode+" · "+stamp+" · "+d.products.length+" produits, "+d.accounts.length+" comptes, "+d.keywords.length+" règles de mots-clés.";
 render();
}
async function connect(){
 const tokens=[localStorage.getItem("college_accounting_token"),localStorage.getItem("college_secretariat_token"),localStorage.getItem("edm_admin_token"),localStorage.getItem("holding_admin_token")].filter(Boolean);
 let failure="Connexion indisponible ou session expirée";
 for(const token of tokens){
 try{
  const r=await fetch(API,{headers:{Authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!r.ok){failure="Supabase : HTTP "+r.status;continue;}
  const d=await r.json(),stamp=new Date().toISOString();
  if(!validCatalog(d))throw Error("Réponse Supabase incomplète");
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({stamp,catalog:d}));}catch{}
  activateCatalog(d,stamp,"Synchronisé Supabase");note("Fiche synchronisée et conservée dans ce navigateur.");return true;
 }catch(e){failure=e.message;}
 }
 try{const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
 if(cached?.catalog){activateCatalog(cached.catalog,cached.stamp||"Date inconnue","Mode hors connexion");note("Supabase inaccessible : fiche locale chargée. "+failure);return true;}
 }catch{}
 note("Catalogue indisponible : "+failure+". Importez une fiche locale JSON.");return false;
}
function exportCatalog(){
 if(!catalog)return;
 const obj={stamp:catalogTimestamp,catalog};
 const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="fiche_catalogue_college_"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function importCatalog(file){
 if(!file)return;
 try{const data=JSON.parse(await file.text());activateCatalog(data.catalog,data.stamp||"Date non renseignée","Fiche locale importée");localStorage.setItem(CACHE_KEY,JSON.stringify(data));note("Fiche hors connexion disponible.");}
 catch(e){note("Fiche refusée : "+e.message)}
}
function renderExcluded(){
 $("showExcluded").textContent="Lignes écartées ("+excluded.length+")";
 const box=$("excludedView");box.replaceChildren();
 excluded.forEach((r,i)=>{const line=document.createElement("div");line.style.padding="7px";line.textContent="Page "+r.page+" · "+r.reason+" · "+r.raw+" ";
 const btn=document.createElement("button");btn.textContent="Réintégrer";btn.onclick=()=>{rows.push(CORE.empty(r.page,r.raw));excluded.splice(i,1);render();renderExcluded()};line.append(btn);box.append(line)});
 if(!excluded.length)box.textContent="Aucune ligne écartée.";
}
function render(){
 const body=$("rows");body.replaceChildren();let ht=0,ttc=0,pending=0;
 rows.forEach((r,i)=>{
 const tr=document.createElement("tr");if(!r.checked)tr.style.background="#fff8ec";
 const cell=el=>{const td=document.createElement("td");if(typeof el==="string")td.textContent=el;else td.appendChild(el);tr.appendChild(td)};
 const input=(key,type="text")=>{const el=document.createElement("input");el.type=type;el.value=r[key]||"";if(type==="number")el.step="any";el.onchange=()=>{r[key]=el.value;r.checked=false;render()};return el};
 cell(String(r.page));cell(input("raw"));cell(input("reference"));
 const sel=document.createElement("select");sel.add(new Option("À identifier",""));(catalog?.products||[]).forEach(p=>sel.add(new Option(p.code+" - "+p.name,p.id)));
 sel.value=r.product_id||"";sel.onchange=()=>{r.product_id=sel.value;r.reference=catalog.products.find(p=>p.id===sel.value)?.code||"";r.checked=false;render()};cell(sel);
 ["qty","unit","vat","ht","ttc"].forEach(k=>cell(input(k,"number")));
 const ac=document.createElement("select");ac.add(new Option("Compte à définir",""));(catalog?.accounts||[]).filter(a=>a.account.startsWith("6")).forEach(a=>ac.add(new Option(a.account+" - "+a.label,a.account)));
 ac.value=r.account||"";ac.onchange=()=>{r.account=ac.value;r.checked=false;render()};cell(ac);
 const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=!!r.checked;checkbox.onchange=()=>{r.checked=checkbox.checked;render()};cell(checkbox);
 const remove=document.createElement("button");remove.textContent="Retirer";remove.onclick=()=>{rows.splice(i,1);render()};cell(remove);body.append(tr);
 ht+=num(r.ht)||0;ttc+=num(r.ttc)||0;
 if(!r.checked||!CORE.check(r,catalog).ready)pending++;
 });
 $("nLines").textContent=rows.length;$("nReview").textContent=pending;$("sumHT").textContent=ht.toFixed(2)+" €";$("sumTTC").textContent=ttc.toFixed(2)+" €";$("export").disabled=!rows.length;
}
function importTxt(text){let page=1;allRaw=[];for(const raw of text.split(/\r?\n/)){const m=raw.match(/^===== PAGE (\d+) =====$/);if(m){page=Number(m[1]);continue;}if(raw.trim())allRaw.push({page,raw:raw.trim()});}rows=allRaw.map(x=>CORE.empty(x.page,x.raw));excluded=[];render();renderExcluded();note(rows.length+" lignes importées.");}
let xlsxPromise=null;
async function XLSXLib(){if(window.XLSX)return window.XLSX;if(!xlsxPromise)xlsxPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(Error("Excel indisponible"));document.head.append(s)});return xlsxPromise}
async function importFile(file){if(!file)return;try{if(file.name.toLowerCase().endsWith(".txt")){importTxt(await file.text());await connect();if(catalog)classify();return;}const XLSX=await XLSXLib();const w=XLSX.read(await file.arrayBuffer(),{type:"array"}),data=XLSX.utils.sheet_to_json(w.Sheets.Lignes||w.Sheets[w.SheetNames[0]],{header:1,defval:""});allRaw=data.slice(1).filter(a=>a[2]).map(a=>({page:Number(a[0])||1,raw:String(a[2])}));rows=allRaw.map(x=>CORE.empty(x.page,x.raw));excluded=[];render();renderExcluded();note(rows.length+" lignes Excel chargées.");}catch(e){note("Import impossible : "+e.message)}}
async function exportFile(){
 try{const XLSX=await XLSXLib();const wb=XLSX.utils.book_new(),data=[["Page","Source","Référence","Produit","Quantité","Prix unitaire HT","TVA %","Total HT","Total TTC","Compte charge","Vérifié","Alerte"]];
 for(const r of rows){const p=catalog?.products?.find(x=>x.id===r.product_id);const q=num(r.qty),pu=num(r.unit),ht=num(r.ht),ttc=num(r.ttc);
 const checks=CORE.check(r,catalog),issues=[...checks.errors,...checks.warnings];if(!r.checked)issues.unshift("NON VALIDÉ");
 data.push([r.page,r.raw,r.reference,p?.name||"",q??"",pu??"",num(r.vat)??"",ht??"",ttc??"",r.account,r.checked?"OUI":"NON",issues.join("; ")]);
 }
 const sheet=XLSX.utils.aoa_to_sheet(data);sheet["!cols"]=[{wch:8},{wch:65},{wch:15},{wch:45},{wch:12},{wch:18},{wch:12},{wch:15},{wch:15},{wch:18},{wch:12},{wch:44}];XLSX.utils.book_append_sheet(wb,sheet,"Traitement");const archive=XLSX.utils.aoa_to_sheet([["Page","Ligne originale","Motif"],...excluded.map(x=>[x.page,x.raw,x.reason])]);XLSX.utils.book_append_sheet(wb,archive,"Lignes écartées");
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Fournisseur",$("supplier").value],["Numéro",$("invoiceNo").value],["Date",$("invoiceDate").value],["Compte fournisseur",$("supplierAccount").value],["État","BROUILLON - pas un import Charlemagne"]]),"Facture");
 XLSX.writeFile(wb,"traitement_facture.xlsx");note("Excel exporté. Aucune écriture ni stock modifié.");}
 catch(e){note("Export impossible : "+e.message)}
}
function boot(){
 $("connect").onclick=connect;$("saveCatalog").onclick=exportCatalog;$("offlineFile").onchange=e=>importCatalog(e.target.files?.[0]);$("showExcluded").onclick=()=>{$("excludedView").hidden=!$("excludedView").hidden};$("restoreAll").onclick=()=>{for(const e of excluded)rows.push(CORE.empty(e.page,e.raw));excluded=[];render();renderExcluded()};$("classify").onclick=classify;$("sourceFile").onchange=e=>importFile(e.target.files?.[0]);
 $("addRow").onclick=()=>{rows.push({page:1,raw:"",reference:"",product_id:"",qty:"",unit:"",vat:"",ht:"",ttc:"",account:"",checked:false});render()};
 $("export").onclick=exportFile;$("supplier").onchange=()=>{const r=catalog?.supplier_rules?.find(x=>norm(x.supplier_name)===norm($("supplier").value));if(r)$("supplierAccount").value=r.supplier_account||""};
 render();renderExcluded();connect();
}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot):boot();
})();