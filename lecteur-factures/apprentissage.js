(()=>{
"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-ocr-learning",KEY="college_ocr_learning_v1";
let db=null,supplier="",proposed=[];
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens=()=>["college_accounting_token","college_secretariat_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
function detect(pages){
 if(!db||!pages?.length)return null;
 const compact=value=>norm(value).replace(/\s+/g,"");
 const full=compact(pages.map(p=>p.text||"").join(" ").slice(0,16000));
 const header=compact(String(pages[0].text||"").split(/\r?\n/).slice(0,45).join(" ").slice(0,3500));
 const candidates=[];
 for(const p of db.profiles||[]){
  const names=[p.supplier_name,...(p.aliases||[])].filter(x=>compact(x).length>=8);
  let score=0;
  for(const name of names){
   const v=compact(name),idx=header.indexOf(v);
   if(idx>=0)score=Math.max(score,200+Math.min(v.length,25)-Math.min(100,idx/30));
   else if(full.includes(v))score=Math.max(score,40+Math.min(v.length,25));
  }
  const signatures=(p.strong_text_signatures||[]).filter(v=>compact(v).length>=24&&full.includes(compact(v)));
  if(score===0&&signatures.length>0)score=10+Math.min(signatures.length,2);
  if(score>0)candidates.push({name:p.supplier_name,key:p.supplier_key,score});
 }
 candidates.sort((a,b)=>b.score-a.score);
 if(!candidates.length||candidates[0].score<40)return null;
 if(candidates[1]&&candidates[0].score-candidates[1].score<8)return null;
 return candidates[0];
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

async function fingerprint(){
 const file=window.InvoiceReader?.file?.();if(!file)return "";
 const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function sendLearning(action,product_ids=[]){
 const file_hash=await fingerprint();if(!file_hash)return;
 const pages=window.InvoiceReader?.pages?.()||[];
 const supplier_name=document.getElementById("supplierMatch")?.value?.trim()||"";
 if(!supplier_name)return updateLabel("Apprentissage en attente : fournisseur à identifier.");
 const raw=pages.map(p=>p.text).join("\n");
 const observed=(db?.secretariat||[]).flatMap(p=>p.known_product_codes||[]).filter(code=>code&&raw.includes(code));
 const payload={action,file_hash,supplier_key:norm(supplier_name),supplier_name,page_count:pages.length,ocr_page_count:pages.filter(p=>p.source==="OCR").length,product_codes:observed.slice(0,100),product_ids};
 for(const token of tokens())try{
  const r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  if(!r.ok)continue;
  const x=await r.json();updateLabel(action==="observe"?(x.duplicate?"Facture déjà connue : apprentissage conservé.":"Facture mémorisée pour les prochaines lectures."):"Produits vérifiés enregistrés dans l'apprentissage.");return x;
 }catch{}
 updateLabel("Apprentissage non synchronisé : réessayez après reconnexion.");
}
document.addEventListener("invoice-reader:ready",()=>{setTimeout(()=>{void sendLearning("observe")},800)});
document.getElementById("supplierMatch")?.addEventListener("change",()=>{if(window.InvoiceReader?.pages?.()?.length){process(window.InvoiceReader.pages());void sendLearning("observe");}});
document.addEventListener("invoice-learning:confirm",e=>{void (async()=>{await sendLearning("observe");await sendLearning("confirm",e.detail?.product_ids||[]);})();});
window.InvoiceLearning={refresh:()=>load(),process,observe:()=>sendLearning("observe")};
})();