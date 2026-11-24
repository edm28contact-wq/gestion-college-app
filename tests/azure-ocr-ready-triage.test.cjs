"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {pathToFileURL}=require("node:url");
const {resolve}=require("node:path");
const modulePromise=import(pathToFileURL(resolve("backend/secretariat-invoice-queue/core.mjs")).href);
const product={id:"p1",code:"VA58",name:"Soucoupe 112 Restaurant blanc",active:true,unit:"pièce",
 stock_count_mode:"unit",inventory_unit_label:"pièce",purchase_to_stock_factor:1,conditionnement:"à la pièce"};
const supplier={supplier_key:"henrijulien",supplier_reference_norm:"va58",supplier_label:"SOUCOUPE 112 RESTAURANT BLANC",
 product_id:"p1",verification_count:2};
const catalog={products:[product],verified_mappings:[supplier],supplier_product_catalog:[]};
const values={supplier:"Henri Julien",subtotal:"63",items:[{
 description:"SOUCOUPE 112 RESTAURANT BLANC",product_code:"VA58",quantity:"60",
 unit:"pièce",unit_price:"1.05",amount:"63",confidence:.98
}]};
const azure=(s=values,page_count=1)=>({provider:"azure_invoice",attempt:1,status:"review",page_count,
 structured_result:{...s,items:s.items.map(i=>({...i})),partial_document_possible:page_count===2}});
test("Verified supplier mapping + matching amount and packaging creates a green pre-review, never stock writes",async()=>{
 const {evaluateInvoice}=await modulePromise;
 const out=evaluateInvoice({readings:[azure()],catalog});
 assert.equal(out.green_lines,1);assert.equal(out.orange_lines,0);
 assert.equal(out.lines[0].stock_quantity,60);
 assert.equal(out.stock_unchanged,true);
});
test("Missing supplier or F0 two-page limit prevents any green",async()=>{
 const {evaluateInvoice}=await modulePromise;
 for(const read of [azure({...values,supplier:""}),azure(values,2)]){
  const out=evaluateInvoice({readings:[read],catalog});
  assert.equal(out.green_lines,0);assert.equal(out.needs_review,true);
 }
});
test("Contradictory supplier reference is orange, not silently excluded",async()=>{
 const {evaluateInvoice}=await modulePromise;
 const second={...product,id:"p2",code:"VBB",name:"SOUCOUPE RESTAURANT AUTRE"};
 const out=evaluateInvoice({readings:[azure()],catalog:{
  products:[product,second],
  verified_mappings:[{...supplier,product_id:"p2"}],
  supplier_product_catalog:[]
 }});
 assert.equal(out.green_lines,0);assert.equal(out.red_lines,0);assert.equal(out.orange_lines,1);
});
test("Unknown product is red excluded and recoverable in review",async()=>{
 const {evaluateInvoice}=await modulePromise;
 const out=evaluateInvoice({readings:[azure({...values,items:[{...values.items[0],
  product_code:"UNKNOWN",description:"Produit inconnu",confidence:.98}]})],catalog});
 assert.equal(out.red_lines,1);assert.equal(out.lines[0].excluded,true);
 assert.equal(out.stock_unchanged,true);
});
test("Missing structured Azure result never invents green products",async()=>{
 const {evaluateInvoice}=await modulePromise;
 const out=evaluateInvoice({readings:[{provider:"ocrspace",attempt:1,status:"review",ocr_text:"VA58 63 €"}],catalog});
 assert.equal(out.ready,false);assert.equal(out.green_lines,0);
});
test("Arithmetic mismatch and unverifiable stock packaging must be orange",async()=>{
 const {evaluateInvoice}=await modulePromise;
 const out=evaluateInvoice({readings:[azure({...values,items:[{...values.items[0],amount:"68"}],subtotal:"68"})],catalog});
 assert.equal(out.green_lines,0);assert.equal(out.orange_lines,1);
});
test("Invoice numeric 2,000 is ambiguous, never guessed as quantity 2",async()=>{
 const {money}=await modulePromise;
 assert.equal(money("2,000"),null);assert.equal(money("2.00"),2);
});
test("Azure results are displayed separately and never finalize stock",()=>{
 const code=fs.readFileSync("backend/secretariat-invoice-queue/index.ts","utf8");
 const page=fs.readFileSync("secretariat/factures-gestion/queue.js","utf8");
 assert.match(code,/evaluateInvoice\(/);assert.match(code,/stock_unchanged:true/);
 assert.match(page,/showReview/);assert.match(page,/data\.readings/);assert.match(page,/stock_unchanged!==true/);
 assert.doesNotMatch(code,/stock_movements|stock_balances/i);
});
