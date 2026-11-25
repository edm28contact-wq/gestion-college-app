"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const dir=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(dir,"college/admin/index.html"),"utf8");
const ui=fs.readFileSync(path.join(dir,"college/admin/salary-od.js"),"utf8");
test("Compta salaire : le générateur est chargé avant le bordereau",()=>{
 const generator=html.indexOf('src="./sepa-credit-transfer.js');
 const old=html.indexOf('src="./salary-od.js');
 assert.ok(generator>0&&old>generator);
 assert.match(html,/comptaSalaires:salaryPage/);
 assert.match(ui,/id="salaryBankXml"/);
 assert.match(ui,/window\.ChambertinSEPA\?\.createCreditTransfer/);
 assert.match(ui,/application\/xml;charset=utf-8/);
});
test("l'export XML exige deux validations et une relecture récente des RIB",()=>{
 assert.match(ui,/!d\.payConfirmed\|\|!d\.bankConfirmed\|\|d\.bankLoading/);
 assert.match(ui,/staff-bank-payroll","POST",\{ids\}/);
 assert.match(ui,/if\(mergeSavedBanks\(d,response\.banks\)\)/);
 assert.match(ui,/if\(!current\(\)\|\|!d\.payConfirmed\|\|!d\.bankConfirmed\)return/);
 assert.match(ui,/result\.totalCents!==paymentTotals\(d\.payments\)\.total/);
 assert.match(ui,/Ne déposez jamais deux fois le même lot/);
});
test("le bordereau conserve les colonnes CP Ville Adresse du classeur sans copier les RIB dans le code",()=>{
 assert.match(ui,/postcode","Code postal"/);
 assert.match(ui,/city","Ville"/);
 assert.match(ui,/address","Adresse"/);
 assert.match(ui,/b\.postcode\|\|""/);
 assert.match(ui,/b\.city\|\|""/);
 assert.match(ui,/b\.address\|\|""/);
 assert.doesNotMatch(ui,/FR7630066109050002028630193/);
});
