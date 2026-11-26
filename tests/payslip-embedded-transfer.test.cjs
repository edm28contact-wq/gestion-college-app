"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("college/admin/salary-od.js","utf8");
const importer=fs.readFileSync("college/admin/payslip-import.js","utf8");
const main=fs.readFileSync("college/admin/salaires.js","utf8");
const index=fs.readFileSync("college/admin/index.html","utf8");
const parser=require("../college/admin/payslip-net-parser.js");
const sandbox={window:{addEventListener(){}},module:{exports:{}}};
vm.runInNewContext(source,sandbox);
const bank=sandbox.module.exports.simpleBankHtml;
test("l'import des bulletins apparaît dans le seul tableau des virements et son XML reste en place",()=>{
 const d={payments:new Map([["one",""],["two",""]]),bank:{issuer:{date:"2026-11-30"},beneficiaries:new Map()}};
 const html=bank(d,[{id:"one",name:"Martin"},{id:"two",name:"Dupont"}],"2026-11");
 assert.equal((html.match(/<table\b/g)||[]).length,1);
 assert.equal((html.match(/id="salaryPayslipImport"/g)||[]).length,1);
 assert.match(html,/<details[^>]*salary-payslip-import-panel/);
 assert.match(html,/Déposer les bulletins de paie \(PDF\)/);
 assert.match(html,/data-pay-id="one"/);
 assert.match(html,/Exporter le fichier XML/);
 assert.doesNotMatch(main,/data-salary-accounting-tab="payslips"/);
 assert.match(main,/data-salary-accounting-tab="pay"/);
 assert.match(source,/window\.ChambertinPayslipImporter\?\.mount/);
});
test("le dépôt accepte plusieurs PDF, et renseigne en une fois uniquement les nets certains",()=>{
 assert.match(importer,/type="file" accept="\.pdf,application\/pdf" multiple/);
 assert.match(importer,/dataTransfer\?\.files/);
 assert.match(importer,/Renseigner tous les nets reconnus/);
 assert.match(importer,/row\.employeeSource==="document"&&row\.periodSource==="document"/);
 assert.match(importer,/\["after-tax","paid"\]\.includes\(row\.netConfidence\)/);
 assert.match(importer,/state\.opts\.apply\(eligible\.map\(row=>\(\{staffId:row\.staffId,amountCents:row\.amountCents\}\)\),false\)/);
 assert.match(importer,/if\(!confirm\("Importer les nets de "/);
 assert.doesNotMatch(importer,/\bfetch\s*\(|localStorage|sessionStorage/);
 assert.match(index,/payslip-import\.js/);
});
test("le net à virer après impôt ne doit pas être confondu avec le brut ou le net social",()=>{
 const staff=[{id:"one",name:"MARTIN Alice"}];
 const parsed=parser.inspectPayslip(["BULLETIN DE PAIE","Période : NOVEMBRE 2026","Salarié MARTIN Alice",
  "Salaire brut 3 100,00","Net social 2 800,00","NET À PAYER AVANT IMPÔT 2 600,00",
  "Net à payer après impôt 2 475,47"],staff,"2026-11","2026-11 MARTIN Alice.pdf");
 assert.equal(parsed.ready,true);
 assert.equal(parsed.staffId,"one");
 assert.equal(parsed.period,"2026-11");
 assert.equal(parsed.netConfidence,"after-tax");
 assert.equal(parsed.amountCents,247547);
});
