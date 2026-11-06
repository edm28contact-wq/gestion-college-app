/* Admin Collège: exact supplier invoice designations stored in existing secured alias catalog. */
(function(){
"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/product-alias-keywords";
const clean=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const escapeText=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentAliases=[],loadedProductId="",searchSerial=0;
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
  const verified=(result.verified_mappings||[]).filter(a=>a.product_id===id&&Number(a.verification_count||0)>0);
  box.replaceChildren();
  if(!currentAliases.length&&!verified.length){box.textContent="Aucune désignation ni référence fournisseur enregistrée pour ce produit.";return}
  const heading=document.createElement("strong");
  heading.textContent=currentAliases.length+" identifiant(s) saisi(s) · "+verified.length+" correspondance(s) vérifiée(s)";
  box.append(heading);
  for(const alias of currentAliases){
   const row=document.createElement("div");row.className="invoice-alias-row";
   const info=document.createElement("div");
   const supplier=document.createElement("strong");supplier.textContent=alias.supplier_key||"Fournisseur non spécifié";
   const name=document.createElement("p");name.textContent=(alias.alias_kind==="reference"?"Référence : ":"Désignation : ")+alias.keyword;
   info.append(supplier,name);
   const button=document.createElement("button");button.type="button";button.className="btn secondary compact";
   button.textContent="Supprimer";button.addEventListener("click",()=>remove(alias.id,id,alias.keyword));
   row.append(info,button);box.append(row);
  }
  for(const item of verified){
   const row=document.createElement("div");row.className="invoice-alias-row";
   const info=document.createElement("div");const supplier=document.createElement("strong");supplier.textContent=item.supplier_name||item.supplier_key||"Fournisseur";
   const name=document.createElement("p");name.textContent="Référence vérifiée : "+(item.supplier_reference||"non renseignée")+(item.supplier_label?" · "+item.supplier_label:"");
   info.append(supplier,name);row.append(info);box.append(row);
  }
 }catch(error){status(error.message,true);box.textContent="Impossible de charger les désignations."}
}
async function save(id,supplier,label,aliasKind="designation"){
 const productId=String(id||"");
 const keyword=String(label||"").replace(/\s+/g," ").trim();
 const supplierKey=clean(supplier);
 if(!/^[0-9a-f-]{36}$/i.test(productId))throw Error("Produit non enregistré : enregistrez d’abord sa fiche.");
 if(!supplierKey||supplierKey.length<3)throw Error("Renseignez le fournisseur de cette désignation.");
 if(!["designation","reference"].includes(aliasKind))throw Error("Type d’identifiant invalide.");
 const max=aliasKind==="reference"?100:160;
 if(keyword.length<3||keyword.length>max)throw Error("Identifiant fournisseur : 3 à "+max+" caractères requis.");
 const result=await fetchAlias("POST",{product_id:productId,keyword,supplier_key:supplierKey,alias_kind:aliasKind});
 return result.alias;
}
async function saveDetails(id,supplier,label,reference){
 if(!String(label||"").trim()&&!String(reference||"").trim())return 0;
 if(!String(supplier||"").trim())throw Error("Indiquez le fournisseur.");
 let count=0;
 try{
  if(String(label||"").trim()){await save(id,supplier,label,"designation");count++}
  if(String(reference||"").trim()){await save(id,supplier,reference,"reference");count++}
 }catch(e){throw Error((count?count+" identifiant(s) déjà enregistré(s). ":"")+e.message)}
 return count;
}
async function add(id){
 const btn=document.querySelector(".invoice-alias-actions button");if(btn)btn.disabled=true;
 try{
  const supplier=document.getElementById("pSupplierName")?.value||"";
  const label=document.getElementById("pInvoiceLabel")?.value||"";
  const reference=document.getElementById("pInvoiceReference")?.value||"";
  const count=await saveDetails(id,supplier,label,reference);
  if(!count)throw Error("Saisissez une désignation ou une référence fournisseur.");
  document.getElementById("pInvoiceLabel").value="";
  document.getElementById("pInvoiceReference").value="";
  status(count+" identifiant(s) enregistré(s) pour Veryfi.");
  await load(id);await refreshSearch();
 }catch(e){status(e.message,true)}finally{if(btn)btn.disabled=false}
}
async function refreshSearch(){
 const serial=++searchSerial;
 const rows=[...document.querySelectorAll("#productRows tr[data-product-id]")];
 if(!rows.length)return;
 try{
  const result=await fetchAlias();
  if(serial!==searchSerial)return;
  const searchByProduct=new Map();
  for(const item of result.aliases||[]){
   const values=searchByProduct.get(item.product_id)||[];
   values.push(item.supplier_key,item.keyword);searchByProduct.set(item.product_id,values);
  }
  for(const item of result.verified_mappings||[]){
   const values=searchByProduct.get(item.product_id)||[];
   values.push(item.supplier_key,item.supplier_name,item.supplier_reference,item.supplier_label);
   searchByProduct.set(item.product_id,values);
  }
  for(const row of rows){
   if(!row.isConnected)continue;
   const text=(row.dataset.baseSearch+" "+(searchByProduct.get(row.dataset.productId)||[]).filter(Boolean).join(" "));
   row.dataset.search=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  }
  window.filterProducts?.();
 }catch(error){
  const box=document.getElementById("pageStatus");
  if(box){box.className="status err";box.textContent="Recherche des identifiants fournisseur indisponible : "+error.message}
 }
}
async function remove(id,productId,label){
 if(!confirm("Supprimer la désignation fournisseur « "+label+" » ? Le produit et son stock seront conservés."))return;
 try{await fetchAlias("DELETE",{id});status("Identifiant fournisseur supprimé.");await load(productId);await refreshSearch()}
 catch(error){status(error.message,true)}
}
window.saveProductInvoiceAlias=save;
window.saveProductInvoiceDetails=saveDetails;
window.refreshSupplierProductSearch=refreshSearch;
window.addProductInvoiceAlias=add;
window.loadProductInvoiceAliases=load;
})();