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
  navigoCents:Object.freeze({"1-5":9080,"2-3":8880,"3-4":8640,"4-5":8440}),
  mealGeneralCents:550,
  minEmployerRate:50,
  sources:Object.freeze({
   transport:"https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois",
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
function navigo(month,settings={}){
 const r=rulesFor(month);
 if(!r)return {status:"unknown",amountCents:null,message:"Barème de transport non confirmé pour "+month+"."};
 const zone=String(settings.zone||"1-5");
 if(zone==="none")return {status:"excluded",amountCents:0,message:"Aucun remboursement déclaré pour ce mois."};

 const fare=zone==="custom"?parseDecimal(settings.ticketCost):r.navigoCents[zone];
 if(!Number.isSafeInteger(fare)||fare<=0)return {status:"missing",amountCents:null,message:"Tarif du titre non renseigné ou non valide."};
 const hours=Number(settings.weeklyHours);
 const full=Number(settings.fullTimeHours);
 const rate=String(settings.employerRate||"50").trim();
 const employerRate=parseDecimal(rate);
 if(employerRate===null||employerRate<5000||employerRate>10000)return {status:"invalid",amountCents:null,message:"Taux employeur invalide (minimum de 50 %)."};
 if(!String(settings.weeklyHours||"").trim()||!String(settings.fullTimeHours||"").trim()||!Number.isFinite(hours)||!Number.isFinite(full)||hours<=0||full<=0||hours>full||full>60)
  return {status:"missing",amountCents:null,referenceAmountCents:Math.round(fare*employerRate/10000),monthlyPassCents:fare,message:"Forfait 1–5 connu, mais durée contractuelle et horaire complet à confirmer avant validation du remboursement."};
 const partTimeFactor=hours>=full/2?1:hours/(full/2);
 const total=Math.round(fare*(employerRate/10000)*partTimeFactor);
 return {status:"ok",amountCents:total,monthlyPassCents:fare,employerPercent:employerRate/100,partTimeFactor,ruleVersion:r.version,
  message:"Calcul : prix réel × taux employeur × coefficient temps partiel."};
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
 // Une consommation réalisée par nécessité de service avec les élèves peut être exonérée ;
 // ce caractère doit être confirmé par l'employeur.
 const perMeal=service||paid>r.mealGeneralCents/2?0:Math.max(0,r.mealGeneralCents-paid);
 return {status:"ok",amountCents:count*perMeal,unitCents:perMeal,meals:count,ruleVersion:r.version,
  message:service?"Repas pris avec les élèves par nécessité de service déclarée : avantage non retenu.":
  paid>r.mealGeneralCents/2?"Participation supérieure à 50 % du forfait : avantage négligé selon l’Urssaf.":
  "Nombre de repas × (forfait Urssaf − participation du salarié)."};
}
const API=Object.freeze({RULES,rulesFor,navigo,meal,parseDecimal,centsToString});
if(typeof window!=="undefined")window.ChambertinLegalPayroll=API;
if(typeof module!=="undefined"&&module.exports)module.exports=API;
})();