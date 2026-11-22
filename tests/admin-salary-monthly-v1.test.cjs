"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const calculation=fs.readFileSync("college/admin/salary-calculations.js","utf8");
const frontend=fs.readFileSync("college/admin/salary-payroll.js","utf8");
const back=fs.readFileSync("backend/salary-profiles/index.ts","utf8");
const sql=fs.readFileSync("backend/salary-profiles/schema.sql","utf8");
const salary=fs.readFileSync("college/admin/salaires.js","utf8");
const page=fs.readFileSync("college/admin/index.html","utf8");
const ctx={};vm.createContext(ctx);vm.runInContext(calculation,ctx);
const calc=ctx.CollegeSalaryCalc;
const plain=value=>JSON.parse(JSON.stringify(value));
test("MEDJEBER et MOREL ne travaillent jamais le mercredi par défaut",()=>{
 for(const name of ["MEDJEBER","Morel","Jean-Marc MOREL","medjeber A."]){
  assert.deepEqual(plain(calc.defaultWeekdays(name)),[1,2,4,5]);
 }
 assert.deepEqual(plain(calc.defaultWeekdays("SIMON")),[1,2,3,4,5]);
 assert.doesNotMatch("MEJE".toUpperCase(),/MEDJEBER|MOREL/);
 assert.match(frontend,/noWednesday&&n===3\?" disabled"/);
 assert.match(back,/days\.includes\(3\)/);
});
test("Novembre 2026 : mercredi férié retiré de lundi-vendredi, et aucun mercredi pour MOREL",()=>{
 assert.equal(calc.workingDays("2026-11"),20);
 assert.equal(calc.workingDays("2026-11",[1,2,4,5]),17);
 assert.equal(calc.workingDays("2026-11",[3]),3);
 assert.equal(calc.workingDays("2026-11",[]),null);
});
test("Taux et heures théoriques fondés sur les quatre jours hebdomadaires, pas cinq",()=>{
 const p={base_salary_gross:2400,bonus_gross:100,weekly_hours:28,working_days:[1,2,4,5],
  actual_hours:null,benefits_in_kind:[{label:"Repas",amount:60},{label:"Logement",amount:180}]};
 const r=calc.calculate(p,"2026-11");
 assert.equal(r.working_days,17);
 assert.equal(r.theoretical_work_hours,119);
 assert.equal(r.monthly_contract_hours,121.33);
 assert.equal(r.hourly_gross,19.7802);
 assert.equal(r.actual_hours,null);
 assert.equal(r.estimated_gross,2500);
 assert.equal(r.benefits_total,240);
 assert.equal(r.reference_gross_with_benefits,2740);
});
test("Décompte des avantages multiples sans les confondre avec de l'argent versé",()=>{
 const p={base_salary_gross:1800,bonus_gross:0,weekly_hours:24,
  benefits_in_kind:[{label:"Repas",amount:35},{label:"Logement",amount:90}]};
 assert.equal(calc.calculate(p,"2026-11").estimated_gross,1800);
 assert.equal(calc.calculate(p,"2026-11").benefits_total,125);
 assert.equal(calc.calculate(p,"2026-11").reference_gross_with_benefits,1925);
 assert.match(frontend,/data-salary-benefit-remove/);
 assert.match(frontend,/salaryBenefitAdd/);
});
test("Aucune heure réelle inventée : saisie vide reste indéterminée",()=>{
 const v=calc.calculate({base_salary_gross:2000,bonus_gross:100,weekly_hours:35,working_days:[1,2,3,4,5],actual_hours:null},"2026-11");
 assert.equal(v.actual_hours,null);assert.equal(v.actual_confirmed,false);
});
test("Saisie mensuelle, version optimiste et contrôles des listes d'avantages côté serveur",()=>{
 assert.match(back,/validWeekdays\(days\)/);
 assert.match(back,/benefits\(body\.benefits_in_kind\)/);
 assert.match(back,/body\.version\+1/);
 assert.match(back,/\.eq\("version",body\.version\)/);
 assert.match(back,/row\.data\.role!=="admin"/);
 assert.match(back,/crypto\.subtle\.verify\("HMAC"/);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.college_salary_monthly from PUBLIC, anon, authenticated/);
 assert.match(sql,/benefits_in_kind jsonb/);
 assert.match(sql,/working_days smallint\[\]/);
});
test("Le menu Salaires utilise le nouvel éditeur sans écraser le suivi existant",()=>{
 assert.match(salary,/salaryPayrollOverview\(\)/);
 assert.match(salary,/salaryPayrollPanel\(\)/);
 assert.match(salary,/salaryStaffProfilePanel\(\)/);
 assert.match(salary,/salaryPayrollWire\(\)/);
 assert.match(page,/salary-calculations\.js/);
 assert.match(page,/salary-payroll\.js/);
});
