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
 assert.match(html,/salaires\.js\?v=20261127-navigo2/);
 assert.match(html,/salary-od\.js\?v=20261126-netpdf2/);
});

test("Préparation : heures prévues et événements séparés, bénéfices, Navigo du mois, accès TESE",()=>{
 for(const key of ["Temps prévu (planning)","Retards","Absences","Départs anticipés","Avantages en nature / mois","Navigo calculé (1–5)"])
  assert.ok(page.includes(key),key);
 assert.match(page,/salaryAccountingMetrics\(staff,month\)/);
 assert.match(page,/durationCell\(r\.byType\.retard\)/);
 assert.match(page,/durationCell\(r\.byType\.absence\)/);
 assert.match(page,/salaryAccountingBenefitsDetail\(r\.benefits\)/);
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
