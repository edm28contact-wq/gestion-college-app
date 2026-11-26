"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
test("MEATER frontend loads and exposes the three mounts",()=>{const ctx={window:{}};vm.runInNewContext(read("cuisine/meater-ui.js"),ctx);for(const name of ["mountAdmin","mountDashboard","mountKitchen"])assert.equal(typeof ctx.window.KitchenMeater[name],"function");});
test("Twelve physical slots, professional permission and qualification",()=>{const ui=read("cuisine/meater-ui.js"),api=read("supabase/functions/kitchen-api/index.ts");assert.match(ui,/length:12/);assert.match(ui,/\["A","B","C"\]/);assert.match(api,/slot<=12/);assert.match(api,/kitchen_meater_professional_permission/);assert.match(api,/kitchen_meater_record_qualification/);assert.match(api,/kitchen_meater_claim/);assert.match(api,/kitchen_meater_apply/);});
test("Manual HACCP and Govee paths remain",()=>{const api=read("supabase/functions/kitchen-api/index.ts"),ui=read("cuisine/cuisine.js");assert.match(api,/action==="finish-reheat"/);assert.match(api,/action==="govee-auto-sync"/);assert.match(ui,/data-finish/);assert.match(ui,/mountDashboard/);assert.match(ui,/mountKitchen/);});

test("MEATER : essai manuel sans autorisation professionnelle, collecte protégée",()=>{
 const ui=read("cuisine/meater-ui.js"),api=read("supabase/functions/kitchen-api/index.ts");
 const login=api.slice(api.indexOf('if(action==="meater-login")'),api.indexOf('if(action==="meater-test")'));
 assert.match(login,/meaterCall\("\/login",\{email,password\}\)/);
 assert.match(login,/kitchen_meater_set_token/);
 assert.doesNotMatch(login,/professional_permission_ref/);
 assert.match(api,/if\(!allowed\(u,true\)\)return forbidden\(\);/);
 assert.match(ui,/\(!s.configured\?'disabled':''\)\+'>Tester/);
 assert.match(ui,/\(!s.configured\|\|!s.professional_permission_confirmed\?'disabled':''\)/);
 assert.match(ui,/Station A :/);
 const sql=read("supabase/migrations/20261126204320_kitchen_meater_manual_test_without_professional_activation.sql");
 assert.match(sql,/if not p_manual and not s.enabled then return jsonb_build_object\('skipped',true\)/);
 assert.match(sql,/if not p_manual and s.professional_permission_ref is null/);
 assert.match(sql,/interval '30 seconds'/);
 assert.match(sql,/revoke all on function public.kitchen_meater_claim\(boolean\) from public,anon,authenticated/);
 assert.match(api,/production=cfg.data.enabled===true&&!!cfg.data.professional_permission_ref/);
 assert.match(api,/!visible\?\{present:false,internal_c:null,ambient_c:null,measured_at:null,cook_id:null,cook_state:null\}/);
 assert.match(api,/meaterStatus\(c,u.scope==="admin"\)/);
});
