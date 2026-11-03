(()=>{
"use strict";
const $=id=>document.getElementById(id),btn=$("veryfiRead"),label=$("veryfiStatus");
if(!btn||!label)return;
const endpoint="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-veryfi-reader";
const tokens=()=>["college_secretariat_token","college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean);
let busy=false,selectedFile=null,seq=0;
function status(message,bad=false){label.textContent=message;label.className=(bad?"err ":"")+"muted";}
const short=val=>String(val==null?"":val).trim();
function normalizeDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(short(v))?short(v):""}
async function request(method,payload){
 let forbidden=false;
 for(const token of tokens()){
  const res=await fetch(endpoint,{method,headers:{"x-admin-session":token,...(method==="POST"?{"content-type":"application/json"}:{})},body:method==="POST"?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(70000),cache:"no-store"});
  const data=await res.json().catch(()=>({error:"Réponse serveur invalide"}));
  if(res.status===401||res.status===403){forbidden=true;continue}
  if(!res.ok||data.ok!==true)throw Error(data.error||"Échec de Veryfi");
  return data;
 }
 throw Error(forbidden?"Session sans autorisation Veryfi : reconnectez-vous.":"Connexion au collège requise.");
}
function b64(bytes){
 const chunks=[];for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
 return btoa(chunks.join(""));
}
async function configured(){
 if(!tokens().length)return status("Connectez-vous au collège pour activer Veryfi.",true);
 try{const v=await request("GET");status(v.configured?"Veryfi prêt. La lecture cloud démarre uniquement après votre clic.":"Veryfi non configuré : identifiants API manquants sur Supabase.",!v.configured)}
 catch(e){status(e?.message||String(e),true)}
}
btn.onclick=async()=>{
 const file=$("invoicePdf")?.files?.[0];
 if(!file)return status("Importez d’abord un PDF.",true);
 if(file.size>6*1024*1024)return status("Veryfi accepte ici les PDF de 6 Mo maximum. L’OCR local reste disponible.",true);
 if(busy)return;
 if(!confirm("Envoyer ce PDF à Veryfi pour analyse ? Cette opération utilise un service externe et peut être facturée selon votre abonnement. Aucun stock ne sera modifié."))return;
 busy=true;const current=++seq,source=file;btn.disabled=true;status("Analyse Veryfi en cours…");
 try{
  const data=await request("POST",{file_name:file.name,file_data:b64(new Uint8Array(await file.arrayBuffer()))});
  if(current!==seq||$("invoicePdf")?.files?.[0]!==source)return status("Résultat ancien ignoré : le PDF a changé.",true);
  document.dispatchEvent(new CustomEvent("invoice-veryfi:result",{detail:data.result}));
  status("Lecture Veryfi terminée : "+(data.result?.item_count||0)+" ligne(s) structurée(s). Vérifiez les références, quantités et montants avant validation.");
 }catch(e){status("Veryfi indisponible : "+(e?.message||String(e))+". L’OCR local et la saisie manuelle restent accessibles.",true)}
 finally{busy=false;btn.disabled=false}
};
document.addEventListener("invoice-pdf:replace",()=>{seq++;selectedFile=null;status("PDF chargé. Vous pouvez lancer Veryfi ou conserver l’OCR local.")});
document.addEventListener("invoice-pdf:reset-after-success",()=>{seq++;status("Facture suivante : importez le nouveau PDF.")});
configured();
})();
