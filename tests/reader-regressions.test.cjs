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
const names=["pdfEvidenceFingerprint","currentPdfEvidence","lineOcrConfidence","independentPdfVerified","lineEvidenceMetrics","validLineVat","lineVatAcceptable","validStockQuantity","groupedVatAmount","proposeHeaderAmounts","missingVatRows","applyVerifiedVat","applyNativePdfVatEvidence","applyVatFromPdf","suggestInvoiceVatRate","previewVatApproval","duplicateFingerprint","possibleDuplicate","automaticExclusionReason","synchronizeExcludedRows","setRowExclusion","productColor","invoiceArithmetic","eligible","isRetainedGreen","autoVerifyGreenRows","issueCategories","issueRank","groupedRows","calc"];
function row(extra={}){const value={id:0,reference:"R100",description:"Fromage",quantity:2,unit:"piece",unit_price:3,total:6,tax_rate:20,
 product_id:"p-1",stock_quantity:2,stock_needs_review:false,stock_confirmed:true,score:.99,confidenceMissing:[],
 verified:false,manualVerified:false,autoVerified:false,changed:false,manualMatchRequired:false,unit_inferred:false,
 autoQuantityReconciled:false,unit_label_conflict:false,excluded:false,...extra};
 if(value.pdfEvidence&&!value.pdfEvidence.source){
  const normLocal=x=>String(x??"").normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g,"");
  const fp=[normLocal(value.reference),normLocal(value.description),value.quantity,value.unit_price,value.total,value.tax_rate].join("|");
  value.pdfEvidence={...value.pdfEvidence,source:"pdf-native-text",fingerprint:fp};
 }
 return value;}
