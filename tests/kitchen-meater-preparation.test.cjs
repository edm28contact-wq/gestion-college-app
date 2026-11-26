"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
test("MEATER frontend loads and exposes the three mounts",()=>{const ctx={window:{}};vm.runInNewContext(read("cuisine/meater-ui.js"),ctx);for(const name of ["mountAdmin","mountDashboard","mountKitchen"])assert.equal(typeof ctx.window.KitchenMeater[name],"function");});
test("Twelve physical slots and qualification",()=>{const ui=read("cuisine/meater-ui.js"),api=read("supabase/functions/kitchen-api/index.ts");assert.match(ui,/length:12/);assert.match(ui,/\["A","B","C"\]/);assert.match(api,/slot<=12/);assert.doesNotMatch(api,/c\.rpc\("kitchen_meater_professional_permission"/);assert.match(api,/kitchen_meater_record_qualification/);assert.match(api,/kitchen_meater_claim/);assert.match(api,/kitchen_meater_apply/);});
test("Manual HACCP and Govee paths remain",()=>{const api=read("supabase/functions/kitchen-api/index.ts"),ui=read("cuisine/cuisine.js");assert.match(api,/action==="finish-reheat"/);assert.match(api,/action==="govee-auto-sync"/);assert.match(ui,/data-finish/);assert.match(ui,/mountDashboard/);assert.match(ui,/mountKitchen/);});

test("MEATER : connexion directe, qualification et collecte protégées",()=>{
 const ui=read("cuisine/meater-ui.js"),api=read("supabase/functions/kitchen-api/index.ts");
 const login=api.slice(api.indexOf('if(action==="meater-login")'),api.indexOf('if(action==="meater-test")'));
 assert.match(login,/meaterCall\("\/login",\{email,password\}\)/);
 assert.match(login,/kitchen_meater_set_token/);
 assert.doesNotMatch(login,/professional_permission_ref/);
 assert.match(api,/if\(!allowed\(u,true\)\)return forbidden\(\);/);
 assert.match(ui,/\(!s.configured\?'disabled':''\)\+'>Tester/);
 assert.match(ui,/!list.some\(p=>qualified\(p\)&&fresh\(p,s\)\)/);
 assert.doesNotMatch(ui,/data-meater-permission|professional_permission_confirmed|data-meater-revoke/);
 assert.match(ui,/r=await api\("meater-test","POST",\{\}\)/);
 assert.match(api,/meaterDatabaseError\("stockage sécurisé du jeton",q.error\)/);
 assert.match(ui,/Station A :/);
 const sql=read("supabase/migrations/20261126205512_kitchen_meater_remove_letter_gate_keep_qualification.sql");
 assert.match(sql,/if not p_manual and not s.enabled then return jsonb_build_object\('skipped',true\)/);
 assert.doesNotMatch(sql,/professional_permission_ref/);
 assert.match(sql,/qualification_expires_at>now\(\)/);
 assert.match(sql,/abs\(a-b\)\+u<=0.5/);
 assert.match(sql,/if s.enabled then/);
 assert.match(sql,/interval '30 seconds'/);
 assert.match(sql,/revoke all on function public.kitchen_meater_claim\(boolean\) from public,anon,authenticated/);
 assert.match(api,/production=cfg.data.enabled===true/);
 assert.match(api,/if\(e instanceof MeaterError\)return answer\(\{error:e.message\},503\)/);
 assert.match(api,/!visible\?\{present:false,internal_c:null,ambient_c:null,measured_at:null,cook_id:null,cook_state:null\}/);
 assert.match(api,/meaterStatus\(c,u.scope==="admin"\)/);
});

test("MEATER : toutes les mises à jour de sondes ont un prédicat compatible safeupdate",()=>{
 const sql=read("supabase/migrations/20261126210903_kitchen_meater_safe_update_where.sql");
 const updates=[...sql.matchAll(/update public\.kitchen_meater_probes\b([\s\S]*?);/gi)];
 assert.equal(updates.length,3);
 for(const update of updates)assert.match(update[1],/\bwhere\b/i);
 assert.equal((sql.match(/set present=false where present;/g)||[]).length,2);
 assert.match(sql,/qualification_expires_at=null\s+where present or qualified_at is not null or qualified_by is not null or qualification_expires_at is not null/);
 assert.match(sql,/update public\.kitchen_meater_links set detached_at=now\(\) where detached_at is null/);
 assert.match(sql,/vault\.create_secret\(p_token,/);
 assert.match(sql,/vault\.update_secret\(sid,p_token,/);
 assert.match(sql,/revoke all on function public\.kitchen_meater_set_token\(text\) from public,anon,authenticated/);
});

test("MEATER : mesures récentes visibles avant affectation, mesures anciennes masquées",()=>{
 const ui=read("cuisine/meater-ui.js"),ctx={window:{}};
 vm.runInNewContext(ui.replace("window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen};","window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen,probeReadingMarkup};"),ctx);
 const s={enabled:false,last_error:null},p={device_id:"test-unique-12345678",slot:null,fresh:true,internal_c:26.8,ambient_c:25.1,measured_at:new Date().toISOString()};
 const html=ctx.window.KitchenMeater.probeReadingMarkup(p,s);
 assert.match(html,/12345678/);assert.match(html,/26,8 °C/);assert.match(html,/Non associée/);
 const stale=ctx.window.KitchenMeater.probeReadingMarkup({...p,measured_at:new Date(Date.now()-180000).toISOString()},s);
 assert.doesNotMatch(stale,/26,8 °C/);assert.match(stale,/Mesure indisponible ou ancienne/);
 assert.match(ui,/list\.filter\(p=>!p.slot\)\.map\(p=>probeReadingMarkup\(p,s\)\)/);
 assert.match(ui,/data-meater-refresh"\)\)\{if\(s\?\.configured\)run\("meater-test",\{\}\)/);
});

test("MEATER : essai temporaire sans qualification fictive ni écriture HACCP",()=>{
 const sql=read("supabase/migrations/20261126212856_kitchen_meater_temporary_test_mode.sql"),api=read("supabase/functions/kitchen-api/index.ts"),ui=read("cuisine/meater-ui.js");
 assert.match(sql,/check \(not enabled or test_until is null\)/);
 assert.match(sql,/interval '2 hours'/);
 assert.match(sql,/not p_manual and not s.enabled and coalesce\(s.test_until<=now\(\),true\)/);
 assert.match(sql,/set enabled=p_enabled,test_until=null,generation=gen_random_uuid\(\)/);
 assert.match(sql,/where id=1 and \(enabled or test_until>now\(\)\) and vault_secret_id is not null/);
 assert.match(sql,/revoke all on function public.kitchen_meater_test_mode\(boolean\) from public,anon,authenticated/);
 assert.match(api,/testActive=!production&&Date.parse\(cfg.data.test_until\)>now/);
 assert.match(api,/links:production\?links.data\|\|\[\]:\[\]/);
 assert.match(api,/c.rpc\("kitchen_meater_test_mode",\{p_enabled:x.enabled\}\)/);
 assert.match(ui,/MODE ESSAI · mesures indicatives, hors registre HACCP/);
 assert.match(ui,/data-meater-test-mode/);
 assert.match(ui,/void refreshLive\(\);\},30000\)/);
 assert.match(read("supabase/migrations/20261126210903_kitchen_meater_safe_update_where.sql"),/if s.enabled then/);
 const ctx={window:{}};
 vm.runInNewContext(ui.replace("window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen};","window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen,dashboardMarkup};"),ctx);
 const probe={device_id:"test",slot:1,label:"Féculents",fresh:true,internal_c:28.1,ambient_c:26.4,measured_at:new Date().toISOString()};
 const s={enabled:false,test_active:true,configured:true,test_until:new Date(Date.now()+3600000).toISOString(),probes:[probe],links:[]};
 assert.match(ctx.window.KitchenMeater.dashboardMarkup(s),/MODE ESSAI/);
 assert.match(ctx.window.KitchenMeater.dashboardMarkup(s),/28,1 °C/);
 assert.doesNotMatch(ctx.window.KitchenMeater.dashboardMarkup({...s,test_active:false}),/28,1 °C/);
});

test("MEATER : diagnostic administrateur indépendant du mode production et dernière valeur clairement signalée",()=>{
 const ui=read("cuisine/meater-ui.js"),ctx={window:{}};
 vm.runInNewContext(ui.replace("window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen};","window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen,dashboardMarkup};"),ctx);
 const p={device_id:"test",slot:1,label:"Viande",fresh:false,internal_c:29.3,ambient_c:26.1,measured_at:new Date(Date.now()-900000).toISOString()};
 const s={enabled:false,test_active:false,configured:true,probes:[p],links:[]};
 const html=ctx.window.KitchenMeater.dashboardMarkup(s,true);
 assert.match(html,/Dernière valeur connue \(non actualisée\) : 29,3 °C/);
 assert.match(html,/class="meater-value">— °C/);
 assert.match(html,/hors registre HACCP/);
 assert.doesNotMatch(ctx.window.KitchenMeater.dashboardMarkup(s),/29,3 °C/);
});
