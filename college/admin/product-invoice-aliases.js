/* Admin Collège: exact supplier invoice designations stored in existing secured alias catalog. */
(function(){
"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/product-alias-keywords";
const clean=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const escapeText=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentAliases=[],loadedProductId="";
async function fetchAlias(method="GET",body){
 const response=await fetch(API,{method,headers:{"content-type":"application/json","x-admin-session":token},body:body?JSON.stringify(body):undefined,cache:"no-store"});
 const result=await response.json().catch(()=>({error:"Réponse invalide du service des désignations"}));
 if(!response.ok)throw Error(result.error||"Enregistrement de la désignation impossible");
 return result;
}
function status(message,error=false){
 const element=document.getElementById("invoiceAliasStatus");
 if(element){element.textContent=message;element.className="status "+(error?"err":"ok")}
}
async function load(id){
 loadedProductId=id;
 const box=document.getElementById("productInvoiceAliases");
 if(!box)return;
 box.textContent="Chargement des désignations fournisseur…";
 try{
  const result=await fetchAlias();
  if(loadedProductId!==id||!document.getElementById("productInvoiceAliases"))return;
  currentAliases=(result.aliases||[]).filter(a=>a.product_id===id);
  box.replaceChildren();
  if(!currentAliases.length){box.textContent="Aucune désignation de facture enregistrée pour ce produit.";return}
  const heading=document.createElement("strong");
  heading.textContent=currentAliases.length+" désignation(s) enregistrée(s)";
  box.append(heading);
  for(const alias of currentAliases){
   const row=document.createElement("div");row.className="invoice-alias-row";
   const info=document.createElement("div");
   const supplier=document.createElement("strong");supplier.textContent=alias.supplier_key||"Fournisseur non spécifié";
   const name=document.createElement("p");name.textContent=alias.keyword;
   info.append(supplier,name);
   const button=document.createElement("button");button.type="button";button.className="btn secondary compact";
   button.textContent="Supprimer";button.addEventListener("click",()=>remove(alias.id,id,alias.keyword));
   row.append(info,button);box.append(row);
  }
 }catch(error){status(error.message,true);box.textContent="Impossible de charger les désignations."}
}
async function save(id,supplier,label){
 const productId=String(id||"");
 const keyword=String(label||"").replace(/\s+/g," ").trim();
 const supplierKey=clean(supplier);
 if(!/^[0-9a-f-]{36}$/i.test(productId))throw Error("Produit non enregistré : enregistrez d’abord sa fiche.");
 if(!supplierKey||supplierKey.length<3)throw Error("Renseignez le fournisseur de cette désignation.");
 if(keyword.length<3||keyword.length>160)throw Error("Le libellé doit contenir entre 3 et 160 caractères.");
 const result=await fetchAlias("POST",{product_id:productId,keyword,supplier_key:supplierKey});
 return result.alias;
}
async function add(id){
 const btn=document.querySelector(".invoice-alias-actions button");
 if(btn)btn.disabled=true;
 try{
  const supplier=document.getElementById("pSupplierName")?.value||"";
  const label=document.getElementById("pInvoiceLabel")?.value||"";
  await save(id,supplier,label);
  document.getElementById("pInvoiceLabel").value="";
  status("Désignation fournisseur enregistrée et disponible pour le lecteur Veryfi.");
  await load(id);
 }catch(error){status(error.message,true)}
 finally{if(btn)btn.disabled=false}
}
async function remove(id,productId,label){
 if(!confirm("Supprimer la désignation fournisseur « "+label+" » ? Le produit et son stock seront conservés."))return;
 try{await fetchAlias("DELETE",{id});status("Désignation supprimée.");await load(productId)}
 catch(error){status(error.message,true)}
}
window.saveProductInvoiceAlias=save;
window.addProductInvoiceAlias=add;
window.loadProductInvoiceAliases=load;
})();