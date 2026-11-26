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
 assert.match(result,/Toutes les 10 min/);
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

test("Accueil Cuisine : affichage de la fréquence propre à une chambre et du prochain créneau",()=>{
 const result=html({connected:[sensor],cold:[],cold_overview:[{
  room_id:"negative",last_reading:reading(-21.7),next_slot_at:new Date(Date.now()+600000).toISOString()
 }]});
 assert.match(result,/21,7 °C/);
 assert.match(result,/Prochain :/);
 assert.match(result,/Toutes les 10 min/);
});
test("Administration Cuisine : programmation indépendante des quatre chambres",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(admin,/data-room-schedule/);
 assert.match(admin,/save-room-collection-schedule/);
 assert.match(admin,/Heures fixes chaque jour/);
 assert.match(admin,/Collecte automatique/);
 assert.match(admin,/auto_collection_interval_minutes/);
 assert.match(admin,/Prochain créneau/);
 assert.match(backend,/action==="save-room-collection-schedule"/);
 assert.match(backend,/c\.rpc\("kitchen_claim_govee_due"\)/);
 assert.match(backend,/c\.rpc\("kitchen_cold_room_overview"\)/);
 const slots=read("supabase/migrations/20261124081350_kitchen_individual_room_collection_schedules.sql");
 const dispatch=read("supabase/migrations/20261124081516_kitchen_schedule_per_room_minute_dispatch.sql");
 assert.match(slots,/for update of r skip locked/i);
 assert.match(slots,/auto_collection_enabled/);
 assert.match(slots,/Europe\/Paris/);
 assert.match(dispatch,/'\* \* \* \* \*'/);
 assert.match(dispatch,/where exists\(select 1 from public\.kitchen_govee_due_rooms\(now\(\)\)\)/i);
 assert.match(dispatch,/cron\.unschedule/);
});

test("Govee : les chambres occupées ne sont jamais proposées à un autre capteur",()=>{
 const admin=read("college/admin/cuisine-admin.js");
 const start=admin.indexOf(" function goveeRoomOptions("),end=admin.indexOf(" function renderGoveeDiscovery(",start);
 const ctx=vm.createContext({e:v=>String(v??""),t:String,when:String});
 vm.runInContext(admin.slice(start,end)+";this.options=goveeRoomOptions;this.cards=goveeCards",ctx);
 const s={me:{scope:"admin"},rooms:[roomN,roomP,{id:"old",label:"Archivée",archived_at:"2026-01-01"}],connected:[{...sensor,device_identifier:"aa:bb:cc",label:"Wifi Thermometer",raw_unit:"F"}]};
 assert.deepEqual(Array.from(ctx.options(s,"new"),r=>r.id),["positive"]);
 assert.deepEqual(Array.from(ctx.options(s,"aa:bb:cc"),r=>r.id),["negative","positive"]);
 const result=ctx.cards(s,{discovered:[{device:"aa:bb:cc",sku:"H5179",label:"Wifi Thermometer",temperature_capability:true},{device:"dd:ee:ff",sku:"H5179",label:"Wifi Thermometer",temperature_capability:true}],devices:[{device:"aa:bb:cc",online:true,temperature_c:5,raw_unit:"F"}]});
 assert.match(result,/aa:bb:cc/);assert.match(result,/dd:ee:ff/);
 assert.match(result,/Température hors seuil/);
 const form=result.match(/<form class="grid" data-govee-associate="dd:ee:ff"[\s\S]*?<\/form>/)[0];
 assert.match(form,/value="">Choisir une chambre froide/);assert.match(form,/value="positive"/);assert.doesNotMatch(form,/value="negative"/);
 assert.equal((result.match(/data-govee-associate=/g)||[]).length,1);
 assert.match(result,/Modifier l’association/);
 assert.match(admin,/goveeDiscovery=result/);
 assert.match(admin,/goveeFeedback\(err\.message,true\)/);
 assert.match(backend,/sensor:existing\.data,unchanged:true/);
 assert.match(backend,/if\(occupant\.data\)return answer/);
});

