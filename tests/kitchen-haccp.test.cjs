"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
test("Cuisine : fichiers autonomes et scripts valides",()=>{
 const html=read("cuisine/index.html"),script=read("cuisine/cuisine.js"),admin=read("college/admin/cuisine-admin.js");
 assert.match(html,/src="\.\/cuisine\.js\?v=/);
 assert.match(html,/id="startReheat"|id="content"/);
 assert.match(script,/start-reheat/);
 assert.match(script,/finish-reheat/);
 assert.match(script,/cold-reading/);
 assert.match(script,/task-check/);
 assert.match(script,/data-due/);
 assert.match(script,/name="cold_room_id"/);
 assert.match(script,/name="dish_type_id"/);
 assert.match(script,/name="oven_id"/);
 assert.doesNotMatch(script,/name="service_number"/);
 assert.match(admin,/data-room-edit/);
 assert.match(admin,/kitchenAddOven/);
 assert.match(admin,/kitchenAddDish/);
 assert.match(admin,/kitchenSaveDefaults/);
 new vm.Script(script,{filename:"cuisine.js"});new vm.Script(admin,{filename:"cuisine-admin.js"});
});
test("Cuisine : l'administration et les accès proposent les deux espaces",()=>{
 const html=read("college/admin/index.html"),links=read("admin/acces.html"),workspace=read("college/workspace-layout.js");
 assert.match(html,/cuisine:'Gestion Cuisine'/);
 assert.match(html,/cuisine:window\.kitchenAdminPage/);
 assert.match(html,/cuisine-admin\.js/);
 assert.match(links,/ROOT\+'cuisine\/'/);
 assert.match(workspace,/link\("Cuisine","cuisine\/"\)/);
});

test("Cuisine : les températures finales restent bloquées avant les cinq dernières minutes",()=>{
 const script=read("cuisine/cuisine.js"),html=read("cuisine/index.html");
 assert.match(script,/remainingMs\(due\)<5\*60\*1000/);
 assert.match(script,/input\.disabled=!unlocked/);
 assert.match(script,/button\.disabled=!unlocked/);
 assert.match(script,/!canFinish\(form\.dataset\.due\)/);
 assert.match(script,/const key=r\.id\+":"\+stage/);
 assert.match(script,/stage==="five"/);
 assert.match(script,/stage==="zero"/);
 assert.match(script,/enableKitchenAlarm/);
 assert.match(html,/cuisine\.js\?v=20261120-4/);
});

test("Cuisine : navigation agent guidée et rubriques administration séparées",()=>{
 const html=read("cuisine/index.html"),js=read("cuisine/cuisine.js");
 const admin=read("college/admin/cuisine-admin.js"),adminHtml=read("college/admin/index.html");
 for(const tab of ["dashboard","reheat","cold","tasks"])assert.match(html,new RegExp('data-page="'+tab+'"'));
 assert.match(html,/id="loginForm"/);
 assert.match(js,/function renderDashboard\(\)/);
 assert.match(js,/function switchPage\(next\)/);
 assert.match(js,/function renderCold\(\)/);
 assert.match(js,/function renderReheat\(\)/);
 assert.match(js,/function renderTasks\(\)/);
 assert.match(js,/function checkReheatAlarms\(\)/);
 assert.match(admin,/kitchenTab="overview"/);
 assert.match(admin,/kitchen-section-intro/);
 assert.match(admin,/data-kitchen-tab/);
 assert.match(html,/cuisine\.js\?v=20261120-5/);
 assert.match(adminHtml,/cuisine-admin\.js\?v=20261120-5/);
});
