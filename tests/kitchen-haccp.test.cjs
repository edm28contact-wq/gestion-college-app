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

test("Cuisine : le rappel reste actif et un agent peut mesurer avant les cinq dernières minutes",()=>{
 const script=read("cuisine/cuisine.js"),html=read("cuisine/index.html");
 assert.match(script,/remainingMs\(due\)<5\*60\*1000/);
 assert.match(script,/input\.disabled=!unlocked/);
 assert.match(script,/button\.disabled=!unlocked/);
 assert.match(script,/!canRecordReheat\(\)/);
 assert.match(script,/const canRecordReheat=\(\)=>data\?\.me\.scope==="staff"&&!data\.me\.existingAccount/);
 assert.match(read("supabase/functions/kitchen-api/index.ts"),/elapsedMs<=60\*60000/);
 assert.doesNotMatch(read("supabase/functions/kitchen-api/index.ts"),/Saisie finale verrouillée/);
 assert.match(script,/const key=r\.id\+":"\+stage/);
 assert.match(script,/stage==="five"/);
 assert.match(script,/stage==="zero"/);
 assert.match(script,/enableKitchenAlarm/);
 assert.match(html,/cuisine\.js\?v=\d{8}-[a-z0-9.-]+/);
});

test("Cuisine : navigation agent guidée et rubriques administration séparées",()=>{
 const html=read("cuisine/index.html"),js=read("cuisine/cuisine.js");
 const admin=read("college/admin/cuisine-admin.js"),adminHtml=read("college/admin/index.html");
 for(const section of ["dailyTasks","sensorResults"])assert.match(html,new RegExp('data-section="'+section+'"'));
 assert.doesNotMatch(html,/data-page="pms"/);
 assert.match(js,/data-go="reheat"/);assert.match(js,/data-go="cold"/);
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
 assert.match(html,/cuisine\.js\?v=\d{8}-[a-z0-9.-]+/);
 assert.match(adminHtml,/cuisine-admin\.js\?v=\d{8}-[a-z0-9.-]+/);
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
 assert.match(kitchen,/current\.source==='govee_cloud'/);
});

