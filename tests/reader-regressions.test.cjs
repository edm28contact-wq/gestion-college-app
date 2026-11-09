"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.join(__dirname,".."),file=p=>fs.readFileSync(path.join(root,p),"utf8"),source=file("lecteur-veryfi/veryfi.js");
function functionSource(name){
 const start=source.indexOf("function "+name+"(");
 assert.ok(start>=0,"Fonction de production manquante: "+name);
 const open=source.indexOf("{",start);let depth=0;
 for(let i=open;i<source.length;i++){if(source[i]==="{")depth++;if(source[i]==="}"&&--depth===0)return source.slice(start,i+1)}
 throw Error("Corps de fonction incomplet: "+name);
}
const names=["validLineVat","duplicateFingerprint","possibleDuplicate","productColor","invoiceArithmetic","eligible","isRetainedGreen","autoVerifyGreenRows","issueCategories","issueRank","groupedRows","calc"];
function row(extra={}){return {id:0,reference:"R100",description:"Fromage",quantity:2,unit:"piece",unit_price:3,total:6,tax_rate:20,
 product_id:"p-1",stock_quantity:2,stock_needs_review:false,stock_confirmed:true,score:.99,confidenceMissing:[],
 verified:false,manualVerified:false,autoVerified:false,changed:false,manualMatchRequired:false,unit_inferred:false,
 autoQuantityReconciled:false,unit_label_conflict:false,excluded:false,...extra}}
function harness(){
 const values={subtotal:"6",tax:"1.2",total:"7.2",vendor:"Fournisseur",invoiceNumber:"123",invoiceDate:"2026-11-09"};
 const ctx={rows:[],removedRows:[],issueFilter:"all",saved:false,documentData:{id:1},file:{name:"test.pdf"},accounting:false,catalog:{products:[{id:"p-1",active:true}]},
  AUTO_APPROVE_SCORE:.90,document:{getElementById:id=>({value:values[id]??""})}};
 const helpers=[
  'const $=id=>document.getElementById(id);',
  'const amount=x=>{if(x==null||String(x).trim()==="")return null;const n=Number(String(x).replace(",","."));return Number.isFinite(n)?n:null};',
  'const norm=x=>String(x??"").normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g,"");',
  'const round=x=>Math.round((x+Number.EPSILON)*100)/100;',
  'const canonicalUnit=x=>norm(x);',
  'const invoiceDesignationKey=x=>norm(x);',
  'const issuePriority=Object.freeze({montant:0,doublon:1,tva:2,stock:3,unite:4,rapprochement:5,ocr:6,validation:7,catalogue:8});'
 ].join("\n");
 vm.createContext(ctx);
 vm.runInContext(helpers+"\n"+names.map(functionSource).join("\n")+"\nthis.reader={productColor,autoVerifyGreenRows,isRetainedGreen,issueCategories,groupedRows,calc};",ctx);
 return {ctx,api:ctx.reader};
}
test("ligne fiable: verte et réception permise",()=>{
 const h=harness();h.ctx.rows=[row()];h.api.autoVerifyGreenRows();
 assert.equal(h.api.productColor(h.ctx.rows[0]),"good");
 assert.equal(h.api.calc().ok,true);assert.equal(h.api.calc().sum,6);
});
test("deux lignes identiques ne passent pas automatiquement au vert",()=>{
 const h=harness();h.ctx.rows=[row({id:0}),row({id:1})];h.api.autoVerifyGreenRows();
 assert.deepEqual(Array.from(h.ctx.rows,r=>h.api.productColor(r)),["warn","warn"]);
 assert.equal(h.api.calc().ok,false);
 assert.ok(h.api.issueCategories(h.ctx.rows[0]).includes("doublon"));
});
test("TVA absente, négative ou supérieure à 100: réception bloquée",()=>{
 for(const tax_rate of ["",null,-1,101]){const h=harness();h.ctx.rows=[row({tax_rate})];h.api.autoVerifyGreenRows();
  assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");assert.equal(h.api.calc().ok,false)}
});
test("écart quantité/prix/total et stock non confirmé: réception bloquée",()=>{
 for(const value of [{total:7},{stock_needs_review:true,stock_confirmed:false}]){
  const h=harness();h.ctx.rows=[row(value)];h.api.autoVerifyGreenRows();
  assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");assert.equal(h.api.calc().ok,false);
 }
});
test("ligne écartée: exclue du stock et rangée séparément",()=>{
 const h=harness();h.ctx.rows=[row({verified:true,manualVerified:true,excluded:true}),row({reference:"R101"})];h.api.autoVerifyGreenRows();
 assert.equal(h.api.isRetainedGreen(h.ctx.rows[0]),false);assert.equal(h.api.calc().sum,6);
 assert.equal(h.api.groupedRows().find(x=>x.status==="excluded").items.length,1);
});
test("filtre des erreurs: aucun effet sur les montants",()=>{
 const h=harness();h.ctx.rows=[row()];h.api.autoVerifyGreenRows();const before=h.api.calc().sum;
 h.ctx.issueFilter="tva";assert.equal(h.api.calc().sum,before);
 assert.ok(h.api.groupedRows().every(g=>!g.items.length));
});
test("la finalisation n'envoie que les lignes retenues",()=>{
 assert.ok(source.includes("const items=c.included.map("));
 assert.ok(source.includes("expected_ht:c.sum"));
 assert.ok(source.includes('if(!c.ok||!$("confirmReview").checked)'));
});
test("les intégrations de base restent présentes",()=>{
 const admin=file("college/admin/index.html"),payroll=file("college/admin/salaires.js"),planning=file("secretariat/planning/index.html");
 const secretariat=file("secretariat/index.html"),reader=file("lecteur-veryfi/index.html");
 assert.ok(admin.includes("restoreProductFilters()"));assert.ok(payroll.includes("salaryStaffPanel()"));
 assert.ok(planning.includes('<option value="incident">Incident</option>'));
 assert.ok(planning.includes("Planning des événements du personnel"));
 assert.ok(secretariat.includes("embeddedInvoices")&&secretariat.includes("embeddedPlanning"));
 assert.ok(reader.includes('id="issueFilter"')&&reader.includes('id="freeOcrVerify"'));
});
