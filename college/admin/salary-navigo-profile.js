/* Remboursement Navigo Annuel 1-5 : affichage derivé des sources officielles et du contrat.
 * Ne modifie ni bulletin existant, ni avantage en nature, ni ordre SEPA. */
(()=>{
"use strict";
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let current=null;
const str=value=>value===null||value===undefined?"":String(value);
const localMoney=cents=>(cents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
function calculate(staff,month,values={},legal){
 if(!staff||typeof staff.navigo_reimbursement!=="boolean")
  return {status:"missing",amountCents:null,message:"Éligibilité au remboursement non renseignée."};
 if(!legal?.navigo)
  return {status:"unknown",amountCents:null,message:"Moteur réglementaire indisponible."};
 return legal.navigo(month,{
  zone:staff.navigo_reimbursement?"1-5":"none",
  weeklyHours:str(values.weeklyHours??staff.navigo_contract_weekly_hours),
  fullTimeHours:str(values.fullTimeHours??staff.navigo_full_time_weekly_hours),
  employerRate:"50"
 });
}
function validPair(weekly,fullTime){
 const parse=value=>{
  const txt=str(value).trim().replace(",",".");
  if(!/^(?:[1-9]|[1-5]\d|60)(?:\.\d{1,2})?$/.test(txt))return null;
  const n=Number(txt);
  return Number.isFinite(n)&&n>=1&&n<=60?n:null;
 };
 if(!str(weekly).trim()&&!str(fullTime).trim())return {ok:true,weekly:null,fullTime:null};
 const a=parse(weekly),b=parse(fullTime);
 if(a===null||b===null||a>b)return {ok:false,reason:"Renseignez les deux horaires contractuels (1 à 60 h, heures du contrat inférieures ou égales à la référence temps plein)."};
 return {ok:true,weekly:a,fullTime:b};
}
function html(staff,month,editable){
 const included=staff?.navigo_reimbursement===true,readOnly=!editable?" disabled":"";
 const input=(key,label,value)=>'<label>'+esc(label)+
  '<input id="'+key+'" type="text" inputmode="decimal" maxlength="5" autocomplete="off" value="'+esc(str(value))+'"'+readOnly+'></label>';
 return '<section class="card" id="salaryNavigoProfile" data-person="'+esc(staff?.id||"")+'" data-month="'+esc(month)+'" style="margin:12px 0">'+
  '<h3>Pass Navigo Annuel — toutes zones 1 à 5</h3>'+
  '<p class="muted">Montant proposé automatiquement selon le tarif officiel de l’année et la durée contractuelle. Remboursement de transport, distinct des avantages en nature.</p>'+
  '<div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center">'+
   '<div><small class="muted">Remboursement employeur du mois</small><p><strong id="salaryNavigoAmount">Calcul en cours…</strong></p></div>'+
   '<div><small class="muted">Situation</small><p id="salaryNavigoEligibility">'+(included?"Bénéficiaire — toutes zones":"Non bénéficiaire")+'</p></div>'+
  '</div>'+
  '<p id="salaryNavigoExplanation" class="muted" role="status"></p>'+
  '<p id="salaryNavigoDeclared" class="muted">Montant figurant sur le bulletin : chargement…</p>'+
  (included?
   '<div class="salary-doc-fields">'+
    input("salaryNavigoWeeklyHours","Heures contractuelles par semaine",staff.navigo_contract_weekly_hours)+
    input("salaryNavigoFullTimeHours","Horaire de référence à temps plein par semaine",staff.navigo_full_time_weekly_hours)+
   '</div><div class="actions"><button class="btn secondary" type="button" id="salaryNavigoSave"'+readOnly+'>Enregistrer les horaires pour les futurs calculs</button></div>':
   '<p class="muted">Ce salarié est exclu du remboursement dans le paramétrage du personnel.</p>')+
  '<p id="salaryNavigoFeedback" role="status"></p>'+
  '<p class="muted">Source : <a href="https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel" target="_blank" rel="noopener noreferrer">tarifs Navigo Annuel</a>. '+
  'Les heures du planning ne remplacent pas les heures contractuelles. Les bulletins déjà émis et les nets à virer ne sont pas modifiés.</p></section>';
}
function refresh(){
 const config=current,root=document.getElementById("salaryNavigoProfile");
 if(!config||!root||root.dataset.person!==config.staff.id||root.dataset.month!==config.month)return;
 const legal=window.ChambertinLegalPayroll;
 const weekly=root.querySelector("#salaryNavigoWeeklyHours"),full=root.querySelector("#salaryNavigoFullTimeHours");
 const values={weeklyHours:weekly?.value,fullTimeHours:full?.value};
 const r=calculate(config.staff,config.month,values,legal);
 const amount=root.querySelector("#salaryNavigoAmount"),explain=root.querySelector("#salaryNavigoExplanation");
 const cents=r.amountCents??r.referenceAmountCents;
 if(amount)amount.textContent=r.status==="excluded"?"0,00 €":cents===undefined||cents===null?"Tarif non confirmé":legal?.centsToString?.(cents)||localMoney(cents);
 if(explain)explain.textContent=r.status==="ok"?
  "Calcul automatique validé selon les horaires enregistrés · "+r.message:
  r.status==="missing"&&cents!==null&&cents!==undefined?
   "Base indicative temps plein : préciser les horaires du contrat pour obtenir le montant exact. "+r.message:
  r.message;
 const declared=root.querySelector("#salaryNavigoDeclared");
 const bulletin=window.ChambertinSalaryProfileDeclaration?.navigoState?.(config.staff.id,config.month);
 if(declared){
  if(!bulletin?.loaded)declared.textContent="Navigo indiqué sur le bulletin : dossier mensuel non chargé ou indisponible.";
  else{
   const real=String(bulletin.transport||"").trim(),realCents=real?legal?.parseDecimal?.(real):null;
   declared.textContent=realCents===null?"Navigo indiqué sur le bulletin : non renseigné.":
    "Navigo enregistré sur le bulletin : "+(legal?.centsToString?.(realCents)||localMoney(realCents))+
    (r.status==="ok"&&realCents!==r.amountCents?" · Écart avec le calcul actuel : à contrôler, aucune correction automatique.":" · Montant historique conservé.");
  }
 }
}
function mount(config){
 if(!config?.staff||!config?.month)return;
 current={...config};
 const root=document.getElementById("salaryNavigoProfile");
 if(!root||root.dataset.person!==config.staff.id||root.dataset.month!==config.month)return;
 for(const id of ["salaryNavigoWeeklyHours","salaryNavigoFullTimeHours"])
  root.querySelector("#"+id)?.addEventListener("input",()=>{
   const msg=root.querySelector("#salaryNavigoFeedback");
   if(msg)msg.textContent="Simulation en cours — horaires non encore enregistrés.";
   refresh();
  });
 root.querySelector("#salaryNavigoSave")?.addEventListener("click",async()=>{
  if(!current||!current.editable||current.staff.id!==config.staff.id||typeof current.onSave!=="function")return;
  const button=root.querySelector("#salaryNavigoSave"),msg=root.querySelector("#salaryNavigoFeedback");
  const check=validPair(root.querySelector("#salaryNavigoWeeklyHours")?.value,root.querySelector("#salaryNavigoFullTimeHours")?.value);
  if(!check.ok){if(msg)msg.textContent=check.reason;return}
  button.disabled=true;
  if(msg)msg.textContent="Enregistrement des horaires contractuels…";
  try{
   const saved=await current.onSave({
    id:current.staff.id,updated_at:current.staff.updated_at,
    navigo_contract_weekly_hours:check.weekly,navigo_full_time_weekly_hours:check.fullTime
   });
   if(!saved||saved.id!==current.staff.id)throw Error("Enregistrement non confirmé.");
   current.staff={...current.staff,...saved};
   if(msg)msg.textContent="Horaires contractuels enregistrés. Le remboursement se recalcule automatiquement pour chaque mois.";
   refresh();
  }catch(e){if(msg)msg.textContent=String(e?.message||"Enregistrement non confirmé.")}
  finally{if(root.isConnected)button.disabled=!current?.editable}
 });
 refresh();
}
const api=Object.freeze({html,mount,refresh,calculate,validPair});
if(typeof window!=="undefined")window.ChambertinNavigoProfile=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();