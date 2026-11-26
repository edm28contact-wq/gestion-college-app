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
 assert.match(admin,/api\("govee-test"\)/);
 assert.match(admin,/goveeCards\(snapshot,goveeDiscovery\)/);
 assert.match(admin,/e\(d\.device\)/);
 assert.match(read("supabase/functions/kitchen-api/index.ts"),/devices:checked,discovered/);
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
 assert.match(admin,/d\.device_identifier!==device&&d\.room_id===r\.id/);
 assert.match(admin,/current\?\.room_id===r\.id/);
 assert.match(read("supabase/functions/kitchen-api/index.ts"),/if\(occupant\.data\)return answer/);
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

test("Checklist : les 29 tâches du protocole 7 sont réparties dans sept rubriques sans doublon",()=>{
 const migration=read("supabase/migrations/20261124184136_kitchen_cleaning_protocol7_monthly_and_on_demand.sql");
 const seed=migration.slice(migration.indexOf("for r in select * from (values"),migration.indexOf(") as source(label,recurrence)"));
 const tasks=[...seed.matchAll(/\('([^']+)','(daily|weekly|monthly|on_demand)'\)/g)].map((m,i)=>({id:String(i+1),label:m[1],recurrence:m[2]}));
 assert.equal(tasks.length,29);
 const script=read("cuisine/cuisine.js"),start=script.indexOf("function cleaningSections("),end=script.indexOf("function renderCleaningSections(",start);
 const group=vm.runInNewContext(script.slice(start,end)+";cleaningSections");
 const sections=group(tasks.filter(t=>t.recurrence!=="on_demand"),tasks.filter(t=>t.recurrence==="on_demand"));
 assert.equal(sections.length,7);
 assert.deepEqual(Array.from(sections,g=>g.tasks.length+g.optional.length),[3,4,5,3,8,4,2]);
 const result=Array.from(sections).flatMap(g=>[...g.tasks,...g.optional]);
 assert.equal(result.length,29);assert.equal(new Set(result.map(t=>t.id)).size,29);
 assert.equal(sections.find(g=>g.key==="cuisson").optional[0].label,"Friteuse / huile");
 assert.deepEqual(Array.from(sections.find(g=>g.key==="sanitaires").tasks,t=>t.label),["Sanitaires","Vestiaires"]);
 const extra=group([{id:"x",label:"Nouvelle tâche"},{id:"y",label:"  POINT D'EAU DU SELF  "}],[]);
 assert.equal(extra.find(g=>g.key==="other").tasks[0].id,"x");assert.equal(extra.find(g=>g.key==="service").tasks[0].id,"y");
});
test("Checklist : compteurs par rubrique et tâches selon utilisation sans fausser les obligations",()=>{
 const script=read("cuisine/cuisine.js"),start=script.indexOf("function visibleTasks("),end=script.indexOf("async function save(action,body)");
 const today="2026-11-24",tasks=[{id:"1",label:"Bain-marie",active:true,scheduled:true},{id:"2",label:"Fours de remise en température",active:true,scheduled:true},{id:"3",label:"Vestiaires",active:true,scheduled:true}],optional=[{id:"4",label:"Friteuse / huile",active:true,scheduled:false}];
 const context={data:{me:{scope:"staff",id:"a"},tasks,optional_tasks:optional,checks:[{task_id:"1",performed_on:today,photo_bytes:100},{task_id:"4",performed_on:today,photo_bytes:100}],reheats:[]},today:()=>today,canRecordReheat:()=>true,esc:v=>String(v??""),clock:()=>"12:00",staffName:()=>"Agent"};
 const html=vm.runInNewContext(script.slice(start,end)+";renderTasks()",context);
 assert.match(html,/2 à réaliser · 1 \/ 3 validées/);
 assert.match(html,/Cuisson et remise en température<\/h3><span[^>]+>1 \/ 2 validées/);
 assert.match(html,/Tâches selon utilisation<\/strong><span>1 \/ 1 réalisées/);
 assert.match(html,/Sanitaires et vestiaires<\/h3><span[^>]+>0 \/ 1 validées/);
 assert.doesNotMatch(html,/id="cleaning-froid"/);
 assert.equal((html.match(/aria-checked="true"/g)||[]).length,2);
});

test("Checklist : planning complet non dû et aperçu du prochain jour sans validation anticipée",()=>{
 const script=read("cuisine/cuisine.js"),start=script.indexOf("function visibleTasks("),end=script.indexOf("async function save(action,body)");
 const today="2026-11-24",old={id:"old",label:"Nettoyage des fours",active:true,scheduled:true},weekly={id:"w",label:"Armoires",recurrence:"weekly",weekdays:[5]},future={id:"new",label:"Bacs à légumes",recurrence:"daily"};
 const context={data:{me:{scope:"staff",id:"a"},tasks:[old],optional_tasks:[],checks:[],reheats:[],task_plan:{date:today,tasks:[old,weekly]},task_plan_next:{date:"2026-11-25",tasks:[future]}},today:()=>today,canRecordReheat:()=>true,esc:v=>String(v??""),clock:()=>"12:00",staffName:()=>"Agent"};
 const html=vm.runInNewContext(script.slice(start,end)+";renderTasks()",context);
 assert.match(html,/1 à réaliser · 0 \/ 1 validées/);assert.match(html,/Planning complet à partir du 25\/11\/2026/);
 assert.match(html,/Chaque semaine · vendredi/);assert.match(html,/Non prévue aujourd’hui/);assert.match(html,/Bacs à légumes/);
 assert.equal((html.match(/role="checkbox"/g)||[]).length,1);
 assert.doesNotMatch(html,/data-task="(?:new|w)"/);
 assert.doesNotMatch(html,/Autres tâches/);
 const api=read("supabase/functions/kitchen-api/index.ts");
 assert.match(api,/p_day:nextTaskDay/);assert.match(api,/task_plan_next:JSON.stringify\(taskPlan\)!==JSON.stringify\(nextTaskPlan\)/);
});

test("Administration Cuisine : planning daté, catégories, filtrage et photo par validation",()=>{
 const code=read("college/admin/cuisine-admin.js"),start=code.indexOf("function cleaningSections("),end=code.indexOf("let cleaningDate=",start);
 const ctx={e:v=>String(v??""),when:v=>v,};const {rows,markup,filter}=vm.runInNewContext(code.slice(start,end)+";({rows:cleaningAdminRows,markup:cleaningAdminMarkup,filter:cleaningAdminFilter})",ctx);
 const day="2026-11-25",tasks=[{id:"a",label:"Bacs à légumes",active:true,scheduled:true,assigned_to:"s"},{id:"b",label:"Vestiaires",active:true,scheduled:true},{id:"c",label:"Armoires",active:true,scheduled:false,recurrence:"weekly"},{id:"d",label:"Friteuse / huile",active:true,scheduled:false,recurrence:"on_demand"},{id:"e",label:"Nettoyage de la plonge",active:false,scheduled:false}];
 const report={tasks:tasks.slice(0,2),checks:[{id:"proof",task_id:"a",performed_by:"s",performed_at:"12:00",photo_bytes:120}]};
 const model=rows(tasks,report,day,day),params={day,today:day,filter:{agent:"",state:""},canManage:true,staffName:v=>v,scheduleLabel:()=>"Fréquence"};
 const html=markup(model,params);assert.match(html,/Préparation et hygiène/);assert.match(html,/Sanitaires et vestiaires/);assert.match(html,/1 \/ 2/);assert.match(html,/data-admin-task-photo="proof"/);assert.match(html,/Non prévue ce jour/);assert.match(html,/Selon utilisation/);assert.match(html,/1 tâche\(s\) désactivée/);
 assert.equal(filter(model,{agent:"s",state:"photo"}).length,1);
 assert.doesNotMatch(markup(model,{...params,canManage:false}),/data-admin-task-photo|data-edit-admin-task/);
 assert.doesNotMatch(markup(model,{...params,today:"2026-11-26"}),/data-edit-admin-task/);
 assert.match(code,/\["cleaning","Tâches et photos"\]/);assert.match(code,/cleaningGet\("task-settings",\{date\}/);assert.match(code,/selectedId,fetchPhoto/);
 assert.match(read("cuisine/kitchen-photo.js"),/if\(selectedButton\)selectedButton.click\(\)/);
});

test("Retrait des quatre anciennes tâches : seul le nouveau planning est visible côté salarié",()=>{
 const script=read("cuisine/cuisine.js"),start=script.indexOf("function visibleTasks("),end=script.indexOf("async function save(action,body)");
 const today="2026-11-24",oldLabels=["Nettoyage de la ligne de self","Nettoyage de la plonge","Nettoyage des fours","Nettoyage du lave-vaisselle"],old=oldLabels.map((label,i)=>({id:"old"+i,label,starts_on:"2026-11-19",active:true,scheduled:true})),next=[{id:"old2",label:"Fours de remise en température",starts_on:"2026-11-25",recurrence:"weekly",weekdays:[5]},{id:"old3",label:"Lave-vaisselle",starts_on:"2026-11-25",recurrence:"daily"},{id:"new",label:"Bacs à légumes",starts_on:"2026-11-25",recurrence:"daily"}];
 const context={data:{me:{scope:"staff",id:"a"},tasks:old,optional_tasks:[],checks:old.map(x=>({task_id:x.id,performed_on:today,photo_bytes:100})),reheats:[],task_plan:{date:today,tasks:old},task_plan_next:{date:"2026-11-25",tasks:next}},today:()=>today,canRecordReheat:()=>true,esc:v=>String(v??""),clock:()=>"12:00",staffName:()=>"Agent"};
 const html=vm.runInNewContext(script.slice(start,end)+";renderTasks()",context);
 for(const label of oldLabels)assert.ok(!html.includes(label));assert.match(html,/3 tâches du nouveau planning/);assert.match(html,/Fours de remise en température/);assert.match(html,/Lave-vaisselle/);assert.doesNotMatch(html,/data-task=/);assert.doesNotMatch(html,/0 \/ 0 validées/);
});
test("Retrait des anciennes tâches : archives photo accessibles, deux nouvelles définitions préservées",()=>{
 const code=read("college/admin/cuisine-admin.js"),start=code.indexOf("function cleaningSections("),end=code.indexOf("let cleaningDate=",start);
 const ctx={e:v=>String(v??""),when:v=>v};const {rows,markup}=vm.runInNewContext(code.slice(start,end)+";({rows:cleaningAdminRows,markup:cleaningAdminMarkup})",ctx);
 const day="2026-11-24",old={id:"reuse",label:"Nettoyage du lave-vaisselle",starts_on:"2026-11-19",active:true,scheduled:true};
 const report={tasks:[old],checks:[{id:"photo1",task_id:"reuse",photo_bytes:100,performed_by:"s"}]};
 const params={day,today:day,filter:{agent:"",state:""},canManage:true,staffName:v=>v,scheduleLabel:()=>"Fréquence"};
 const archived=markup(rows([old],report,day,day),params);
 assert.match(archived,/Ancien planning archivé/);assert.match(archived,/data-admin-task-photo="photo1"/);assert.doesNotMatch(archived,/data-edit-admin-task="reuse"/);
 const tomorrow="2026-11-25",newTask={...old,label:"Lave-vaisselle",starts_on:tomorrow},retired={id:"retired",label:"Nettoyage de la plonge",active:false,scheduled:false,starts_on:tomorrow,description:"Remplacée par les lignes détaillées du protocole 7."};
 const future=markup(rows([newTask,retired],{tasks:[newTask],checks:[]},tomorrow,day),{...params,day:tomorrow});
 assert.match(future,/Lave-vaisselle/);assert.match(future,/data-edit-admin-task="reuse"/);assert.doesNotMatch(future,/Nettoyage de la plonge|data-edit-admin-task="retired"/);
});

test("Cuisine : pages de suivi et de paramètres distinctes avec droits identiques",()=>{
 const html=read("college/admin/index.html"),admin=read("college/admin/cuisine-admin.js"),designer=read("college/admin/site-designer.js");
 const start=admin.indexOf(" const kitchenPages="),end=admin.indexOf(" let loadEpoch",start);
 assert.ok(start>=0&&end>start);
 const ctx=vm.createContext({});
 vm.runInContext(admin.slice(start,end)+";this.kitchenPages=kitchenPages;",ctx);
 assert.deepEqual(Array.from(ctx.kitchenPages.cuisine,x=>x[0]),["overview","records","cleaning"]);
 assert.deepEqual(Array.from(ctx.kitchenPages.cuisineSettings,x=>x[0]),["govee","meater","pms","schedule","equipment","staff"]);
 assert.match(html,/cuisineSettings:'Paramètres cuisine'/);
 assert.match(html,/\['cuisineSettings','Paramètres cuisine'\]/);
 assert.match(html,/cuisine:\["cuisine.manage"\],cuisineSettings:\["cuisine.manage"\]/);
 assert.match(html,/cuisineSettings:window.kitchenAdminSettingsPage/);
 assert.match(designer,/\["Paramètres cuisine","tab:#cuisineSettings"\]/);
 assert.match(admin,/content.replaceChildren\(sharedHeader,header\)/);
 assert.match(admin,/for\(const \[key\] of tabs\)/);
 assert.match(admin,/settings\?openKitchenTab\("cuisine","records"\):show\("cuisineSettings"\)/);
 assert.match(admin,/window.kitchenAdminOpenGovee=function\(\)\{openKitchenTab\("cuisineSettings","govee"\)\}/);
 assert.match(admin,/window.KitchenMeater.mountDashboard\(root,api,\{diagnostic:true,live:true\}\)/);
 assert.match(admin,/if\(section==="cuisine"\)await refreshColdHistory/);
 assert.match(admin,/epoch===loadEpoch&&owner===goveeSession\(\)&&currentKitchenPage\(\)===section/);
});
