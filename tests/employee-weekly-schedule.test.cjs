"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("college/admin/salaires.js","utf8");
const backend=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20261124083911_college_personnel_weekly_work_slots.sql","utf8");
const ctx={esc:s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))};
vm.createContext(ctx);
vm.runInContext(source+"\nthis.api={salaryWorkSlotSummary,salaryHoursBreakdown,salaryWeeklyScheduleHtml,salaryHoursResultHtml,salaryCalendars,salaryPayrollPanel};",ctx);
const a=ctx.api,slot=(day,start,end)=>({day,start,end});
const staff={id:"example",working_weekdays:[1,2,4,5],exclude_public_holidays:true,exclude_school_holidays:false,
 weekly_work_slots:[slot(1,"08:00","12:00"),slot(1,"13:00","16:00"),slot(2,"09:00","13:00"),slot(4,"08:00","12:00"),slot(5,"08:00","12:00"),slot(5,"13:00","16:00")]};
test("Horaires : pause non travaillée et journées de durées différentes",()=>{
 const r=a.salaryWorkSlotSummary(staff.working_weekdays,staff.weekly_work_slots);
 assert.equal(r.error,"");assert.equal(r.weeklyMinutes,22*60);assert.equal(r.minutesByDay[1],420);assert.equal(r.minutesByDay[3],0);
});
test("Horaires : calcul mensuel selon le jour de semaine, sans compter un mercredi non travaillé",()=>{
 a.salaryCalendars.set("2026-11",{holidays:[{date:"2026-11-11"},{date:"2026-11-01"}],vacations:[]});
 const r=a.salaryHoursBreakdown(staff,"2026-11");
 // Novembre 2026 : cinq lundis, quatre mardis, quatre jeudis, quatre vendredis.
 assert.equal(r.monthlyMinutes,(5*7+4*4+4*4+4*7)*60);
 a.salaryCalendars.set("2026-11",{holidays:[{date:"2026-11-02"}],vacations:[{start:"2026-11-01",end:"2026-11-06"}]});
 const school=a.salaryHoursBreakdown({...staff,exclude_school_holidays:true},"2026-11");
 // Lundi férié déduit une seule fois, mardi et jeudi en vacances, mercredi déjà non travaillé.
 assert.equal(school.monthlyMinutes,(95-7-4-4)*60);assert.equal(school.calendar.publicDays,1);assert.equal(school.calendar.schoolDays,2);
});
test("Horaires : aucune durée fictive lorsque des créneaux ou calendriers manquent",()=>{
 assert.equal(a.salaryWorkSlotSummary([1,2],[slot(1,"08:00","12:00")]).weeklyMinutes,null);
 assert.equal(a.salaryHoursBreakdown(staff,"2026-12").monthlyMinutes,null);
 assert.equal(a.salaryWorkSlotSummary([],[]).weeklyMinutes,0);
 assert.match(a.salaryHoursResultHtml({...staff,weekly_work_slots:[]},"2026-11"),/Horaires à compléter/);
});
test("Horaires : refus des plages inversées, chevauchantes, incomplètes ou hors plage",()=>{
 for(const slots of [
  [slot(1,"12:00","08:00")],
  [slot(1,"08:00","12:00"),slot(1,"11:59","15:00")],
  [slot(1,"08:00","")],[slot(1,"25:00","26:00")],[slot(1,"12:00","12:00")]
 ])assert.ok(a.salaryWorkSlotSummary([1],slots).error);
 assert.equal(a.salaryWorkSlotSummary([1],[slot(1,"08:00","12:00"),slot(1,"12:00","15:00")]).weeklyMinutes,420);
 assert.equal(a.salaryWorkSlotSummary([1],[slot(1,"08:00","12:00"),slot(3,"08:00","12:00")]).slots.length,1);
});
test("Horaires : formulaire multi-créneaux et consultation seule",()=>{
 const html=a.salaryWeeklyScheduleHtml(staff.working_weekdays,staff.weekly_work_slots,true);
 assert.match(html,/Lundi/);assert.match(html,/Mercredi/);assert.match(html,/Repos/);assert.match(html,/data-work-slot="1"/);
 assert.match(html,/data-add-work-slot="1" disabled/);assert.match(html,/data-work-start value="08:00" disabled/);
 assert.match(html,/data-remove-work-slot="1:1"/);
});
test("Horaires : sauvegarde côté serveur validée, protection des droits et concurrence",()=>{
 assert.match(backend,/staff-payroll-update"&&req\.method==="POST"\)\{\s*if\(!user\.salaryWrite\)/);
 assert.match(backend,/college_valid_weekly_work_slots/);assert.match(backend,/weekly_work_slots:cleanSlots/);
 assert.match(backend,/\.eq\("updated_at",current\.data\.updated_at\)/);
 assert.match(source,/weekly_work_slots:schedule\.slots/);
 assert.match(migration,/college_personnel_weekly_work_slots_check/);
 assert.match(migration,/revoke execute.+from public,anon,authenticated/i);
});
