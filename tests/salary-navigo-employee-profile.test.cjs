"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const calc=require("../college/admin/salary-navigo-profile.js");
const rates=require("../college/admin/legal-payroll-rules.js");
const page=fs.readFileSync("college/admin/salaires.js","utf8");
const html=fs.readFileSync("college/admin/index.html","utf8");
const declarations=fs.readFileSync("college/admin/salary-profile-declaration.js","utf8");
const backend=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20261127120000_college_personnel_navigo_contract_hours.sql","utf8");
test("Navigo Mois 1–5 : calcul mensuel automatique dans la fiche salarié",()=>{
 const beneficiary={id:"person1",navigo_reimbursement:true,navigo_contract_weekly_hours:35,navigo_full_time_weekly_hours:35};
 const nov=calc.calculate(beneficiary,"2026-11",{},rates);
 assert.equal(nov.status,"ok");
 assert.equal(nov.amountCents,4540);
 assert.equal(nov.monthlyPriceCents,9080);
 assert.equal(calc.calculate(beneficiary,"2026-01",{},rates).amountCents,4540);
 const contractPartTime={...beneficiary,navigo_contract_weekly_hours:14};
 const reduced=calc.calculate(contractPartTime,"2026-11",{},rates);
 assert.equal(reduced.status,"ok");
 assert.ok(reduced.amountCents<nov.amountCents);
 assert.equal(reduced.partTimeFactor,0.8);
});
test("Pas de contrat inventé : montant provisoire et 3 exclusions à zéro",()=>{
 const eligible={id:"p",navigo_reimbursement:true,navigo_contract_weekly_hours:null,navigo_full_time_weekly_hours:null};
 const result=calc.calculate(eligible,"2026-11",{},rates);
 assert.equal(result.status,"missing");
 assert.equal(result.amountCents,null);
 assert.equal(result.referenceAmountCents,4540);
 const notEligible=calc.calculate({...eligible,navigo_reimbursement:false},"2026-11",{},rates);
 assert.equal(notEligible.status,"excluded");
 assert.equal(notEligible.amountCents,0);
 assert.equal(calc.calculate({...eligible,navigo_contract_weekly_hours:35,navigo_full_time_weekly_hours:35},"2027-01",{},rates).status,"unknown");
});
test("La durée contractuelle est persistante, complète et validée avant sauvegarde",()=>{
 assert.equal(calc.validPair("35","35").ok,true);
 assert.equal(calc.validPair("14,50","35").ok,true);
 assert.equal(calc.validPair("35","20").ok,false);
 assert.equal(calc.validPair("14","").ok,false);
 assert.equal(calc.validPair("","").ok,true);
 assert.match(migration,/college_personnel_navigo_hours_valid/);
 assert.match(migration,/navigo_contract_weekly_hours <= navigo_full_time_weekly_hours/);
 assert.match(backend,/action==="staff-navigo-contract-update"/);
 assert.match(backend,/if\(!user\.salaryWrite\)return reply/);
 assert.match(backend,/\.eq\("id",x\.id\)\.eq\("updated_at",x\.updated_at\)/);
});
test("Fiche salarié : calculation actualisée sans modifier les virements ni les avantages",()=>{
 assert.match(page,/window\.ChambertinNavigoProfile\?\.html\(staff,month,salaryCanWrite\)/);
 assert.match(page,/window\.ChambertinNavigoProfile\?\.mount/);
 assert.match(page,/window\.ChambertinNavigoProfile\?\.refresh/);
 assert.match(declarations,/function navigoState\(id,month\)/);
 assert.match(declarations,/transport:String\(state\.base\.transport\|\|""\)/);
 assert.match(html,/salary-navigo-profile\.js\?v=20261127-navigo2/);
 assert.match(html,/salaires\.js\?v=20261127-navigo3/);
 assert.match(html,/salary-profile-declaration\.js\?v=20261127-navigo2/);
 const row=calc.html({id:"x",navigo_reimbursement:true},"2026-11",true);
 assert.match(row,/salaryNavigoAmount/);
 assert.match(row,/salaryNavigoDeclared/);
 assert.match(row,/salaryNavigoWeeklyHours/);
 assert.match(row,/salaryNavigoSave/);
 assert.match(row,/bulletins déjà émis et les nets à virer ne sont pas modifiés/);
 const endpoint=backend.slice(backend.indexOf('if(action==="staff-navigo-contract-update"'),backend.indexOf('if(action==="staff-profile-update"'));
 assert.doesNotMatch(endpoint,/college_payroll_months|benefits_in_kind|payments|declarations|transport:/);
});

test("Liste salariés : montant Navigo mensuel visible, contrat manquant signalé et exclusions respectées",()=>{
 const vm=require("node:vm");
 const start=page.indexOf("function salaryStaffNavigoCell(staff,month){");
 const end=page.indexOf("function salaryStaffPanel(){",start);
 assert.ok(start>0&&end>start);
 const context={window:{ChambertinLegalPayroll:rates,ChambertinNavigoProfile:calc},
  esc:v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")};
 vm.runInNewContext(page.slice(start,end)+";globalThis.render=salaryStaffNavigoCell;",context);
 const eligible={id:"p",archived:false,navigo_reimbursement:true,
  navigo_contract_weekly_hours:null,navigo_full_time_weekly_hours:null};
 const indicative=context.render(eligible,"2026-11");
 assert.match(indicative,/45,40/);
 assert.match(indicative,/horaires contractuels à compléter/);
 assert.match(context.render({...eligible,navigo_contract_weekly_hours:35,navigo_full_time_weekly_hours:35},"2026-11"),/45,40/);
 assert.match(context.render({...eligible,navigo_reimbursement:false},"2026-11"),/0,00/);
 assert.match(context.render({...eligible,archived:true},"2026-11"),/Archivé/);
 assert.match(context.render(eligible,"2027-01"),/non confirmé/);
 assert.match(page,/data-salary-staff-navigo/);
 assert.match(page,/salaryStaffNavigoMonth/);
 assert.match(page,/salaryRefreshStaffNavigoCells/);
 assert.match(page,/Navigo Mois zones 1–5 \(50 %\)/);
});
