"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const details=require("../college/admin/payslip-details-parser.js");
const net=require("../college/admin/payslip-net-parser.js");
const importer=fs.readFileSync("college/admin/payslip-import.js","utf8");
const od=fs.readFileSync("college/admin/salary-od.js","utf8");
const salaries=fs.readFileSync("college/admin/salaires.js","utf8");
const backend=fs.readFileSync("supabase/functions/college-payroll-workflow/index.ts","utf8");
const index=fs.readFileSync("college/admin/index.html","utf8");
const text=[
 "COURS CHAMBERTIN · BULLETIN DE PAIE - NOVEMBRE 2026",
 "PÉRIODE DU 01/11/2026 AU 30/11/2026",
 "SALARIÉ MARTIN Alice",
 "SALAIRE BRUT 3 500,00",
 "NET SOCIAL 2 800,00",
 "NET IMPOSABLE 2 910,00",
 "NET À PAYER AVANT IMPÔT SUR LE REVENU 2 810,00",
 "PRÉLÈVEMENT À LA SOURCE 175,12",
 "NET À PAYER APRÈS IMPÔT 2 634,88"
];
test("le lecteur extrait brut, PAS, net social et avant impôt sans les confondre avec le net bancaire",()=>{
 const r=details.inspect(text);
 assert.equal(r.gross.cents,350000);
 assert.equal(r.withholding.cents,17512);
 assert.equal(r.beforeTax.cents,281000);
 assert.equal(r.netSocial.cents,280000);
 assert.equal(r.taxableNet.cents,291000);
 assert.equal(net.extractNetPay(text).cents,263488);
});
test("une ligne avec plusieurs montants ne sélectionne pas une valeur au hasard",()=>{
 const parsed=details.inspect(["Salaire brut 151,67 30,00 3 500,00","Prélèvement à la source 2,10 2810,00 175,12"]);
 assert.equal(parsed.gross.cents,null);
 assert.equal(parsed.withholding.cents,null);
 assert.ok(parsed.gross.candidates.includes(350000));
 assert.ok(parsed.withholding.candidates.includes(17512));
});
test("le site montre l'import PDF depuis Compta salaire sans transmettre les documents",()=>{
 assert.match(od,/id="salaryPayslipImport"/);
 assert.match(od,/function simpleBankHtml\(d,/);
 assert.doesNotMatch(salaries,/data-salary-accounting-tab="payslips"/);
 assert.match(od,/window\.ChambertinPayslipImporter\?\.mount/);
 assert.match(importer,/window\.ChambertinPayslipDetails\?\.inspect/);
 assert.match(importer,/Valider et enregistrer le bulletin/);
 assert.match(importer,/Aucun montant n'a été enregistré automatiquement/);
 assert.match(importer,/PDF scanné sans texte/);
 assert.doesNotMatch(importer,/\bfetch\s*\(|localStorage|sessionStorage/);
 assert.match(index,/payslip-details-parser\.js/);
});
test("la sauvegarde est dans le dossier mensuel authentifié; aucun import ne déclenche un paiement",()=>{
 for(const field of ["gross","withholding","netBeforeTax","netSocial","netTaxable"])assert.ok(backend.includes(field+":40"));
 assert.match(od,/apply:async\(amounts,overwrite\)/);
 assert.match(od,/await workflowSave\(d,true\)/);
 assert.match(od,/if\(!await workflowSave\(d,true\)\)/); 
 assert.match(od,/workflowEditable\(\)/);
 assert.match(od,/id="salaryBankXml"/);
 assert.doesNotMatch(importer,/createWorkbookCreditTransfer|staff-bank-payroll/);
});