function harness(){
 const values={subtotal:"6",tax:"1.2",total:"7.2",vendor:"Fournisseur",invoiceNumber:"123",invoiceDate:"2026-11-09",bulkVatRate:"20"};
 const ctx={rows:[],removedRows:[],issueFilter:"all",saved:false,loading:false,documentData:{id:1},file:{name:"test.pdf"},accounting:false,catalog:{products:[{id:"p-1",active:true}]},
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
 vm.runInContext(helpers+"\n"+names.map(functionSource).join("\n")+"\nthis.reader={lineVatAcceptable,validStockQuantity,pdfEvidenceFingerprint,currentPdfEvidence,lineOcrConfidence,lineEvidenceMetrics,productColor,autoVerifyGreenRows,isRetainedGreen,issueCategories,groupedRows,calc,automaticExclusionReason,synchronizeExcludedRows,setRowExclusion,groupedVatAmount,proposeHeaderAmounts,applyVerifiedVat,applyNativePdfVatEvidence,applyVatFromPdf,suggestInvoiceVatRate,previewVatApproval};",ctx);
 return {ctx,api:ctx.reader,values};
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
test("TVA non récupérable : absence autorisée, taux explicitement invalide bloqué",()=>{
 for(const tax_rate of ["",null]){
  const h=harness();h.ctx.rows=[row({tax_rate})];h.api.autoVerifyGreenRows();
  assert.equal(h.api.productColor(h.ctx.rows[0]),"good");
  assert.equal(h.api.calc().ok,true);
  assert.equal(h.api.calc().sum,6);
 }
 for(const tax_rate of [-1,101]){
  const h=harness();h.ctx.rows=[row({tax_rate})];h.api.autoVerifyGreenRows();
  assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");assert.equal(h.api.calc().ok,false);
 }
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
 assert.ok(source.includes("banner.hidden=true"));
 assert.ok(source.includes("TVA non appliquée : confirmation annulée"));
 assert.ok(source.includes("PRÉREMPLI mais PAS APPLIQUÉ"));
 assert.ok(page.includes("veryfi.js?v=48"));
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
 assert.equal(h.api.productColor(h.ctx.rows[0]),"good");
 assert.ok(notifications.some(x=>x.message.includes("TVA non appliquée")));
});
test("Secrétariat : la version du lecteur et de son iframe est explicitement incrémentée",()=>{
 const page=file("lecteur-veryfi/index.html");
 const sec=file("secretariat/index.html");
 assert.ok(page.includes('id="readerVersion"'));
 assert.ok(source.includes('const READER_VERSION="V48"'));
 assert.ok(source.includes('stamp.textContent=READER_VERSION'));
 assert.ok(page.includes("veryfi.js?v=48"));
 assert.ok(sec.includes("embed=secretariat&amp;v=20261111-v48"));
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
 h.$=id=>h.document.getElementById(id);
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
 assert.ok(page.includes("veryfi.js?v=48"));
 assert.ok(sec.includes("embed=secretariat&amp;v=20261111-v48"));
 assert.ok(source.includes('const READER_VERSION="V48"'));
});
test("TVA du PDF natif : rapprochement exact sur 25 lignes et 4 colonnes",()=>{
 const ocr=file("lecteur-veryfi/ocr-secours.js");
 const name="function nativeVatEvidenceForPage(";
 const start=ocr.indexOf(name);assert.ok(start>=0);
 const open=ocr.indexOf("{",start);let depth=0,end=-1;
 for(let i=open;i<ocr.length;i++){if(ocr[i]==="{")depth++;else if(ocr[i]==="}"&&--depth===0){end=i+1;break}}
 assert.ok(end>open);
 const parse=new Function("items","candidates","page",ocr.slice(start,end)+";return nativeVatEvidenceForPage(items,candidates,page)");
 const codes="MG84 VW87 RV20 RV40 RC54 BR49 RM25 VN19 VW24 VE30 VG41 HL91 CV61R VA58 VW33 XV90 XV87 VA70 VA63 XP81 HE40 HE42 CA24 GL05 CA21".split(" ");
 const quantities=[6,1,1,3,6,6,3,1,4,72,120,60,1,60,3,2,1,48,48,42,6,12,6,6,6];
 const prices=[8.9,36.4,11.4,49,11.6,6.6,7.4,27.5,2.55,.7,.25,1.4,4.2,1.05,5,18,9.8,3.78,3.78,2.1,4.28,3.8,3.5,2.7,4.28];
 const totals=[53.4,36.4,11.4,147,69.6,39.6,22.2,27.5,10.2,50.4,30,84,4.2,63,15,36,9.8,181.44,181.44,88.2,25.68,45.6,21,16.2,25.68];
 const text=(str,x,y)=>({str:String(str),transform:[1,0,0,1,x,y]});
 const items=[text("Quantité",352,500),text("Unité",399,500),text("% TVA",451,500),text("Prix",478,500),text("Montant HT",524,500)];
 for(let i=0;i<codes.length;i++){
  const y=480-i*10;
  items.push(text(codes[i],19,y),text(quantities[i],385,y),text("Pièce",400,y),text("20",460,y),
   text(String(prices[i]).replace(".",","),500,y),text(String(totals[i]).replace(".",","),548,y));
 }
 const candidates=codes.map((reference,i)=>({reference,quantity:quantities[i],unit_price:prices[i],total:totals[i]}));
 const evidence=parse(items,candidates,1);
 assert.equal(evidence.length,25);
 assert.ok(evidence.every((item,i)=>item.index===i&&item.rate===20));
 const h=harness();
 h.ctx.rows=candidates.map((item,i)=>row({id:i,...item,description:"Article "+i,tax_rate:i===0?20:"",product_id:[0,12,20,21,22,23,24].includes(i)?"":"p-1",score:[13,17].includes(i)?.85:.95}));
 assert.equal(h.api.applyNativePdfVatEvidence(evidence),24);
 h.api.autoVerifyGreenRows();
 const counts=Array.from(h.ctx.rows,r=>h.api.productColor(r));
 assert.equal(counts.length,25);
 const status=Array.from(h.ctx.rows,r=>h.api.productColor(r));
 assert.equal(status.filter(x=>x==="good").length,16);
 assert.equal(status.filter(x=>x==="warn").length,2);
 assert.equal(status.filter(x=>x==="bad").length,7);
 assert.ok(h.ctx.rows.slice(1).every(r=>r.tax_rate===20));
 const mismatch=candidates.map((r,i)=>i===0?{...r,quantity:7}:r);
 assert.equal(parse(items,mismatch,1).length,24);
 const wrongPrice=candidates.map((r,i)=>i===1?{...r,unit_price:99}:r);
 assert.equal(parse(items,wrongPrice,1).length,24);
 const wrongTotal=candidates.map((r,i)=>i===2?{...r,total:99}:r);
 assert.equal(parse(items,wrongTotal,1).length,24);
 assert.equal(parse(items.filter(item=>item.str!=="% TVA"),candidates,1).length,0);
});
test("TVA du PDF natif : ne remplace jamais une correction manuelle ni un taux existant",()=>{
 const h=harness();
 h.ctx.rows=[row({reference:"A",tax_rate:"",changed:true}),row({reference:"B",tax_rate:5}),row({reference:"C",tax_rate:""})];
 const evidence=[
  {index:0,reference:"A",rate:20,quantity:2,unit_price:3,total:6},
  {index:1,reference:"B",rate:20,quantity:2,unit_price:3,total:6},
  {index:2,reference:"C",rate:20,quantity:2,unit_price:3,total:6},
  {index:2,reference:"C",rate:5,quantity:42,unit_price:3,total:6}
 ];
 assert.equal(h.api.applyNativePdfVatEvidence(evidence),1);
 assert.equal(h.ctx.rows[0].tax_rate,"");
 assert.equal(h.ctx.rows[1].tax_rate,5);
 assert.equal(h.ctx.rows[2].tax_rate,20);
});
test("la vérification TVA native ne valide pas une ligne à faible confiance",()=>{
 const h=harness();h.ctx.rows=[row({reference:"A",tax_rate:"",score:.85})];
 assert.equal(h.api.applyNativePdfVatEvidence([{index:0,reference:"A",rate:20,quantity:2,unit_price:3,total:6}]),1);
 h.api.autoVerifyGreenRows();
 assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");
 assert.equal(h.ctx.rows[0].verified,false);
});
test("Henri Julien : 7 rouges écartées automatiquement, VA58 orange conservée et 17 vertes",()=>{
 const h=harness();
 const codes="MG84 VW87 RV20 RV40 RC54 BR49 RM25 VN19 VW24 VE30 VG41 HL91 CV61R VA58 VW33 XV90 XV87 VA70 VA63 XP81 HE40 HE42 CA24 GL05 CA21".split(" ");
 const amounts=[53.4,36.4,11.4,147,69.6,39.6,22.2,27.5,10.2,50.4,30,84,4.2,63,15,36,9.8,181.44,181.44,88.2,25.68,45.6,21,16.2,25.68];
 const missing=new Set(["MG84","CV61R","HE40","CA24"]),inactive=new Set(["HE42","GL05","CA21"]);
 h.ctx.rows=codes.map((code,i)=>row({
  id:i,reference:code,description:"Produit "+i,quantity:1,unit_price:amounts[i],total:amounts[i],
  product_id:(missing.has(code)||inactive.has(code))?"":"p-1",
  reason:missing.has(code)?"Produit ABSENT du catalogue actif — à ajouter ou rapprocher":
   inactive.has(code)?"Produit DÉSACTIVÉ : "+code+" — produit inactif":"Référence exacte du catalogue",
  score:code==="VA58"?.85:.97
 }));
 h.api.synchronizeExcludedRows();h.api.autoVerifyGreenRows();
 assert.equal(h.ctx.rows.filter(x=>x.autoExcluded&&x.excluded).length,7);
 assert.equal(h.ctx.rows.filter(x=>x.excluded&&x.autoExclusionReason==="Produit absent du catalogue actif").length,4);
 assert.equal(h.ctx.rows.filter(x=>x.excluded&&x.autoExclusionReason==="Produit désactivé dans le catalogue").length,3);
 assert.equal(h.ctx.rows.filter(x=>!x.excluded&&h.api.productColor(x)==="good").length,17);
 assert.equal(h.ctx.rows.filter(x=>!x.excluded&&h.api.productColor(x)==="warn").length,1);
 assert.equal(h.ctx.rows.find(x=>x.reference==="VA58").excluded,false);
 const result=h.api.calc();
 assert.equal(result.included.length,17);
 assert.equal(result.pending.length,1);
 assert.equal(result.excludedCount,7);
 assert.equal(result.autoExcludedCount,7);
 assert.equal(result.autoExcludedHt,191.76);
 assert.equal(result.sum,1040.18);
 assert.equal(result.reconciledSum,1294.94);
 assert.equal(h.api.groupedRows().find(x=>x.status==="excluded").items.length,7);
 h.api.synchronizeExcludedRows();
 assert.equal(h.ctx.rows.filter(x=>x.autoExcluded&&x.excluded).length,7,"Pas de nouveaux effets de bord au deuxième passage.");
});
test("une ligne automatiquement écartée redevient contrôlable lorsqu'un produit actif est retrouvé",()=>{
 const h=harness(),item=row({product_id:"",reference:"HE42",reason:"Produit DÉSACTIVÉ : HE42 — Assiette dessert"});
 h.ctx.rows=[item];h.api.synchronizeExcludedRows();
 assert.equal(item.excluded,true);assert.equal(item.autoExcluded,true);
 item.product_id="p-1";item.reason="Référence exacte du catalogue";
 h.api.synchronizeExcludedRows();
 assert.equal(item.excluded,false);assert.equal(item.autoExcluded,false);
 assert.equal(item.autoExclusionReason,"");
});
test("réintégration manuelle : pas de ré-exclusion automatique tant que la fiche est absente",()=>{
 const h=harness(),item=row({product_id:"",reference:"MG84",reason:"Produit ABSENT du catalogue actif — à ajouter ou rapprocher"});
 h.ctx.rows=[item];h.api.synchronizeExcludedRows();
 h.api.setRowExclusion(item,false);h.api.synchronizeExcludedRows();
 assert.equal(item.excluded,false);assert.equal(item.autoExcluded,false);
 assert.equal(item.exclusionOverride,true);
 assert.equal(h.api.productColor(item),"bad");
 assert.equal(h.api.calc().pending.length,1,"La ligne réintégrée reste bloquée jusqu'à rapprochement.");
 h.api.setRowExclusion(item,true);h.api.synchronizeExcludedRows();
 assert.equal(item.excluded,true);assert.equal(item.autoExcluded,false,"Exclusion manuelle conservée.");
});
test("pas d'exclusion sans catalogue, en comptabilité, ni pour une correspondance ambiguë",()=>{
 const h=harness();
 const missing=row({reference:"MG84",product_id:"",reason:"Produit ABSENT du catalogue actif — à ajouter ou rapprocher"});
 const ambiguous=row({reference:"X",product_id:"",reason:"Référence catalogue ambiguë",manualMatchRequired:true});
 h.ctx.rows=[missing,ambiguous];h.ctx.catalog=null;h.api.synchronizeExcludedRows();
 assert.equal(missing.excluded,false);assert.equal(ambiguous.excluded,false);
 h.ctx.catalog={products:[{id:"p-1",active:true}]};h.ctx.accounting=true;h.api.synchronizeExcludedRows();
 assert.equal(missing.excluded,false);assert.equal(ambiguous.excluded,false);
 h.ctx.accounting=false;h.api.synchronizeExcludedRows();
 assert.equal(missing.excluded,true);assert.equal(ambiguous.excluded,false);
});
test("ligne automatiquement exclue : TVA PDF conservée, sans réception en stock",()=>{
 const h=harness(),item=row({reference:"MG84",product_id:"",reason:"Produit ABSENT du catalogue actif — à ajouter ou rapprocher",tax_rate:""});
 h.ctx.rows=[item];h.api.synchronizeExcludedRows();
 assert.equal(h.api.applyNativePdfVatEvidence([{index:0,reference:"MG84",rate:20,quantity:2,unit_price:3,total:6}]),1);
 assert.equal(item.tax_rate,20);
 assert.equal(item.excluded,true);
 assert.equal(h.api.isRetainedGreen(item),false);
 assert.equal(h.api.calc().included.length,0);
});
test("exclusions automatiques : confirmation explicite et trace des références conservées",()=>{
 assert.ok(source.includes("auto_excluded_details:rows.filter("));
 assert.ok(source.includes("autoExcludedHt"));
 assert.ok(source.includes("ne pourront pas être réceptionnés plus tard à partir du même PDF"));
 assert.ok(source.includes('color==="warn"||color==="bad"||color==="excluded"'));
 assert.ok(source.includes("setRowExclusion(row,e.target.checked)"));
 assert.ok(source.includes('if(accounting||!catalog||!Array.isArray(catalog.products)'));
 assert.ok(source.includes('const READER_VERSION="V48"'));
 const page=file("lecteur-veryfi/index.html"),secretariat=file("secretariat/index.html");
 assert.ok(page.includes("veryfi.js?v=48"));
 assert.ok(secretariat.includes("embed=secretariat&amp;v=20261111-v48"));
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

test("VA58 : OCR 85 % et preuve PDF native complète permettent le vert sans altérer le score",()=>{
 const h=harness(),item=row({reference:"VA58",description:"SOUCOUPE 112 RESTAURANT BLANC",quantity:60,unit_price:1.05,total:63,stock_quantity:60,score:.85,pdfEvidence:{reference:true,description:true,quantity:true,unit_price:true,total:true,vat:true}});
 h.ctx.rows=[item];h.api.autoVerifyGreenRows();
 assert.equal(h.api.productColor(item),"good");
 assert.equal(item.score,.85);
 assert.equal(item.autoVerified,true);
 assert.equal(h.api.lineEvidenceMetrics(item).nativePdf,true);
 assert.equal(h.api.calc().sum,63);
});
test("VA58 reste orange en cas de preuve PDF partielle ou anomalie metier",()=>{
 for(const extra of [{pdfEvidence:{reference:true,description:false,quantity:true,unit_price:true,total:true,vat:true}},{total:64},{manualMatchRequired:true},{unit_label_conflict:true},{stock_needs_review:true,stock_confirmed:false}]){
  const h=harness(),item=row({reference:"VA58",score:.85,quantity:60,unit_price:1.05,total:63,stock_quantity:60,pdfEvidence:{reference:true,description:true,quantity:true,unit_price:true,total:true,vat:true},...extra});
  h.ctx.rows=[item];h.api.autoVerifyGreenRows();
  assert.equal(h.api.productColor(item),"warn",JSON.stringify(extra));
  assert.equal(item.autoVerified,false);
  assert.equal(h.api.calc().sum,0);
 }
});
test("une preuve PDF partielle n'efface pas le motif OCR",()=>{
 const h=harness(),item=row({score:.85,pdfEvidence:{reference:true,description:false,quantity:true,unit_price:true,total:true,vat:true}});
 h.ctx.rows=[item];assert.ok(h.api.issueCategories(item).includes("ocr"));
});

test("V45 conserve les scores OCR et désigne le champ le plus faible",()=>{
 const h=harness();
 const x=h.api.lineOcrConfidence({boxes:{
  description:{score:.97,ocr_score:.96},quantity:{score:.93},unit_price:{score:.85},total:{score:.99}
 }});
 assert.equal(x.score,.85);
 assert.equal(x.missing.length,0);
 assert.equal(x.fields.length,4);
 const item=row({ocrFieldScores:x.fields,score:x.score});
 h.ctx.rows=[item];
 assert.deepEqual(Array.from(h.api.lineEvidenceMetrics(item).weakest),["Prix unitaire HT"]);
 assert.equal(h.api.lineEvidenceMetrics(item).pdfCount,0);
});
test("V45 signale séparément les scores OCR absents et preuves PDF partielles",()=>{
 const h=harness();
 const x=h.api.lineOcrConfidence({boxes:{quantity:{ocr_score:.85},description:{score:.95}}});
 assert.equal(x.score,.85);
 assert.deepEqual(Array.from(x.missing),["unit_price","total"]);
 const item=row({score:x.score,ocrFieldScores:x.fields,pdfEvidence:{reference:true,description:false,quantity:true,unit_price:true,total:true,vat:true}});
 h.ctx.rows=[item];
 const m=h.api.lineEvidenceMetrics(item);
 assert.equal(m.pdfCount,5);
 assert.equal(m.nativePdf,false);
 assert.equal(h.api.productColor(item),"warn");
 assert.equal(h.api.calc().sum,0);
});
test("V45 les corrections de champ invalident les anciennes preuves indépendantes",()=>{
 assert.ok(source.includes("row[key]=value;row.pdfEvidence=null;"));
 assert.ok(source.includes("row.changed=true;row.pdfEvidence=null;"));
 assert.ok(source.includes("Détail : OCR, métier et preuves du PDF"));
});

test("V46 : des preuves natives authentiques permettent de sortir VA58 de l'orange",()=>{
 const h=harness(),item=row({reference:"VA58",description:"SOUCOUPE 112 RESTAURANT BLANC",quantity:60,unit_price:1.05,total:63,stock_quantity:60,score:.85});
 h.ctx.rows=[item];
 const evidence=[{source:"pdf-native-text",index:0,reference:"VA58",quantity:60,unit_price:1.05,total:63,rate:20,descriptionVerified:true,page:1}];
 assert.equal(h.api.applyNativePdfVatEvidence(evidence),0,"La TVA existante ne doit pas être réécrite.");
 assert.equal(h.api.currentPdfEvidence(item),true);
 h.api.autoVerifyGreenRows();
 assert.equal(h.api.productColor(item),"good");
 assert.equal(h.api.calc().sum,63);
 assert.equal(item.score,.85);
});
test("V46 : preuve ancienne ou incomplète ne valide pas la réception",()=>{
 for(const key of ["reference","description","quantity","unit_price","total","tax_rate"]){
  const h=harness(),item=row({reference:"VA58",description:"SOUCOUPE 112 RESTAURANT BLANC",quantity:60,unit_price:1.05,total:63,stock_quantity:60,score:.85});
  h.ctx.rows=[item];
  h.api.applyNativePdfVatEvidence([{source:"pdf-native-text",index:0,reference:"VA58",quantity:60,unit_price:1.05,total:63,rate:20,descriptionVerified:true,page:1}]);
  if(key==="tax_rate")item[key]=5;
  else if(key==="reference")item[key]="VA59";
  else if(key==="description")item[key]="SOUCOUPE MODIFIEE";
  else if(key==="quantity")item[key]=61;
  else if(key==="unit_price")item[key]=1.06;
  else item[key]=64;
  h.api.autoVerifyGreenRows();
  assert.equal(h.api.currentPdfEvidence(item),false,key);
  assert.equal(h.api.productColor(item),"warn",key);
  assert.equal(h.api.calc().sum,0,key);
 }
});
test("V46 : aucun recoupement si l'origine ou les valeurs ne correspondent pas",()=>{
 const h=harness(),item=row({reference:"VA58",description:"SOUCOUPE 112 RESTAURANT BLANC",quantity:60,unit_price:1.05,total:63,stock_quantity:60,score:.85});
 h.ctx.rows=[item];
 h.api.applyNativePdfVatEvidence([{source:"autre",index:0,reference:"VA58",quantity:60,unit_price:1.05,total:63,rate:20,descriptionVerified:true,page:1}]);
 assert.equal(h.api.productColor(item),"warn");
 h.api.applyNativePdfVatEvidence([{source:"pdf-native-text",index:0,reference:"VA58",quantity:60,unit_price:1.05,total:64,rate:20,descriptionVerified:true,page:1}]);
 assert.equal(h.api.productColor(item),"warn");
});
test("V46 : la lecture PDF reçoit la désignation originale et une seule soumission est permise",()=>{
 assert.ok(source.includes("description:r.description,quantity:r.quantity,unit_price:r.unit_price,total:r.total"));
 assert.ok(source.includes("if(loading||saved)return;"));
 assert.ok(source.includes("const currentFile=file;loading=true;"));
});
test("Secrétariat : les suggestions fournisseurs ne contiennent plus d'exécution JavaScript",()=>{
 const secretary=file("secretariat/index.html");
 assert.ok(secretary.includes('data-supplier-index'));
 assert.ok(secretary.includes("addEventListener('click',event=>"));
 assert.ok(!secretary.includes("onclick=\"chooseSupplier("));
});

test("Pomona : TVA absente ne bloque plus trois lignes réellement cohérentes",()=>{
 const h=harness();
 const entries=[
  {reference:"44556",quantity:48,unit:"POT",unit_price:0.29,total:13.92,stock_quantity:48,score:.91},
  {reference:"244299",quantity:10,unit:"PU",unit_price:2.244,total:22.44,stock_quantity:10,score:.93},
  {reference:"6662",quantity:60,unit:"PU",unit_price:.33,total:19.8,stock_quantity:60,score:.90},
  {reference:"12693",quantity:1,unit:"KG",unit_price:5.85,total:9.95,stock_quantity:1,score:.84},
  {reference:"97606",quantity:1,unit:"KG",unit_price:10.479,total:7.86,stock_quantity:1,score:.88},
  {reference:"31189",quantity:2.5696,unit:"KG",unit_price:8.546,total:21.96,stock_quantity:2.5696,score:.98}
 ];
 h.ctx.rows=entries.map((x,i)=>row({id:i,description:"Produit "+i,tax_rate:"",...x}));
 h.api.autoVerifyGreenRows();
 assert.deepEqual(Array.from(h.ctx.rows,r=>h.api.productColor(r)),["good","good","good","warn","warn","warn"]);
 assert.equal(h.api.calc().sum,56.16);
 assert.equal(h.api.calc().pending.length,3);
 assert.equal(h.api.calc().ok,false,"Ne pas enregistrer les lignes restantes sans correction.");
});
test("Pomona : la précision des quantités de stock doit rester compatible avec le serveur",()=>{
 const h=harness();
 for(const stock_quantity of [2.5696,15.9982,48.0203]){
  h.ctx.rows=[row({tax_rate:"",score:.99,stock_quantity})];
  assert.equal(h.api.validStockQuantity(h.ctx.rows[0]),false);
  assert.equal(h.api.productColor(h.ctx.rows[0]),"warn");
 }
 for(const stock_quantity of [2.570,16,48]){
  h.ctx.rows=[row({tax_rate:"",score:.99,stock_quantity})];
  assert.equal(h.api.validStockQuantity(h.ctx.rows[0]),true);
 }
});
test("Pomona : le bouton ne doit plus réécrire le montant HT réel",()=>{
 assert.ok(!source.includes('label:"Corriger le total HT"'));
 assert.ok(!source.includes('row.total=calculation.calculated'));
 assert.ok(source.includes("quantité FACTURÉE"));
});
test("TVA : ne jamais transformer un taux vide en taux zéro ni supprimer le TTC de facture",()=>{
 assert.ok(source.includes("function lineVatAcceptable(row)"));
 assert.ok(source.includes("vat_rate:amount(r.tax_rate)"));
 assert.ok(source.includes('original_invoice:{ht:c.ht,vat:c.vat,ttc:c.ttc}'));
 assert.ok(source.includes('coût payé, TVA non récupérable'));
});
