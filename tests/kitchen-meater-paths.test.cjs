const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
test("MEATER technical paths: server deadline, real markers, and transmission gaps",()=>{
 const src=read("cuisine/meater-paths.js");
 const ctx={window:{}};vm.runInNewContext(src.replace("window.KitchenMeaterPaths={mount};","window.KitchenMeaterPaths={mount,chart,countdown};"),ctx);
 const {chart,countdown}=ctx.window.KitchenMeaterPaths,base=Date.parse("2026-11-26T22:00:00Z"),iso=n=>new Date(base+n*1000).toISOString();
 const r={status:"running",started_at:iso(0),deadline_at:iso(3600),trigger_c:9.9,cold_c:3.1,cold_at:iso(10),hot_c:64.9,hot_at:iso(60)};
 assert.equal(countdown(r,base),"60:00");
 assert.equal(countdown(r,base+61e3),"58:59");
 assert.equal(countdown(r,base+3601e3),"00:00");
 assert.equal(countdown({...r,status:"armed"},base),"En attente");
 assert.equal(countdown({...r,status:"target",finished_at:iso(120)},base+4000e3),"58:00");
 const rows=[{measured_at:iso(0),internal_c:9.9,ambient_c:2,event:"trigger"},{measured_at:iso(10),internal_c:20,ambient_c:80},{measured_at:iso(150),internal_c:64.9,ambient_c:90}];
 const svg=chart(r,rows);
 assert.match(svg,/65 °C/);assert.match(svg,/Proche de 3 °C/);assert.match(svg,/Déclenchement/);
 assert.match(svg,/meater-graph-line meater-graph-core" d=" M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ M/);
 assert.match(chart({status:"armed"},[]),/première mesure sous 10 °C/);
});
test("MEATER technical paths: both clients wired; read-only endpoints and bounded history",()=>{
 const api=read("supabase/functions/kitchen-api/index.ts");
 assert.match(api,/action==="meater-paths"&&req.method==="GET"/);
 assert.match(api,/action.startsWith\("meater-path-history:"\)/);
 assert.match(api,/c.rpc\("kitchen_meater_path_arm"/);
 assert.match(api,/c.rpc\("kitchen_meater_path_cancel"/);
 assert.match(api,/u.scope!=="admin"&&\(u.scope!=="staff"\|\|u.existingAccount\)/);
 assert.match(read("college/admin/cuisine-admin.js"),/\["paths","Parcours remises en température"\]/);
 assert.match(read("cuisine/cuisine.js"),/window.KitchenMeaterPaths.mount\(\$\("meaterPathsStaff"\),request\)/);
 assert.match(read("college/admin/index.html"),/meater-paths.js\?v=/);
 assert.match(read("cuisine/index.html"),/meater-paths.js\?v=/);
});


test("MEATER automatic monitoring: distinguish unavailable charging from a Cloud error",()=>{
 const ui=read("cuisine/meater-ui.js"),ctx={window:{}};
 vm.runInNewContext(ui.replace("window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen};","window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen,dashboardMarkup};"),ctx);
 const now=new Date().toISOString(),p={device_id:"test",slot:1,label:"Sonde",present:false,fresh:false,internal_c:24,measured_at:now};
 const s={now,last_ok_at:now,configured:true,enabled:false,preview:true,probes:[p],links:[]};
 const html=ctx.window.KitchenMeater.dashboardMarkup(s,true);
 assert.match(html,/Valeur indisponible — sonde en charge \(présumée\)/);
 assert.match(html,/class="meater-value">— °C/);
 assert.doesNotMatch(ctx.window.KitchenMeater.dashboardMarkup({...s,last_error:"Erreur API"},true),/sonde en charge/);
 assert.match(ctx.window.KitchenMeater.dashboardMarkup({...s,last_error:"Erreur API"},true),/Valeur indisponible — erreur Cloud/);
 assert.doesNotMatch(ctx.window.KitchenMeater.dashboardMarkup({...s,last_ok_at:new Date(Date.now()-120000).toISOString()},true),/sonde en charge/);
 assert.match(ctx.window.KitchenMeater.dashboardMarkup({...s,probes:[{...p,present:true,fresh:true}]},true),/class="meater-value">24 °C/);
 assert.match(read("cuisine/meater-paths.js"),/retour d’une nouvelle mesure est détecté automatiquement/);
 assert.match(read("cuisine/meater-paths.js"),/Valeur indisponible — sonde en charge/);
});

test("Cancelled technical paths: explicit irreversible confirmation and immediate removal",()=>{
 const ui=read("cuisine/meater-paths.js");
 assert.match(ui,/supprimer définitivement ce parcours technique ainsi que ses relevés/);
 assert.match(ui,/r\?\.deleted!==true/);
 assert.match(ui,/state\.paths=state\.paths\.filter\(p=>p\.id!==id\)/);
 assert.match(ui,/paths:s\.paths\.filter\(r=>r\.status!=="cancelled"\)/);
 const sql=read("supabase/migrations/20261127002217_kitchen_meater_delete_cancelled_technical_paths.sql");
 assert.match(sql,/delete from public\.kitchen_meater_paths where id=p_id and status in \('armed','running','cancelled'\)/);
 assert.match(sql,/delete from public\.kitchen_meater_paths where status='cancelled'/);
 assert.match(sql,/'deleted',true/);
});
