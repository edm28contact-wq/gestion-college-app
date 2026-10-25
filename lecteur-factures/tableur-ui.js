(()=>{
"use strict";
const $=id=>document.getElementById(id),C=window.InvoiceTableurCore;
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
let catalog=null,records=[],ignored=[],unresolved=[],summary=null;
let currentProfile=null;
const tokens=()=>["college_accounting_token","college_secretariat_token","college_admin_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
function status(message,error=false){$("status").textContent=message;$("status").className="status"+(error?" err":"")}
function transferStatus(message,error=false){const e=$("transferStatus");if(e){e.textContent=message;e.className="status"+(error?" err":"")};status(message,error)}
function catalogStatus(message,error=false){const el=$("catalogStatus")||$("status");el.textContent=message;el.className="muted"+(error?" err":"")}
function extractionStatus(message,error=false){const el=$("extractionStatus");if(!el)return;el.textContent=message;el.className="muted"+(error?" err":"")}
async function loadCatalog(){
 for(const token of tokens()){
  try{const res=await fetch(API,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)});if(!res.ok)continue;const data=await res.json();if(data.read_only===true&&Array.isArray(data.products)){catalog=data;detectSupplier($("sourceText").value);catalogStatus("Catalogue synchronisé : "+data.products.length+" produits. Aucun stock n'est modifié.");render();return;}}catch{}
 }
 catalogStatus("Catalogue non connecté. La transcription PDF fonctionne néanmoins. Connectez-vous à la comptabilité pour associer les produits.",true);
}
function detectSupplier(raw){
 const profile=C.detectProfile(raw,catalog);
 if(!profile)return;
 currentProfile=profile;
 const field=$("supplierMatch");
 if(field&&(!field.value.trim()||field.dataset.auto==="true")){field.value=profile.supplier_name;field.dataset.auto="true";}
}
function make(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e}
function render(){
 const body=$("tableurBody");body.replaceChildren();
 let associated=0,verified=0;
 for(const [index,r] of records.entries()){
  const tr=make("tr"),match=C.match(r,catalog,$("supplierMatch").value),test=C.check(r);
  const productId=r.product_id||match.product?.id||"";
  const products=(catalog?.products||[]).filter(p=>p.active!==false);
  if(r.layout==="pomona"){const n=make("td",r.line_number??"");tr.append(n)}else{tr.append(make("td",r.line_number??""))}
  for(const [field,width] of [["reference",100],["designation",270],["delivered_quantity",75],["delivered_unit",70],["quantity",75],["unit",70],["vat_code",55],["vat",60],["unit_price_ht",85],["total_ht",95]]){
   const td=make("td"),input=make("input");input.value=r[field]??"";input.style.width=width+"px";
   input.setAttribute("aria-label",field+" ligne "+(index+1));input.addEventListener("change",()=>{r[field]=input.value;r.verified=false;if(["quantity","delivered_quantity","unit","delivered_unit","reference"].includes(field)){r.stock_quantity=null;r.stock_manual=false}render()});td.append(input);tr.append(td);
  }
  const td=make("td"),selector=make("select");
  selector.style.minWidth="240px";selector.append(make("option","À associer"));selector.firstChild.value="";
  for(const p of products){const o=make("option",p.code+" — "+p.name);o.value=p.id;selector.append(o)}
  selector.value=productId;
  if(productId&&!selector.value){r.product_id="";r.verified=false;selector.value="";}
  selector.onchange=()=>{r.product_id=selector.value;r.verified=false;r.stock_quantity=null;r.stock_manual=false;render()};
  td.append(selector,make("small",r.product_id?"Sélection manuelle":match.source));tr.append(td);
  const valid=make("td",(test.ok?"HT cohérent":"À vérifier : "+test.text)+(r.needs_review?" · "+(r.review_reason||"Unité ou ligne à vérifier"):""));valid.className=test.ok&&!r.needs_review?"ok":"err";tr.append(valid);
  const checkTd=make("td"),check=make("input");check.type="checkbox";check.checked=!!r.verified;check.disabled=!test.ok||!productId;
  check.title=r.needs_review?(r.review_reason||"Vérifier la ligne sur le PDF"):"Confirmer la ligne";check.onchange=()=>{r.verified=check.checked;if(check.checked&&r.needs_review)r.manual_corrected=true;render()};checkTd.append(check);tr.append(checkTd);
  const action=make("td"),remove=make("button","Retirer");remove.className="btn";remove.onclick=()=>{records.splice(index,1);render()};action.append(remove);tr.append(action);body.append(tr);
  if(productId)associated++;if(r.verified&&test.ok&&productId)verified++;
 }
 $("metrics").textContent=records.length+" lignes produits · "+associated+" associées · "+verified+" vérifiées · "+ignored.length+" lignes inutiles écartées";
 const total=records.reduce((sum,r)=>sum+(C.decimal(r.total_ht)||0),0);
 const target=summary?.expected_ht;
 $("invoiceTotals").textContent="Total HT des lignes : "+total.toFixed(2)+" €"+(target!==null&&target!==undefined?" · Total facture : "+Number(target).toFixed(2)+" € · Écart : "+(Math.round((total-target)*100)/100).toFixed(2)+" €":" · Total HT facture non détecté")+(summary?.expected_vat!=null?" · TVA : "+Number(summary.expected_vat).toFixed(2)+" €":"")+(summary?.expected_ttc!=null?" · TTC : "+Number(summary.expected_ttc).toFixed(2)+" €":"");
 $("invoiceTotals").className=target!=null&&Math.abs(total-target)>.02?"err":"ok";
 $("cleanText").value=records.length?C.format(records):($("sourceText").value.trim()?"Aucun produit reconnu dans le texte brut. La transcription complète reste visible en haut. Consultez les lignes ignorées pour corriger leur structure.":"");
 $("ignoredCount").textContent=ignored.length+" lignes écartées · "+unresolved.length+" fragments non résolus";
 $("ignoredList").value=[...unresolved.map(x=>"À RÉPARER — ligne "+x.line+" : "+x.text+" ("+x.reason+")"),...ignored.map(x=>"Ligne "+x.line+" : "+x.text)].join("\n");
 $("exportRows").disabled=!records.length;
 renderStockPreview();
}
function applyTranscription(text,origin="manuel"){
 detectSupplier(text);
 const result=C.parse(text);
 $("finalInvoiceNumber").value=getInvoiceNumber();$("finalInvoiceDate").value=getInvoiceDate();$("finalInvoiceHT").value=result.meta?.expected_ht??"";
 records=result.rows.map(r=>({...r,product_id:"",verified:false}));
 ignored=result.ignoredLines||[];unresolved=result.unresolvedLines||[];summary=result.meta||null;
 render();
 if(result.error){
  status("Texte "+(origin==="PDF"?"du PDF ":"")+"reçu ("+text.length+" caractères) mais aucun article complet reconnu. Les "+ignored.length+" lignes ignorées sont affichées. Corrigez le texte brut ou forcez l’OCR.",true);
 }else{
  status("Transcription "+(origin==="PDF"?"PDF ":"")+"nettoyée : "+records.length+" produit(s), "+(summary?.reconstructed||0)+" ligne(s) recomposée(s), "+unresolved.length+" fragment(s) non résolu(s)."+(summary?.reconciled===true?" Total HT retrouvé.":" Vérifiez les montants."));
 }
 return result;
}
function analyze(){
 const text=$("sourceText").value;
 if(!text.trim())return status("Aucune transcription à analyser. Importez un PDF ou collez les lignes de facture.",true);
 if(records.length&&!confirm("Remplacer les "+records.length+" lignes du tableau actuel ?"))return;
 applyTranscription(text,"manuel");
}
function applyCorrectedLines(replaceAll=false){
 const field=$("manualLines"),raw=field?.value||"";
 if(!raw.trim())return status("Collez les lignes corrigées avant de les appliquer.",true);
 detectSupplier(raw);
 const result=C.parse(raw);
 if(!result.rows.length)return status("Aucune ligne produit complète reconnue dans le collage. Contrôlez la référence, la quantité et les montants. Le tableau actuel reste intact.",true);
 if(replaceAll&&records.length&&!confirm("Remplacer le tableau actuel par les lignes corrigées ?"))return;
 const merged=C.mergeRows(records,result.rows,replaceAll);
 records=merged.rows;
 if(replaceAll){ignored=result.ignoredLines||[];unresolved=result.unresolvedLines||[];summary=result.meta||null;}
 else if(result.unresolvedLines?.length)unresolved.push(...result.unresolvedLines);
 render();
 field.value="";
 status((replaceAll?"Tableau remplacé. ":"Corrections appliquées. ")+merged.updated+" ligne(s) corrigée(s), "+merged.added+" ajoutée(s), "+merged.unchanged+" inchangée(s)"+(merged.ambiguous?" · "+merged.ambiguous+" référence(s) ambiguë(s) ajoutée(s) sans association automatique":"")+". Les lignes modifiées doivent être revérifiées.");
}
async function saveVerifiedAssociations(){
 const supplier=$("supplierMatch").value.trim();
 const supplierKey=C.supplierKey(supplier,catalog);
 const layout=records.some(r=>r.layout==="pomona")?"pomona":"standard";
 if(supplierKey.length<2)return status("Indiquez le fournisseur avant d'enregistrer les associations.",true);
 if(unresolved.length||!records.length||(summary?.expected_ht!=null&&Math.abs(records.reduce((n,r)=>n+(C.decimal(r.total_ht)||0),0)-summary.expected_ht)>.02))return status("Validation bloquée : corrigez les lignes non résolues et l’écart HT avant de mémoriser les associations.",true);
 const selected=records.filter(r=>r.verified&&C.check(r).ok).map(r=>({supplier_reference:String(r.reference),supplier_label:r.designation,product_id:r.product_id||C.match(r,catalog,supplier).product?.id}));
 if(!selected.length)return status("Cochez « Vérifié » pour chaque produit à mémoriser.",true);
 if(selected.some(r=>!r.product_id))return status("Un produit confirmé n'est plus disponible dans le catalogue.",true);
 if(new Set(selected.map(r=>C.norm(r.supplier_reference).replace(/\s+/g,""))).size!==selected.length)return status("Référence fournisseur en double : vérifiez les lignes avant l'apprentissage.",true);
 const allTokens=tokens();if(!allTokens.length)return status("Session requise : connectez-vous au Secrétariat, à l’administration ou à la comptabilité.",true);
 const btn=$("saveMappings");btn.disabled=true;
 try{
  let data=null,authFailure=false;
  for(const token of allTokens){
   const response=await fetch("https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-ocr-learning",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({action:"verify-product-mappings",supplier_key:supplierKey,supplier_name:supplier,layout_type:layout,items:selected})});
   const result=await response.json();
   if(response.status===401||response.status===403){authFailure=true;continue}
   if(!response.ok||!result.ok)throw Error(result.error||"Enregistrement indisponible");
   data=result;break;
  }
  if(!data)throw Error(authFailure?"Les sessions présentes ne sont pas autorisées à enregistrer ces associations. Reconnectez-vous.":"Aucune session utilisable");
  status(data.confirmed+" association(s) mémorisée(s) pour "+supplier+" / "+layout+". Elles seront réutilisées sur les prochaines factures.");
  await loadCatalog();
 }catch(e){status("Impossible de mémoriser : "+(e?.message||String(e)),true)}
 finally{btn.disabled=false}
}
function exportTsv(){
 const selected=records.filter(r=>r.verified).map(r=>{const p=(catalog?.products||[]).find(x=>x.id===(r.product_id||C.match(r,catalog,$("supplierMatch").value).product?.id));return {r,p}});
 if(!selected.length){status("Cochez les produits vérifiés avant l’export.",true);return}
 const header=["Ligne","Réf. fournisseur","Désignation fournisseur","Qté livrée","Unité livrée","Qté facturée","Unité facturée","Code TVA","TVA %","PU HT","Total HT","Code produit","Nom produit","Recomposée"];
 const safe=x=>{let v=String(x??"").replace(/[\t\r\n]+/g," ");return /^[=+@-]/.test(v)?"'"+v:v};
 const tsv=[header.join("\t"),...selected.map(({r,p})=>[r.line_number??"",r.reference,r.designation,r.delivered_quantity,r.delivered_unit,r.quantity,r.unit,r.vat_code,r.vat,r.unit_price_ht,r.total_ht,p?.code||"",p?.name||"",r.needs_review?"Oui":"Non"].map(safe).join("\t"))].join("\n");
 const link=make("a");const url=URL.createObjectURL(new Blob([tsv],{type:"text/tab-separated-values;charset=utf-8"}));link.href=url;link.download="facture_produits_verifies.tsv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
 status("Export effectué : "+selected.length+" produits vérifiés. Aucun stock ni aucune facture enregistrés.");
}

