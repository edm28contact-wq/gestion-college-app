(()=>{
"use strict";
const $=id=>document.getElementById(id),btn=$("veryfiRead"),label=$("veryfiStatus");
if(!btn||!label)return;
const endpoint="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-veryfi-reader";
const accountPage=location.pathname.includes("/lecteur-comptabilite/");
const authKeys=accountPage?["college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"]:["college_secretariat_token","college_admin_token","edm_admin_token","holding_admin_token"];
function tokenStillValid(token){
 try{
  const part=token.split(".")[0],normalized=part.replace(/-/g,"+").replace(/_/g,"/");
  const body=atob(normalized+"=".repeat((4-normalized.length%4)%4));
  const claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(body,c=>c.charCodeAt(0))));
  return !!claims.u&&Number.isFinite(Number(claims.exp))&&Date.now()+30000<Number(claims.exp);
 }catch{return false}
}
const tokens=()=>[...new Set(authKeys.map(k=>localStorage.getItem(k)).filter(x=>x&&tokenStillValid(x)))];
let busy=false,selectedFile=null,seq=0,ready=false,activeToken=null,checking=false,needsLogin=false;
const loginLink=document.createElement("a");
loginLink.href=accountPage?"../comptabilite/?return=veryfi&reauth=1":"../secretariat/?return=veryfi&reauth=1";
loginLink.target="_self";
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
 if(!tokens().length){
  activeToken=null;ready=false;needsLogin=true;btn.disabled=false;
  btn.textContent="Se connecter pour utiliser Veryfi";
  loginLink.style.display="inline-block";
  status("Connectez-vous avec votre compte du collège pour activer Veryfi.",true);
  checking=false;
  return;
 }
 try{
  if(!tokens().length)throw Error("Connectez-vous au collège pour utiliser Veryfi.");
  const v=await request("GET");
  ready=!!v.configured;
  needsLogin=false;
  btn.disabled=false;
  btn.textContent="Lire avec Veryfi";
  loginLink.style.display="none";
  status(ready?"Veryfi prêt. Cliquez pour lire le PDF après contrôle.":"Identifiants API Veryfi manquants dans les secrets Supabase.",!ready);
 }catch(e){
  ready=false;activeToken=null;btn.disabled=false;
  const message=e?.message||String(e);
  needsLogin=/session|connexion au collège/i.test(message);
  loginLink.style.display=needsLogin?"inline-block":"none";
  btn.textContent=needsLogin?"Se connecter pour utiliser Veryfi":"Lire avec Veryfi";
  status(needsLogin?"Session collège expirée : reconnectez-vous pour utiliser Veryfi.":"Veryfi indisponible : "+message,true);
 }finally{checking=false}
}
btn.onclick=async()=>{
 if(needsLogin||!tokens().length||activeToken&&!tokenStillValid(activeToken)){
  if($("invoicePdf")?.files?.[0]&&!confirm("La connexion va recharger ce lecteur. Il faudra sélectionner de nouveau le PDF. Continuer ?"))return;
  location.assign(loginLink.href);
  return;
 }
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
  if(auth){ready=false;activeToken=null;needsLogin=true;loginLink.style.display="inline-block";btn.textContent="Se connecter pour utiliser Veryfi"}
  status((auth?"Connexion requise : ":"Veryfi indisponible : ")+message+". L’OCR local et la saisie manuelle restent accessibles.",true)
 }
 finally{busy=false;btn.disabled=false}
};
document.addEventListener("invoice-pdf:replace",()=>{seq++;selectedFile=null;status("PDF chargé. Vous pouvez lancer Veryfi ou conserver l’OCR local.")});
document.addEventListener("invoice-pdf:reset-after-success",()=>{seq++;status("Facture suivante : importez le nouveau PDF.")});
window.addEventListener("focus",()=>{void configured()});
configured();
})();
