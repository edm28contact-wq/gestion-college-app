"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const parser=require("../college/admin/payslip-net-parser.js");
const staff=[
 {id:"one",name:"XU"},
 {id:"two",name:"SIMON"},
 {id:"three",name:"DALBERT Paul"},
 {id:"four",name:"DALBERT Enguerrand"},
 {id:"five",name:"MARTIN Alice"}
];
const file="2026-11 XU Xin.pdf";
test("un bulletin de novembre avec dates non préfixées PERIODE remplit le bon salarié",()=>{
 const row=parser.inspectPayslip([
  "BULLETIN DE PAIE","XU Xin",
  "Du 01/11/2026 au 30/11/2026",
  "Net à payer avant impôt 2 810,00",
  "Prélèvement à la source 175,12",
  "NET À PAYER APRÈS IMPÔT 2 634,88"
 ],staff,"2026-11",file);
 assert.equal(row.ready,true);
 assert.equal(row.staffId,"one");
 assert.equal(row.period,"2026-11");
 assert.equal(row.periodSource,"document");
 assert.equal(row.employeeSource,"document");
 assert.equal(row.amountCents,263488);
});
test("sur le même bulletin les nets avant et après impôt ne sont pas confondus",()=>{
 const result=parser.extractNetPay([
  "Net social 2 900,00",
  "Net imposable 2 800,00",
  "NET À PAYER AVANT IMPÔT 2 600,00",
  "NET A PAYER APRES IMPOT 2 394,74"
 ]);
 assert.equal(result.cents,239474);
 assert.equal(result.confidence,"after-tax");
});
test("le mois du nom de fichier est présenté comme provisoire, jamais auto-validé",()=>{
 const row=parser.inspectPayslip([
  "BULLETIN DE PAIE","Salarié : SIMON Armance","Net payé 2 394,74"
 ],staff,"2026-11","2026-11 SIMON Armance.pdf");
 assert.equal(row.period,"2026-11");
 assert.equal(row.periodSource,"filename");
 assert.equal(row.ready,false);
 assert.match(row.reasons.join(" "),/nom du fichier/);
 assert.equal(row.amountCents,239474);
});
test("les noms de famille courts et les particules séparées du fichier retrouvent le salarié",()=>{
 const xu=parser.matchEmployee(["BULLETIN DE PAIE","XU Xin"],staff,"2026-11 XU Xin.pdf");
 assert.equal(xu.id,"one");assert.equal(xu.source,"document");
 const paul=parser.matchEmployee(["BULLETIN DE PAIE"],staff,"2026-11 D ALBERT Paul.pdf");
 const eng=parser.matchEmployee(["BULLETIN DE PAIE"],staff,"2026-11 D ALBERT Enguerrand.pdf");
 assert.equal(paul.id,"three");
 assert.equal(eng.id,"four");
 assert.equal(paul.source,"filename");
});
test("le mot paie suivi d'un mois explicite est reconnu dans le document",()=>{
 for(const doc of ["BULLETIN DE PAIE 11/2026","BULLETIN DE PAIE — NOVEMBRE 2026","PÉRIODE : NOVEMBRE 2026","MOIS DE PAIE : 11/2026"]){
  assert.equal(parser.findPayPeriod([doc]).month,"2026-11",doc);
  assert.equal(parser.findPayPeriod([doc]).source,"document");
 }
});
test("une mauvaise période et un conflit PDF/nom de fichier ne permettent pas l'import automatique",()=>{
 const row=parser.inspectPayslip([
  "BULLETIN DE PAIE","Salarié : MARTIN Alice",
  "Période du 01/10/2026 au 31/10/2026",
  "Net à payer après impôt 1 845,10"
 ],staff,"2026-11","2026-11 MARTIN Alice.pdf");
 assert.equal(row.ready,false);
 assert.equal(row.period,null);
 assert.match(row.reasons.join(" "),/contredit/);
});
test("des nets contradictoires ne sont jamais choisis silencieusement",()=>{
 const row=parser.inspectPayslip([
  "BULLETIN DE PAIE — NOVEMBRE 2026","Salarié XU Xin",
  "Net à payer 2 000,00",
  "Net à payer 1 950,00"
 ],staff,"2026-11",file);
 assert.equal(row.ready,false);
 assert.equal(row.amountCents,null);
 assert.equal(row.amountCandidates.length,2);
 assert.deepEqual(row.amountCandidates.map(x=>x.cents),[200000,195000]);
 assert.match(row.reasons.join(" "),/priorité|différents/);
});
test("le PDF reste à vérifier si le net est négatif ou comporte plusieurs nombres sur la même ligne",()=>{
 const negative=parser.extractNetPay(["Net à payer -1 500,00"]);
 assert.equal(negative.cents,null);
 assert.equal(parser.extractNetPay(["Net à payer 1 500,00 et 1 200,00"]).cents,null);
});
test("la suggestion manuelle ne contourne pas le contrôle du mois et ne transmet pas les bulletins",()=>{
 const importer=fs.readFileSync("college/admin/payslip-import.js","utf8");
 assert.match(importer,/inspectPayslip\(lines,state\.opts\.staff,state\.opts\.month,file\.name\)/);
 assert.match(importer,/row\.period===state\.opts\.month&&row\.documentOk===true/);
 assert.match(importer,/row\.amountCandidates\?\.length>0/);
 assert.match(importer,/options\.some\(x=>x\.cents===verified\)/);
 assert.match(importer,/confirm\("Après contrôle du bulletin PDF/);
 assert.doesNotMatch(importer,/\bfetch\s*\(/);
 assert.doesNotMatch(importer,/localStorage|sessionStorage/);
});