test("Cuisine : l’archivage et la suppression conservent les contrôles historiques",()=>{
 const admin=read("college/admin/cuisine-admin.js"),kitchen=read("cuisine/cuisine.js");
 assert.match(admin,/data-archive-room/);
 assert.match(admin,/data-delete-room/);
 assert.match(admin,/request-room-delete-code/);
 assert.match(admin,/delete-room/);
 assert.match(kitchen,/function activeRooms\(\)/);
 assert.match(kitchen,/!r\.archived_at&&!r\.deleted_at/);
 assert.match(read("college/admin/index.html"),/cuisine-admin\.js\?v=\d{8}-[a-z0-9.-]+/);
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

test("Cuisine : relevés manuels côté agent et exports complets réservés à l’administration",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const kitchen=read("cuisine/cuisine.js");
 const reports=read("cuisine/releve-export.js");
 assert.match(kitchen,/data-cold="/);
 assert.match(admin,/id="adminColdRoomSelector"/);
 assert.doesNotMatch(kitchen,/data-cold-export=/);
 assert.match(admin,/data-admin-cold-export="csv"/);
 assert.match(admin,/data-admin-cold-export="pdf"/);
 assert.doesNotMatch(kitchen,/cold-history/);
 assert.match(admin,/cold-history/);
 assert.match(reports,/for\(let offset=0;offset<=1000000;offset\+=step\)/);
 assert.match(reports,/page\.has_more/);
 assert.match(reports,/window\.CuisineReports=/);
 assert.match(reports,/new jsPDF/);
 assert.doesNotMatch(read("cuisine/index.html"),/releve-export\.js/);
 assert.match(read("college/admin/index.html"),/releve-export\.js/);
 new vm.Script(reports,{filename:"releve-export.js"});
});
test("Cuisine : un rappel dépassé n'est pas une anomalie thermique",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const kitchen=read("cuisine/cuisine.js");
 assert.match(admin,/Température cible atteinte/);
 assert.match(admin,/Relevé après le rappel/);
 assert.match(kitchen,/Contrôle attendu/);
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
 assert.match(read("college/admin/index.html"),/releve-export\.js\?v=\d{8}-[a-z0-9.-]+/);
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

test("Cuisine : une seule clé Govee et diagnostic immédiat après saisie",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(admin,/id="kitchenGoveeApiKey"/);
 assert.match(admin,/id="kitchenGoveeSaveAndTest"/);
 assert.match(admin,/id="kitchenGoveeQuickTest"/);
 assert.match(admin,/function saveGoveeKeyAndTest/);
 assert.match(admin,/await api\("govee-save-key","POST"/);
 assert.match(admin,/await testGoveeConnection\(\)/);
 assert.match(admin,/await api\("govee-test"\)/);
 assert.match(admin,/id="kitchenGoveeTestResult"/);
 assert.match(admin,/\["govee","Connexion Govee"\]/);
 assert.match(read("college/admin/index.html"),/cuisine-admin\.js\?v=\d{8}-[a-z0-9.-]+/);
});

test("Cuisine : valeurs Fahrenheit H5179 affichées en Celsius et H5192 isolé",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(admin,/d\.temperature_c/);
 assert.match(admin,/d\.raw_temperature/);
 assert.match(admin,/d\.raw_unit/);
 assert.match(admin,/d\.sku==="H5179"/);
 assert.match(admin,/Fahrenheit/);
 assert.match(admin,/H5192/);
 const toC=value=>Math.round((value-32)*5/9*100)/100;
 assert.equal(toC(32),0);
 assert.equal(toC(-0.4),-18);
 assert.equal(toC(212),100);
});

test("Espace Cuisine : tâches personnelles, communes, facultatives et validées séparées",()=>{
 const script=read("cuisine/cuisine.js"),start=script.indexOf("function visibleTasks("),end=script.indexOf("async function save(action,body)");
 assert.ok(start>=0&&end>start);
 const today="2026-11-24",common={id:"common",label:"Bacs à légumes",active:true,scheduled:true},mine={id:"mine",label:"Vestiaires",assigned_to:"a",active:true,scheduled:true},other={id:"other",label:"Tâche autre agent",assigned_to:"b",active:true,scheduled:true},done={id:"done",label:"Sanitaires",active:true,scheduled:true},optional={id:"optional",label:"Friteuse",active:true,scheduled:false};
 const context={data:{me:{scope:"staff",id:"a"},tasks:[common,mine,other,done],optional_tasks:[optional],checks:[{task_id:"done",performed_on:today,photo_bytes:100}],reheats:[]},today:()=>today,canRecordReheat:()=>true,esc:v=>String(v??""),clock:()=>"12:00",staffName:()=>"Agent"};
 const html=vm.runInNewContext(script.slice(start,end)+";renderTasks()",context);
 assert.match(html,/2 à réaliser · 1 \/ 3 validées/);
 assert.match(html,/Bacs à légumes/);assert.match(html,/Vestiaires/);assert.doesNotMatch(html,/Tâche autre agent/);
 assert.match(html,/Tâches selon utilisation/);assert.match(html,/Valider si utilisée · Photo/);
 assert.match(html,/Checklist de nettoyage/);assert.match(html,/Photo enregistrée/);
 assert.equal((html.match(/aria-checked="true"/g)||[]).length,1);
 assert.equal((html.match(/aria-checked="false"/g)||[]).length,3);
 assert.match(html,/aria-valuenow="33"/);
 assert.match(html,/aria-checked="true"[^>]* disabled/);
 assert.match(html,/aria-checked="false"[^>]*data-task="common"/);
 assert.doesNotMatch(html,/data-edit-kitchen-task|data-add-kitchen-task/);
});
test("Espace Cuisine : deux accès, sondes réelles et administration séparée",()=>{
 const html=read("cuisine/index.html"),script=read("cuisine/cuisine.js"),meater=read("cuisine/meater-ui.js");
 assert.equal((html.match(/data-section="/g)||[]).length,2);
 assert.match(html,/data-section="dailyTasks"/);assert.match(html,/data-section="sensorResults"/);
 assert.match(script,/renderColdOverview\(\)/);assert.match(script,/KitchenMeater\.mountDashboard/);
 assert.match(script,/kitchenAdminLink"\)\.hidden=data\.me\.scope!=="admin"/);
 assert.doesNotMatch(html,/pms-ui\.js|releve-export\.js/);
 assert.match(meater,/Aucune sonde associée\. Aucune mesure disponible/);
 assert.match(meater,/function mountKitchen\(root,api,getData,\{showTiles=true\}/);
 assert.match(script,/showTiles:false/);
});
