"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const legal=require("../college/admin/legal-payroll-rules.js");
const v=require("../college/admin/legal-payroll-vehicle-housing.js");
const SOURCE="https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/avantages-en-nature.html";
const h={year:2027,effectiveFrom:"2027-01-01",thresholds:[210000,250000,290000,370000,450000,530000,610000],
 one:[8000,9400,10800,12000,14800,17600,20200,22800],
 perRoom:[4400,6100,8300,10100,12900,15600,18800,21800]};
test("les anciens calculs restent 2026; un millésime futur n'est chargé qu'avec une source vérifiée",()=>{
 const i={housingMode:"forfait",housingLeaseHolder:"employer",housingGross:"3000",housingRooms:"1",housingWeeks:"4"};
 assert.equal(v.housing("2026-11",i).amountCents,11940);
 assert.equal(v.housing("2027-02",i).status,"missing");
 assert.equal(v.setOfficialRate("logement",{year:2027,payload:h,source:"https://example.com"}),false);
 assert.equal(v.setOfficialRate("logement",{year:2027,payload:h,source:SOURCE}),true);
 assert.equal(v.housing("2027-02",i).amountCents,12000);
 assert.equal(v.housing("2026-11",i).amountCents,11940);
});
test("les repas et NTIC 2027 peuvent utiliser une nouvelle référence officielle datée",()=>{
 assert.equal(legal.meal("2027-01",{mealsCount:"2"}).status,"unknown");
 assert.equal(legal.setMealRate({year:2027,mealGeneralCents:560,effectiveFrom:"2027-01-01",source:SOURCE}),true);
 assert.equal(legal.meal("2027-01",{mealsCount:"2",employeePaidPerMeal:"0"}).amountCents,1120);
 assert.equal(legal.meal("2026-11",{mealsCount:"2",employeePaidPerMeal:"0"}).amountCents,1100);
 const x={year:2027,annualRate:0.12,effectiveFrom:"2027-01-01"};
 assert.equal(v.setOfficialRate("ntic",{year:2027,payload:x,source:SOURCE}),true);
 assert.equal(v.technology("2027-01",{techMode:"forfait",techPrivateUse:"yes",techIncidentalUse:"no",techDeviceCost:"1200",techSubscriptionAnnual:"0"}).amountCents,1200);
 assert.equal(v.technology("2026-11",{techMode:"forfait",techPrivateUse:"yes",techIncidentalUse:"no",techDeviceCost:"1200",techSubscriptionAnnual:"0"}).amountCents,1000);
});
test("contrôle mensuel prévu le 20 et contrôles de secours, sans accès aux virements",()=>{
 const cron=fs.readFileSync("supabase/migrations/20261126110000_college_payroll_official_rates_cron.sql","utf8");
 const edge=fs.readFileSync("supabase/functions/college-payroll-rates-sync/index.ts","utf8");
 const api=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
 const client=fs.readFileSync("college/admin/salaires.js","utf8");
 const fetcher=fs.readFileSync("scripts/update-payroll-official-rates.mjs","utf8");
 assert.match(cron,/0 5 20 \* \*/);
 assert.match(cron,/0 5 21-22 \* \*/);
 assert.match(cron,/vault\.decrypted_secrets/);
 assert.match(edge,/college_verify_rates_cron_token/);
 assert.doesNotMatch(edge,/college_payroll_months|bank_details/);
 assert.match(api,/college_payroll_official_rate_snapshots/);
 assert.match(client,/salaryInstallArchivedOfficialRates/);
 assert.match(client,/Derniers barèmes officiels archivés/);
 assert.match(fetcher,/previously_verified/);
});
