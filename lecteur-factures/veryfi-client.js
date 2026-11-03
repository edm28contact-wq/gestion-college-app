(()=>{
"use strict";
const $=id=>document.getElementById(id),btn=$("veryfiRead"),label=$("veryfiStatus");
if(!btn||!label)return;
const endpoint="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-veryfi-reader";
const tokens=()=>[...new Set(["college_secretariat_token","college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"].map(k=>localStorage.getItem(k)).filter(Boolean))];
let busy=false,selectedFile=null,seq=0,ready=false,activeToken=null,checking=false;
const accountPage=location.pathname.includes("/lecteur-comptabilite/");
const loginLink=document.createElement("a");
loginLink.href=accountPage?"../comptabilite/?return=veryfi":"../secretariat/?return=veryfi";
loginLink.target="_blank";
loginLink.rel="noopener";
loginLink.textContent=accountPage?"Se connecter à la Comptabilité":"Se connecter au Secrétariat";
loginLink.className="btn";
loginLink.style.marginLeft="8px";
loginLink.style.display="none";
label.after(loginLink);
function status(message,bad=false){label.textContent=message;label.className=(bad?"err ":"")+"muted";}
const short=val=>String(val==null?"":val).trim();
function normalizeDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(short(v))?short(v):""}
async function request(method,payload){
 let forbidden=false;
 for(const token of method==="POST"&&activeToken?[activeToken]:tokens()){
  const res=await fetch(endpoint,{method,headers:{"x-admin-session":token,...(method==="POST"?{"content-type":"application/json"}:{})},body:method==="POST"?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(70000),cache:"no-store"});
  const data=await res.json().catch(()=>({error:"Réponse serveur invalide"}));
  if(res.status===401||res.status===403){forbidden=true;continue}
  if(!res.ok||data.ok!==true)throw Error(data.error||"Échec de Veryfi");
  activeToken=token;
  return data;
 }
 activeToken=null;
 throw Error(forbidden?"Session collège expirée ou invalide. Reconnectez-vous dans le même navigateur.":"Connexion au collège requise.");
}
function b64(bytes){
 const chunks=[];for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
 return btoa(chunks.join(""));
}
async function configured(){
 if(checking||busy)return;
 checking=true;
 try{
  if(!tokens().length)throw Error("Connectez-vous au collège pour utiliser Veryfi.");
  const v=await request("GET");
  ready=!!v.configured;
  btn.disabled=false;
  loginLink.style.display="none";
  status(ready?"Veryfi prêt. Cliquez pour lire le PDF après contrôle.":"Identifiants API Veryfi manquants dans les secrets Supabase.",!ready);
 }catch(e){
  ready=false;activeToken=null;btn.disabled=false;
  loginLink.style.display="inline-block";
  status("Connexion collège requise : "+(e?.message||String(e)),true);
 }finally{checking=false}
}
btn.onclick=async()=>{
 const file=$("invoicePdf")?.files?.[0];
 if(!file)return status("Importez d’abord un PDF.",true);
 if(file.size>6*1024*1024)return status("Veryfi accepte ici les PDF de 6 Mo maximum. L’OCR local reste disponible.",true);
 if(busy)return;
 busy=true;const current=++seq,source=file;btn.disabled=true;status("Vérification de la session collège…");
 try{
  const health=await request("GET");
  if(!health.configured)throw Error("Identifiants API Veryfi non configurés dans Supabase.");
  if(!confirm("Envoyer ce PDF à Veryfi pour analyse ? Cette opération utilise un service externe et peut être facturée selon votre abonnement. Aucun stock ne sera modifié."))return;
  status("Analyse Veryfi en cours…");
  const data=await request("POST",{file_name:file.name,file_data:b64(new Uint8Array(await file.arrayBuffer()))});
  if(current!==seq||$("invoicePdf")?.files?.[0]!==source)return status("Résultat ancien ignoré : le PDF a changé.",true);
  document.dispatchEvent(new CustomEvent("invoice-veryfi:result",{detail:data.result}));
  status("Lecture Veryfi terminée : "+(data.result?.item_count||0)+" ligne(s) structurée(s). Vérifiez les références, quantités et montants avant validation.");
 }catch(e){
  const message=e?.message||String(e),auth=/session|connexion au collège/i.test(message);
  if(auth){ready=false;activeToken=null;loginLink.style.display="inline-block"}
  status((auth?"Connexion requise : ":"Veryfi indisponible : ")+message+". L’OCR local et la saisie manuelle restent accessibles.",true)
 }
 finally{busy=false;btn.disabled=false}
};
document.addEventListener("invoice-pdf:replace",()=>{seq++;selectedFile=null;status("PDF chargé. Vous pouvez lancer Veryfi ou conserver l’OCR local.")});
document.addEventListener("invoice-pdf:reset-after-success",()=>{seq++;status("Facture suivante : importez le nouveau PDF.")});
window.addEventListener("focus",()=>{void configured()});
configured();
})();
