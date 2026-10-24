(()=>{
"use strict";
const $=id=>document.getElementById(id),C=window.InvoiceTableurCore;
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
let catalog=null,records=[],ignored=[],unresolved=[],summary=null;
const tokens=()=>["college_accounting_token","college_secretariat_token","college_admin_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
function status(message,error=false){$("status").textContent=message;$("status").className="status"+(error?" err":"")}
async function loadCatalog(){
 for(const token of tokens()){
  try{const res=await fetch(API,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)});if(!res.ok)continue;const data=await res.json();if(data.read_only===true&&Array.isArray(data.products)){catalog=data;status("Catalogue synchronisé : "+data.products.length+" produits. Aucun stock n'est modifié.");render();return;}}catch{}
 }
 status("Catalogue non connecté. Vous pouvez nettoyer la transcription et remplir le tableau, puis vous connecter à la comptabilité pour associer les produits.",true);
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
   input.setAttribute("aria-label",field+" ligne "+(index+1));input.addEventListener("change",()=>{r[field]=input.value;r.verified=false;render()});td.append(input);tr.append(td);
  }
  const td=make("td"),selector=make("select");
  selector.style.minWidth="240px";selector.append(make("option","À associer"));selector.firstChild.value="";
  for(const p of products){const o=make("option",p.code+" — "+p.name);o.value=p.id;selector.append(o)}
  selector.value=productId;
  selector.onchange=()=>{r.product_id=selector.value;r.verified=false;render()};
  td.append(selector,make("small",r.product_id?"Sélection manuelle":match.source));tr.append(td);
  const valid=make("td",(test.ok?"HT cohérent":"À vérifier : "+test.text)+(r.needs_review?" · Ligne recomposée : vérifier la désignation":""));valid.className=test.ok&&!r.needs_review?"ok":"err";tr.append(valid);
  const checkTd=make("td"),check=make("input");check.type="checkbox";check.checked=!!r.verified;check.disabled=!test.ok||!productId;
  check.title=r.needs_review?"Vérifiez la désignation recomposée sur la facture, puis confirmez la ligne":"Confirmer la ligne";check.onchange=()=>{r.verified=check.checked;render()};checkTd.append(check);tr.append(checkTd);
  const action=make("td"),remove=make("button","Retirer");remove.className="btn";remove.onclick=()=>{records.splice(index,1);render()};action.append(remove);tr.append(action);body.append(tr);
  if(productId)associated++;if(r.verified&&test.ok&&productId)verified++;
 }
 $("metrics").textContent=records.length+" lignes produits · "+associated+" associées · "+verified+" vérifiées · "+ignored.length+" lignes inutiles écartées";
 const total=records.reduce((sum,r)=>sum+(C.decimal(r.total_ht)||0),0);
 const target=summary?.expected_ht;
 $("invoiceTotals").textContent="Total HT des lignes : "+total.toFixed(2)+" €"+(target!==null&&target!==undefined?" · Total facture : "+Number(target).toFixed(2)+" € · Écart : "+(Math.round((total-target)*100)/100).toFixed(2)+" €":" · Total HT facture non détecté")+(summary?.expected_vat!=null?" · TVA : "+Number(summary.expected_vat).toFixed(2)+" €":"")+(summary?.expected_ttc!=null?" · TTC : "+Number(summary.expected_ttc).toFixed(2)+" €":"");
 $("invoiceTotals").className=target!=null&&Math.abs(total-target)>.02?"err":"ok";
 $("cleanText").value=C.format(records);
 $("ignoredCount").textContent=ignored.length+" lignes écartées · "+unresolved.length+" fragments non résolus";
 $("ignoredList").value=[...unresolved.map(x=>"À RÉPARER — ligne "+x.line+" : "+x.text+" ("+x.reason+")"),...ignored.map(x=>"Ligne "+x.line+" : "+x.text)].join("\n");
 $("exportRows").disabled=!records.length;
}
function analyze(){
 const result=C.parse($("sourceText").value);
 if(result.error){status(result.error,true);return}
 if(records.length&&!confirm("Remplacer les "+records.length+" lignes du tableau actuel ?"))return;
 records=result.rows.map(r=>({...r,product_id:"",verified:false}));
 ignored=result.ignoredLines||[];unresolved=result.unresolvedLines||[];summary=result.meta||null;
 status("Transcription nettoyée ("+(summary?.layout||"classique")+") : "+records.length+" produit(s), "+(summary?.reconstructed||0)+" ligne(s) recomposée(s), "+unresolved.length+" fragment(s) non résolu(s)."+(summary?.reconciled===true?" Total HT de la facture retrouvé.":" Vérifiez les montants et les associations."));
 render();
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
function boot(){
 $("analyze").onclick=analyze;$("exportRows").onclick=exportTsv;$("refreshCatalog").onclick=loadCatalog;
 $("clear").onclick=()=>{if(records.length&&!confirm("Effacer la transcription et le tableau ?"))return;$("sourceText").value="";records=[];ignored=[];unresolved=[];summary=null;render();status("Saisie vidée.")};
 document.addEventListener("invoice-pdf:replace",()=>{$("sourceText").value="";records=[];ignored=[];unresolved=[];summary=null;render();status("Facture importée : extraction du texte en cours...")});
 document.addEventListener("invoice-pdf:partial",e=>{const text=String(e.detail?.text||"");if(text)$("sourceText").value=text;});
 document.addEventListener("invoice-pdf:transcribed",e=>{
  const text=String(e.detail?.text||"");if(!text.trim()){status("PDF sans texte exploitable. Utilisez « Forcer OCR » ou saisissez le texte manuellement.",true);return}
  $("sourceText").value=text;
  const result=C.parse(text);
  if(result.error){status("Transcription affichée, mais aucune ligne complète détectée. Corrigez le texte puis cliquez sur « Nettoyer et repérer les produits ».",true);return}
  records=result.rows.map(r=>({...r,product_id:"",verified:false}));
  ignored=result.ignoredLines||[];unresolved=result.unresolvedLines||[];summary=result.meta||null;
  render();
  status("PDF transcrit : "+(e.detail?.pages?.length||0)+" page(s), "+records.length+" produit(s) détecté(s). Vérifiez le texte et les montants avant de valider.");
 });
 $("supplierMatch").onchange=()=>{records.forEach(r=>{r.verified=false;r.product_id=""});render()};
 render();loadCatalog();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();