function inferStockQty(r,product){
 if(!product)return null;
 const a=C.decimal(r.quantity),b=C.decimal(r.delivered_quantity);
 const unit=C.unitInfo(r.unit).canonical,del=C.unitInfo(r.delivered_unit).canonical;
 const stock=product.stock_count_mode==='litre'?'litre':C.unitInfo(product.unit).canonical;
 const factor=C.decimal(product.purchase_to_stock_factor)||1;
 if(factor>1&&stock===unit&&stock===del&&a===b)return null;
 if(stock&&stock===unit&&a>0)return a;
 if(stock&&stock===del&&b>0)return b;
 // A documented package conversion can be proposed, never silently confirmed.
 if(factor>1&&b>0&&del&&del!==stock&&C.unitInfo(product.unit).recognized)return Math.round(b*factor*1000)/1000;
 return null;
}
function getInvoiceDate(){
 const text=$("sourceText").value;
 const p=[/(?:date\s*(?:de\s*)?(?:facture|document)|factur[eé]\s+le)\s*[: ]*\s*(\d{1,2}[/.]\d{1,2}[/.]\d{4})/i,/\b(?:du|le)\s*(\d{1,2}[/.]\d{1,2}[/.]\d{4})/i];
 for(const re of p){const v=text.match(re)?.[1];if(!v)continue;const m=v.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);if(m){const iso=m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0"),d=new Date(iso+"T12:00:00Z");if(!isNaN(+d)&&d.toISOString().slice(0,10)===iso)return iso}}
 return "";
}
function getInvoiceNumber(){
 const t=$("sourceText").value;
 const formats=[/\bfacture\s*(?:n[°oº.]?\s*)?[:#-]?\s*(FA[- ]?\d{5,}|\d{7,})\b/i,/\bfacture\s*[:#]?\s*([A-Z][A-Z0-9/-]{5,})\b/i];
 return formats.map(re=>t.match(re)?.[1]).find(Boolean)||"";
}
function renderStockPreview(){
 const rows=$("stockPreview");if(!rows)return;
 rows.replaceChildren();
 for(const [i,r] of records.entries()){
  const t=make("tr"),match=C.match(r,catalog,$("supplierMatch").value);
  const product=(catalog?.products||[]).find(x=>x.id===(r.product_id||match.product?.id));
  const unit=product?.unit||"—",suggested=inferStockQty(r,product),qty=r.stock_manual?r.stock_quantity:suggested;
  if(!r.stock_manual&&qty!=null)r.stock_quantity=qty;
  for(const v of [r.reference,product?.name||"À associer",r.delivered_quantity+" "+r.delivered_unit,r.quantity+" "+r.unit,unit])t.append(make("td",v));
  const td=make("td"),input=make("input");input.type="number";input.min="0.001";input.max="1000000";input.step="0.001";input.style.width="110px";input.value=qty??"";
  input.title="Quantité qui sera réellement ajoutée au stock du collège";
  input.onchange=()=>{r.stock_quantity=input.value;r.stock_manual=true;r.verified=false;render()};
  td.append(input);t.append(td);
  t.append(make("td",qty==null?"Conversion à confirmer":r.stock_manual?"Saisie manuelle : vérifier":suggested!=null&&product&&C.unitInfo(r.delivered_unit).canonical!==C.unitInfo(product.stock_count_mode==="litre"?"litre":product.unit).canonical?"Conversion proposée : vérifier le conditionnement":"Unité concordante"));
  rows.append(t);
 }
}
function resetAfterSuccessfulTransfer(result){
 const label="Facture enregistrée · CMD-"+String(result.order_no).padStart(6,"0")+" · "+result.stock_products+" produit(s) synchronisé(s). Vous pouvez importer la facture suivante.";
 document.dispatchEvent(new Event("invoice-pdf:reset-after-success"));
 records=[];ignored=[];unresolved=[];summary=null;currentProfile=null;
 $("sourceText").value="";$("manualLines").value="";$("supplierMatch").value="";delete $("supplierMatch").dataset.auto;
 for(const id of ["finalInvoiceNumber","finalInvoiceDate","finalInvoiceHT"])$(id).value="";
 render();
 const button=$("finalizeInvoice");button.textContent="Valider et transférer vers Commandes + Achats + Stocks";button.disabled=false;
 $("finalizeLinks").hidden=false;
 extractionStatus("Nouvelle facture : importez le prochain PDF.");
 transferStatus(label);
 $("transferStatus").scrollIntoView({behavior:"smooth",block:"center"});
}
async function finalizeInvoice(){
 if(unresolved.length||!records.length||!catalog)return transferStatus("Complétez la facture et corrigez les fragments non résolus.",true);
 const supplier=$("supplierMatch").value.trim(),number=$("finalInvoiceNumber").value.trim(),date=$("finalInvoiceDate").value;
 const h=C.decimal($("finalInvoiceHT").value);
 if(!supplier||!number||!date||h==null||h<=0)return transferStatus("Fournisseur, numéro, date et total HT obligatoires.",true);
 const total=records.reduce((n,r)=>n+(C.decimal(r.total_ht)||0),0);
 if(Math.abs(h-total)>.02)return transferStatus("Total HT différent des lignes : validation bloquée.",true);
 if(summary?.expected_ht!=null&&Math.abs(summary.expected_ht-h)>.02)return transferStatus("Total HT différent du PDF : validation bloquée.",true);
 const file=$("invoicePdf").files?.[0];
 if(!file||file.size>8*1024*1024)return transferStatus("Importez le PDF original (maximum 8 Mo) avant validation. Pour les PDF plus volumineux, réduisez la taille sans modifier la facture.",true);
 if(records.some(r=>!r.verified||!C.check(r).ok||!r.stock_quantity||C.decimal(r.stock_quantity)<=0||r.needs_review&&!r.manual_corrected))return transferStatus("Chaque produit, montant, unité et quantité de stock doit être vérifié.",true);
 const items=records.map(r=>{
  const match=C.match(r,catalog,supplier),product=(catalog.products||[]).find(x=>x.id===(r.product_id||match.product?.id));
  return {product_id:product?.id,stock_quantity:C.decimal(r.stock_quantity),invoice_quantity:C.decimal(r.quantity),delivered_quantity:C.decimal(r.delivered_quantity),invoice_unit:r.unit,delivered_unit:r.delivered_unit,detected_label:r.designation,detected_reference:r.reference,unit_price_ht:C.decimal(r.unit_price_ht),line_total_ht:C.decimal(r.total_ht),vat_rate:C.decimal(r.vat),verified:true};
 });
 if(items.some(x=>!x.product_id||!x.stock_quantity))return transferStatus("Un ou plusieurs produits du catalogue sont introuvables.",true);
 const msg="Confirmer l'enregistrement définitif de cette facture ?\n"+records.length+" lignes seront transférées vers Secrétariat → Commandes et Administration → Achats. Le stock sera augmenté UNE FOIS, selon les quantités saisies.";
 if(!confirm(msg))return;
 const btn=$("finalizeInvoice");btn.disabled=true;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  const digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
  let b64="";for(let i=0;i<bytes.length;i+=8192)b64+=String.fromCharCode(...bytes.slice(i,i+8192));
  b64=btoa(b64);
  let result=null;
  for(const token of tokens()){
   const response=await fetch("https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-tableur-finalize",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({file_hash:digest,file_name:file.name,pdf_base64:b64,supplier,supplier_key:C.supplierKey(supplier,catalog),invoice_number:number,invoice_date:date,expected_ht:h,raw_text:$("sourceText").value,items})});
   const data=await response.json();
   if(response.status===401||response.status===403)continue;
   if(!response.ok||!data.ok)throw Error(data.error||"Validation impossible");
   result=data;break;
  }
  if(!result)throw Error("Session autorisée introuvable : reconnectez-vous au Secrétariat.");
  status("Facture validée. Commande CMD-"+String(result.order_no).padStart(6,"0")+" enregistrée, "+result.stock_products+" produits en Achats et stocks synchronisés.");
  resetAfterSuccessfulTransfer(result);
 }catch(e){transferStatus("Facture non validée : "+(e?.message||String(e)),true);btn.disabled=false}
}

function boot(){
 $("analyze").onclick=analyze;$("exportRows").onclick=exportTsv;$("refreshCatalog").onclick=loadCatalog;
 $("saveMappings").onclick=saveVerifiedAssociations;
 $("finalizeInvoice").onclick=finalizeInvoice;
 $("manualApply").onclick=()=>applyCorrectedLines(false);
 $("manualReplace").onclick=()=>applyCorrectedLines(true);
 $("clear").onclick=()=>{if(records.length&&!confirm("Effacer la transcription et le tableau ?"))return;$("sourceText").value="";records=[];ignored=[];unresolved=[];summary=null;render();status("Saisie vidée.")};
 document.addEventListener("invoice-pdf:replace",()=>{
  $("sourceText").value="";records=[];ignored=[];unresolved=[];summary=null;currentProfile=null;$("supplierMatch").value="";delete $("supplierMatch").dataset.auto;["finalInvoiceNumber","finalInvoiceDate","finalInvoiceHT"].forEach(id=>$(id).value="");$("finalizeLinks").hidden=true;transferStatus("");render();
  extractionStatus("Lecture du PDF lancée. Le texte doit apparaître automatiquement dans cette zone.");
  status("Facture importée : extraction du texte en cours...");
 });
 document.addEventListener("invoice-pdf:partial",e=>{
  const text=String(e.detail?.text||"");
  if(text){$("sourceText").value=text;extractionStatus("Texte extrait : "+text.length+" caractères · page "+(e.detail?.page||"?")+"/"+(e.detail?.total||"?")+". Lecture en cours...");}
 });
 document.addEventListener("invoice-pdf:transcribed",e=>{
  const text=String(e.detail?.text||"");
  $("sourceText").value=text;
  detectSupplier(text);
  if(!text.trim()){
   extractionStatus("Aucun texte extrait. Cliquez sur « Forcer OCR (PDF scanné) ». Si cela échoue, le détail de l’erreur sera affiché.",true);
   status("PDF sans texte exploitable. Utilisez « Forcer OCR » ou collez la transcription manuellement.",true);return;
  }
  extractionStatus("Transcription visible : "+text.length+" caractères, "+(e.detail?.pages?.length||0)+" page(s). Vérifiez le texte avant validation.");
  applyTranscription(text,"PDF");
 });
 document.addEventListener("invoice-pdf:error",e=>{
  const message=String(e.detail?.message||"Erreur de transcription inconnue");
  extractionStatus("Impossible de transcrire automatiquement : "+message,true);
  status("Erreur de lecture PDF : "+message+" · Vous pouvez toujours coller le texte manuellement.",true);
 });
 $("supplierMatch").onchange=()=>{$("supplierMatch").dataset.auto="false";records.forEach(r=>{r.verified=false;r.product_id=""});render()};
 render();loadCatalog();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();