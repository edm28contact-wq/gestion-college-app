"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("college/admin/salaires.js","utf8");
const admin=fs.readFileSync("college/admin/index.html","utf8");
const start=source.indexOf("function salaryStaffKey("),end=source.indexOf("function salaryStaffProfilePanel(");
assert.ok(start>=0&&end>start);
const ctx={};vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+"\nthis.testApi={salaryStaffKey,salaryLateMinutes,salaryProfileTotals,salaryFormatLate};",ctx);
const api=ctx.testApi;
const entry=(date,type,minutes,extra={})=>({id:date+type,event_date:date,event_type:type,duration_minutes:minutes,all_day:false,...extra});
test("Un retard de 1h30 et 20min totalise 1h50 au mois, sans absences ni départs",()=>{
 const events=[entry("2026-11-04","retard",90),entry("2026-11-05","retard",20),entry("2026-11-06","absence",1440,{all_day:true}),entry("2026-11-07","depart_anticipe",60),entry("2026-11-08","incident",40)];
 const t=api.salaryProfileTotals(events,"2026-11");
 assert.equal(t.monthMinutes,110);assert.equal(t.yearMinutes,110);
 assert.equal(t.monthCount,2);assert.equal(t.incidentCount,1);
 assert.equal(api.salaryFormatLate(t.monthMinutes),"1 h 50");
});
test("Le cumul annuel inclut les autres mois de l’année, mais pas l’année précédente",()=>{
 const list=[entry("2026-01-14","retard",35),entry("2026-11-04","retard",60),entry("2025-12-10","retard",15)];
 const nov=api.salaryProfileTotals(list,"2026-11"),jan=api.salaryProfileTotals(list,"2026-01");
 assert.equal(nov.monthMinutes,60);assert.equal(nov.yearMinutes,95);assert.equal(jan.monthMinutes,35);
 assert.equal(jan.yearMinutes,95);
});
test("Durées manquantes signalées mais exclues du cumul; jamais de journée convertie en retard",()=>{
 const events=[entry("2026-11-01","retard",null),entry("2026-11-02","retard",1440,{all_day:true}),entry("2026-11-03","retard",null,{start_time:"08:30",end_time:"09:00"})];
 const t=api.salaryProfileTotals(events,"2026-11");
 assert.equal(t.monthMinutes,30);assert.equal(t.monthCount,3);assert.equal(t.monthMissing,2);
});
test("Identité exacte normalisée : accents et espaces, aucun appariement de simple prénom",()=>{
 assert.equal(api.salaryStaffKey("Élodie   Dupont"),api.salaryStaffKey("Elodie Dupont"));
 assert.notEqual(api.salaryStaffKey("Elodie Dupont"),api.salaryStaffKey("Elodie"));
});
test("Fiche individuelle réservée à la page des salaires; toutes les périodes, lecture seule",()=>{
 assert.match(source,/data-salary-staff-profile/);
 assert.match(source,/salaryStaffProfilePanel\(\)/);
 assert.match(source,/call\(ROOT\+"\/personnel-planning","admin-months"\)/);
 assert.match(source,/call\(ROOT\+"\/personnel-planning","admin-list","GET"/);
 assert.match(source,/salaryStaffKey\(e\.personnel_name\)===employeeKey/);
 assert.match(source,/data-salary-profile-pdf/);
 assert.match(admin,/salary-profile-kpis/);
 assert.match(admin,/salaires\.js\?v=20261119-employee-totals-v2/);
});

test("Départs anticipés et incidents sont totalisés séparément sans fabriquer des retards",()=>{
 const events=[
  entry("2026-11-04","depart_anticipe",90),
  entry("2026-11-07","depart_anticipe",35),
  entry("2026-11-08","incident",40),
  entry("2026-11-10","incident",null),
  entry("2026-10-09","depart_anticipe",75),
  entry("2025-11-01","depart_anticipe",60),
  entry("2026-11-12","absence",1440,{all_day:true})
 ];
 const t=api.salaryProfileTotals(events,"2026-11");
 assert.equal(t.monthMinutes,0);assert.equal(t.yearMinutes,0);
 assert.equal(t.earlyMonthMinutes,125);assert.equal(t.earlyYearMinutes,200);
 assert.equal(t.incidentMonthMinutes,40);assert.equal(t.incidentYearMissing,1);
 assert.equal(t.incidentMonthCount,2);assert.equal(t.absenceMonthCount,1);
 assert.equal(t.earlyYearCount,3);
});
test("La fiche indique explicitement les retards non saisis et les autres catégories",()=>{
 assert.match(source,/Aucun retard enregistré pour/);
 assert.match(source,/salary-profile-secondary/);
 assert.match(source,/salaryFormatLate\(totals.earlyMonthMinutes\)/);
 assert.match(source,/salaryFormatLate\(totals.incidentYearMinutes\)/);
});