test("Collecte globale : isolation des échecs des capteurs et des deux fournisseurs",async()=>{
 const start=backend.indexOf("async function syncManualGovee("),end=backend.indexOf("Deno.serve(",start);
 assert.ok(start>=0&&end>start);
 const rooms=[roomN,roomP,{id:"room3",label:"Chambre 3"},{id:"room4",label:"Chambre 4"}];
 const sensors=[sensor,{...sensor,id:"g2",room_id:"positive",last_checked_at:new Date().toISOString()},{...sensor,id:"g3",room_id:"room3"},{...sensor,id:"g4",room_id:"room4"},{...sensor,id:"archived",room_id:"archived"}];
 const invoked=[];
 const c={from(table){const q={select(){return q},is(){return q},eq(){return q},then(resolve){resolve({data:table==="kitchen_cold_rooms"?rooms:sensors})}};return q}};
 const ctx={Date,query:q=>q.data,goveeKey:async()=>"fake",syncGoveeDevice:async(c,s)=>{
  invoked.push(s.id);if(s.id==="g3")throw Error("failure");if(s.id==="g4")return {error:"Hors ligne",statusCode:409};return {reading:{temperature_c:-20,measured_at:new Date().toISOString()},alert:false};
 },pollMeater:async()=>({received:0}),meaterStatus:async()=>({probes:[{label:"A1",fresh:false,measured_at:null}]} )};
 const source=backend.slice(start,end).replace(/:any\[\]/g,"").replace(/:any\b|:string\b/g,"");
 vm.runInNewContext(source+";this.syncAllSensors=syncAllSensors",ctx);
 const result=await ctx.syncAllSensors(c);
 assert.equal(result.govee.total,4);assert.equal(result.govee.received,1);assert.equal(result.govee.skipped,1);assert.equal(result.govee.failed,2);
 assert.deepEqual(invoked,["govee1","g3","g4"]);
 assert.equal(result.meater.total,1);assert.equal(result.meater.fresh,0);
 ctx.pollMeater=async()=>{throw Error("MEATER unavailable")};
 const partial=await ctx.syncAllSensors(c);
 assert.equal(partial.govee.received,1);assert.match(partial.meater.error,/indisponible/);
 const admin=read("college/admin/cuisine-admin.js");
 assert.match(backend,/if\(!allowed\(u,true\)\)return forbidden\(\);\s*if\(action==="sync-all-sensors"\)/);
 assert.match(admin,/api\("sync-all-sensors","POST",\{\}\)/);
 assert.match(admin,/record.addEventListener\("click",refreshAllSensors\)/);
});

test("Cuisine : une sonde en ligne peut renvoyer une température hors seuil",()=>{
 const r=reading(-13.8,1,true),out=html({connected:[sensor],cold:[r]});
 assert.match(out,/Connexion en ligne/);
 assert.match(out,/Hors seuil/);
 assert.match(out,/Seuil : max. -18 °C/);
 assert.match(out,/Valeur Cloud reçue le/);
 assert.match(out,/13,8 °C/);
 const adminUI=read("cuisine/kitchen-ui.js"),ctx={window:{}};
 vm.runInNewContext(adminUI,ctx);
 const rendered=ctx.window.KitchenUI.coldOverview({rooms:[roomN],connected:[sensor],cold:[r]});
 assert.match(rendered,/Connexion en ligne/);
 assert.match(rendered,/Hors seuil/);
 assert.match(rendered,/Seuil : max. -18 °C/);
});
test("Cuisine : une mesure MEATER ancienne ne transforme pas la collecte Govee réussie en erreur",()=>{
 const admin=read("college/admin/cuisine-admin.js"),start=admin.indexOf(" function sensorSyncSummary("),end=admin.indexOf(" function showSensorSyncReport(",start);
 const ctx={t:v=>String(v),when:v=>String(v)};
 vm.runInNewContext(admin.slice(start,end)+";this.summary=sensorSyncSummary;",ctx);
 const result=ctx.summary({govee:{received:4,total:4,failed:0,skipped:0,devices:[{label:"Négative 1",status:"received",temperature_c:-13.8,measured_at:"2026-11-26T21:50:45Z",alert:true}]},meater:{fresh:0,total:4,devices:[]}});
 assert.equal(result[0].tone,"ok");assert.equal(result[1].tone,"warning");
 assert.match(result[0].text,/4\/4/);assert.match(result[0].details[0],/21:50:45Z.*hors seuil/);
 const limited=ctx.summary({govee:{received:0,total:4,failed:0,skipped:4,devices:[]},meater:{fresh:4,total:4,devices:[]}});
 assert.equal(limited[0].tone,"warning");assert.match(limited[0].text,/moins d’une minute/);
});

