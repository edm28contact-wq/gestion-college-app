"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const parser=require("../college/admin/payslip-net-parser.js");
const {pageLines}=require("../college/admin/payslip-import.js");
const staff=[{id:"al",name:"Alice Martin"},{id:"be",name:"Béatrice Dupont"},{id:"me",name:"Morel"}];
const bullet=[
 "COURS CHAMBERTIN — BULLETIN DE PAIE",
 "Période du 01/11/2026 au 30/11/2026",
 "Salarié : MARTIN Alice",
 "Salaire brut 3 500,00",
 "Cotisations 690,00",
 "NET SOCIAL 2 800,00",
 "NET IMPOSABLE 2 910,00",
 "NET À PAYER AVANT IMPÔT SUR LE REVENU 2 810,00",
 "Prélèvement à la source 175,12",
 "NET À PAYER APRÈS IMPÔT 2 634,88"
];
test("extrait uniquement le net à payer après impôt, pas le net social ni avant PAS",()=>{
 const result=parser.inspectPayslip(bullet,staff,"2026-11");
 assert.equal(result.ready,true);
 assert.equal(result.staffId,"al");
 assert.equal(result.period,"2026-11");
 assert.equal(result.amountCents,263488);
 assert.equal(parser.moneyFromText("1 234,56 EUR")[0],123456);
 assert.equal(parser.moneyFromText("2.345,67 €")[0],234567);
});
test("identifie le salarié malgré l'ordre nom/prénom et les accents",()=>{
 const r=parser.inspectPayslip([
 "BULLETIN DE PAIE — NOVEMBRE 2026",
 "Salariée : DUPONT Béatrice",
 "Net payé : 1 998,20"
 ],staff,"2026-11");
 assert.equal(r.ready,true);
 assert.equal(r.staffId,"be");
 assert.equal(r.amountCents,199820);
});
test("refuse silencieusement le mois différent, manquant ou contradictoire",()=>{
 const wrong=parser.inspectPayslip(bullet,staff,"2026-10");
 assert.equal(wrong.ready,false);
 assert.match(wrong.reasons.join(" "),/mois 2026-11/);
 const missing=parser.inspectPayslip(["BULLETIN DE PAIE","Salarié : Alice Martin","NET À PAYER 2 000,00"],staff,"2026-11");
 assert.equal(missing.ready,false);
 assert.match(missing.reasons.join(" "),/Période/);
 const different=parser.findPayPeriod(["Bulletin de paie novembre 2026","Période : octobre 2026"]);
 assert.equal(different.month,null);
});
test("refuse des valeurs contradictoires, négatives, absentes et des dates déguisées",()=>{
 const conflicting=parser.extractNetPay(["Net payé 1 500,00","Net à payer 1 400,00"]);
 assert.equal(conflicting.cents,null);
 const negative=parser.extractNetPay(["Net à payer -1 400,00"]);
 assert.equal(negative.cents,null);
 assert.deepEqual(parser.moneyFromText("Paiement 21.11.2026"),[]);
 const noTax=parser.extractNetPay(["Net à payer avant impôt 2 000,00","Net social 2 100,00"]);
 assert.equal(noTax.cents,null);
 const multiple=parser.extractNetPay(["NET À PAYER : 1 000,00 / 1 200,00"]);
 assert.equal(multiple.cents,null);
});
test("ne peut pas attribuer une paie à un salarié ambigu",()=>{
 const lines=["BULLETIN DE PAIE 11/2026","Salarié : Alice Martin","Net à payer : 1 850,20"];
 const duplicate=[...staff,{id:"second",name:"Alice Martin"}];
 assert.equal(parser.inspectPayslip(lines,duplicate,"2026-11").ready,false);
 assert.equal(parser.inspectPayslip(lines,duplicate,"2026-11").staffId,null);
});
test("ne considère pas un document non salarial comme bulletin",()=>{
 const inv=["Période de novembre 2026","Salarié : Alice Martin","Net à payer : 2 090,00"];
 const result=parser.inspectPayslip(inv,staff,"2026-11");
 assert.equal(result.ready,false);
 assert.match(result.reasons.join(" "),/Nature/);
});
test("reconstruit les lignes PDF selon les coordonnées, sans mélanger les montants",()=>{
 const rows=pageLines({items:[
  {str:"€",transform:[1,0,0,1,220,100]},
  {str:"1 250,54",transform:[1,0,0,1,140,100]},
  {str:"NET À PAYER",transform:[1,0,0,1,20,100]},
  {str:"BULLETIN DE PAIE",transform:[1,0,0,1,20,180]},
  {str:"Salarié : Morel",transform:[1,0,0,1,20,150]}
 ]});
 assert.deepEqual(rows,["BULLETIN DE PAIE","Salarié : Morel","NET À PAYER 1 250,54 €"]);
});
test("le module est intégré à Compta salaire et la lecture n'envoie pas les PDF à un service tiers",()=>{
 const page=fs.readFileSync("college/admin/index.html","utf8");
 const salary=fs.readFileSync("college/admin/salary-od.js","utf8");
 const importer=fs.readFileSync("college/admin/payslip-import.js","utf8");
 assert.ok(page.indexOf('payslip-net-parser.js')<page.indexOf('salary-od.js'));
 assert.ok(page.indexOf('payslip-import.js')<page.indexOf('salary-od.js'));
 assert.match(salary,/id="salaryPayslipImport"/);
 assert.match(salary,/window.ChambertinPayslipImporter\?\.mount/);
 assert.match(salary,/updateDraft\(d\)/);
 assert.match(salary,/workflowEditable\(\)/);
 assert.match(importer,/getDocument\(\{data:bytes/);
 assert.doesNotMatch(importer,/\bfetch\s*\(/);
 assert.doesNotMatch(importer,/localStorage|sessionStorage/);
 assert.match(importer,/MAX_FILES=30/);
 assert.match(importer,/Plusieurs bulletins pour le même salarié/);
});
