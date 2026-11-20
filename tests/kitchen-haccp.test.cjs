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
 assert.match(html,/cuisine\.js\?v=20261120-11/);
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
 assert.match(admin,/b\.dataset\.kitchenTab/);
 assert.match(html,/cuisine\.js\?v=20261120-11/);
 assert.match(adminHtml,/cuisine-admin\.js\?v=20261120-12/);
});

test("Cuisine : raccordement Govee identifiable et provenance des relevés préservée",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const kitchen=read("cuisine/cuisine.js");
 assert.match(admin,/kitchenGoveeKey/);
 assert.match(admin,/govee-save-key/);
 assert.match(admin,/govee-discover/);
 assert.match(admin,/govee-add-sensor/);
 assert.match(admin,/govee-sync/);
 assert.match(admin,/kitchenProbeRegister/);
 assert.match(admin,/testo 104-IR BT/);
 assert.match(kitchen,/sensor\.status==='online'/);
 assert.match(kitchen,/r\.source==='govee_cloud'/);
});

test("Cuisine : l’archivage et la suppression conservent les contrôles historiques",()=>{
 const admin=read("college/admin/cuisine-admin.js"),kitchen=read("cuisine/cuisine.js");
 assert.match(admin,/data-archive-room/);
 assert.match(admin,/data-delete-room/);
 assert.match(admin,/request-room-delete-code/);
 assert.match(admin,/delete-room/);
 assert.match(kitchen,/function activeRooms\(\)/);
 assert.match(kitchen,/!r\.archived_at&&!r\.deleted_at/);
 assert.match(read("college/admin/index.html"),/cuisine-admin\.js\?v=20261120-12/);
});

test("Cuisine : alerte prioritaire persistante et son répétitif sans faux contrôle",()=>{
 const html=read("cuisine/index.html"),script=read("cuisine/cuisine.js");
 assert.match(html,/id="kitchenCriticalAlert"/);
 assert.match(html,/id="kitchenAlertGo"/);
 assert.match(html,/id="kitchenAlertMute"/);
 assert.match(html,/role="alert"/);
 assert.match(script,/function activeCriticalCycles\(\)/);
 assert.match(script,/function updateCriticalAlert\(\)/);
 assert.match(script,/function silenceAlarm\(\)/);
 assert.match(script,/now-lastSirenAt>=12000/);
 assert.match(script,/alarmSilenced/);
 assert.match(script,/switchPage\("reheat"\)/);
 assert.match(script,/if\(!active\.length\)/);
 assert.match(script,/status==="en_cours"&&canFinish/);
});

test("Cuisine : choisir les chambres et exporter la totalité des relevés",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const kitchen=read("cuisine/cuisine.js");
 const reports=read("cuisine/releve-export.js");
 assert.match(kitchen,/id="coldRoomSelector"/);
 assert.match(admin,/id="adminColdRoomSelector"/);
 assert.match(kitchen,/data-cold-export="csv"/);
 assert.match(kitchen,/data-cold-export="pdf"/);
 assert.match(admin,/data-admin-cold-export="csv"/);
 assert.match(admin,/data-admin-cold-export="pdf"/);
 assert.match(kitchen,/cold-history/);
 assert.match(admin,/cold-history/);
 assert.match(reports,/for\(let offset=0;offset<=1000000;offset\+=step\)/);
 assert.match(reports,/page\.has_more/);
 assert.match(reports,/window\.CuisineReports=/);
 assert.match(reports,/new jsPDF/);
 assert.match(read("cuisine/index.html"),/releve-export\.js/);
 assert.match(read("college/admin/index.html"),/releve-export\.js/);
 new vm.Script(reports,{filename:"releve-export.js"});
});
test("Cuisine : un rappel dépassé n'est pas une anomalie thermique",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const kitchen=read("cuisine/cuisine.js");
 assert.match(admin,/Température cible atteinte/);
 assert.match(admin,/Relevé après le rappel/);
 assert.match(kitchen,/Mesure enregistrée après le rappel/);
});

test("Cuisine : une mesure froide recontrôlée ne déclenche pas une alerte actuelle",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const agent=read("cuisine/cuisine.js");
 assert.match(admin,/latestCold=new Map/);
 assert.match(admin,/followedByGood=/);
 assert.match(admin,/Ancien écart/);
 assert.match(agent,/\.\.\.latestByRoom\(\)\.values\(\)/);
 assert.match(agent,/nécessitant une vérification/);
});

test("Cuisine : chaque thermomètre Govee est affectable à une seule chambre",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(admin,/data-govee-room/);
 assert.match(admin,/govee-reassign-sensor/);
 assert.match(admin,/other\.room_id===r\.id/);
 assert.match(admin,/r\.id===d\.room_id/);
 assert.match(admin,/data-govee-associate/);
});
test("Cuisine : exporter le suivi des tâches ménagères en PDF à une date choisie",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const pdf=read("cuisine/releve-export.js");
 assert.match(admin,/id="kitchenTasksReportDate"/);
 assert.match(admin,/id="kitchenTasksPdf"/);
 assert.match(admin,/action:"task-report"/);
 assert.match(admin,/CuisineReports\.tasksPdf/);
 assert.match(pdf,/async function tasksPdf/);
 assert.match(pdf,/const byTask=new Map/);
 assert.match(pdf,/Non validee/);
 assert.match(pdf,/Validee/);
 assert.match(pdf,/Une tache non validee/);
 assert.match(read("college/admin/index.html"),/releve-export\.js\?v=20261120-2/);
});
test("Cuisine : l’admin invalide les fautes de saisie avec conservation de l’audit",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(admin,/kitchenCorrectionDialog/);
 assert.match(admin,/invalidate-cold-reading/);
 assert.match(admin,/Journal des relevés invalidés/);
 assert.match(admin,/invalidation_reason/);
 assert.match(admin,/Documenter sans invalider/);
 assert.match(admin,/valeur originale/);
});
