"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const page=fs.readFileSync("college/admin/salaires.js","utf8");
const payroll=fs.readFileSync("college/admin/salary-od.js","utf8");
const html=fs.readFileSync("college/admin/index.html","utf8");

test("Compta salaire : deux fenêtres, avec dépôt PDF dans les virements",()=>{
 assert.match(page,/data-salary-accounting-tab="prep"/);
 assert.doesNotMatch(page,/data-salary-accounting-tab="payslips"/);
 assert.match(page,/data-salary-accounting-tab="pay"/);
 assert.match(page,/1\. Préparation des fiches de paie/);
 assert.match(payroll,/Déposer les bulletins de paie \(PDF\)/);
 assert.match(page,/2\. Virements de salaires/);
 assert.match(page,/salaryAccountingView="prep"/);
 assert.match(page,/function salaryAccountingShowTab\(view\)/);
 assert.match(payroll,/activeView="pay";\s*nav\.replaceChildren\(\)/);
 assert.match(payroll,/salaryAccountingActiveTab\(\)!=="pay"/);
 assert.match(html,/salaires\.js\?v=20261127-payroll-compact1/);
 assert.match(html,/salary-od\.js\?v=20261126-netpdf2/);
});

test("Préparation : synthèse en sept colonnes et détails de paie préservés",()=>{
 const prep=page.slice(page.indexOf(" const preparation="),page.indexOf(" $('content').innerHTML",page.indexOf(" const preparation=")));
 for(const name of ["Salarié","Temps prévu","Écarts","Avantages / mois","Navigo","Contrôle","Actions"])
  assert.ok(prep.includes("<th>"+name+"</th>"),name);
 for(const name of ["Retards","Absences","Départs anticipés","Repas calculés","Véhicule","Logement"])
  assert.ok(!prep.includes("<th>"+name+"</th>"),name);
 assert.match(prep,/colspan="7"/);
 assert.match(page,/detailStat\("Retards"/);
 assert.match(page,/detailStat\("Absences"/);
 assert.match(page,/detailStat\("Départs anticipés"/);
 assert.match(page,/item\("Repas"/);
 assert.match(page,/item\("Véhicule"/);
 assert.match(page,/item\("Logement"/);
 assert.match(page,/salaryAccountingMetrics\(staff,month\)/);
 assert.match(page,/durationCell\(r\.byType\.retard\)/);
 assert.match(page,/durationCell\(r\.byType\.absence\)/);
 assert.match(page,/salaryAccountingBenefitsDetail\(metrics\.benefits\)/);
 assert.match(page,/data-salary-prep-navigo/);
 assert.match(page,/window\.salaryOdLegalData\?\.\(month,id\)/);
 assert.match(page,/https:\/\/www\.letese\.urssaf\.fr\//);
 assert.match(payroll,/draftFor\(month\)\.declarations\.get\(id\)\?\.transport/);
 assert.match(payroll,/window\.salaryAccountingOnDraftLoaded\?\.\(month\)/);
 assert.doesNotMatch(page.slice(page.indexOf("const preparation="),page.indexOf("$('content').innerHTML",page.indexOf("const preparation="))),/IBAN|BIC|Numéro de sécurité sociale/);
});

test("Les virements conservent l'unique export XML et les validations bancaires",()=>{
 assert.match(payroll,/function simpleBankHtml\(d,/);
 assert.match(payroll,/Exporter le fichier XML/);
 assert.match(payroll,/if\(!workflowEditable\(\)\|\|!d\.payConfirmed\|\|!d\.bankConfirmed/);
 assert.match(payroll,/staff-bank-payroll","POST",\{ids\}/);
 assert.match(payroll,/createWorkbookCreditTransfer/);
 assert.match(payroll,/result\.totalCents!==paymentTotals\(d\.payments\)\.total/);
 assert.match(payroll,/workflowStatus\("exported"/);
});

test("Préparation : les écarts sont totalisés, le détail reste disponible",()=>{
 const vm=require("node:vm");
 const from=page.indexOf(" const durationCell=part=>");
 const to=page.indexOf(" const preparation=",from);
 assert.ok(from>0&&to>from);
 const r={
  staff:{id:"s1",name:"Salarié test"},plannedMinutes:10050,plannedDays:20,
  knownAbsenceMinutes:135,missingHours:0,unmatchedDays:0,overbookedDays:0,pending:0,
  byType:{retard:{minutes:30,missing:0,count:1},absence:{minutes:0,missing:0,count:0},depart_anticipe:{minutes:105,missing:0,count:1}},
  benefits:{total:500,entries:[{label:"Logement",amount:300},{label:"Véhicule",amount:200}],invalid:0}
 };
 const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
 const render=data=>{
  const env={rows:data,esc,salaryFormatLate:n=>n+" min",salaryAccountingMetricFormat:String,salaryAccountingMoney:n=>n.toFixed(2)+" €"};
  vm.runInNewContext(page.slice(from,to)+";globalThis.output=prepRows;",env);
  return String(env.output);
 };
 const row=render([r]);
 assert.equal((row.match(/<tr>/g)||[]).length,1);
 assert.equal((row.match(/<td(?:\s|>)/g)||[]).length,6);
 assert.match(row,/135 min/);
 assert.match(row,/30 min · Absences : 0 min · Départs anticipés : 105 min/);
 assert.match(row,/500\.00 €/);
 assert.match(row,/data-salary-prep-navigo="s1"/);
 assert.match(row,/Détails calculs/);
 assert.doesNotMatch(row,/data-salary-prep-(meal|vehicle|housing)/);
 const incomplete=render([{...r,knownAbsenceMinutes:30,missingHours:1,byType:{...r.byType,absence:{minutes:0,missing:1,count:1}}}]);
 assert.match(incomplete,/≥ 30 min/);
 assert.match(incomplete,/À vérifier/);
 const provisional=render([{...r,pending:1}]);
 assert.match(provisional,/salary-prep-status--pending/);
});
