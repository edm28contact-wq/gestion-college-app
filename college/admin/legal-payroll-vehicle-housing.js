"use strict";
/* Simulateurs d'avantages en nature pour la préparation TESE, sans effet sur les bulletins.
   Montants et taux 2026 : Urssaf 01/06/2026.
   Les champs nécessaires non documentés bloquent le résultat. */
(()=>{
const SOURCE="https://www.urssaf.fr/accueil/employeur/cotisations/avantages-en-nature.html";
const VERIFIED_2026={vehicleElectricOldCapCents:202630,vehicleElectricNewCapCents:464160,vehicleElectricOldDiscount:0.50,vehicleElectricNewForfaitDiscount:0.70,technologyAnnualRate:0.10,sourceChecked:"2026-11-26"};
const HOUSING_2026=Object.freeze({
 thresholds:[200250,240300,280350,360450,440550,520650,600750],
 one:[7970,9300,10620,11940,14640,17260,19940,22560],
 perRoom:[4260,5970,7970,9950,12610,15240,18570,21230]
});
const missing=message=>({status:"missing",amountCents:null,message,source:SOURCE});
const invalid=message=>({status:"invalid",amountCents:null,message,source:SOURCE});
const notApplicable=message=>({status:"excluded",amountCents:0,message,source:SOURCE});
const verifiedYearRates=new Map();
const VEHICLE_2026=Object.freeze({
 purchasedYoungPercent:15,purchasedOldPercent:10,leasedPercent:50,
 withFuelPurchasedYoungPercent:20,withFuelPurchasedOldPercent:15,withFuelLeasedPercent:67,
 oldPurchasedYoungPercent:9,oldPurchasedOldPercent:6,oldLeasedPercent:30,
 oldWithFuelPurchasedYoungPercent:12,oldWithFuelPurchasedOldPercent:9,oldWithFuelLeasedPercent:40,
 electricNewDiscountPercent:70,electricNewCapCents:464160,electricOldDiscountPercent:50,electricOldCapCents:202630
});
function setOfficialRate(category,{year,payload,source}={}){
 if(!["logement","vehicule","ntic"].includes(category)||!Number.isInteger(year)||year<2027||year>2100||
  typeof source!=="string"||!source.startsWith("https://www.urssaf.fr/")||
  !payload||typeof payload!=="object"||payload.year!==year)return false;
 if(category==="logement"){
  const values=[payload.thresholds,payload.one,payload.perRoom];
  if(!values.every((arr,i)=>Array.isArray(arr)&&arr.length===(i?8:7)&&
   arr.every((value,j)=>Number.isSafeInteger(value)&&value>0&&value<(i===0?5000000:300000)&&(!j||value>arr[j-1])))||
   payload.effectiveFrom!==year+"-01-01")return false;
 }else if(category==="vehicule"){
  if(!Object.keys(VEHICLE_2026).every(key=>{
   const value=payload[key];
   return Number.isSafeInteger(value)&&value>0&&
    (key.endsWith("CapCents")?value>=100000&&value<=1000000:value<=100);
  }))return false;
 }else if(category==="ntic"){
  if(typeof payload.annualRate!=="number"||payload.annualRate<=0||payload.annualRate>0.30||
   payload.effectiveFrom!==year+"-01-01")return false;
 }
 verifiedYearRates.set(category+":"+year,Object.freeze({...payload}));
 return true;
}
function rateFor(category,month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month)))return null;
 const year=Number(month.slice(0,4));
 if(year===2026)return category==="vehicule"?VEHICLE_2026:category==="logement"?HOUSING_2026:
   category==="ntic"?{annualRate:VERIFIED_2026.technologyAnnualRate}:null;
 return verifiedYearRates.get(category+":"+year)||null;
}
const money=value=>{
 const str=String(value??"").trim().replace(/[\u00a0\u202f ]/g,"").replace(",",".");
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(str))return null;
 const [whole,fraction=""]=str.split(".");
 const n=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 return Number.isSafeInteger(n)?n:null;
};
const optionalMoney=(value,defaultCents=0)=>String(value??"").trim()===""?defaultCents:money(value);
const select=value=>String(value??"").trim();
const annualMonth=amount=>Math.round(amount/12);
function vehicle(month,input={}){
 const mode=select(input.vehicleKind);
 if(mode==="none")return notApplicable("Aucun véhicule mis à disposition à titre privé.");
 const rates=rateFor("vehicule",month);
 if(!rates)return missing("Barèmes véhicule officiels non vérifiés pour "+month+".");
 if(!["purchased","leased"].includes(mode))return missing("Préciser véhicule acheté ou loué / LOA.");
 if(!["forfait","real"].includes(select(input.vehicleEvaluation)))return missing("Choisir l'évaluation au forfait ou aux frais réels.");
 if(!["lte5","gt5"].includes(select(input.vehicleAge)))return missing("Préciser l'âge du véhicule (5 ans ou moins / plus de 5 ans).");
 if(!["none","actual","forfait"].includes(select(input.vehicleFuelMode))&&input.vehicleElectric!=="yes")return missing("Préciser la prise en charge du carburant.");
 const allocation=select(input.vehicleAssignedDate);
 const date=new Date(allocation+"T00:00:00Z");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(allocation)||!Number.isFinite(date.getTime())||
  date.toISOString().slice(0,10)!==allocation||allocation.slice(0,7)>month)
  return missing("Date de première mise à disposition invalide ou postérieure au mois étudié.");
 const recent=allocation>="2025-02-01",young=input.vehicleAge==="lte5";
 const electric=select(input.vehicleElectric);
 if(!["yes","no"].includes(electric))return missing("Préciser si le véhicule est exclusivement électrique.");
 if(electric==="yes"&&recent&&!["yes","no"].includes(select(input.vehicleEcoScore)))
  return missing("Éligibilité au score environnemental à confirmer pour le véhicule électrique.");
 if(!["yes","no"].includes(select(input.vehicleFullMonth)))return missing("Préciser si le véhicule a été à disposition durant tout le mois. Un mois entamé compte pour un mois entier.");
 const contribution=optionalMoney(input.vehicleEmployeeContribution);
 if(contribution===null)return invalid("Participation mensuelle du salarié invalide.");
 let annual=0,base=0,cap=null;
 const fuel=electric==="yes"?"none":select(input.vehicleFuelMode),forfait=input.vehicleEvaluation==="forfait";
 const purchase=money(input.vehiclePurchasePrice),lease=money(input.vehicleRentalAnnual);
 const fuelPrivate=optionalMoney(input.vehicleFuelPrivateAnnual),fuelTotal=optionalMoney(input.vehicleFuelTotalAnnual);
 if(fuelPrivate===null||fuelTotal===null)return invalid("Coûts de carburant annuels invalides.");
 const low=(recent?(young?rates.purchasedYoungPercent:rates.purchasedOldPercent):(young?rates.oldPurchasedYoungPercent:rates.oldPurchasedOldPercent))/100;
 const withFuel=(recent?(young?rates.withFuelPurchasedYoungPercent:rates.withFuelPurchasedOldPercent):(young?rates.oldWithFuelPurchasedYoungPercent:rates.oldWithFuelPurchasedOldPercent))/100;
 if(mode==="purchased"&&(purchase===null||purchase===0))return missing("Prix d'achat TTC du véhicule nécessaire.");
 if(mode==="leased"&&(lease===null||lease===0))return missing("Coût annuel TTC complet de location, entretien et assurance nécessaire.");
 if(forfait){
  if(mode==="purchased"){
   base=Math.round(purchase*(fuel==="forfait"&&electric==="no"?withFuel:low));
   annual=base+(fuel==="actual"&&electric==="no"?fuelPrivate:0);
  }else{
   if(fuel==="forfait"&&electric==="no"&&fuelTotal===0)return missing("Pour le forfait carburant en location, renseigner le coût annuel de tous les carburants.");
   annual=Math.round((lease+(fuel==="forfait"&&electric==="no"?fuelTotal:0))*
    (fuel==="forfait"&&electric==="no"?(recent?rates.withFuelLeasedPercent:rates.oldWithFuelLeasedPercent):(recent?rates.leasedPercent:rates.oldLeasedPercent))/100);
   if(fuel==="actual"&&electric==="no")annual+=fuelPrivate;
   const ref=money(input.vehicleLessorPurchasePrice);
   if(ref===null||ref===0)return missing("Le prix de référence TTC payé par le loueur est requis pour plafonner le forfait.");
   cap=Math.round(ref*(fuel==="forfait"&&electric==="no"?withFuel:low))+
    (fuel==="actual"&&electric==="no"?fuelPrivate:0);
   annual=Math.min(annual,cap);
  }
 }else{
  const insurance=mode==="purchased"?money(input.vehicleInsuranceAnnual):0;
  const maintenance=mode==="purchased"?money(input.vehicleMaintenanceAnnual):0;
  const totalKm=Number(select(input.vehicleKmTotal)),privateKm=Number(select(input.vehicleKmPrivate));
  if(mode==="purchased"&&(!select(input.vehicleInsuranceAnnual)||!select(input.vehicleMaintenanceAnnual)||insurance===null||maintenance===null))
   return missing("Assurance et entretien TTC annuels nécessaires (indiquer 0 si aucun).");
  if(!Number.isFinite(totalKm)||!Number.isFinite(privateKm)||totalKm<=0||privateKm<0||
   privateKm>totalKm||!select(input.vehicleKmTotal)||!select(input.vehicleKmPrivate))
   return missing("Kilométrages total et privé annuels nécessaires.");
  const expenses=mode==="purchased"?Math.round(purchase*(young?0.20:0.10))+insurance+maintenance:lease;
  annual=Math.round(expenses*privateKm/totalKm)+(fuel==="none"||electric==="yes"?0:fuelPrivate);
  if(mode==="leased"&&!input.vehicleLessorPurchasePrice)
   return missing("Calcul réel en location : prix de référence loueur requis pour vérifier le plafonnement.");
 }
 let discount=0;
 if(electric==="yes"&&(!recent||input.vehicleEcoScore==="yes")){
  const rate=(recent&&forfait?rates.electricNewDiscountPercent:rates.electricOldDiscountPercent)/100;
  const max=recent&&forfait?rates.electricNewCapCents:rates.electricOldCapCents;
  discount=Math.min(Math.round(annual*rate),max);
 }
 const monthly=Math.max(0,annualMonth(Math.max(0,annual-discount))-contribution);
 return {status:mode==="leased"&&!forfait?"review":"ok",amountCents:monthly,annualBeforeDiscountCents:annual,annualDiscountCents:discount,
  monthlyContributionCents:contribution,capCents:cap,ruleVersion:"URSSAF-"+month.slice(0,4)+"-2025-02",source:SOURCE,
  message:"Barème "+(recent?"depuis février 2025":"avant février 2025")+
   " · "+(forfait?"forfait":"frais réels")+" · "+(electric==="yes"?"électrique":"non électrique")+
   ". Montant indicatif sur mois complet, à contrôler avant TESE."+(mode==="leased"&&!forfait?" Plafonnement en location aux frais réels à contrôler manuellement.":"")};
}
function housing(month,input={}){
 const mode=select(input.housingMode);
 if(mode==="none")return notApplicable("Aucun logement fourni au salarié.");
 const rates=rateFor("logement",month);
 if(!rates)return missing("Barème logement non vérifié pour "+month+".");
 if(!["forfait","real"].includes(mode))return missing("Choisir l'évaluation au barème forfaitaire ou à la valeur réelle.");
 if(select(input.housingLeaseHolder)==="employee")return missing("Bail au nom du salarié : avantage en espèces, non calculable au barème logement.");
 if(select(input.housingLeaseHolder)!=="employer")return missing("Titulaire du bail non renseigné : la valorisation du logement dépend du bail.");
 if(select(input.housingShared)==="yes"||select(input.housingServiceNecessity)==="yes")
  return missing("Logement partagé ou nécessité absolue de service : situation particulière à qualifier avant calcul.");
 const contribution=optionalMoney(input.housingEmployeeContribution);
 if(contribution===null)return invalid("Participation du salarié au logement invalide.");
 const weeks=select(input.housingWeeks);
 if(!/^[1-4]$/.test(weeks))return missing("Nombre de semaines d'occupation entre 1 et 4 à confirmer.");
 let base,bracket=null,rooms=null;
 if(mode==="forfait"){
  const gross=money(input.housingGross);
  rooms=Number(select(input.housingRooms));
  if(gross===null)return missing("Salaire brut mensuel hors avantage logement nécessaire.");
  if(!/^\d{1,2}$/.test(select(input.housingRooms))||rooms<1||rooms>30)
   return missing("Nombre de pièces principales à usage privé invalide ou manquant.");
  bracket=rates.thresholds.findIndex(limit=>gross<limit);
  if(bracket<0)bracket=7;
  base=rooms===1?rates.one[bracket]:rates.perRoom[bracket]*rooms;
 }else{
  const rentalValue=money(input.housingRentalValue),expenses=optionalMoney(input.housingExpenses);
  if(rentalValue===null||expenses===null)return missing("Valeur locative et frais accessoires au réel nécessaires.");
  base=rentalValue+expenses;
 }
 const monthBase=Math.round(base*Number(weeks)/4);
 return {status:"ok",amountCents:Math.max(0,monthBase-contribution),monthlyBaseCents:base,
  employeeContributionCents:contribution,bracket,rooms,weeks:Number(weeks),source:SOURCE,ruleVersion:"URSSAF-LOGEMENT-"+month.slice(0,4),
  message:mode==="forfait"?"Barème "+month.slice(0,4)+" selon brut hors logement, nombre de pièces privées et semaines d'occupation.":
   "Valeur locative et frais réels à justifier, moins participation du salarié."};
}
function technology(month,input={}){
 const mode=select(input.techMode);
 if(!["yes","no"].includes(select(input.techPrivateUse)))return missing("Préciser si un usage privé est autorisé et constaté.");
 if(input.techPrivateUse==="no")return notApplicable("Aucun usage privé déclaré.");
 const rates=rateFor("ntic",month);
 if(!rates)return missing("Barème NTIC non vérifié pour "+month+".");
 if(!["forfait","real"].includes(mode))return missing("Choisir l'évaluation de l'outil numérique (forfait ou usage privé réel).");
 if(!["yes","no"].includes(select(input.techIncidentalUse)))return missing("Préciser si l'usage privé est seulement raisonnable et accessoire.");
 if(input.techIncidentalUse==="yes")return {status:"review",amountCents:null,message:"Usage personnel raisonnable pouvant être négligé : vérification de la politique d'entreprise nécessaire.",source:SOURCE};
 const contribution=optionalMoney(input.techEmployeeContribution);
 if(contribution===null)return invalid("Participation du salarié invalide.");
 const device=money(input.techDeviceCost);
 const subscription=money(input.techSubscriptionAnnual);
 let annual=0;
 if(mode==="forfait"){
  if(device===null||subscription===null)return missing("Renseigner le prix d'achat TTC et le coût annuel TTC de l'abonnement (0 si absent).");
  annual=Math.round((device+subscription)*rates.annualRate);
 }else{
  const real=money(input.techPrivateAnnual);
  if(real===null)return missing("Renseigner les dépenses annuelles justifiées correspondant à l'usage privé.");
  annual=real;
 }
 return {status:"ok",amountCents:Math.max(0,Math.round(annual/12)-contribution),
  annualAmountCents:annual,ruleVersion:"URSSAF-NTIC-"+month.slice(0,4),source:SOURCE,
  message:mode==="forfait"?"10 % du prix TTC de l'appareil et de l'abonnement annuel, répartis sur 12 mois, moins la participation.":"Dépenses annuelles d'usage privé réparties sur 12 mois, moins la participation."};
}
const API=Object.freeze({SOURCE,HOUSING_2026,VERIFIED_2026,setOfficialRate,vehicle,housing,technology,money});
if(typeof window!=="undefined")window.ChambertinVehicleHousing=API;
if(typeof module!=="undefined"&&module.exports)module.exports=API;
})();
