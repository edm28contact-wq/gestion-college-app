"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const sources=[
 "college/admin/legal-payroll-rules.js",
 "college/admin/legal-payroll-vehicle-housing.js",
 "college/admin/salary-benefit-questionnaire.js"
].map(path=>fs.readFileSync(path,"utf8"));
const environment={window:{},module:{exports:{}},Intl,Number,Object,Array,String,Math};
for(const source of sources)vm.runInNewContext(source,environment);
const quiz=environment.window.ChambertinBenefitQuestionnaire;
const rates=environment.window.ChambertinLegalPayroll;
const benefits=environment.window.ChambertinVehicleHousing;
const app=fs.readFileSync("college/admin/salaires.js","utf8");
const backend=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
const index=fs.readFileSync("college/admin/index.html","utf8");
test("Un ajout de nouvel avantage demande le type avant d'ouvrir les questions",()=>{
 const b=quiz.newBenefit();
 assert.equal(b.kind,"choose");
 assert.equal(quiz.evaluate("2026-11",b).status,"missing");
 const screen=quiz.display(0,b,"2026-11");
 assert.match(screen,/data-benefit-kind="0"/);
 assert.match(screen,/Véhicule de fonction/);
 assert.match(screen,/Logement/);
 assert.match(screen,/Ordinateur/);
 assert.doesNotMatch(screen,/vehiclePurchasePrice/);
});
test("Les questions suivent le contexte, sans afficher les champs inutiles",()=>{
 const purchased=quiz.fieldsFor("vehicle",{vehicleKind:"purchased",vehicleElectric:"no",vehicleEvaluation:"forfait",vehicleFuelMode:"none"});
 const leased=quiz.fieldsFor("vehicle",{vehicleKind:"leased",vehicleElectric:"no",vehicleEvaluation:"forfait",vehicleFuelMode:"actual"});
 const electric=quiz.fieldsFor("vehicle",{vehicleKind:"purchased",vehicleElectric:"yes",vehicleEvaluation:"forfait",vehicleAssignedDate:"2026-03-01"});
 const keys=fields=>fields.map(x=>x[0]);
 assert.ok(keys(purchased).includes("vehiclePurchasePrice"));
 assert.ok(!keys(purchased).includes("vehicleRentalAnnual"));
 assert.ok(keys(leased).includes("vehicleLessorPurchasePrice"));
 assert.ok(keys(leased).includes("vehicleFuelPrivateAnnual"));
 assert.ok(!keys(electric).includes("vehicleFuelMode"));
 assert.ok(keys(electric).includes("vehicleEcoScore"));
 assert.ok(!keys(quiz.fieldsFor("housing",{housingMode:"real"})).includes("housingRooms"));
 assert.ok(keys(quiz.fieldsFor("housing",{housingMode:"real"})).includes("housingRentalValue"));
});
test("La simulation refuse un questionnaire incomplet",()=>{
 const empty={kind:"meal",details:{mealsCount:"10"}};
 const val=quiz.evaluate("2026-11",empty);
 assert.equal(val.status,"missing");
 assert.equal(val.amountCents,null);
 assert.match(val.message,/Participation du salarié/);
 const full={kind:"meal",details:{mealsCount:"10",employeePaidPerMeal:"1.50",mealMode:"workplace",dutyMeal:"no"}};
 assert.equal(quiz.evaluate("2026-11",full).amountCents,4000);
 assert.equal(quiz.normalize(full,"2026-11").amount,40);
});
test("Barèmes vérifiés en 2026, 2027 non calculé par anticipation",()=>{
 assert.equal(rates.rulesFor("2026-11").mealGeneralCents,550);
 assert.equal(benefits.HOUSING_2026.one[0],7970);
 assert.equal(benefits.VERIFIED_2026.vehicleElectricNewCapCents,464160);
 assert.equal(benefits.VERIFIED_2026.vehicleElectricOldCapCents,202630);
 assert.equal(benefits.VERIFIED_2026.technologyAnnualRate,0.1);
 assert.equal(quiz.evaluate("2027-01",{kind:"meal",details:{mealsCount:"3",employeePaidPerMeal:"0",mealMode:"workplace",dutyMeal:"no"}}).status,"unknown");
});
test("Le moteur NTIC est conforme aux 10 % annuels du forfait",()=>{
 const b={kind:"technology",details:{techPrivateUse:"yes",techMode:"forfait",techIncidentalUse:"no",techDeviceCost:"850",techSubscriptionAnnual:"360",techEmployeeContribution:"0"}};
 assert.equal(quiz.evaluate("2026-11",b).amountCents,1008);
 const none={kind:"technology",details:{techPrivateUse:"no"}};
 assert.equal(quiz.evaluate("2026-11",none).status,"excluded");
});
test("Anciennes fiches inchangées, nouveaux avantages enregistrables après contrôle",()=>{
 const legacy=quiz.evaluate("2026-11",{label:"ancien repas",amount:85});
 assert.equal(legacy.status,"manual");
 const explicit=quiz.evaluate("2026-11",{kind:"manual",label:"autre",amount:85,confirmed:false});
 assert.equal(explicit.status,"missing");
 assert.match(app,/salaryPayrollDraft\.benefits\.push\(window\.ChambertinBenefitQuestionnaire/);
 assert.match(app,/data-benefit-kind/);
 assert.match(app,/salaryPayrollReadDraft/);
 assert.match(backend,/detailFields=new Set/);
 assert.match(backend,/benefitTypes=new Set/);
 assert.match(backend,/Avantage incomplet/);
 assert.match(index,/salary-benefit-questionnaire\.js/);
 assert.match(app,/benefits_in_kind:benefits/);
});