test("Consultation Govee : lecture Cloud distincte du registre et alerte indépendante",()=>{
 const ui=read("cuisine/kitchen-ui.js"),ctx={window:{}};
 vm.runInNewContext(ui,ctx);
 const data={rooms:[{...roomN,sensor:{status:"online",temperature_c:-13.8,checked_at:new Date().toISOString()}}]};
 const out=ctx.window.KitchenUI.liveColdMarkup(data);
 assert.match(out,/Connexion en ligne/);assert.match(out,/13,8 °C/);assert.match(out,/Température hors seuil/);assert.match(out,/sans enregistrement/);
 const stale=ctx.window.KitchenUI.liveColdMarkup({rooms:[{...roomN,sensor:{...data.rooms[0].sensor,checked_at:new Date(Date.now()-200000).toISOString()}}]});
 assert.match(stale,/Valeur ancienne/);assert.match(stale,/Dernière valeur Cloud \(ancienne\)/);assert.match(stale,/class="cold-live-value">— °C/);
 const start=backend.indexOf("async function readGoveeLiveState("),end=backend.indexOf("async function syncGoveeDevice(",start);
 const live=backend.slice(start,end);
 assert.match(live,/kitchen_claim_govee_live/);assert.match(live,/update\(\{live_state:state\}\)/);assert.doesNotMatch(live,/kitchen_cold_readings|\.insert\(/);
 assert.match(backend,/preview\?await c.rpc\("kitchen_meater_claim_preview"\)/);
 assert.match(backend,/if\(action==="govee-live"&&req.method==="GET"\)/);
 assert.match(backend,/if\(action==="meater-live"&&req.method==="GET"\)/);
 const admin=read("college/admin/cuisine-admin.js");assert.match(admin,/Actualiser les températures/);assert.match(admin,/Enregistrer un relevé Govee/);
 const migration=read("supabase/migrations/20261126215921_kitchen_live_temperature_cache_without_history.sql");
 assert.match(migration,/interval '60 seconds'/);assert.match(migration,/if s.enabled or s.vault_secret_id is null/);assert.match(migration,/revoke all on function public.kitchen_meater_claim_preview\(\) from public,anon,authenticated/);
});

test("Govee : les réponses récentes restent visibles avec une horloge navigateur décalée",()=>{
 const ui=read("cuisine/kitchen-ui.js"),base=Date.parse("2026-11-26T22:05:57Z");
 class WrongClock extends Date{static now(){return base+3600000;}}
 const ctx={window:{},Date:WrongClock};
 vm.runInNewContext(ui,ctx);
 const payload={now:new Date(base).toISOString(),queried:4,rooms:[{...roomN,sensor:{status:"online",temperature_c:-13.9,checked_at:new Date(base-44000).toISOString(),fresh:true}}]};
 const out=ctx.window.KitchenUI.liveColdMarkup(payload);
 assert.match(out,/13,9 °C/);assert.match(out,/Connexion en ligne/);assert.match(out,/il y a 44 s/);
 assert.doesNotMatch(out,/Valeur ancienne/);
 const stale=ctx.window.KitchenUI.liveColdMarkup({...payload,now:new Date(base+180000).toISOString()});
 assert.match(stale,/Valeur ancienne/);assert.match(stale,/class="cold-live-value">— °C/);
 const rejected=ctx.window.KitchenUI.liveColdMarkup({...payload,rooms:[{...roomN,sensor:{...payload.rooms[0].sensor,fresh:false}}]});
 assert.match(rejected,/Valeur ancienne/);
 assert.match(backend,/age_seconds:Number.isFinite\(age\)/);
 assert.match(backend,/now:new Date\(now\).toISOString\(\),queried:claimed.length/);
});
test("Govee : les actualisations simultanées partagent la requête et ne bloquent pas le bouton",async()=>{
 const ui=read("cuisine/kitchen-ui.js"),ctx={window:{},document:{hidden:false,addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){}};
 vm.runInNewContext(ui,ctx);
 let resolve,called=0;
 const root={isConnected:true,innerHTML:"",closest:()=>null,querySelector:()=>({}),addEventListener(){}};
 const refresh=ctx.window.KitchenUI.mountLiveCold(root,()=>{called++;return new Promise(r=>resolve=r);});
 const a=refresh(),b=refresh();assert.equal(a,b);
 await Promise.resolve();assert.equal(called,1);
 resolve({now:new Date().toISOString(),rooms:[],queried:0});
 await a;assert.match(root.innerHTML,/Dernière interrogation réutilisée/);
});
