"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
test("Identité : Cours Chambertin sur les principaux espaces sans casser les routes",()=>{
 for(const path of ["index.html","portail/index.html","college/admin/index.html","college/workspace-layout.js","college/admin/site-designer.js","admin/holding/index.html","admin/holding/access-catalog.js","secretariat/index.html","comptabilite/index.html","cuisine/index.html","lecteur-veryfi/index.html"]){
  const text=read(path);assert.match(text,/Cours Chambertin/);assert.doesNotMatch(text,/\b(?:Gestion|Administration|Société) [Cc]ollège\b/);
 }
 assert.match(read("college/workspace-layout.js"),/college\/admin\//);
 assert.match(read("admin/holding/access-catalog.js"),/college_admin/);
});
test("Publication qualifiée : déploiement dépendant des tests et activation explicite",()=>{
 const source=read(".github/workflows/pages-qualified.yml");
 assert.match(source,/vars\.CHAMBERTIN_PAGES_CI == 'true'/);
 assert.match(source,/node --test tests\/\*\.test\.cjs/);
 assert.match(source,/needs: qualification/);
 assert.match(source,/pages: write/);
 assert.match(source,/id-token: write/);
});
