"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("la page d'accueil conserve les liens QR des applications",()=>{
 const html=read("index.html");
 assert.match(html,/hasApp\?'\.\/college\/'/);
 assert.match(html,/'\.\/portail\/'/);
 assert.match(html,/target\.search=location\.search/);
});

test("le portail n'affiche que les sites autorisés par la session vérifiée",()=>{
 const html=read("portail/index.html");
 assert.match(html,/college-access-context/);
 assert.match(html,/context\.sites\?\.\[id\]!==true/);
 assert.match(html,/if\(!response\.ok\)return null/);
 assert.match(html,/const seen=new Set/);
 assert.match(html,/textContent=title/);
 assert.match(html,/role="status"/);
 assert.match(html,/id="account"/);
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){
  new vm.Script(script[1],{filename:"portail-inline.js"});
 }
});

test("les connexions Holding ne remplacent pas la session Secrétariat",()=>{
 const source=read("admin/holding/index.html");
 assert.match(source,/const UNIVERSAL_TOKEN_KEYS=\['holding_admin_token','edm_admin_token'\]/);
 const writer=source.match(/function saveUniversalToken\(value\)\{[^}]+\}/)?.[0]||"";
 assert.doesNotMatch(writer,/college_secretariat_token/);
 assert.match(source,/function clearUniversalTokens\(\)/);
});

test("le contrôle des droits ne réutilise pas une session Cuisine sans vérifier sa signature",()=>{
 const navigation=read("college/workspace-access.mjs");
 assert.match(navigation,/area==="cuisine"/);
 assert.match(navigation,/sessionStorage\.getItem/);
 assert.match(navigation,/if\(!response\.ok\)/);
 assert.match(navigation,/invalidToken=token/);
 assert.match(navigation,/!allowedLink\(a\.href,access,base\)/);
});
