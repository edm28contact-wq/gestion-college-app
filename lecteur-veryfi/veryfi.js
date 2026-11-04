(()=>{
"use strict";
const ROOT="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/";
const API={veryfi:ROOT+"invoice-veryfi-reader",catalog:ROOT+"invoice-central-catalog",finalize:ROOT+"secretariat-tableur-finalize",accounting:ROOT+"accounting-api"};
const $=id=>document.getElementById(id);
const parameters=new URLSearchParams(location.search);
const accounting=parameters.get("origine")==="comptabilite";
const authKeys=accounting?["college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"]:["college_secretariat_token","college_admin_token","edm_admin_token","holding_admin_token"];
let file=null,objectUrl=null,authToken="",catalog=null,documentData=null,rows=[],loading=false,saved=false,revision=0,serverReady=false;
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
const amount=x=>{if(x==null||String(x).trim()==="")return null;const t=String(x).replace(/[\u00a0\u202f\s€]/g,"").replace(",",".");return /^-?\d+(?:\.\d+)?$/.test(t)&&Number.isFinite(Number(t))?Number(t):null};
const fmt=x=>x==null?"—":Number(x).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const timestamp=()=>new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
function notice(message,type=""){const e=$("notice");e.textContent=message;e.className="notice"+(type?" "+type:"")}
function setScope(){
 $("scope").textContent=accounting?"Comptabilité":"Secrétariat";
 $("backLink").href=accounting?"../comptabilite/":"../secretariat/";
 $("loginLink").href=accounting?"../comptabilite/?return=veryfi&reauth=1&reader=dedicated":"../secretariat/?return=veryfi&reauth=1&reader=dedicated";
 $("save").textContent=accounting?"Envoyer en Comptabilité — à contrôler":"Valider vers Commandes + Achats + Stocks";
}
function isUnexpired(token){
 try{
  const parts=String(token).split(".");if(parts.length!==2)return false;
  const v=parts[0].replace(/-/g,"+").replace(/_/g,"/"),b=atob(v+"=".repeat((4-v.length%4)%4));
  const obj=JSON.parse(new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0))));
  return !!obj.u&&Number.isFinite(Number(obj.exp))&&Number(obj.exp)>Date.now()+30000;
 }catch{return false}
}
function availableTokens(){return [...new Set(authKeys.map(k=>localStorage.getItem(k)).filter(isUnexpired))]}
async function request(url,{method="GET",payload,token,timeout=20000}={}){
 const headers=method==="POST"?{"content-type":"application/json",authorization:"Bearer "+(token||authToken)}:{"x-admin-session":token||authToken};
 const r=await fetch(url,{method,headers,body:method==="POST"?JSON.stringify(payload):undefined,cache:"no-store",signal:AbortSignal.timeout(timeout)});
 const data=await r.json().catch(()=>({error:"Réponse serveur invalide"}));
 if(!r.ok)throw Object.assign(new Error(data.error||"Erreur HTTP "+r.status),{code:r.status});
 return data;
}
async function resolveSession(){
 $("refreshSession").disabled=true;
 try{
  const candidates=availableTokens();
  if(!candidates.length)throw Object.assign(new Error("Session expirée. Reconnectez-vous à l’application."),{code:401});
  let last=null;
  for(const token of candidates){
   try{
    const config=await request(API.veryfi,{token,timeout:15000});
    if(!config.ok)throw new Error("Le lecteur Veryfi ne répond pas correctement.");
    authToken=token;serverReady=!!config.configured;
    $("sessionDot").className="dot "+(serverReady?"ok":"bad");
    $("sessionState").textContent=serverReady?"Veryfi prêt · "+timestamp():"Veryfi non configuré dans Supabase";
    $("loginLink").hidden=true;
    $("analyze").disabled=!file||loading||!serverReady;
    if(!serverReady)notice("Identifiants Veryfi non configurés sur le serveur.","error");
    await loadCatalog();
    return;
   }catch(e){last=e;if(e.code!==401&&e.code!==403)throw e}
  }
  throw last||new Error("Aucune session autorisée.");
 }catch(e){
  serverReady=false;authToken="";$("sessionDot").className="dot bad";
  $("sessionState").textContent=e.message;$("loginLink").hidden=false;$("analyze").disabled=true;
  $("catalogState").textContent="";notice(e.message,"error");
 }finally{$("refreshSession").disabled=false}
}
async function loadCatalog(){
 if(!authToken)return;
 try{
  const v=await request(API.catalog,{token:authToken,timeout:20000});
  if(!Array.isArray(v.products))throw new Error("Réponse catalogue incompatible");
  catalog=v;$("catalogState").textContent=v.products.length+" produits référencés";
  populateDatalists();if(rows.length)refreshMatches();
 }catch(e){
  catalog=null;$("catalogState").textContent="Catalogue indisponible";
  notice("Veryfi est accessible, mais le catalogue collège est indisponible : "+e.message,"error");
 }
}
function populateDatalists(){
 const p=$("productOptions");p.replaceChildren();
 for(const x of (catalog?.products||[]).filter(z=>z.active!==false)){
  const o=document.createElement("option");o.value=x.code+" — "+x.name;p.append(o);
 }
 const a=$("accountOptions");a.replaceChildren();
 for(const x of catalog?.accounts||[]){const o=document.createElement("option");o.value=String(x.account||"");o.label=String(x.label||x.name||"");a.append(o)}
}
function setFile(newFile){
 if(loading)return;
 clearPdf();
 const valid=newFile&&/\.pdf$/i.test(newFile.name)&&newFile.size>=5&&newFile.size<=6*1024*1024;
 if(newFile&&!valid){$("file").value="";notice("PDF invalide ou supérieur à 6 Mo. La lecture Veryfi n’a pas été lancée.","error");return}
 file=newFile||null;saved=false;documentData=null;rows=[];revision++;
 $("results").hidden=true;$("resultsEmpty").hidden=false;$("readingState").textContent="En attente du document";
 $("saveResult").textContent="";$("confirmReview").checked=false;$("fileName").textContent=file?file.name+" · "+(file.size/1048576).toFixed(2)+" Mo":"Aucun document sélectionné";
 $("clearFile").disabled=!file;$("analyze").disabled=!file||!serverReady;
 if(!file){$("viewerEmpty").hidden=false;notice("Déposez une facture PDF pour commencer.");return}
 objectUrl=URL.createObjectURL(file);$("viewer").src=objectUrl;$("viewer").hidden=false;$("viewerEmpty").hidden=true;
 $("openPdf").href=objectUrl;$("openPdf").hidden=false;
 notice("Document prêt. Cliquez sur « Lire avec Veryfi » pour analyser les lignes.");
}
function clearPdf(){
 if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
 $("viewer").removeAttribute("src");$("viewer").hidden=true;$("viewerEmpty").hidden=false;
 $("openPdf").removeAttribute("href");$("openPdf").hidden=true;file=null;
}
function encode(bytes){
 const chunks=[];for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
 return btoa(chunks.join(""));
}
async function analyze(){
 if(loading||!file)return;
 if(!serverReady)return notice("Une session Veryfi valide est requise.","error");
 if(!confirm("Envoyer « "+file.name+" » à Veryfi pour lecture ? Il s’agit d’un service externe pouvant être facturé. Aucune donnée comptable ni aucun stock ne sera modifié par cette lecture."))return;
 const version=++revision,source=file;loading=true;$("analyze").disabled=true;$("clearFile").disabled=true;
 $("readingState").textContent="Analyse en cours";notice("Lecture Veryfi en cours…");
 try{
  const result=await request(API.veryfi,{method:"POST",payload:{file_name:file.name,file_data:encode(new Uint8Array(await file.arrayBuffer()))},timeout:75000});
  if(source!==file||version!==revision)return;
  if(!result.ok||!result.result||!Array.isArray(result.result.line_items))throw Error("Résultat Veryfi inexploitable.");
  documentData=result.result;saved=false;rows=documentData.line_items.map((x,i)=>makeRow(x,i));
  bindDocument();refreshMatches();renderRows();
  $("resultsEmpty").hidden=true;$("results").hidden=false;
  $("readingState").textContent="Lecture terminée";notice("Veryfi a identifié "+rows.length+" ligne(s). Vérifiez les données avant validation.","success");
 }catch(e){
  if(e.code===401||e.code===403){serverReady=false;authToken="";$("loginLink").hidden=false;$("sessionDot").className="dot bad";$("sessionState").textContent="Session non autorisée";}
  $("readingState").textContent="Lecture interrompue";
  notice("Échec de la lecture : "+e.message,"error");
 }finally{loading=false;$("analyze").disabled=!serverReady||!file;$("clearFile").disabled=!file}
}
function makeRow(x,index){
 return {id:index,reference:String(x.reference||""),description:String(x.description||""),
  quantity:x.quantity??"",unit:String(x.unit||""),unit_price:x.unit_price??"",total:x.total??"",
  tax_rate:x.tax_rate??"",score:typeof x.boxes?.description?.score==="number"?x.boxes.description.score:typeof x.boxes?.total?.score==="number"?x.boxes.total.score:null,
  product_id:"",product_label:"",stock_quantity:"",account:"",account_source:"",
  matched:false,verified:false,excluded:false,changed:false,reason:""};
}
function bindDocument(){
 const d=documentData;
 for(const [id,k] of [["vendor","vendor"],["invoiceNumber","invoice_number"],["invoiceDate","date"],["subtotal","subtotal"],["tax","tax"],["total","total"]]){
  $(id).value=d[k]??"";
 }
 const scores=Object.entries(d.fields||{}).filter(([k,v])=>v&&typeof v.score==="number");
 $("fieldScores").textContent=scores.length?"Confiance fournie par Veryfi : "+scores.map(([k,v])=>k+" "+Math.round(v.score*100)+" %").join(" · "):"Scores détaillés non fournis par Veryfi pour ces champs.";
 $("confirmReview").checked=false;
}
function findProduct(row){
 if(!catalog||!row.description&&!row.reference)return null;
 const supplier=norm($("vendor").value);
 const ref=norm(row.reference),label=norm(row.description);
 const products=(catalog.products||[]).filter(x=>x.active!==false);
 const candidates=(catalog.supplier_product_catalog||[]).filter(x=>x.supplier_key&&norm(x.supplier_key)===supplier&&ref&&norm(x.supplier_reference)===ref);
 const ids=[...new Set(candidates.map(x=>x.product_id).filter(Boolean))];
 if(ids.length===1){const product=products.find(x=>x.id===ids[0]);if(product)return {product,source:"Référence fournisseur reconnue",record:candidates.find(x=>x.product_id===product.id)}}
 if(ids.length>1)return {product:null,source:"Plusieurs produits correspondent à cette référence"};
 if(ref){
  const found=products.filter(x=>norm(x.code)===ref);
  if(found.length===1)return {product:found[0],source:"Référence catalogue exacte"};
  if(found.length>1)return {product:null,source:"Référence catalogue ambiguë"};
 }
 if(label&&label.length>=7){
  const found=products.filter(x=>norm(x.name)===label);
  if(found.length===1)return {product:found[0],source:"Désignation catalogue exacte"};
 }
 return {product:null,source:"Produit absent du catalogue actif"};
}
function refreshMatches(){
 for(const row of rows){
  if(row.changed&&row.product_id)continue;
  const match=findProduct(row);row.matched=!!match?.product;row.reason=match?.source||"Catalogue non chargé";
  row.product_id=match?.product?.id||"";row.product_label=match?.product?match.product.code+" — "+match.product.name:"";
  if(match?.product){
   const q=amount(row.quantity),product=match.product;
   const sameUnit=norm(row.unit)&&norm(row.unit)===norm(product.stock_count_mode==="litre"?"litre":product.unit);
   row.stock_quantity=sameUnit&&q>0?q:"";
   const accountRow=match.record||null;
   row.account=String(accountRow?.account||"");row.account_source=String(accountRow?.account_source||"");
  }else{row.stock_quantity="";row.account="";row.account_source=""}
 }
}
function buildLine(row,index){
 const card=document.createElement("article");card.className="row";card.dataset.index=String(index);
 const heading=document.createElement("div");heading.className="row-head";
 const score=typeof row.score==="number"?Math.round(row.score*100):null;
 heading.innerHTML='<div class="row-headline"><span class="row-number">LIGNE '+(index+1)+'</span><strong>'+esc(row.description||"Désignation manquante")+'</strong></div><span class="score '+(score==null?"unknown":score<80?"low":"")+'">'+(score==null?"Confiance inconnue":score+" %")+'</span>';
 card.append(heading);
 const fields=document.createElement("div");fields.className="row-grid";
 const definitions=[["reference","Référence fournisseur","text"],["description","Désignation","text","wide"],["quantity","Quantité facturée","number"],["unit","Unité","text"],["unit_price","Prix unitaire HT","number"],["total","Total HT","number"],["tax_rate","TVA (%)","number"],["product_label","Produit du catalogue","text","wide"],["stock_quantity","Entrée en stock","number"],["account","Compte de charge proposé","text"]];
 for(const [key,title,type,wide] of definitions){
  const label=document.createElement("label");label.className="field"+(wide?" "+wide:"");
  const span=document.createElement("span");span.textContent=title;label.append(span);
  const input=document.createElement("input");input.dataset.key=key;input.type=type;input.autocomplete="off";
  input.value=row[key]??"";
  if(type==="number"){input.type="text";input.inputMode="decimal"}
  if(key==="product_label")input.setAttribute("list","productOptions");
  if(key==="account")input.setAttribute("list","accountOptions");
  input.addEventListener("change",()=>changeRow(index,key,input.value));
  label.append(input);fields.append(label);
 }
 card.append(fields);
 const meta=document.createElement("div");meta.className="mapping";
 meta.textContent=row.reason+(row.account_source?" · Charge : "+row.account_source:"");
 card.append(meta);
 const foot=document.createElement("div");foot.className="row-foot";
 foot.innerHTML='<label><input type="checkbox" data-choice="verified" '+(row.verified?"checked":"")+'> Vérifiée sur PDF</label><label><input type="checkbox" data-choice="excluded" '+(row.excluded?"checked":"")+'> Écarter de la réception</label><button class="btn secondary" type="button" data-choice="remove">Supprimer la ligne</button>';
 foot.querySelector('[data-choice="verified"]').addEventListener("change",e=>{row.verified=e.target.checked;row.changed=true;$("confirmReview").checked=false;updateTotals()});
 foot.querySelector('[data-choice="excluded"]').addEventListener("change",e=>{row.excluded=e.target.checked;row.verified=false;row.changed=true;$("confirmReview").checked=false;renderRows()});
 foot.querySelector('[data-choice="remove"]').addEventListener("click",()=>{if(!confirm("Supprimer cette ligne ? Son montant ne sera plus inclus dans le contrôle HT."))return;rows.splice(index,1);$("confirmReview").checked=false;renderRows()});
 card.append(foot);card.classList.toggle("excluded",row.excluded);
 const matched=!!row.product_id&&!row.excluded;
 card.classList.toggle("bad",!matched&&!row.excluded||row.excluded);card.classList.toggle("warn",!row.verified&&matched);
 return card;
}
function changeRow(index,key,value){
 const row=rows[index];if(!row||saved)return;
 row[key]=value;row.changed=true;row.verified=false;$("confirmReview").checked=false;
 if(key==="reference"||key==="description"){
  row.product_id="";row.product_label="";row.stock_quantity="";row.account="";
  const m=findProduct(row);
  if(m?.product){row.product_id=m.product.id;row.product_label=m.product.code+" — "+m.product.name;row.matched=true;row.reason=m.source}
  else{row.matched=false;row.reason=m?.source||"Produit à associer"}
 }else if(key==="product_label"){
  const p=(catalog?.products||[]).filter(x=>x.active!==false).find(x=>x.code+" — "+x.name===value);
  row.product_id=p?.id||"";row.matched=!!p;row.reason=p?"Produit sélectionné manuellement":"Produit catalogue non identifié";
  row.stock_quantity="";
 }else if(key==="unit"||key==="quantity"){row.stock_quantity=""}
 renderRows();
}
function renderRows(){
 const box=$("lines");box.replaceChildren();
 rows.forEach((r,i)=>box.append(buildLine(r,i)));
 updateTotals();
}
function addLine(){
 if(!documentData||saved)return;
 rows.push(makeRow({},rows.length));$("confirmReview").checked=false;renderRows();
}
function eligible(row){
 if(row.excluded)return false;
 const q=amount(row.quantity),p=amount(row.unit_price),t=amount(row.total);
 return !!row.description&&q!=null&&q>0&&p!=null&&p>=0&&t!=null&&t>=0&&Math.abs(round(q*p)-t)<=.02;
}
function calc(){
 const included=rows.filter(r=>!r.excluded);
 const sum=round(included.reduce((n,r)=>n+(amount(r.total)||0),0));
 const ht=amount($("subtotal").value),vat=amount($("tax").value),ttc=amount($("total").value);
 const missing=included.filter(r=>!eligible(r));
 const unmatched=accounting?[]:included.filter(r=>!r.product_id||!(amount(r.stock_quantity)>0));
 const unverified=included.filter(r=>!r.verified);
 const discrepancy=ht==null||Math.abs(sum-ht)>.02;
 const grossMismatch=ht!=null&&vat!=null&&ttc!=null&&Math.abs(round(ht+vat)-ttc)>.02;
 const ok=!!documentData&&!!file&&!saved&&included.length>0&&!missing.length&&!unmatched.length&&!unverified.length&&!discrepancy&&!grossMismatch&&ht!=null&&vat!=null&&ttc!=null&&!!$("vendor").value.trim()&&!!$("invoiceNumber").value.trim()&&/^\d{4}-\d{2}-\d{2}$/.test($("invoiceDate").value);
 return {ok,included,sum,ht,vat,ttc,discrepancy,grossMismatch,missing,unmatched,unverified};
}
function updateTotals(){
 if(!documentData)return;
 const c=calc(),ignored=rows.filter(r=>r.excluded).length;
 $("metrics").innerHTML='<div class="metric"><span>Lignes détectées</span><strong>'+rows.length+'</strong></div><div class="metric"><span>À vérifier</span><strong>'+(c.unverified.length+c.missing.length)+'</strong></div><div class="metric"><span>Écart HT</span><strong>'+(c.ht==null?"—":fmt(round(c.sum-c.ht)))+'</strong></div>';
 const errors=[];
 if(!c.included.length)errors.push("Aucune ligne retenue");
 if(c.discrepancy)errors.push("Total des lignes différent du total HT de la facture");
 if(c.grossMismatch)errors.push("HT + TVA différent du TTC");
 if(c.missing.length)errors.push(c.missing.length+" ligne(s) incompletes ou incohérentes");
 if(c.unmatched.length)errors.push(c.unmatched.length+" ligne(s) sans produit/quantité de stock");
 if(c.unverified.length)errors.push(c.unverified.length+" ligne(s) non vérifiées");
 if(ignored)errors.push(ignored+" ligne(s) écartées, non incluses dans le total");
 $("reconciliation").className="reconciliation "+(errors.length?"bad":"good");
 $("reconciliation").textContent="Somme HT des lignes retenues : "+fmt(c.sum)+" · HT facture : "+fmt(c.ht)+" · TTC : "+fmt(c.ttc)+"."+(errors.length?" Contrôles : "+errors.join(" ; "):" Totaux cohérents. Contrôle des lignes terminé.");
 $("save").disabled=!c.ok||!$("confirmReview").checked||loading;
 $("saveHelp").textContent=saved?"Facture enregistrée.":c.ok?"Cochez la confirmation pour autoriser la validation.":"Vérifiez les lignes et corrigez les écarts avant l’enregistrement.";
}
async function digest(bytes){
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}
async function save(){
 const c=calc();
 if(!c.ok||!$("confirmReview").checked)return notice("La facture n’est pas prête : contrôles incomplets.","error");
 if(!confirm(accounting?"Enregistrer cette facture en Comptabilité pour contrôle, sans la valider définitivement ?":"Valider cette facture ? Les produits vérifiés seront ajoutés au stock et transmis à Commandes et Achats."))return;
 const bytes=new Uint8Array(await file.arrayBuffer());loading=true;$("save").disabled=true;notice("Enregistrement sécurisé en cours…");
 try{
  if(accounting){
   const fd=new FormData();
   fd.append("file",file);fd.append("supplier",$("vendor").value.trim());
   fd.append("invoice_number",$("invoiceNumber").value.trim());fd.append("invoice_date",$("invoiceDate").value);
   fd.append("amount_ht",String(c.ht));fd.append("amount_vat",String(c.vat));fd.append("amount_ttc",String(c.ttc));
   fd.append("vat_rate","");fd.append("raw_text",JSON.stringify({provider:"veryfi",document_id:documentData.id,lines:c.included.map(r=>({reference:r.reference,description:r.description,quantity:amount(r.quantity),unit:r.unit,unit_price:amount(r.unit_price),total:amount(r.total),account:r.account}))}));
   const response=await fetch(API.accounting+"?action=upload",{method:"POST",headers:{authorization:"Bearer "+authToken},body:fd,cache:"no-store",signal:AbortSignal.timeout(80000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Import comptable refusé : HTTP "+response.status);
   saved=true;notice("Facture enregistrée en Comptabilité. Statut : à contrôler. Aucune écriture comptable validée automatiquement.","success");
   $("saveResult").textContent="Document "+(data.item?.id||"")+" · Vérification comptable requise avant validation.";
  }else{
   if(!catalog)throw Error("Catalogue central indisponible.");
   const items=c.included.map(r=>{
    const product=catalog.products.find(p=>p.id===r.product_id);
    return {product_id:product?.id,stock_quantity:amount(r.stock_quantity),
      invoice_quantity:amount(r.quantity),delivered_quantity:amount(r.quantity),
      invoice_unit:r.unit,delivered_unit:r.unit,detected_label:r.description,detected_reference:r.reference,
      unit_price_ht:amount(r.unit_price),line_total_ht:amount(r.total),vat_rate:amount(r.tax_rate),verified:true};
   });
   if(items.some(x=>!x.product_id||!(x.stock_quantity>0)))throw Error("Une ou plusieurs quantités de stock sont manquantes.");
   const data=await request(API.finalize,{method:"POST",payload:{file_hash:await digest(bytes),file_name:file.name,pdf_base64:encode(bytes),supplier:$("vendor").value.trim(),
    supplier_key:norm($("vendor").value),invoice_number:$("invoiceNumber").value.trim(),invoice_date:$("invoiceDate").value,expected_ht:c.ht,
    raw_text:JSON.stringify({provider:"veryfi",document_id:documentData.id}),items},timeout:80000});
   if(data.ok!==true)throw Error(data.error||"Validation rejetée");
   saved=true;notice("Facture validée. Commandes, achats et stocks synchronisés.","success");
   $("saveResult").textContent="Commande CMD-"+String(data.order_no||"").padStart(6,"0")+" · "+(data.stock_products||0)+" produit(s) enregistré(s).";
  }
  lockFields();$("newDocument").hidden=false;
 }catch(e){notice("Enregistrement refusé : "+e.message,"error");$("saveResult").textContent=e.message}
 finally{loading=false;updateTotals()}
}
function lockFields(){
 $("results").querySelectorAll("input,button").forEach(el=>{if(el.id!=="newDocument")el.disabled=true});
}
function setup(){
 setScope();
 const drop=$("drop"),input=$("file");
 drop.addEventListener("click",()=>{if(!loading)input.click()});
 drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!loading)input.click()}});
 drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag")});
 drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
 drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");if(!loading)setFile(e.dataTransfer.files?.[0])});
 input.addEventListener("change",()=>setFile(input.files?.[0]));
 $("clearFile").addEventListener("click",()=>{input.value="";setFile(null)});
 $("analyze").addEventListener("click",analyze);
 $("refreshSession").addEventListener("click",resolveSession);
 $("addLine").addEventListener("click",addLine);
 $("save").addEventListener("click",save);
 $("confirmReview").addEventListener("change",updateTotals);
 for(const key of ["vendor","invoiceNumber","invoiceDate","subtotal","tax","total"])
  $(key).addEventListener("change",()=>{if(key==="vendor"){rows.forEach(r=>{r.changed=false;r.product_id="";r.verified=false});refreshMatches()}renderRows();$("confirmReview").checked=false;updateTotals()});
 $("newDocument").addEventListener("click",()=>{location.reload()});
 $("loginLink").addEventListener("click",e=>{if(file&&!confirm("La reconnexion rechargera la page. Le PDF devra être sélectionné de nouveau. Continuer ?"))e.preventDefault()});
 window.addEventListener("focus",()=>{if(!loading&&!saved&&file)resolveSession()});
 window.addEventListener("pagehide",()=>{if(objectUrl)URL.revokeObjectURL(objectUrl)});
 resolveSession();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();