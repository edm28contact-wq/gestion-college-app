"use strict";
/* Questions conditionnelles de préparation des avantages en nature.
   Les montants affichés sont des simulations du barème applicable au mois.
   Aucun bulletin, aucune OD, aucun virement n'est modifié ici. */
(()=>{
const TYPES=Object.freeze([
 ["choose","Sélectionner le type d'avantage…"],
 ["meal","Repas"],
 ["vehicle","Véhicule de fonction"],
 ["housing","Logement"],
 ["technology","Ordinateur / téléphone / internet"],
 ["manual","Autre avantage — saisie contrôlée"]
]);
const NAMES=Object.freeze(Object.fromEntries(TYPES));
const OPTIONS=Object.freeze({
 yesno:[["","À préciser"],["yes","Oui"],["no","Non"]],
 mealMode:[["","À préciser"],["workplace","Repas fourni dans les locaux"],["canteen","Cantine / restaurant d'entreprise"]],
 vehicleKind:[["","À préciser"],["purchased","Acheté par l'employeur"],["leased","Location / LOA"]],
 vehicleEvaluation:[["","À préciser"],["forfait","Forfait réglementaire"],["real","Frais réels"]],
 vehicleAge:[["","À préciser"],["lte5","5 ans ou moins"],["gt5","Plus de 5 ans"]],
 vehicleFuelMode:[["","À préciser"],["none","Non pris en charge"],["actual","Carburant privé réellement payé"],["forfait","Forfait carburant"]],
 housingMode:[["","À préciser"],["forfait","Barème forfaitaire Urssaf"],["real","Valeur réelle"]],
 housingLeaseHolder:[["","À préciser"],["employer","Bail au nom de l'employeur"],["employee","Bail au nom du salarié"]],
 techMode:[["","À préciser"],["forfait","Forfait de 10 %"],["real","Dépenses privées réelles"]],
 housingWeeks:[["","À préciser"],["1","1 semaine"],["2","2 semaines"],["3","3 semaines"],["4","4 semaines"]]
});
const FIELDS=Object.freeze({
 meal:[
  ["mealsCount","Nombre de repas réellement fournis", "number"],
  ["mealMode","Où sont consommés les repas ?", "select"],
  ["employeePaidPerMeal","Participation du salarié par repas (€)", "money"],
  ["dutyMeal","Repas pris avec les élèves par obligation professionnelle ?", "yesno"]
 ],
 vehicle:[
  ["vehicleKind","Véhicule acheté ou loué ?", "select"],
  ["vehicleEvaluation","Mode d'évaluation", "select"],
  ["vehicleAssignedDate","Première date de mise à disposition au salarié", "date"],
  ["vehicleAge","Âge du véhicule à la mise à disposition", "select"],
  ["vehicleFullMonth","Véhicule à disposition toute la période ?", "yesno"],
  ["vehicleElectric","100 % électrique ?", "yesno"],
  ["vehicleEcoScore","Véhicule électrique éligible à l'éco-score ?", "yesno",d=>d.vehicleElectric==="yes"&&d.vehicleAssignedDate>="2025-02-01"],
  ["vehicleFuelMode","Prise en charge du carburant par l'employeur", "select",d=>d.vehicleElectric==="no"],
  ["vehiclePurchasePrice","Prix d'achat TTC (€)", "money",d=>d.vehicleKind==="purchased"],
  ["vehicleRentalAnnual","Location, entretien et assurance TTC par an (€)", "money",d=>d.vehicleKind==="leased"],
  ["vehicleLessorPurchasePrice","Prix d'achat TTC de référence payé par le loueur (€)", "money",d=>d.vehicleKind==="leased"],
  ["vehicleFuelPrivateAnnual","Carburant privé TTC payé par an (€)", "money",d=>d.vehicleElectric==="no"&&d.vehicleFuelMode==="actual"],
  ["vehicleFuelTotalAnnual","Carburant privé et professionnel TTC par an (€)", "money",d=>d.vehicleKind==="leased"&&d.vehicleElectric==="no"&&d.vehicleFuelMode==="forfait"],
  ["vehicleInsuranceAnnual","Assurance annuelle TTC (€)", "money",d=>d.vehicleKind==="purchased"&&d.vehicleEvaluation==="real"],
  ["vehicleMaintenanceAnnual","Entretien annuel TTC (€)", "money",d=>d.vehicleKind==="purchased"&&d.vehicleEvaluation==="real"],
  ["vehicleKmPrivate","Kilomètres privés par an", "number",d=>d.vehicleEvaluation==="real"],
  ["vehicleKmTotal","Kilomètres totaux par an", "number",d=>d.vehicleEvaluation==="real"],
  ["vehicleEmployeeContribution","Participation mensuelle du salarié (€)", "money"]
 ],
 housing:[
  ["housingMode","Mode d'évaluation", "select"],
  ["housingLeaseHolder","Qui est titulaire du bail ?", "select"],
  ["housingShared","Logement partagé entre plusieurs salariés ?", "yesno"],
  ["housingServiceNecessity","Logement par nécessité absolue de service ?", "yesno"],
  ["housingWeeks","Nombre de semaines d'occupation ce mois", "select"],
  ["housingGross","Salaire brut du mois hors avantage logement (€)", "money",d=>d.housingMode==="forfait"],
  ["housingRooms","Nombre de pièces à usage privé", "number",d=>d.housingMode==="forfait"],
  ["housingRentalValue","Valeur locative cadastrale mensuelle (ou comparable justifié) (€)", "money",d=>d.housingMode==="real"],
  ["housingExpenses","Eau, gaz, électricité, chauffage, garage réels par mois (€)", "money",d=>d.housingMode==="real"],
  ["housingEmployeeContribution","Participation mensuelle du salarié (€)", "money"]
 ],
 technology:[
  ["techMode","Mode d'évaluation des outils numériques", "select"],
  ["techPrivateUse","Un usage privé existe-t-il ?", "yesno"],
  ["techIncidentalUse","Usage privé uniquement raisonnable et accessoire ?", "yesno",d=>d.techPrivateUse==="yes"],
  ["techDeviceCost","Prix TTC d'achat des appareils (€)", "money",d=>d.techMode==="forfait"&&d.techPrivateUse==="yes"&&d.techIncidentalUse==="no"],
  ["techSubscriptionAnnual","Coût annuel TTC des abonnements (€)", "money",d=>d.techMode==="forfait"&&d.techPrivateUse==="yes"&&d.techIncidentalUse==="no"],
  ["techPrivateAnnual","Dépenses annuelles réellement attribuables à l'usage privé (€)", "money",d=>d.techMode==="real"&&d.techPrivateUse==="yes"&&d.techIncidentalUse==="no"],
  ["techEmployeeContribution","Participation mensuelle du salarié (€)", "money",d=>d.techPrivateUse==="yes"]
 ]
});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=c=>(c/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const newBenefit=()=>({kind:"choose",label:"",amount:0,details:{},status:"missing"});
const options=(name,selected)=>OPTIONS[name]||OPTIONS.yesno;
function fieldsFor(kind,data={}){
 const d={...data};
 return (FIELDS[kind]||[]).filter(([, , ,when])=>!when||when(d));
}
function renderQuestions(kind,data={},i,disabled=false){
 const lock=disabled?' disabled':'';
 return fieldsFor(kind,data).map(([key,label,type])=>{
  const value=String(data[key]??"");
  if(type==="select"||type==="yesno"){
   const candidates=OPTIONS[type==="yesno"?"yesno":key]||OPTIONS.yesno;
   return '<label>'+esc(label)+'<select data-benefit-input="'+i+'" data-benefit-key="'+esc(key)+'"'+lock+'>'+
    candidates.map(([v,t])=>'<option value="'+esc(v)+'"'+(value===v?' selected':'')+'>'+esc(t)+'</option>').join("")+'</select></label>';
  }
  return '<label>'+esc(label)+'<input data-benefit-input="'+i+'" data-benefit-key="'+esc(key)+'" type="'+(type==="date"?"date":"text")+'"'+
   (type==="date"?'':' inputmode="decimal"')+' maxlength="30" value="'+esc(value)+'"'+lock+'></label>';
 }).join("");
}
function evaluate(month,b){
 const kind=b?.kind||"manual",d=b?.details||{};
 if(!["manual","choose"].includes(kind)){
  const required=fieldsFor(kind,d).filter(([key])=>String(d[key]??"").trim()==="").map(([,label])=>label);
  if(required.length)return {status:"missing",amountCents:null,message:"Questions obligatoires : "+required.join(", ")+".",ruleVersion:""};
 }
 if(kind==="manual"){
  const amount=Number(b?.amount);
  if(b?.confirmed===false)return {status:"missing",amountCents:null,message:"Montant libre : confirmer expressément la base de calcul et son justificatif."};
  if(!String(b.label||"").trim()||!Number.isFinite(amount)||amount<0||amount>100000)return {status:"invalid",amountCents:null,message:"Désignation ou montant manuel invalide."};
  return {status:"manual",amountCents:Math.round(amount*100),message:"Montant renseigné manuellement, justificatif de paie requis.",ruleVersion:"MANUAL"};
 }
 if(kind==="choose")return {status:"missing",amountCents:null,message:"Choisir un avantage pour afficher ses questions."};
 const legal=typeof window!=="undefined"?window.ChambertinLegalPayroll:null;
 const vh=typeof window!=="undefined"?window.ChambertinVehicleHousing:null;
 if(kind==="meal")return legal?.meal(month,d)||{status:"unknown",amountCents:null,message:"Barème repas indisponible."};
 if(kind==="vehicle")return vh?.vehicle(month,d)||{status:"unknown",amountCents:null,message:"Barème véhicule indisponible."};
 if(kind==="housing")return vh?.housing(month,d)||{status:"unknown",amountCents:null,message:"Barème logement indisponible."};
 if(kind==="technology")return vh?.technology(month,d)||{status:"unknown",amountCents:null,message:"Barème outils numériques indisponible."};
 return {status:"invalid",amountCents:null,message:"Type d'avantage inconnu."};
}
function display(i,raw,month,disabled=false){
 const b=raw&&typeof raw==="object"?raw:newBenefit(),kind=b.kind||"manual",d=b.details||{};
 const result=evaluate(month,b),lock=disabled?' disabled':'';
 const label=NAMES[kind]||b.label||"Avantage non reconnu";
 const isManual=kind==="manual",changeable=kind!=="choose"&&kind!=="manual";
 return '<section class="card salary-benefit-entry" data-benefit-row="'+i+'" style="margin:8px 0;padding:12px;border:1px solid #4b6470">'+
 '<div class="actions" style="align-items:end;gap:8px;flex-wrap:wrap">'+
  '<label style="flex:2;min-width:230px">Type d’avantage<select data-benefit-kind="'+i+'"'+lock+'>'+
   TYPES.map(([v,t])=>'<option value="'+esc(v)+'"'+(kind===v?' selected':'')+'>'+esc(t)+'</option>').join("")+
  '</select></label>'+
  '<button class="btn secondary compact" type="button" data-benefit-remove="'+i+'"'+lock+'>Supprimer</button></div>'+
  (isManual?'<div class="salary-doc-fields"><label>Libellé exact<input maxlength="100" data-benefit-label="'+i+'" value="'+esc(b.label||"")+'"'+lock+'></label>'+
   '<label>Montant / mois (€)<input type="number" min="0" step="0.01" data-benefit-amount="'+i+'" value="'+esc(b.amount||0)+'"'+lock+'></label>'+
   '<label><input type="checkbox" data-benefit-confirm="'+i+'"'+(b.confirmed!==false?' checked':'')+lock+'> Montant et justificatif contrôlés</label></div>':
   '<input type="hidden" data-benefit-label="'+i+'" value="'+esc(label)+'">'+
   '<input type="hidden" data-benefit-amount="'+i+'" value="'+(Number(result.amountCents??0)/100)+'">'+
   (changeable?'<div class="salary-doc-fields">'+renderQuestions(kind,d,i,disabled)+'</div>':''))+
 '<p role="status" data-benefit-status="'+i+'" class="muted">'+esc(result.message)+
  (result.amountCents!==null?' · <strong>'+fmt(result.amountCents)+'</strong> / mois':' · Montant non calculable')+
  (result.ruleVersion?' · Barème '+esc(result.ruleVersion):'')+'</p>'+
 '</section>';
}
function normalize(b,month){
 const value=evaluate(month,b);
 return {...b,label:b.kind==="manual"?b.label:NAMES[b.kind]||"",amount:value.amountCents===null?0:value.amountCents/100,
  status:value.status,ruleVersion:value.ruleVersion||"",source:value.source||""};
}
const API=Object.freeze({TYPES,NAMES,newBenefit,fieldsFor,renderQuestions,display,evaluate,normalize});
if(typeof window!=="undefined")window.ChambertinBenefitQuestionnaire=API;
if(typeof module!=="undefined"&&module.exports)module.exports=API;
})();
