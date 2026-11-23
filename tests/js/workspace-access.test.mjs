import test from "node:test";
import assert from "node:assert/strict";
import {allowedLink,allowedTab} from "../../college/workspace-access.mjs";

const base=new URL("https://edm28contact-wq.github.io/gestion-college-app/");
const context=(pages={},permissions={},read_only=false)=>({pages,permissions,read_only,sites:{secretariat:!!pages.secretariat},is_super_admin:false});
const check=(route,ctx)=>allowedLink(new URL(route,base).href,ctx,base);

test("secrétariat : uniquement les modules explicitement autorisés",()=>{
 const ctx=context({secretariat:true,planning:true,veryfi:true},{"secretariat.read":true});
 assert.equal(check("secretariat/",ctx),true);
 assert.equal(check("secretariat/planning/",ctx),true);
 assert.equal(check("comptabilite/",ctx),false);
 assert.equal(check("admin/holding/",ctx),false);
 assert.equal(allowedTab("#tSettings",ctx,"secretariat"),false);
 assert.equal(allowedTab("#tOrders",ctx,"secretariat"),true);
});

test("comptabilité sans privilège Holding ni Gestion Collège",()=>{
 const ctx=context({accounting:true,veryfi:true},{"accounting.read":true},true);
 assert.equal(check("comptabilite/",ctx),true);
 assert.equal(check("lecteur-veryfi/?origine=comptabilite",ctx),true);
 assert.equal(check("admin/holding/utilisateurs/",ctx),false);
 assert.equal(check("college/admin/?page=cuisine",ctx),false);
});

test("gestionnaire locataires ne reçoit pas le droit sur les biens ou les finances",()=>{
 const ctx=context({marne:true,marne_tenants:true,marne_studios:false,marne_accounting:false},{"marne_tenants":true});
 assert.equal(check("admin/marne-invest/?page=tenants",ctx),true);
 assert.equal(check("admin/marne-invest/?page=properties",ctx),false);
 assert.equal(check("admin/marne-invest/comptabilite/",ctx),false);
});

test("aucun lien arbitraire ou externe n'est présenté",()=>{
 const ctx=context({college:true,holding:true});
 assert.equal(allowedLink("https://attacker.example/",ctx,base),false);
 assert.equal(check("admin/secret-page/",ctx),false);
 assert.equal(check("college/admin/",ctx),true);
});

test("le planning en lecture seule masque la saisie",()=>{
 const ctx=context({planning:true},{"personnel.planning.read":true},true);
 assert.equal(allowedTab("#new",ctx,"planning"),false);
 assert.equal(allowedTab("#month",ctx,"planning"),true);
});

test("sans session vérifiée, aucun lien ni onglet",()=>{
 assert.equal(check("secretariat/",null),false);
 assert.equal(allowedTab("#tInvoices",null,"secretariat"),false);
});
