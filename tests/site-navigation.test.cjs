"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.join(__dirname,".."),read=p=>fs.readFileSync(path.join(root,p),"utf8");
const pages=[
 "secretariat/index.html","comptabilite/index.html","secretariat/planning/index.html",
 "lecteur-veryfi/index.html","admin/holding/index.html","admin/holding/controle/index.html",
 "admin/holding/utilisateurs/index.html","admin/holding/societes/index.html","college/readiness/index.html"
];
test("les pages essentielles chargent des scripts et feuilles de style versionnés",()=>{
 for(const page of pages){
  const html=read(page);
  assert.match(html,/workspace-layout\.js\?v=[0-9a-z.-]+/i,page+" : menu sans version");
  assert.match(html,/workspace-layout\.css\?v=[0-9a-z.-]+/i,page+" : feuille de style sans version");
 }
});
test("scripts et feuilles de style locaux : aucun chemin cassé dans les espaces principaux",()=>{
 for(const page of pages){
  const html=read(page);
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/gi)){
   const uri=match[1];if(/^(?:https?:|data:|\/\/)/i.test(uri))continue;
   const relative=uri.split(/[?#]/)[0];
   if(!relative||relative.startsWith("#"))continue;
   const location=path.resolve(root,path.dirname(page),relative);
   assert.ok(location.startsWith(root+path.sep),"Chemin hors projet : "+page+" -> "+uri);
   assert.ok(fs.existsSync(location),"Ressource absente : "+page+" -> "+uri);
  }
 }
});
test("la recherche des menus demeure accessible et n'affiche pas les espaces masqués",()=>{
 const source=read("college/workspace-layout.js"),access=read("college/workspace-access.mjs"),css=read("college/workspace-layout.css");
 new vm.Script(source,{filename:"workspace-layout.js"});
 assert.ok(source.includes('searchInput.type="search"'));
 assert.ok(source.includes('control.classList.toggle("school-menu-filtered",!matches)'));
 assert.ok(source.includes('if(!control.hidden&&matches)visible++'));
 assert.ok(access.includes('a.dataset.configHidden==="true"'));
 assert.ok(source.includes('applyAuthorizedNavigation()'));
 assert.ok(access.includes('!allowedLink(a.href,access,base)'));
 assert.ok(css.includes(".school-menu-group-filtered"));
 assert.ok(css.includes("focus-visible"));
});
test("date de commande : la date dépend du fuseau Europe/Paris et non de UTC",()=>{
 const source=read("secretariat/index.html");
 const start=source.indexOf("function parisOrderDate(){");
 assert.ok(start>=0);
 const end=source.indexOf("\nfunction newOrder(){",start);
 assert.ok(end>start);
 const makeDate=iso=>class FakeDate extends Date{constructor(...args){super(...(args.length?args:[iso]));}};
 const run=iso=>new Function("Date",source.slice(start,end)+";return parisOrderDate();")(makeDate(iso));
 assert.equal(run("2026-06-30T22:30:00.000Z"),"2026-07-01");
 assert.equal(run("2026-12-31T23:30:00.000Z"),"2027-01-01");
});
