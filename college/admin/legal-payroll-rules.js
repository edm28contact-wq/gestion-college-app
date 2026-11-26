"use strict";
/*
 Barèmes datés, vérifiés au 26 novembre 2026.
 Le moteur prépare des éléments de paie : il ne modifie jamais un bulletin ou un virement.
 Pas de valeur extrapolée pour une période dont les tarifs ne sont pas confirmés.
*/
(()=>{
const RULES=Object.freeze({
 "2026":Object.freeze({
  from:"2026-01",to:"2026-12",
  navigoAnnualCents:99880,
  navigoPaidMonthCents:9080,
  mealGeneralCents:550,
  minEmployerRate:50,
  sources:Object.freeze({
   transport:"https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-annuel",
   reimbursement:"https://entreprendre.service-public.fr/vosdroits/F37900",
   meal:"https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/avantages-en-nature.html"
  }),
  version:"2026-01-01-officiel-2026-11-26"
 })
});
function rulesFor(month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||""))return null;
 const y=RULES[month.slice(0,4)];
 return y&&month>=y.from&&month<=y.to?y:null;
}
const parseDecimal=v=>{
 const s=String(v??"").trim().replace(/[\u00a0\u202f ]/g,"").replace(",",".");
 if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(s))return null;
 const [a,b=""]=s.split(".");
 return Number(a)*100+Number(b.padEnd(2,"0"));
};
const centsToString=cents=>(cents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const factor=x=>Number.isFinite(x)&&x>=0?x:null;
const verifiedAnnualRates=new Map();
function setAnnualRate(rate){
 if(!rate||rate.status!=="verified"||!Number.isInteger(rate.year)||rate.year<2027||
  !Number.isSafeInteger(rate.annualCents)||rate.annualCents<10000||rate.annualCents>250000||
  !Number.isSafeInteger(rate.paidMonthCents)||rate.paidMonthCents*11!==rate.annualCents||
  !/^20\d{2}-01-01$/.test(String(rate.effectiveFrom))||
  Number(rate.effectiveFrom.slice(0,4))!==rate.year||typeof rate.source!=="string"||
  !rate.source.startsWith("https://www.iledefrance-mobilites.fr/"))return false;
 verifiedAnnualRates.set(rate.year,Object.freeze({...rate}));
 return true;
}
function annualRateFor(month){
 const year=Number(String(month||"").slice(0,4));
 if(year===2026)return {year:2026,annualCents:99880,paidMonthCents:9080,status:"verified",effectiveFrom:"2026-01-01",
  source:RULES["2026"].sources.transport,tariffVersion:"navigo-annuel-2026"};
 return verifiedAnnualRates.get(year)||null;
}
function navigo(month,settings={}){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||""))return {status:"unknown",amountCents:null,message:"Mois invalide."};
 const zone=String(settings.zone||"1-5");
 if(zone==="none")return {status:"excluded",amountCents:0,message:"Pas de remboursement pour ce salarié."};
 if(zone!=="1-5")return {status:"invalid",amountCents:null,message:"Le paramétrage est réservé au Navigo Annuel toutes zones 1–5."};
 const fare=annualRateFor(month);
 if(!fare)return {status:"unknown",amountCents:null,message:"Tarif Navigo Annuel pour "+month.slice(0,4)+" non vérifié par une source officielle. Rechargement automatique nécessaire."};
 const employerRate=parseDecimal(settings.employerRate||"50");
 if(employerRate===null||employerRate<5000||employerRate>10000)return {status:"invalid",amountCents:null,message:"Taux employeur invalide (50 % à 100 %)."};
 const employerAnnual=Math.round(fare.annualCents*employerRate/10000);
 // Répartition de la prise en charge d'un titre ANNUEL sur 12 mois d'utilisation.
 // Les centimes résiduels sont répartis pour éviter un écart de total annuel.
 const monthNumber=Number(month.slice(5))-1;
 const regular=Math.floor(employerAnnual/12)+(monthNumber<employerAnnual%12?1:0);
 const hours=Number(settings.weeklyHours),full=Number(settings.fullTimeHours);
 const common={annualPriceCents:fare.annualCents,paidMonthPriceCents:fare.paidMonthCents,
  employerAnnualCents:employerAnnual,referenceAmountCents:regular,source:fare.source,ruleVersion:fare.tariffVersion,
  distribution:"Remboursement du coût annuel réparti sur 12 mois, indépendamment du 12e prélèvement offert."};
 if(!String(settings.weeklyHours||"").trim()||!String(settings.fullTimeHours||"").trim()||
  !Number.isFinite(hours)||!Number.isFinite(full)||hours<=0||full<=0||hours>full||full>60)
  return {status:"missing",amountCents:null,...common,message:"Base annuelle calculée ; horaires contractuels manquants : remboursement à confirmer."};
 const factor=hours>=full/2?1:hours/(full/2);
 const exactAnnual=Math.round(employerAnnual*factor);
 const amountCents=Math.floor(exactAnnual/12)+(monthNumber<exactAnnual%12?1:0);
 return {status:"ok",amountCents,...common,partTimeFactor:factor,employerPercent:employerRate/100,
  message:"Navigo Annuel 1–5 : prix annuel × part employeur × coefficient temps partiel, puis répartition sur 12 mois. Contrôler le justificatif."};
}
function meal(month,settings={}){
 const r=rulesFor(month);
 if(!r)return {status:"unknown",amountCents:null,message:"Barème nourriture non confirmé pour "+month+"."};
 const countStr=String(settings.mealsCount??"").trim();
 if(!countStr)return {status:"missing",amountCents:null,message:"Nombre de repas fournis à renseigner."};
 if(!/^\d{1,3}$/.test(countStr)||Number(countStr)>100)return {status:"invalid",amountCents:null,message:"Nombre de repas invalide."};
 const count=Number(countStr);
 const paid=parseDecimal(settings.employeePaidPerMeal||"0");
 if(paid===null)return {status:"invalid",amountCents:null,message:"Participation du salarié par repas invalide."};
 const service=settings.dutyMeal==="yes";
 const canteen=settings.mealMode==="canteen";
 // Le seuil de 50 % est specifique aux cantines et restaurants d'entreprise :
 // il ne s'applique pas a tout repas pris dans les locaux.
 const disregarded=canteen&&paid>=Math.ceil(r.mealGeneralCents/2);
 const perMeal=service||disregarded?0:Math.max(0,r.mealGeneralCents-paid);
 return {status:"ok",amountCents:count*perMeal,unitCents:perMeal,meals:count,ruleVersion:r.version,source:r.sources.meal,
  message:service?"Repas pris avec les élèves par nécessité de service déclarée : avantage non retenu.":
  disregarded?"Cantine : participation égale ou supérieure à 50 % du forfait, avantage négligé selon l’Urssaf.":
  "Nombre de repas × (forfait Urssaf − participation du salarié)."};
}
const API=Object.freeze({RULES,rulesFor,navigo,annualRateFor,setAnnualRate,meal,parseDecimal,centsToString});
if(typeof window!=="undefined")window.ChambertinLegalPayroll=API;
if(typeof module!=="undefined"&&module.exports)module.exports=API;
})();