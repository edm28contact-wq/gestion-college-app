"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const migration=read("supabase/migrations/20261124184136_kitchen_cleaning_protocol7_monthly_and_on_demand.sql"),api=read("supabase/functions/kitchen-api/index.ts"),ui=read("cuisine/cuisine.js");
test("Nettoyage protocole 7 : les quatre lignes demandées sont indépendantes",()=>{
 for(const label of ["Bacs à vaisselle","Bacs à légumes","Sanitaires","Vestiaires"]) assert.ok(migration.includes("('"+label+"','daily')"));
 assert.match(migration,/v_count<>29/);assert.match(migration,/old_checks/);
});
test("Nettoyage : fréquence mensuelle affichée et paramétrable",()=>{
 const ctx={window:{}};vm.runInNewContext(read("cuisine/kitchen-ui.js"),ctx);
 assert.match(ctx.window.KitchenUI.scheduleLabel({recurrence:"monthly",weekdays:[5]}),/Une fois par mois : 1er Ven/);
 assert.match(migration,/extract\(day from p_day\)<=7/);
 assert.match(api,/recurrence==="monthly"&&new Set\(weekdays\).size!==1/);
});
test("Nettoyage : la friteuse selon utilisation ne fausse pas les obligations quotidiennes",()=>{
 assert.ok(migration.includes("('Friteuse / huile','on_demand')"));
 assert.match(migration,/when 'on_demand' then false/);
 assert.match(api,/optional_tasks:tasks\.filter/);
 assert.match(ui,/Valider si utilisée/);
 assert.match(ui,/Tâches selon utilisation/);
 assert.match(api,/active:t\.scheduled\|\|checked\.has\(t\.id\)/);
});
