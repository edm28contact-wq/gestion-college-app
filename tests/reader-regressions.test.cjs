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
const names=["validLineVat","groupedVatAmount","proposeHeaderAmounts","missingVatRows","applyVerifiedVat","applyVatFromPdf","suggestInvoiceVatRate","previewVatApproval","duplicateFingerprint","possibleDuplicate","productColor","invoiceArithmetic","eligible","isRetainedGreen","autoVerifyGreenRows","issueCategories","issueRank","groupedRows","calc"];
function row(extra={}){return {id:0,reference:"R100",description:"Fromage",quantity:2,unit:"piece",unit_price:3,total:6,tax_rate:20,
 product_id:"p-1",stock_quantity:2,stock_needs_review:false,stock_confirmed:true,score:.99,confidenceMissing:[],
 verified:false,manualVerified:false,autoVerified:false,changed:false,manualMatchRequired:false,unit_inferred:false,
 autoQuantityReconciled:false,unit_label_conflict:false,excluded:false,...extra}}
function harness(){
 const values={subtotal:"6",tax:"1.2",total:"7.2",vendor:"Fournisseur",invoiceNumber:"123",invoiceDate:"2026-11-09",bulkVatRate:"20"};
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
 vm.runInContext(helpers+"\n"+names.map(functionSource).join("\n")+"\nthis.reader={productColor,autoVerifyGreenRows,isRetainedGreen,issueCategories,groupedRows,calc,groupedVatAmount,proposeHeaderAmounts,applyVerifiedVat,applyVatFromPdf,suggestInvoiceVatRate,previewVatApproval};",ctx);
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
test("les fiches incomplètes sont signalées sans inventer de conditionnement",()=>{
 const html=file("college/admin/index.html");
 assert.ok(html.includes("function productQualityIssues(p)"));
 assert.ok(html.includes('id="productQualityFilter"'));
 assert.ok(html.includes("showProductsToFix()"));
 assert.ok(html.includes("productFilterState.productQualityFilter='missing'"));
 assert.ok(html.includes("productFilterIds=['productSearch'"));
 assert.ok(html.includes("'productQualityFilter'];"));
 assert.ok(html.includes("window.resetProductFilters=()=>"));
});
test("syntaxe des scripts intégrés du site",()=>{
 for(const page of ["college/admin/index.html","secretariat/index.html","secretariat/planning/index.html"]){
  const html=file(page);
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/.test(m[1])&&m[2].trim());
  assert.ok(scripts.length>0,"Pas de script intégré à vérifier : "+page);
  for(const script of scripts)new vm.Script(script[2],{filename:page});
 }
});
test("facture d'entraînement : base TVA globale et arrondis corrects",()=>{
 const totals=[53.4,36.4,11.4,147,69.6,39.6,22.2,27.5,10.2,50.4,30,84,4.2,63,15,36,9.8,181.44,181.44,88.2,25.68,45.6,21,16.2,25.68];
 const h=harness(),lines=totals.map((total,i)=>row({id:i,reference:"R"+i,total,tax_rate:i===0?20:"",verified:false,autoVerified:false}));
 assert.equal(totals.length,25);
 assert.equal(h.api.groupedVatAmount(lines),null,"La TVA est inconnue tant que 24 taux manquent.");
 const guess=h.api.proposeHeaderAmounts(totals,294.94,258.99,553.93);
 assert.equal(guess.ht,1294.94);assert.equal(guess.tax,258.99);assert.equal(guess.ttc,1553.93);assert.equal(guess.gap,1000);
 const filled=h.api.applyVerifiedVat(lines,20);
 assert.equal(filled.ok,true);assert.equal(filled.count,24);
 assert.equal(h.api.groupedVatAmount(lines),258.99);
 assert.ok(lines.slice(1).every(x=>!x.changed&&!x.verified&&!x.autoVerified&&x.vatConfirmedFromPdf===true));
 assert.equal(lines[0].tax_rate,20);
});
test("TVA multiple ou incohérente : propagation refusée",()=>{
 const h=harness(),items=[row({tax_rate:20}),row({tax_rate:5}),row({tax_rate:""})];
 const result=h.api.applyVerifiedVat(items,20);
 assert.equal(result.ok,false);assert.equal(result.count,0);assert.equal(items[2].tax_rate,"");
});
test("la réparation des montants refuse les écarts non justifiés",()=>{
 const h=harness();
 assert.equal(h.api.proposeHeaderAmounts([300,700],294.94,258.99,553.93),null);
 assert.equal(h.api.proposeHeaderAmounts([1294.94],294.94,258.99,600),null);
 assert.equal(h.api.proposeHeaderAmounts([1294.94],null,258.99,553.93),null);
});
test("la correction d'en-tête reste une suggestion OCR à vérifier sur le PDF",()=>{
 assert.ok(source.includes("En-tête OCR à contrôler"));
 assert.ok(source.includes("Suggestion calculée à partir de la somme des lignes OCR"));
 assert.ok(source.includes("vérifiez obligatoirement ces montants sur le PDF original"));
 assert.ok(!source.includes("Correction proposée APRÈS comparaison avec le PDF"));
});
test("le tri explicite les TVA manquantes et les produits désactivés sans les valider",()=>{
 assert.ok(source.includes("const missingTaxes=active.filter(r=>!validLineVat(r)).length"));
 assert.ok(source.includes('startsWith("Produit DÉSACTIVÉ")'));
 assert.ok(source.includes("Le filtre ne modifie ni les données ni les montants."));
 assert.ok(source.includes("row.verified=false;row.autoVerified=false;row.manualVerified=false"));
});
test("mode entraînement : aucune facture ne peut être enregistrée",()=>{
 const html=file("lecteur-veryfi/index.html");
 assert.ok(source.includes("const trainingMode=parameters.get("));
 assert.ok(source.includes("$(\"save\").disabled=trainingMode||"));
 assert.ok(source.includes('if(trainingMode)return notice("Mode entraînement'));
 assert.ok(html.includes('id="trainingBanner"'));
 assert.ok(html.includes('id="applyBulkVat"'));
 assert.ok(html.includes('id="repairHeader"'));
});
test("facture Henri Julien : les lignes fiables passent au vert après une confirmation groupée de TVA",()=>{
 const amounts=[53.4,36.4,11.4,147,69.6,39.6,22.2,27.5,10.2,50.4,30,84,4.2,63,15,36,9.8,181.44,181.44,88.2,25.68,45.6,21,16.2,25.68];
 const h=harness();
 h.ctx.documentData.line_items=amounts.map((total,i)=>({total,index:i}));
 h.values.tax="258.99";
 h.ctx.rows=amounts.map((total,i)=>row({id:i,reference:"H"+i,description:"Ligne "+i,total,quantity:1,unit_price:total,tax_rate:i===0?20:"",
 product_id:[0,12,20,21,23,24,22].includes(i)?"":"p-1",stock_quantity:1,score:i===13?.85:.97}));
 const proposed=h.api.suggestInvoiceVatRate();
 assert.equal(proposed.rate,20);assert.equal(proposed.missing,24);
 assert.equal(h.api.groupedVatAmount(h.ctx.rows),null);
 const added=h.api.applyVerifiedVat(h.ctx.rows,20);
 assert.equal(added.count,24);
 h.api.autoVerifyGreenRows();
 const statuses=Array.from(h.ctx.rows,r=>h.api.productColor(r));
 assert.equal(statuses.filter(s=>s==="good").length,17);
 assert.equal(statuses.filter(s=>s==="warn").length,1);
 assert.equal(statuses.filter(s=>s==="bad").length,7);
 assert.equal(h.ctx.rows[13].verified,false,"Confiance OCR 85 % : validation manuelle obligatoire.");
 assert.equal(h.api.groupedVatAmount(h.ctx.rows),258.99);
});
test("la TVA groupée ne neutralise pas une correction de quantité ou une référence ambiguë",()=>{
 const h=harness();
 const existingCorrection=row({changed:true,tax_rate:""}),manualMatch=row({reference:"autre",manualMatchRequired:true,tax_rate:""});
 h.ctx.rows=[existingCorrection,manualMatch];
 h.api.applyVerifiedVat(h.ctx.rows,20);
 h.api.autoVerifyGreenRows();
 assert.equal(h.api.productColor(existingCorrection),"warn");
 assert.equal(h.api.productColor(manualMatch),"warn");
 assert.ok(h.ctx.rows.every(r=>!r.verified));
});
test("le bouton de correction d'en-tête reste disponible si seul le HT est tronqué",()=>{
 const h=harness();
 assert.equal(h.api.proposeHeaderAmounts([1294.94],294.94,258.99,1553.93).ht,1294.94);
 assert.equal(h.api.proposeHeaderAmounts([1294.94],1294.94,258.99,553.93).ttc,1553.93);
 assert.equal(h.api.proposeHeaderAmounts([1294.94],294.94,258.99,553.93).ttc,1553.93);
 assert.equal(h.api.proposeHeaderAmounts([1294.94],1294.94,258.99,1553.93),null);
});
test("aperçu TVA sans écriture, puis classification après validation explicite",()=>{
 const h=harness();
 h.ctx.rows=[row({reference:"A",tax_rate:20}),row({reference:"B",tax_rate:""}),row({reference:"C",tax_rate:"",score:.85}),row({reference:"D",tax_rate:"",product_id:""})];
 const previous=JSON.stringify(h.ctx.rows),preview=h.api.previewVatApproval(20);
 assert.equal(preview.good,2);assert.equal(preview.warn,1);assert.equal(preview.bad,1);assert.equal(preview.missing,3);
 assert.equal(JSON.stringify(h.ctx.rows),previous,"La prévisualisation ne modifie pas les produits.");
 const changed=h.api.applyVerifiedVat(h.ctx.rows,20);h.api.autoVerifyGreenRows();
 assert.equal(changed.count,3);
 assert.deepEqual(Array.from(h.ctx.rows,r=>h.api.productColor(r)),["good","good","warn","bad"]);
});
test("la TVA proposée reste non appliquée sans confirmation humaine",()=>{
 const page=file("lecteur-veryfi/index.html");
 assert.ok(page.includes('id="vatActionRequired"')&&page.includes('id="applyVatBanner"'));
 assert.ok(source.includes('banner.hidden=!projection||!projection.missing'));
 assert.ok(source.includes("TVA non appliquée : confirmation annulée"));
 assert.ok(source.includes("PRÉREMPLI mais PAS APPLIQUÉ"));
 assert.ok(page.includes("veryfi.js?v=39"));
});
test("clic réel sur Appliquer la TVA : recalcul des verts, oranges et rouges",()=>{
 const h=harness(),notifications=[];
 h.ctx.rows=[row({reference:"A",tax_rate:""}),row({reference:"B",tax_rate:"",score:.85}),row({reference:"C",tax_rate:"",product_id:""})];
 h.ctx.confirm=()=>true;
 h.ctx.notice=(message,type)=>notifications.push({message,type});
 h.ctx.renderRows=()=>h.api.autoVerifyGreenRows();
 h.api.applyVatFromPdf();
 assert.deepEqual(Array.from(h.ctx.rows,r=>h.api.productColor(r)),["good","warn","bad"]);
 assert.deepEqual(Array.from(h.ctx.rows,r=>r.tax_rate),[20,20,20]);
 assert.ok(notifications.some(x=>x.type==="success"&&x.message.includes("1 ligne(s) verte(s)")));
});
test("annulation de la confirmation TVA : aucune ligne modifiée",()=>{
 const h=harness(),notifications=[];
 h.ctx.rows=[row({tax_rate:""})];h.ctx.confirm=()=>false;
 h.ctx.notice=(message,type)=>notifications.push({message,type});
 h.ctx.renderRows=()=>{throw Error("Le recalcul ne doit pas se produire")};
 h.api.applyVatFromPdf();
 assert.equal(h.ctx.rows[0].tax_rate,"");
 assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");
 assert.ok(notifications.some(x=>x.message.includes("TVA non appliquée")));
});
test("Secrétariat : la version du lecteur et de son iframe est explicitement incrémentée",()=>{
 const page=file("lecteur-veryfi/index.html");
 const sec=file("secretariat/index.html");
 assert.ok(page.includes('id="readerVersion"'));
 assert.ok(source.includes('const READER_VERSION="V40"'));
 assert.ok(source.includes('stamp.textContent=READER_VERSION'));
 assert.ok(page.includes("veryfi.js?v=40"));
 assert.ok(sec.includes("embed=secretariat&amp;v=20261109-v40"));
 assert.ok(source.includes('$("applyBulkVat").addEventListener("click",applyVatFromPdf)'));
 assert.ok(source.includes('$("applyVatBanner").addEventListener("click"'));
});
test("fin de lecture : les boutons TVA et HT/TTC sont réactivés après loading=false",async()=>{
 const analyzeSource="async "+functionSource("analyze");
 const controls={analyze:{disabled:false},clearFile:{disabled:false},results:{hidden:false},applyBulkVat:{disabled:false},repairHeader:{disabled:false}};
 const mockFile={name:"test.pdf",arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer};
 const h={
  file:mockFile,loading:false,serverReady:true,saved:false,revision:0,documentData:null,rows:[],removedRows:[],
  API:{veryfi:"mock"},authToken:"auth",
  document:{getElementById:id=>controls[id]||(controls[id]={disabled:false,textContent:"",checked:false})},
  confirm:()=>true,encode:()=>"base64",
  request:async()=>({ok:true,result:{line_items:[{reference:"A",description:"Produit",quantity:1,unit:"piece",unit_price:6,total:6,tax_rate:""}]},usage:null}),
  showUsage:()=>{},notice:()=>{},makeRow:x=>({...x,verified:false}),bindDocument:()=>{},refreshMatches:()=>{},autoVerifyGreenRows:()=>{},
  renderRows:()=>{controls.applyBulkVat.disabled=h.loading;controls.repairHeader.disabled=h.loading;controls.results.hidden=false},
  updateTotals:()=>{controls.applyBulkVat.disabled=h.loading;controls.repairHeader.disabled=h.loading}
 };
 const ctx=vm.createContext(h);
 vm.runInContext(analyzeSource+";this.runAnalyze=analyze",ctx);
 await ctx.runAnalyze();
 assert.equal(ctx.loading,false);
 assert.equal(controls.analyze.disabled,false);
 assert.equal(controls.applyBulkVat.disabled,false,"L'action TVA doit rester cliquable après lecture.");
 assert.equal(controls.repairHeader.disabled,false,"La correction de l'en-tête doit rester cliquable.");
});
test("la page intégrée charge la V41 après correction du cycle de lecture",()=>{
 const page=file("lecteur-veryfi/index.html"),sec=file("secretariat/index.html");
 assert.ok(page.includes("veryfi.js?v=41"));
 assert.ok(sec.includes("embed=secretariat&amp;v=20261109-v41"));
 assert.ok(source.includes('const READER_VERSION="V41"'));
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
