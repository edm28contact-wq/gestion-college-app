"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {navigo,meal,rulesFor}=require("../college/admin/legal-payroll-rules.js");
const page=fs.readFileSync("college/admin/salaires.js","utf8");
const service=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
const payroll=fs.readFileSync("college/admin/salary-od.js","utf8");
const html=fs.readFileSync("college/admin/index.html","utf8");

test("navigo toutes zones 2026 : prix et remboursement employeur 50 %",()=>{
 const result=navigo("2026-11",{weeklyHours:"35",fullTimeHours:"35"});
 assert.equal(result.status,"ok");
 assert.equal(result.monthlyPriceCents,9080);
 assert.equal(result.billingPeriod,"month");
 assert.equal(result.amountCents,4540);
 assert.equal(result.partTimeFactor,1);
 const reduced=navigo("2026-11",{weeklyHours:"7",fullTimeHours:"35"});
 assert.equal(reduced.status,"ok"); assert.equal(reduced.amountCents,1816);
});
test("exceptions et contrats incomplets : pas de déduction inventée",()=>{
 assert.equal(navigo("2026-11",{zone:"none"}).amountCents,0);
 const missing=navigo("2026-11",{});
 assert.equal(missing.status,"missing");
 assert.equal(missing.amountCents,null);
 assert.equal(missing.referenceAmountCents,4540);
 assert.equal(rulesFor("2027-01"),null);
 assert.equal(navigo("2027-01",{weeklyHours:"35",fullTimeHours:"35"}).status,"unknown");
});
test("avantage repas : forfait 2026, contribution et exonération professionnelle",()=>{
 assert.equal(meal("2026-11",{mealsCount:"10"}).amountCents,5500);
 assert.equal(meal("2026-11",{mealsCount:"10",employeePaidPerMeal:"1.50"}).amountCents,4000);
 assert.equal(meal("2026-11",{mealsCount:"10",employeePaidPerMeal:"3.00",mealMode:"workplace"}).amountCents,2500);
 assert.equal(meal("2026-11",{mealsCount:"10",employeePaidPerMeal:"3.00",mealMode:"canteen"}).amountCents,0);
 assert.equal(meal("2026-11",{mealsCount:"10",dutyMeal:"yes"}).amountCents,0);
});
test("application : forfait par défaut fixe, éligibilité issue du profil, sans réécrire les virements",()=>{
 assert.match(service,/navigo_reimbursement/);
 assert.match(page,/staff\.navigo_reimbursement===false/);
 assert.match(page,/zone:staff\.navigo_reimbursement\?"1-5":"none"/);
 assert.match(page,/data-salary-legal-open/);
 assert.match(page,/salaryOdSaveLegalData/);
 assert.match(payroll,/preparation:\[\.\.\.d\.preparation\]/);
 assert.match(payroll,/window\.salaryOdLegalData=/);
 assert.match(html,/legal-payroll-rules\.js/);
 assert.match(payroll,/workflowStatus\("exported"/);
});
