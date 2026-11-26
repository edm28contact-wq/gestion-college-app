"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("college/admin/salary-od.js","utf8");
const salaries=fs.readFileSync("college/admin/salaires.js","utf8");
const context={window:{addEventListener(){}},module:{exports:{}},esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}};
vm.runInNewContext(source,context);
const {simpleBankHtml}=context.module.exports;
test("la vue courante n'affiche qu'un tableau bancaire et un seul export XML",()=>{
 const draft={
  payments:new Map([["a","100.10"],["b","200.20"]]),
  bank:{issuer:{date:"2026-11-27"},beneficiaries:new Map([
   ["a",{matricule:"1",creditorName:"SALARIE A",iban:"FR00EXEMPLEA",bic:"TESTFRPP"}],
   ["b",{matricule:"2",creditorName:"SALARIE B",iban:"FR00EXEMPLEB",bic:"TESTFRPP"}]
  ])}
 };
 const html=simpleBankHtml(draft,[{id:"a",name:"Employé A"},{id:"b",name:"Employé B"}],"2026-11");
 assert.equal((html.match(/<table\b/g)||[]).length,1);
 assert.equal((html.match(/<button\b/g)||[]).length,1);
 assert.match(html,/id="salaryBankXml"[^>]*>Exporter le fichier XML/);
 assert.match(html,/data-pay-id="a"/);
 assert.match(html,/data-bank-key="date"/);
 assert.match(html,/SALARIE A/);
 assert.match(html,/FR00EXEMPLEB/);
 assert.doesNotMatch(html,/bordereau PDF|Exporter CSV|Calcul fiche paye|data-od-key/i);
});
test("le calculateur reste hors de la vue utilisateur sans perdre les contrôles",()=>{
 assert.match(source,/let session="",activeView="pay"/);
 assert.match(source,/activeView="pay";\s*nav\.replaceChildren\(\)/);
 assert.match(source,/activeView==="pay"\?simpleBankHtml\(d\)/);
 assert.match(source,/if\(!workflowEditable\(\)\|\|d\.bankLoading\|\|bankProblem\(d\)/);
 assert.match(source,/staff-bank-payroll","POST",\{ids\}/);
 assert.match(source,/reconcilePayments\(d\)\.difference!==0/);
 assert.match(source,/workflowSave\(d,true\)/);
 assert.match(source,/workflowStatus\("exported"/);
 assert.match(salaries,/id="salaryPayrollWorkArea"/);
 assert.match(salaries,/id="salaryAccountingMonth"/);
});
