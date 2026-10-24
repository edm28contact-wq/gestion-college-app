(()=>{
"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-ocr-learning",KEY="college_ocr_learning_v1";
let db=null,supplier="",proposed=[];
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens=()=>["college_accounting_token","college_secretariat_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
function detect(pages){
 if(!db)return null;
 const text=norm(pages.map(x=>x.text).join(" ").slice(0,12000));
 const candidates=[];
 for(const p of db.profiles||[]){
  const names=[p.supplier_name,...(p.aliases||[])].filter(x=>String(x||"").length>=5);
  const exact=names.some(name=>text.includes(norm(name)));
  const signature=(p.strong_text_signatures||[]).filter(x=>norm(x).length>=9&&text.includes(norm(x))).length;
  if(exact||signature>=2)candidates.push({name:p.supplier_name,key:p.supplier_key,score:(exact?10:0)+Math.min(signature,3)});
 }
 candidates.sort((a,b)=>b.score-a.score);
 return candidates.length&&(!candidates[1]||candidates[0].score>candidates[1].score)?candidates[0]:null;
}
function suggested(pages,key){
 if(!db||!key)return[];
 const pairs=(db.corrections||[]).filter(x=>norm(x.supplier_key)===norm(key));
 const found=[];
 pages.forEach(p=>{
  const lines=p.text.split(/\r?\n/);
  lines.forEach((raw,i)=>{
   for(const pair of pairs){
    if(!pair.source_token||/[0-9]/.test(pair.source_token+pair.corrected_token))continue;
    const at=norm(raw).indexOf(norm(pair.source_token));
    if(at<0)continue;
    found.push({page:p.number,line:i+1,source:pair.source_token,replacement:pair.corrected_token,original:raw});
   }
  });
 });
 return found.slice(0,60);
}
async function load(){
 let error="";
 for(const token of tokens())try{
  const res=await fetch(API,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!res.ok){error="HTTP "+res.status;continue}
  const item=await res.json();
  if(!Array.isArray(item.profiles)||!Array.isArray(item.history))throw Error("Réponse invalide");
  db=item;try{localStorage.setItem(KEY,JSON.stringify(item))}catch{}
  updateLabel("Apprentissage connecté : "+item.profiles.length+" profils fournisseurs, "+item.history.length+" libellés fréquents.");
  return true;
 }catch(e){error=e.message}
 try{const cached=JSON.parse(localStorage.getItem(KEY)||"null");if(cached?.profiles){db=cached;updateLabel("Apprentissage local disponible (Supabase indisponible).");return true}}catch{}
 updateLabel("Apprentissage indisponible : "+error);return false;
}
function updateLabel(s){const el=document.getElementById("learningState");if(el)el.textContent=s}
function process(pages){
 if(!db)return;
 const hit=detect(pages);
 const entry=document.getElementById("supplierMatch");
 if(hit&&entry&&!entry.value.trim()){
  entry.value=hit.name;supplier=hit.key;
  entry.dispatchEvent(new Event("change",{bubbles:true}));
  updateLabel("Fournisseur proposé d'après les profils : "+hit.name+" — à vérifier.");
 }else supplier=entry?.value||"";
 proposed=suggested(pages,supplier);
 const list=document.getElementById("learningSuggestions");if(!list)return;
 list.replaceChildren();
 const note=document.createElement("div");note.textContent=proposed.length+" suggestion(s) lexicales enregistrées. Aucune correction automatique des chiffres.";list.append(note);
 for(const x of proposed){
  const item=document.createElement("div");item.textContent="Page "+x.page+" : « "+x.source+" » → « "+x.replacement+" » ";
  const button=document.createElement("button");button.type="button";button.textContent="Appliquer";
  button.onclick=()=>{
   const sourcePages=window.InvoiceReader?.pages?.()||[];
   const p=sourcePages.find(t=>t.number===x.page);
   if(!p)return;
   const lines=p.text.split(/\r?\n/),old=lines[x.line-1]||"";
   if(!old.includes(x.source)){updateLabel("Texte modifié depuis la proposition. Relecture nécessaire.");return;}
   lines[x.line-1]=old.split(x.source).join(x.replacement);
   window.InvoiceReader?.setPageText?.(x.page,lines.join("\n"));
   button.disabled=true;updateLabel("Correction lexicale appliquée. Reclasser les produits pour mettre le tableau à jour.");
  };
  item.append(button);list.append(item);
 }
}
document.addEventListener("invoice-reader:ready",e=>{if(db)process(e.detail.pages);else load().then(ok=>{if(ok)process(window.InvoiceReader?.pages?.()||e.detail.pages)})});
document.addEventListener("DOMContentLoaded",()=>{load();document.getElementById("learningRefresh")?.addEventListener("click",()=>{load().then(ok=>{if(ok)process(window.InvoiceReader?.pages?.()||[])})})});
window.InvoiceLearning={refresh:()=>load(),process};
})();