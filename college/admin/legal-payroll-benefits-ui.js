"use strict";
/* Formulaire de simulation uniquement : aucune mutation des bulletins ou du XML bancaire. */
(()=>{
function fields(txt,option,esc,value){
 const v=value||{};
 const date=(key,label)=>'<label>'+esc(label)+'<input type="date" data-salary-legal="'+key+'" value="'+esc(v[key]||"")+'"></label>';
 return '<details class="card" style="margin:10px 0"><summary><b>Avantage en nature véhicule</b> — achat, LOA/location, carburant, électrique</summary>'+
 '<div class="salary-doc-fields" style="margin-top:12px">'+
 option("vehicleKind","Type de mise à disposition",[["","À préciser"],["none","Aucun véhicule"],["purchased","Véhicule acheté"],["leased","Location / LOA"]],"")+
 option("vehicleEvaluation","Méthode",[["","À préciser"],["forfait","Évaluation forfaitaire"],["real","Frais réels"]],"")+
 date("vehicleAssignedDate","Date de première mise à disposition")+
 option("vehicleAge","Âge",[["","À préciser"],["lte5","5 ans ou moins"],["gt5","Plus de 5 ans"]],"")+
 option("vehicleFullMonth","Mois complet",[["","À confirmer"],["yes","Oui"],["no","Non (vérification manuelle)"]],"")+
 option("vehicleElectric","Motorisation",[["","À préciser"],["no","Non électrique / hybride"],["yes","100 % électrique"]],"")+
 option("vehicleEcoScore","Éco-score électrique",[["","À vérifier"],["yes","Éligible — justificatif"],["no","Non éligible"]],"")+
 option("vehicleFuelMode","Carburant employeur",[["","À préciser"],["none","Non pris en charge"],["actual","Coût réel usage privé"],["forfait","Forfait carburant"]],"")+
 txt("vehiclePurchasePrice","Prix d'achat TTC (€)","","Si véhicule acheté")+
 txt("vehicleRentalAnnual","Location + entretien + assurance TTC / an (€)","","Si véhicule loué ou LOA")+
 txt("vehicleLessorPurchasePrice","Prix TTC de référence loueur (€)","","Pour plafonner la valorisation du véhicule loué")+
 txt("vehicleFuelPrivateAnnual","Carburant privé payé par employeur / an (€)","0")+
 txt("vehicleFuelTotalAnnual","Tous frais de carburant / an (€)","0","Pour forfait carburant d'un véhicule loué")+
 txt("vehicleInsuranceAnnual","Assurance / an (€)","0","Uniquement méthode frais réels véhicule acheté")+
 txt("vehicleMaintenanceAnnual","Entretien / an (€)","0","Uniquement méthode frais réels véhicule acheté")+
 txt("vehicleKmPrivate","Km privés / an","","Pour calcul aux frais réels")+
 txt("vehicleKmTotal","Km totaux / an","","Pour calcul aux frais réels")+
 txt("vehicleEmployeeContribution","Participation mensuelle salarié (€)","0")+
 '</div></details>'+
 '<details class="card" style="margin:10px 0"><summary><b>Avantage en nature logement</b> — forfait Urssaf ou valeur réelle</summary>'+
 '<div class="salary-doc-fields" style="margin-top:12px">'+
 option("housingMode","Mode de valorisation",[["","À préciser"],["none","Aucun logement"],["forfait","Barème forfaitaire"],["real","Coût réel"]],"")+
 txt("housingGross","Brut mensuel hors logement (€)","","Proposé depuis le bulletin, à confirmer")+
 txt("housingRooms","Nombre de pièces principales privées","","Exclure les pièces affectées au travail")+
 option("housingWeeks","Semaines d'occupation du mois",[["","À confirmer"],["1","1 semaine"],["2","2 semaines"],["3","3 semaines"],["4","4 semaines (mois complet)"]],"")+
 option("housingShared","Logement partagé entre bénéficiaires",[["","À qualifier"],["no","Non"],["yes","Oui — étude spécifique"]],"")+
 option("housingServiceNecessity","Nécessité absolue de service",[["","À qualifier"],["no","Non"],["yes","Oui — étude spécifique"]],"")+
 txt("housingRentalValue","Valeur locative réelle / mois (€)","","Uniquement évaluation au réel")+
 txt("housingExpenses","Charges réelles payées employeur / mois (€)","0")+
 txt("housingEmployeeContribution","Participation mensuelle salarié (€)","0")+
 '</div></details>';
}
function evaluate(month,input,gross){
 const engine=typeof window==="undefined"?null:window.ChambertinVehicleHousing;
 if(!engine)return {vehicle:{status:"unknown",amountCents:null,message:"Moteur non chargé"},
  housing:{status:"unknown",amountCents:null,message:"Moteur non chargé"}};
 const v=engine.vehicle(month,input||{});
 const h=engine.housing(month,{...input,housingGross:String(input?.housingGross||gross||"")});
 return {vehicle:v,housing:h};
}
if(typeof window!=="undefined")window.ChambertinBenefitFields=Object.freeze({fields,evaluate});
if(typeof module!=="undefined"&&module.exports)module.exports={fields};
})();
