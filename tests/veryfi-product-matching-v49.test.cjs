"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("lecteur-veryfi/veryfi.js","utf8");
function extract(name){
 const start=source.indexOf("function "+name+"(");
 assert.ok(start>=0,"Missing "+name);
 const open=source.indexOf("{",start);
 let depth=0;
 for(let i=open;i<source.length;i++){
  if(source[i]==="{")depth++;
  if(source[i]==="}"&&--depth===0)return source.slice(start,i+1);
 }
 throw Error("Incomplete "+name);
}
const norm=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function setup(extra={}){
 const p1={id:"a",active:true,code:"Y100",name:"Yaourt sucré LFR 115Gx4x12 Danone",unit:"pot",stock_count_mode:"unit",inventory_unit_label:"pot",purchase_to_stock_factor:1,conditionnement:"Carton de 48 pots"},
 p2={id:"b",active:true,code:"E100",name:"Emmental UE rape 29% 1KGx10",unit:"kg",stock_count_mode:"unit",inventory_unit_label:"kg",purchase_to_stock_factor:1,conditionnement:"Sachet de 1 kg"};
 const ctx={
  catalog:{products:[p1,p2],inactive_products:[],verified_mappings:[],supplier_product_catalog:[],accounts:[]},
  aliases:[],norm,supplierNorm:()=>"fournisseur",verifiedSupplierReference:()=>null,
  verifiedConversions:Object.freeze({RV40:20,TH49:10,VN19:4,VW27:4,VX38:8,XV90:5}),
  amount:x=>{if(x===null||x===""||x===undefined)return null;const n=Number(String(x).replace(",","."));return Number.isFinite(n)?n:null},
  round:x=>Math.round((x+Number.EPSILON)*100)/100,
  documentedCartonContents:()=>null,accountFor:()=>({account:"",source:"test"}),...extra
 };
 vm.createContext(ctx);
 const functions=["invoiceDesignationKey","findProduct","stockUnitKind","invoiceSaleUnit","stockSuggestion"];
 const definition=source.slice(source.indexOf("const canonicalUnit=x=>"),source.indexOf("function supplierRule()"));
 vm.runInContext(definition+"\n"+functions.map(extract).join("\n")+"\nthis.api={findProduct,invoiceSaleUnit,stockSuggestion,invoiceDesignationKey};",ctx);
 return {ctx,api:ctx.api,p1,p2};
}
test("Full catalog designation survives supplier billed quantities and becomes a reviewable match",()=>{
 const {api,p1}=setup();
 const x=api.findProduct({reference:"unknown-ref",description:"Yaourt sucré LFR 115Gx4x12 Danone 2,000 COL 96,000 POT"});
 assert.equal(x.product.id,p1.id);
 assert.equal(x.manualMatchRequired,true);
});
test("Unknown product does not match a deceptively similar one",()=>{
 const {api}=setup();
 const x=api.findProduct({reference:"other",description:"Yaourt vanille 115Gx4x12 Danone 2,000 COL 96,000 POT"});
 assert.equal(x.product,null);
 assert.match(x.source,/ABSENT/);
});
test("Unverified supplier history suggests a product but cannot approve it",()=>{
 const {api,p1}=setup({catalog:{
  products:[{id:"a",active:true,code:"Y100",name:"Yaourt sucré LFR 115Gx4x12 Danone",unit:"pot",purchase_to_stock_factor:1}],
  inactive_products:[],verified_mappings:[],accounts:[],
  supplier_product_catalog:[{supplier_key:"fournisseur",supplier_product_name:"Yaourt LFR sucré grand carton",product_id:"a"}]
 }});
 const x=api.findProduct({reference:"abc123",description:"Yaourt LFR sucré grand carton 2,000 COL 96,000 POT"});
 assert.equal(x.product.id,p1.id);assert.equal(x.manualMatchRequired,true);
});
test("Conflicting supplier reference and exact catalog designation are not auto-matched",()=>{
 const {api,p1}=setup({aliases:[{alias_kind:"reference",supplier_key:"fournisseur",keyword_norm:"abc123",product_id:"b"}]});
 const x=api.findProduct({reference:"ABC123",description:p1.name});
 assert.equal(x.product,null);assert.equal(x.manualMatchRequired,true);
});
test("Verified 20-L bidon invoice unit can map to documented 20 litre stock",()=>{
 const {api}=setup();const product={code:"RV40",active:true,unit:"pièce",conditionnement:"bidon 20 L",purchase_to_stock_factor:20,inventory_unit_label:"litre",stock_count_mode:"litre"};
 const same=api.invoiceSaleUnit({unit:"BIDON"},product);
 assert.equal(same.ok,true);
 const out=api.stockSuggestion({quantity:2,unit:"BIDON"},product);
 assert.equal(out.quantity,40);assert.equal(out.needsReview,false);
});
test("Unverified conversion never becomes automatically accepted",()=>{
 const {api}=setup();const product={code:"BAD",active:true,unit:"pièce",conditionnement:"bidon 20 L",purchase_to_stock_factor:20,inventory_unit_label:"litre",stock_count_mode:"litre"};
 const out=api.stockSuggestion({quantity:2,unit:"BIDON"},product);
 assert.equal(out.needsReview,true);assert.equal(out.quantity,"");
});
test("Invoice supplier reference memorization is explicitly confirmed and scoped",()=>{
 assert.match(source,/saveKeyword\(row,reference,false,"reference"\)/);
 assert.match(source,/Associer la référence/);
 assert.match(source,/alias_kind:aliasKind/);
});
