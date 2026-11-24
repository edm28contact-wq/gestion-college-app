"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=n=>fs.readFileSync("supabase/functions/"+n+"/index.ts","utf8");
test("Comptes centraux : les cinq API principales vérifient la désactivation centrale et les dates de session",()=>{
 for(const name of ["admin-api","personnel-planning","secretariat-api","kitchen-api","rental-admin-api"]){
  const source=read(name);assert.match(source,/central_active===false/);assert.match(source,/Number\.isFinite\(Number\(p\.exp\)\)/);assert.match(source,/Number\(p\.exp\)<=Date\.now\(\)/);
  assert.match(source,/must_change_password/);
 }
});
test("Administration : changement de mot de passe obligatoire, mais possibilité de changer son mot de passe",()=>{
 const source=read("admin-api"),line=source.split("\n").find(l=>l.startsWith("if(a.must_change_password===true"));
 assert.ok(line);const run=(required,action,method)=>vm.runInNewContext("(function(){"+line+";return 200;})()",{a:{must_change_password:required},action,req:{method},json:(_,status)=>status});
 assert.equal(run(true,"data","GET"),403);assert.equal(run(true,"save-order","POST"),403);assert.equal(run(true,"change-password","GET"),403);assert.equal(run(true,"change-password","POST"),200);assert.equal(run(false,"data","GET"),200);
});
test("Marne : droits de production synchronisés, pas d’autorisation implicite par l’ancien rôle",()=>{
 const source=read("rental-admin-api");assert.match(source,/function tenantEditAllowed/);assert.match(source,/function propertyEditAllowed/);assert.match(source,/if\(!tenantEditAllowed\(account\)\)/);assert.match(source,/if\(!propertyEditAllowed\(account\)\)/);
 const start=source.indexOf("function marneAllowed("),end=source.indexOf("function apiUuid(",start);
 assert.ok(start>=0&&end>start);assert.doesNotMatch(source.slice(start,end),/role==="marne_invest"/);
});
