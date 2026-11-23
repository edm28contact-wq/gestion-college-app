"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(root,"secretariat/index.html"),"utf8");
const api=fs.readFileSync(path.join(root,"supabase/functions/secretariat-api/index.ts"),"utf8");
const start=html.indexOf("function secretaryCanSee(section){");
const end=html.indexOf("function applySecretariatVisibility(){",start);
assert.ok(start>=0&&end>start,"Vérification de visibilité introuvable");
function visibility(role,permissions){
 const db={current_user:{role,permissions}};
 return new Function("db",html.slice(start,end)+"\nreturn secretaryCanSee;")(db);
}

test("un profil Planning seul n'ouvre ni Stocks, ni Commandes, ni Factures",()=>{
 const canSee=visibility("secretariat",{"personnel.planning.read":true,"personnel.planning.write":true});
 assert.equal(canSee("planning"),true);
 for(const page of ["stocks","orders","invoices","settings"])assert.equal(canSee(page),false,page);
});

test("le rôle historique Secrétariat ne suffit pas à accorder des droits",()=>{
 const canSee=visibility("secretariat",{});
 for(const page of ["stocks","orders","invoices","planning","settings"])assert.equal(canSee(page),false,page);
});

test("les droits de consultation et modification sont distingués",()=>{
 assert.equal(visibility("secretariat",{"secretariat.orders.write":true})("orders"),true);
 assert.equal(visibility("secretariat",{"secretariat.orders.write":true})("invoices"),false);
 assert.equal(visibility("secretariat",{"secretariat.invoices.write":true})("invoices"),true);
 assert.equal(visibility("secretariat",{"secretariat.invoices.write":true})("orders"),false);
});

test("l'API ne renvoie pas les données de stock aux comptes Planning seul",()=>{
 assert.match(api,/if\(!productsAllowed\)return \{current_user,categories:\[\],products:\[\],order_products:\[\],balances:\[\],orders:\[\]/);
 assert.match(api,/const ordersAllowed=broad\|\|p\["secretariat\.orders\.write"\]===true/);
 assert.match(api,/perms\["personnel\.planning\.read"\]===true/);
});
