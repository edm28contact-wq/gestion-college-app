"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {vehicle,housing,HOUSING_2026}=require("../college/admin/legal-payroll-vehicle-housing.js");
const legal=require("../college/admin/legal-payroll-rules.js");
const client=fs.readFileSync("college/admin/salaires.js","utf8");
const backend=fs.readFileSync("supabase/functions/college-payroll-workflow/index.ts","utf8");
const staffBackend=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
const markup=fs.readFileSync("college/admin/index.html","utf8");
const baseVehicle={vehicleKind:"purchased",vehicleAssignedDate:"2025-02-01",vehicleAge:"lte5",vehicleFullMonth:"yes",
 vehicleElectric:"no",vehicleFuelMode:"none",vehicleEvaluation:"forfait",vehiclePurchasePrice:"20000"};
test("forfait auto acheté post-2025 avec carburant ou électrique",()=>{
 assert.equal(vehicle("2026-11",baseVehicle).amountCents,25000);
 assert.equal(vehicle("2026-11",{...baseVehicle,vehicleFuelMode:"forfait"}).amountCents,33333);
 assert.equal(vehicle("2026-11",{...baseVehicle,vehicleElectric:"yes",vehicleEcoScore:"yes"}).amountCents,7500);
 assert.equal(vehicle("2026-11",{...baseVehicle,vehicleElectric:"yes"}).status,"missing");
 const capped=vehicle("2026-11",{...baseVehicle,vehiclePurchasePrice:"100000",vehicleElectric:"yes",vehicleEcoScore:"yes"});
 assert.equal(capped.annualDiscountCents,464160);
 assert.equal(capped.amountCents,86320);
});
test("barème antérieur à février 2025 et frais réels avec kilométrage",()=>{
 assert.equal(vehicle("2026-11",{...baseVehicle,vehicleAssignedDate:"2025-01-31"}).amountCents,15000);
 const real=vehicle("2026-11",{...baseVehicle,vehicleEvaluation:"real",vehicleInsuranceAnnual:"1200",
  vehicleMaintenanceAnnual:"800",vehicleKmPrivate:"5000",vehicleKmTotal:"10000"});
 assert.equal(real.amountCents,25000);
 assert.equal(vehicle("2026-11",{...baseVehicle,vehicleFullMonth:"no"}).status,"ok"); // Mois partiel retenu en entier selon Urssaf.
});
test("location : référence loueur obligatoire, forfait plafonné",()=>{
 const leased={...baseVehicle,vehicleKind:"leased",vehicleRentalAnnual:"12000",vehicleLessorPurchasePrice:"40000"};
 assert.equal(vehicle("2026-11",leased).amountCents,50000);
 assert.equal(vehicle("2026-11",{...leased,vehicleFuelMode:"forfait",vehicleFuelTotalAnnual:"2000"}).amountCents,66667);
 assert.equal(vehicle("2026-11",{...leased,vehicleLessorPurchasePrice:""}).status,"missing");
 const leasedReal=vehicle("2026-11",{...leased,vehicleEvaluation:"real",vehicleKmTotal:"10000",vehicleKmPrivate:"5000"});
 assert.equal(leasedReal.status,"review");
 assert.equal(leasedReal.amountCents,50000);
});
test("logement au forfait 2026 : tranches, pièces, retenues et semaines",()=>{
 assert.equal(HOUSING_2026.thresholds.length,7);
 const one={housingMode:"forfait",housingLeaseHolder:"employer",housingGross:"3000",housingRooms:"1",housingWeeks:"4"};
 assert.equal(housing("2026-11",one).amountCents,11940);
 assert.equal(housing("2026-11",{...one,housingRooms:"3"}).amountCents,29850);
 assert.equal(housing("2026-11",{...one,housingRooms:"3",housingEmployeeContribution:"50"}).amountCents,24850);
 assert.equal(housing("2026-11",{...one,housingRooms:"3",housingWeeks:"2"}).amountCents,14925);
 assert.equal(housing("2026-11",{...one,housingGross:"2002.50"}).amountCents,9300);
 assert.equal(housing("2026-11",{...one,housingGross:"6007.50"}).amountCents,22560);
});
test("logement au réel et cas spéciaux : pas de valorisation imaginaire",()=>{
 assert.equal(housing("2026-11",{housingMode:"real",housingLeaseHolder:"employer",housingWeeks:"4",housingRentalValue:"900",housingExpenses:"100",housingEmployeeContribution:"250"}).amountCents,75000);
 assert.equal(housing("2026-11",{housingMode:"forfait",housingGross:"3000"}).status,"missing");
 assert.equal(housing("2026-11",{housingMode:"forfait",housingGross:"3000",housingRooms:"1",housingWeeks:"4",housingLeaseHolder:"employee"}).status,"missing");
 assert.equal(housing("2026-11",{housingMode:"forfait",housingLeaseHolder:"employer",housingGross:"3000",housingRooms:"2",housingWeeks:"4",housingShared:"yes"}).amountCents,null);
 assert.equal(housing("2027-01",{housingMode:"forfait",housingGross:"3000",housingRooms:"2",housingWeeks:"4"}).status,"missing");
});
test("tarif Navigo Mois : remboursement mensuel sans lissage d'un abonnement annuel",()=>{
 let total=0;
 for(let m=1;m<=12;m++){
  const month="2026-"+String(m).padStart(2,"0");
  const computed=legal.navigo(month,{weeklyHours:"35",fullTimeHours:"35"});
  assert.equal(computed.status,"ok");
  assert.equal(computed.monthlyPriceCents,9080);
  assert.equal(computed.amountCents,4540);
  total+=computed.amountCents;
 }
 assert.equal(total,54480);
 assert.equal(legal.navigo("2027-01",{weeklyHours:"35",fullTimeHours:"35"}).status,"unknown");
 assert.equal(legal.setMonthlyRate({year:2027,status:"verified",monthlyCents:9200,
  fareType:"navigo_mois",effectiveFrom:"2027-01-01",
  source:"https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois"}),true);
 assert.equal(legal.navigo("2027-01",{weeklyHours:"35",fullTimeHours:"35"}).amountCents,4600);
 assert.equal(legal.setMonthlyRate({year:2028,status:"verified",monthlyCents:9200,
  fareType:"navigo_mois",effectiveFrom:"2029-01-01",
  source:"https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois"}),false);
});
test("données sensibles isolées du XML bancaire et chargement des barèmes authentifié",()=>{
 for(const key of ["vehicleKind","vehicleAssignedDate","vehicleElectric","vehicleFuelMode","vehicleLessorPurchasePrice","housingMode","housingRooms","housingGross"])
  assert.match(backend,new RegExp(key));
 assert.match(staffBackend,/action==="legal-navigo-mois"/);
 assert.match(staffBackend,/if\(!user\.admin\)return reply/);
 assert.match(client,/salaryAccountingLoadMonthlyRate\(month\)/);
 assert.match(client,/salaryOdSaveLegalData\(month,id/);
 assert.match(client,/data-salary-prep-vehicle/);
 assert.match(client,/data-salary-prep-housing/);
 assert.match(markup,/legal-payroll-vehicle-housing\.js/);
 assert.match(markup,/legal-payroll-benefits-ui\.js/);
});
