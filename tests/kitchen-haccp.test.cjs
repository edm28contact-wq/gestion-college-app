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
