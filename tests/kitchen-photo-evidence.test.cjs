"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const api=read("supabase/functions/kitchen-api/index.ts"),ui=read("cuisine/cuisine.js"),camera=read("cuisine/kitchen-photo.js"),admin=read("college/admin/cuisine-admin.js"),sql=read("supabase/migrations/20261124204137_kitchen_task_mandatory_private_photo_evidence.sql");
test("Nettoyage : caméra en direct et validation uniquement après confirmation",()=>{
 const ctx={window:{}};vm.runInNewContext(camera,ctx);assert.equal(typeof ctx.window.KitchenPhoto.capture,"function");
 assert.match(camera,/navigator\.mediaDevices\.getUserMedia\(\{audio:false/);
 assert.match(camera,/ctx\.drawImage\(video/);assert.match(camera,/if\(!photo\|\|sending\|\|closed\)return/);
 assert.match(camera,/await onSubmit\(photo\)/);assert.match(camera,/getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
 assert.match(ui,/window\.KitchenPhoto\.capture/);assert.match(ui,/photo_jpeg:photo/);
 assert.doesNotMatch(ui,/save\("task-check",\{task_id:b\.dataset\.task\}/);
 assert.doesNotMatch(camera,/type\s*=\s*["']file["']/);
});
test("Nettoyage : garde en base et stockage prive avant validation",()=>{
 assert.match(sql,/'kitchen-cleaning-photos','kitchen-cleaning-photos',false,350000/);
 assert.match(sql,/before insert or update on public\.kitchen_task_checks/);
 assert.match(sql,/Photo de la tâche introuvable ou invalide/);
 assert.match(sql,/photo_sha_unique/);assert.match(sql,/from public,anon,authenticated/);
 const branch=api.slice(api.indexOf('if(action==="task-check"){'),api.indexOf('const x=await req.json().catch'));
 assert.match(branch,/u\.scope!=="staff"\|\|u\.existingAccount/);
 assert.match(branch,/Photo obligatoire/);assert.match(branch,/if\(!bytes\)/);
 assert.ok(branch.indexOf("storage.upload(path,bytes")<branch.indexOf('c.rpc("kitchen_task_validate_photo"'));
 assert.match(branch,/if\(q\.error\).*Résultat incertain/);
});
test("Nettoyage : consultation administrative authentifiee et preuve non publique",()=>{
 const branch=api.slice(api.indexOf('if(action==="task-photo"'),api.indexOf('if(action==="task-report"'));
 assert.match(branch,/u\.scope!=="admin"/);assert.match(branch,/storage\.from\(TASK_PHOTO_BUCKET\)\.download/);
 assert.match(branch,/taskPhotoDigest\(bytes\)!==q\.data\.photo_sha256/);assert.match(branch,/no-store, private/);
 assert.match(admin,/Consulter les photos/);assert.match(admin,/window\.KitchenPhoto\.showHistory/);
 assert.match(read("cuisine/releve-export.js"),/Photo archivee/);
 assert.match(read("cuisine/index.html"),/kitchen-photo\.js\?v=/);assert.match(read("college/admin/index.html"),/kitchen-photo\.js\?v=/);
});
