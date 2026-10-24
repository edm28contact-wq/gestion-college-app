(()=>{
"use strict";
const $=id=>document.getElementById(id),C=window.InvoiceTableurCore;
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
let catalog=null,records=[],ignored=[];
const tokens=()=>["college_accounting_token","college_secretariat_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
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
  for(const [field,width] of [["reference",100],["designation",270],["quantity",74],["unit",80],["vat",65],["unit_price_ht",85],["total_ht",95]]){
   const td=make("td"),input=make("input");input.value=r[field]??"";input.style.width=width+"px";
   input.setAttribute("aria-label",field+" ligne "+(index+1));input.addEventListener("change",()=>{r[field]=input.value;r.verified=false;render()});td.append(input);tr.append(td);
  }
  const td=make("td"),selector=make("select");
  selector.style.minWidth="240px";selector.append(make("option","À associer"));selector.firstChild.value="";
  for(const p of products){const o=make("option",p.code+" — "+p.name);o.value=p.id;selector.append(o)}
  selector.value=productId;
  selector.onchange=()=>{r.product_id=selector.value;r.verified=false;render()};
  td.append(selector,make("small",r.product_id?"Sélection manuelle":match.source));tr.append(td);
  const valid=make("td",test.ok?"Montant HT cohérent":"À vérifier : "+test.text);valid.className=test.ok?"ok":"err";tr.append(valid);
  const checkTd=make("td"),check=make("input");check.type="checkbox";check.checked=!!r.verified;check.disabled=!test.ok||!productId;
  check.title="Confirmer la ligne";check.onchange=()=>{r.verified=check.checked;render()};checkTd.append(check);tr.append(checkTd);
  const action=make("td"),remove=make("button","Retirer");remove.className="btn";remove.onclick=()=>{records.splice(index,1);render()};action.append(remove);tr.append(action);body.append(tr);
  if(productId)associated++;if(r.verified&&test.ok&&productId)verified++;
 }
 $("metrics").textContent=records.length+" lignes produits · "+associated+" associées · "+verified+" vérifiées · "+ignored.length+" lignes inutiles écartées";
 $("cleanText").value=C.format(records);
 $("ignoredCount").textContent=ignored.length+" lignes écartées";
 $("ignoredList").value=ignored.map(x=>"Ligne "+x.line+" : "+x.text).join("\n");
 $("exportRows").disabled=!records.length;
}
function analyze(){
 const result=C.parse($("sourceText").value);
 if(result.error){status(result.error,true);return}
 if(records.length&&!confirm("Remplacer les "+records.length+" lignes du tableau actuel ?"))return;
 records=result.rows.map(r=>({...r,product_id:"",verified:false}));
 ignored=result.ignoredLines||[];
 status("Transcription nettoyée : "+records.length+" ligne(s) de produit détectée(s) et "+ignored.length+" ligne(s) écartée(s). Vérifiez les associations.");
 render();
}
function exportTsv(){
 const selected=records.filter(r=>r.verified).map(r=>{const p=(catalog?.products||[]).find(x=>x.id===(r.product_id||C.match(r,catalog,$("supplierMatch").value).product?.id));return {r,p}});
 if(!selected.length){status("Cochez les produits vérifiés avant l’export.",true);return}
 const header=["Réf. fournisseur","Désignation fournisseur","Quantité","Unité","TVA %","PU HT","Total HT","Code produit","Nom produit"];
 const safe=x=>{let v=String(x??"").replace(/[\t\r\n]+/g," ");return /^[=+@-]/.test(v)?"'"+v:v};
 const tsv=[header.join("\t"),...selected.map(({r,p})=>[r.reference,r.designation,r.quantity,r.unit,r.vat,r.unit_price_ht,r.total_ht,p?.code||"",p?.name||""].map(safe).join("\t"))].join("\n");
 const link=make("a");const url=URL.createObjectURL(new Blob([tsv],{type:"text/tab-separated-values;charset=utf-8"}));link.href=url;link.download="facture_produits_verifies.tsv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
 status("Export effectué : "+selected.length+" produits vérifiés. Aucun stock ni aucune facture enregistrés.");
}
function boot(){
 $("analyze").onclick=analyze;$("exportRows").onclick=exportTsv;$("refreshCatalog").onclick=loadCatalog;
 $("clear").onclick=()=>{if(records.length&&!confirm("Effacer la transcription et le tableau ?"))return;$("sourceText").value="";records=[];ignored=[];render();status("Saisie vidée.")};
 $("supplierMatch").onchange=()=>{records.forEach(r=>{r.verified=false;r.product_id=""});render()};
 render();loadCatalog();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();