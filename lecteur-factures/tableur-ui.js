(()=>{
"use strict";
const $=id=>document.getElementById(id),C=window.InvoiceTableurCore;
let records=[];
function cell(parent,tag,text){const x=document.createElement(tag);x.textContent=String(text??"");parent.append(x);return x}
function render(){
 const body=$("tableurBody");if(!body)return;body.replaceChildren();
 const suppliers=$("supplierMatch")?.value||"",catalog=window.InvoiceManualCatalog?.()||null;
 let matched=0,valid=0;
 for(const [idx,r] of records.entries()){
  const tr=document.createElement("tr");
  const input=(key,width=100)=>{const td=document.createElement("td"),i=document.createElement("input");i.value=String(r[key]??"");i.style.width=width+"px";i.setAttribute("aria-label",key);i.addEventListener("change",()=>{r[key]=i.value;r.accepted=false;render()});td.append(i);tr.append(td)};
  input("reference",105);input("designation",310);input("quantity",73);input("unit",85);input("vat",65);input("unit_price_ht",85);input("total_ht",95);
  const result=C.match(r,catalog,suppliers),control=C.check(r);r.match=result;
  const td=document.createElement("td");
  const select=document.createElement("select");select.style.maxWidth="280px";
  const none=document.createElement("option");none.value="";none.textContent="À rapprocher";select.append(none);
  const all=(catalog?.products||[]).filter(p=>p.active!==false);
  const options=result.product?[result.product]:result.suggestions||[];
  const candidates=[...new Map([...options,...all].map(p=>[p.id,p])).values()];
  for(const p of candidates){const option=document.createElement("option");option.value=p.id;option.textContent=p.code+" — "+p.name;select.append(option)}
  const chosen=r.product_id||result.product?.id||"";
  select.value=chosen;select.addEventListener("change",()=>{r.product_id=select.value;r.accepted=false;render()});td.append(select);
  const note=document.createElement("div");note.className="muted";note.textContent=r.product_id?"Produit choisi manuellement":result.source;td.append(note);tr.append(td);
  const status=document.createElement("td");status.textContent=(control.ok?"HT correct":"HT incohérent")+" · "+(chosen?"Produit associé":"Produit inconnu");tr.append(status);
  const action=document.createElement("td");const box=document.createElement("input");box.type="checkbox";box.checked=!!r.accepted;box.disabled=!chosen||!control.ok;box.setAttribute("aria-label","Confirmer "+r.reference);box.addEventListener("change",()=>{r.accepted=box.checked;render()});action.append(box);tr.append(action);
  const remove=document.createElement("td");const btn=document.createElement("button");btn.className="btn";btn.textContent="Retirer";btn.onclick=()=>{records.splice(idx,1);render()};remove.append(btn);tr.append(remove);body.append(tr);
  if(chosen)matched++;if(r.accepted&&chosen&&control.ok)valid++;
 }
 $("tableurCount").textContent=records.length+" ligne(s) détectée(s) · "+matched+" associée(s) · "+valid+" confirmée(s)";
 $("tableurTransfer").disabled=valid===0;
}
function parse(){
 if(!C)return $("tableurStatus").textContent="Module de saisie indisponible.";
 const source=$("tableurPaste").value,result=C.parse(source);
 if(result.error){$("tableurStatus").textContent=result.error;return}
 records=result.rows.map(r=>({...r,accepted:false,product_id:""}));
 $("tableurStatus").textContent=records.length+" ligne(s) trouvée(s), "+result.ignored+" ligne(s) ignorée(s) (titres, expédition, notes). Vérifiez les associations et les calculs.";
 render();
}
function importRows(){
 const catalog=window.InvoiceManualCatalog?.();if(!catalog){$("tableurStatus").textContent="Catalogue indisponible : reconnectez-vous.";return}
 const rows=records.filter(r=>r.accepted).map(r=>{
  const hit=r.match,product=(catalog.products||[]).find(p=>p.id===(r.product_id||hit?.product?.id));
  if(!product||!C.check(r).ok)return null;
  return {product_id:product.id,product_code:product.code,source_reference:r.reference,raw:[r.reference,r.designation,r.quantity,r.unit,r.vat,r.unit_price_ht,r.total_ht].join(" "),qty:r.quantity,unit:r.unit_price_ht,ht:r.total_ht,vat:r.vat,unit_label:r.unit,match_source:r.product_id?"Tableur : association confirmée":"Tableur : "+hit.source};
 }).filter(Boolean);
 if(!rows.length)return;
 document.dispatchEvent(new CustomEvent("invoice-tableur:import",{detail:{rows}}));
 $("tableurStatus").textContent=rows.length+" ligne(s) transférée(s) vers Produits. Contrôlez les comptes et validez dans le tableau de rapprochement.";
}
function boot(){
 $("tableurAnalyze")?.addEventListener("click",parse);
 $("tableurTransfer")?.addEventListener("click",importRows);
 $("tableurClear")?.addEventListener("click",()=>{$("tableurPaste").value="";records=[];render();$("tableurStatus").textContent="Saisie vidée."});
 $("supplierMatch")?.addEventListener("change",()=>{records.forEach(r=>{r.accepted=false;r.product_id=""});render()});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();