/* Préremplissage de la déclaration gérance à partir des fiches salariés et
 * du planning du mois. Ne génère aucun salaire ou statut contractuel. */
(()=>{
"use strict";
const DAY_NAMES=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const EVENT_NAMES={absence:"absence",retard:"retard",depart_anticipe:"départ anticipé",incident:"incident"};
const clean=(value,max=240)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const formatMinutes=minutes=>Math.floor(minutes/60)+" h "+String(minutes%60).padStart(2,"0");
const formatEuros=value=>Number(value).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
function eventTime(event,calendar){
 if(event.all_day){
  const planned=calendar?.scheduledMinutesByDate?.[event.event_date];
  return "journée entière"+(Number.isFinite(planned)&&planned>0?" ("+formatMinutes(planned)+" prévues)":" (durée à vérifier)");
 }
 const minutes=event.duration_minutes;
 return Number.isInteger(minutes)&&minutes>0&&minutes<=1440?formatMinutes(minutes):"durée à vérifier";
}
function declarationKnown(staff,metrics,events,roleLabel){
 if(!staff||typeof staff!=="object")return {prefill:{},evidence:[],pending:0};
 const evidence=[],prefill={};
 const role=clean(roleLabel,160);
 if(role&&role!=="Non attribué"){
  prefill.function=role;
  evidence.push({label:"Fonction enregistrée",value:role});
 }
 const days=Array.isArray(staff.working_weekdays)?[...new Set(staff.working_weekdays.filter(n=>Number.isInteger(n)&&n>=0&&n<=6))]:[];
 if(days.length)evidence.push({label:"Jours programmés en période scolaire",value:days.map(n=>DAY_NAMES[n]).join(", ")});
 const slots=Array.isArray(staff.weekly_work_slots)?staff.weekly_work_slots:[];
 const times=slots.filter(s=>Number.isInteger(s?.day)&&s.day>=0&&s.day<=6&&
   /^\d{2}:\d{2}$/.test(s.start||"")&&/^\d{2}:\d{2}$/.test(s.end||"")&&s.start<s.end)
  .slice(0,21).map(s=>DAY_NAMES[s.day]+" "+s.start+"–"+s.end);
 if(times.length)evidence.push({label:"Créneaux hebdomadaires enregistrés",value:times.join(" ; ")});
 if(Number.isFinite(metrics?.plannedDays)&&Number.isFinite(metrics?.plannedMinutes)){
  evidence.push({label:"Planning théorique du mois (non contractuel)",
   value:metrics.plannedDays+" jour(s), "+formatMinutes(metrics.plannedMinutes)+" programmé(s)"});
 }
 if(metrics?.benefits?.entries?.length){
  const items=metrics.benefits.entries.filter(b=>b&&clean(b.label,70)&&Number.isFinite(b.amount)&&b.amount>=0);
  if(items.length)evidence.push({label:"Avantages en nature enregistrés (paie à vérifier)",
   value:items.map(b=>clean(b.label,70)+" : "+formatEuros(b.amount)).join(" ; ")+
    (Number.isFinite(metrics.benefits.total)?" — total "+formatEuros(metrics.benefits.total):" — valorisation incomplète")});
 }
 const relevant=(Array.isArray(events)?events:[]).filter(event=>event&&EVENT_NAMES[event.event_type]&&event.review_status!=="sans_suite")
  .sort((a,b)=>String(a.event_date||"").localeCompare(String(b.event_date||"")));
 const confirmedAbsences=relevant.filter(event=>event.event_type==="absence"&&event.review_status==="valide");
 if(confirmedAbsences.length){
  const summary=confirmedAbsences.map(event=>"Absence validée du "+clean(event.event_date,10)+
   " : "+eventTime(event,metrics?.calendar)+" (nature et rémunération à confirmer)").join(" ; ");
  if(summary.length<=1000)prefill.absence=summary;
 }
 const pending=relevant.filter(event=>event.review_status!=="valide");
 if(pending.length)evidence.push({label:"Événements à vérifier — aucune retenue calculée automatiquement",
  value:pending.slice(0,20).map(e=>clean(e.event_date,10)+" : "+EVENT_NAMES[e.event_type]+
   " ("+eventTime(e,metrics?.calendar)+")").join(" ; ")+(pending.length>20?" ; "+(pending.length-20)+" autre(s)":"")});
 const approvedOther=relevant.filter(event=>event.review_status==="valide"&&event.event_type!=="absence");
 if(approvedOther.length)evidence.push({label:"Événements validés — traitement paie à confirmer",
  value:approvedOther.slice(0,20).map(e=>clean(e.event_date,10)+" : "+EVENT_NAMES[e.event_type]+
   " ("+eventTime(e,metrics?.calendar)+")").join(" ; ")+(approvedOther.length>20?" ; "+(approvedOther.length-20)+" autre(s)":"")});
 return {prefill,evidence,pending:pending.length};
}
const api=Object.freeze({declarationKnown});
if(typeof window!=="undefined")window.ChambertinDeclarationKnown=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();