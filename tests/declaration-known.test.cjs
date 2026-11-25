"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {declarationKnown}=require("../college/admin/declaration-known.js");
const salary=fs.readFileSync("college/admin/salary-od.js","utf8");
const source={
 window:{addEventListener(){}},
 module:{exports:{}},
 esc:value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))
};
vm.runInNewContext(salary,source);
const api=source.module.exports;
const month="2026-11";
function person(){
 return {id:"person-one",name:"Salariée fictive",working_weekdays:[1,2,4,5],weekly_work_slots:[
  {day:1,start:"08:00",end:"12:00"},{day:1,start:"13:00",end:"17:00"},{day:5,start:"09:00",end:"12:00"}
 ]};
}
const metrics={plannedDays:17,plannedMinutes:6120,calendar:{scheduledMinutesByDate:{"2026-11-05":420}},benefits:{entries:[],total:0}};
test("fonction renseignée, jours, créneaux et planning présents sans déduire d'heures contractuelles",()=>{
 const known=declarationKnown(person(),metrics,[],"Cuisine / restauration");
 assert.deepEqual(known.prefill,{function:"Cuisine / restauration"});
 assert.match(known.evidence.map(x=>x.value).join(" "),/lundi, mardi, jeudi, vendredi/);
 assert.match(known.evidence.map(x=>x.value).join(" "),/08:00–12:00/);
 assert.match(known.evidence.map(x=>x.value).join(" "),/102 h 00/);
 for(const key of ["contract","start","end","hours","rate","gross","transport","health","nir","status","absencePay"]){
  assert.equal(known.prefill[key],undefined,key);
 }
});
test("avantages en nature montrés dans la fiche sans inventer une prime, une mutuelle ou un salaire",()=>{
 const known=declarationKnown(person(),{...metrics,benefits:{entries:[{label:"logement",amount:300},{label:"véhicule",amount:200}],total:500}},[],"");
 assert.ok(known.evidence.some(x=>x.label.includes("Avantages en nature")&&x.value.includes("500,00")));
 assert.equal(known.prefill.adjustments,undefined);
 assert.equal(known.prefill.gross,undefined);
 assert.equal(known.prefill.health,undefined);
 assert.equal(known.prefill.transport,undefined);
});
test("événements en attente visibles, sans remplir le champ absence ni effectuer des retenues",()=>{
 const pending=[
  {event_date:"2026-11-05",event_type:"absence",all_day:true,review_status:"a_verifier",payroll_action:"a_examiner"},
  {event_date:"2026-11-07",event_type:"incident",duration_minutes:60,review_status:"a_verifier"}
 ];
 const known=declarationKnown(person(),metrics,pending,"Cuisine");
 assert.equal(known.pending,2);
 assert.equal(known.prefill.absence,undefined);
 assert.equal(known.prefill.adjustments,undefined);
 assert.match(known.evidence.map(x=>x.value).join(" "),/05|07/);
});
test("une absence validée est reportée en date et durée prévue, jamais comme 24 heures ou absence non payée",()=>{
 const events=[
  {event_date:"2026-11-05",event_type:"absence",all_day:true,review_status:"valide"},
  {event_date:"2026-11-07",event_type:"retard",duration_minutes:15,review_status:"valide"}
 ];
 const known=declarationKnown(person(),metrics,events,"Vie scolaire");
 assert.match(known.prefill.absence,/2026-11-05/);
 assert.match(known.prefill.absence,/7 h 00/);
 assert.match(known.prefill.absence,/rémunération à confirmer/);
 assert.doesNotMatch(known.prefill.absence,/24 h/);
 assert.equal(known.prefill.absencePay,undefined);
});
test("préfills enregistrables uniquement sur champs absents, sans modifier une saisie volontairement vide",()=>{
 const d=api.restoreDraft({version:2,month,values:{},payments:[["person-one",""]]} ,month,new Set(["person-one"]),["person-one"]);
 d.declarations.set("person-one",{function:"",contract:"CDD",hours:"151,67",gross:"3500",internal:"Notes RH"});
 d.declarationConfirmed=true;
 const staff=[{id:"person-one",name:"Salariée fictive",roleLabel:"Vie scolaire",
   prefill:{function:"Vie scolaire",absence:"Absence validée du 2026-11-05 : journée entière",start:"2020-01-01"}}];
 assert.equal(api.materializeKnownDeclaration(d,staff),true);
 const row=d.declarations.get("person-one");
 assert.equal(row.function,""); // explicit blank must not be overwritten
 assert.equal(row.contract,"CDD");
 assert.equal(row.hours,"151,67");
 assert.equal(row.gross,"3500");
 assert.equal(row.internal,"Notes RH");
 assert.equal(row.absence,staff[0].prefill.absence);
 assert.equal(row.start,staff[0].prefill.start);
 assert.equal(d.declarationConfirmed,false);
 assert.equal(d.dirty,true);
 assert.equal(api.materializeKnownDeclaration(d,staff),false);
 assert.doesNotMatch(api.csv(api.declarationData(d,staff)),/Notes RH/);
});
test("préremplissage visible avant sauvegarde, mais aucune donnée inventée dans les exports",()=>{
 const d=api.restoreDraft({version:2,month,values:{},payments:[["person-one",""]]},month,new Set(["person-one"]),["person-one"]);
 const staff=[{id:"person-one",name:"Salariée fictive",roleLabel:"Direction",prefill:{function:"Direction"}}];
 const table=api.declarationData(d,staff);
 const head=Array.from(table[0]),row=Array.from(table[1]);
 assert.equal(row[head.indexOf("Fonction")],"Direction");
 assert.equal(row[head.indexOf("Salaire brut")],"");
 assert.equal(row[head.indexOf("Date d’entrée")],"");
 assert.equal(row[head.indexOf("Contrat")],"");
 assert.match(api.declarationProblem(d,staff),/contrat/);
});
test("page Compta salaire raccordée aux données live des 10 salariés et bouton Enregistrer le mois conservé",()=>{
 const html=fs.readFileSync("college/admin/index.html","utf8");
 const salariers=fs.readFileSync("college/admin/salaires.js","utf8");
 const css=fs.readFileSync("college/admin/salary-od.css","utf8");
 assert.match(html,/declaration-known\.js\?v=/);
 assert.ok(html.indexOf("declaration-known.js")<html.indexOf("salaires.js"));
 assert.match(salariers,/ChambertinDeclarationKnown\?\.declarationKnown/);
 assert.match(salariers,/salaryOdMount\(\{month,staff:staffAvailable\?salaryStaff:\[\],defaultStaff:staffList,ready,canWrite:ready&&salaryCanWrite,session:token,declarationStaff\}\)/);
 assert.match(salary,/materializeKnownDeclaration\(d,context\.declarationStaff\|\|\[\]\)/);
 assert.match(salary,/Informations récupérées de la fiche salarié/);
 assert.match(salary,/id="salaryWorkflowSave"/);
 assert.match(css,/\.salary-declaration-known/);
});
