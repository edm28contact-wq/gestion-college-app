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

test("Saisie manuelle alimentaire : la consultation et la création restent limitées aux autorisations factures",()=>{
 const start=api.indexOf("function canReadManualInvoices("),end=api.indexOf("function foodProductPayload(",start);
 const f=new Function(api.slice(start,end).replace(/a:any/g,"a")+";return {read:canReadManualInvoices,create:canCreateFoodProduct}")();
 const session=permissions=>({role:"secretariat",permissions});
 assert.equal(f.read(session({"personnel.planning.read":true})),false);
 assert.equal(f.create(session({"secretariat.orders.write":true})),false);
 assert.equal(f.read(session({"secretariat.read":true})),true);
 assert.equal(f.create(session({"secretariat.read":true})),false);
 assert.equal(f.create(session({"secretariat.invoices.write":true})),true);
 assert.equal(f.create(session({"secretariat.invoices.write":true,readonly:true})),false);
 assert.equal(f.create({role:"admin",permissions:{}}),true);
 assert.equal(f.create(session({})),false);
});
test("Création alimentaire côté serveur : aucune mise à jour de produit ou injection de stock initial",()=>{
 const start=api.indexOf("function foodProductPayload("),end=api.indexOf("async function manualInvoiceOptions(",start);
 const source=api.slice(start,end).replace(/x:any|categoryId:string|key:string/g,x=>x.split(":")[0]);
 const payload=new Function(source+";return foodProductPayload")();
 const values={supplier:"LA NORMANDE",code:"test-1",name:"Produit",category_id:"food",unit:"carton",conditionnement:"carton de 12",inventory_unit_label:"pièce",purchase_to_stock_factor:12,stock_count_mode:"unit",unit_price:5,initial_stock:99,min_stock:0,target_stock:1,active:false};
 assert.equal(payload(values,"food").initial_stock,0);
 assert.equal(payload(values,"food").code,"TEST-1");
 assert.equal(payload(values,"food").active,true);
 assert.equal(payload({...values,id:"existing"},"food"),null);
 assert.equal(payload({...values,category_id:"other"},"food"),null);
 assert.equal(payload({...values,supplier:""},"food"),null);
 assert.equal(payload({...values,purchase_to_stock_factor:0},"food"),null);
 assert.equal(payload({...values,code:"BAD CODE"},"food"),null);
 assert.match(api,/if\(!canCreateFoodProduct\(a\)\)return json/);
 assert.match(api,/\.eq\("code","alimentaire"\)\.eq\("active",true\)/);
 assert.match(api,/\.from\("products"\)\.insert\(payload\)/);
 assert.match(api,/if\(result\.error\.code==="23505"\)/);
});
