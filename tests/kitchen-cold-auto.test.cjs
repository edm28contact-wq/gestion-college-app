"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,".."),read=p=>fs.readFileSync(path.join(root,p),"utf8");
const frontend=read("cuisine/cuisine.js"),backend=read("supabase/functions/kitchen-api/index.ts");
const start=frontend.indexOf("function renderColdOverview(){"),end=frontend.indexOf("async function refreshDashboardReadings(){");
assert.ok(start>=0&&end>start,"Le rendu des températures doit être isolable");
const overviewSource=frontend.slice(start,end);
const roomN={id:"negative",label:"Chambre froide négative 1",room_type:"negative",max_c:-18,min_c:null};
const roomP={id:"positive",label:"Chambre froide positive 1",room_type:"positive",max_c:3,min_c:0};
const sensor={id:"govee1",room_id:"negative",kind:"cold_room",provider:"govee",model:"H5179",status:"online"};
const reading=(temperature_c,minutesAgo=1,is_alert=false)=>({room_id:"negative",source:"govee_cloud",connected_device_id:"govee1",temperature_c,is_alert,measured_at:new Date(Date.now()-minutesAgo*60000).toISOString()});
function html(data){
 const context={data,activeRooms:()=>[roomN,roomP],dashboardRefreshError:"",
  esc:v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
  number:v=>Number(v).toLocaleString("fr-FR"),Date};
 return vm.runInNewContext(overviewSource+"; renderColdOverview()",context);
}
test("Accueil Cuisine : noms des chambres et température reçue du capteur",()=>{
 const result=html({connected:[sensor],cold:[reading(-21.7)]});
 assert.match(result,/Chambre froide négative 1/);
 assert.match(result,/Chambre froide positive 1/);
 assert.match(result,/21,7 °C/);
 assert.match(result,/À jour/);
 assert.match(result,/Sans capteur/);
 assert.match(result,/toutes les 10 minutes/);
});
test("Accueil Cuisine : un relevé ancien ou hors ligne ne devient jamais du temps réel",()=>{
 const old=html({connected:[sensor],cold:[reading(6.4,35,true)]});
 assert.match(old,/Données anciennes/);
 assert.match(old,/Dernier relevé hors seuil/);
 assert.doesNotMatch(old,/À jour/);
 const offline=html({connected:[{...sensor,status:"offline"}],cold:[reading(-19)]});
 assert.match(offline,/Capteur hors ligne/);
 assert.doesNotMatch(offline,/À jour/);
});
test("Accueil Cuisine : une chambre sans capteur ne transforme pas une ancienne mesure Govee en relevé manuel",()=>{
 const result=html({connected:[],cold:[{...reading(-4),room_id:"positive",connected_device_id:"old"}]});
 assert.match(result,/Sans capteur/);
 assert.doesNotMatch(result,/-4 °C/);
});
test("Collecte Govee : planification indépendante du navigateur et accès signé",()=>{
 assert.match(frontend,/setInterval\(refreshDashboardReadings,60000\)/);
 assert.match(frontend,/data\.cold\.find\(r=>r\.room_id===room\.id&&r\.source==="govee_cloud"/);
 assert.match(backend,/action==="govee-auto-sync"/);
 assert.match(backend,/signature!==await mac\(await secret\(c\),"kitchen-govee-cron:"\+timestamp\)/);
 assert.match(backend,/async function syncGoveeDevice\(/);
 assert.match(backend,/if\(action==="govee-sync"\)/);
 const migration=read("supabase/migrations/20261124001340_kitchen_govee_background_sync_every_10_min.sql");
 assert.match(migration,/'\*\/10 \* \* \* \*'/);
 assert.match(migration,/extensions\.hmac/);
 assert.match(migration,/net\.http_post/);
 assert.doesNotMatch(migration,/service_role/i);
});
