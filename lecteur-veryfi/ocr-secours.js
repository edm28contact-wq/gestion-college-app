(()=>{
"use strict";
const $=id=>document.getElementById(id);
const PDFJS="https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/";
const TESSERACT="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let file=null,pdf=null,pdfFile=null,pdfLoading=null,pdfjsLoading=null,tesseractLoading=null,workerLoading=null,blobUrl=null,busy=false,pageHint=1,authToken="",latestExtraction=null,hashCache=null;
const status=message=>{$("freeOcrStatus").textContent=message};
async function getPdfJs(){
 if(!pdfjsLoading)pdfjsLoading=import(PDFJS+"pdf.mjs").then(lib=>{
  lib.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.mjs";return lib;
 }).catch(e=>{pdfjsLoading=null;throw e});
 return pdfjsLoading;
}
async function loadPdf(){
 if(!file)throw Error("Sélectionnez d’abord un fichier PDF.");
 if(pdf&&pdfFile===file)return pdf;
 if(pdfLoading)return pdfLoading;
 const current=file;
 pdfLoading=(async()=>{
  const lib=await getPdfJs();
  const bytes=new Uint8Array(await current.arrayBuffer());
  const opened=await lib.getDocument({data:bytes,useSystemFonts:true}).promise;
  if(file!==current){await opened.destroy();throw Error("Le document a changé ; recommencez la lecture.")}
  pdf=opened;pdfFile=current;
  return opened;
 })().finally(()=>{pdfLoading=null});
 return pdfLoading;
}
function resetFile(next){
 file=next||null;pageHint=1;latestExtraction=null;hashCache=null;$("freeOcrVerify").disabled=true;$("freeOcrReviewNote").textContent="";
 if(pdf){void pdf.destroy().catch(()=>{});pdf=null;pdfFile=null}
 if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null}
 $("freeOcr").disabled=!file;
 if($("freeOcrModal").open)$("freeOcrModal").close();
}
async function loadTesseract(){
 if(window.Tesseract?.createWorker)return window.Tesseract;
 if(!tesseractLoading)tesseractLoading=new Promise((resolve,reject)=>{
  const script=document.createElement("script");
  script.src=TESSERACT;script.async=true;
  script.onload=()=>window.Tesseract?.createWorker?resolve(window.Tesseract):reject(Error("Tesseract ne s’est pas chargé."));
  script.onerror=()=>reject(Error("Impossible de télécharger Tesseract. Vérifiez votre connexion Internet."));
  document.head.append(script);
 }).catch(e=>{tesseractLoading=null;throw e});
 return tesseractLoading;
}
// Reconciliation des TVA depuis les valeurs imprimées dans le tableau du PDF, sans OCR distant.
// Aucun taux n'est inféré depuis l'en-tête : référence, quantité, prix et total doivent tous concorder.
function nativeVatEvidenceForPage(items,candidates,pageNumber){
 const positions=(items||[]).filter(item=>typeof item.str==="string"&&item.str.trim()&&Array.isArray(item.transform)&&item.transform.length>=6)
  .map(item=>({text:item.str.trim(),x:Number(item.transform[4]),y:Number(item.transform[5])}))
  .filter(item=>Number.isFinite(item.x)&&Number.isFinite(item.y));
 const key=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 const number=value=>{
  const raw=String(value||"").replace(/[\u00a0\u202f\s€]/g,"").replace(",",".");
  return /^\d+(?:\.\d{1,4})?$/.test(raw)?Number(raw):null;
 };
 const equal=(a,b,tolerance=.015)=>a!==null&&b!==null&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
 const evidence=[];
 const taxHeaders=positions.filter(item=>/\bTVA\b/i.test(item.text)&&item.text.length<=16);
 for(const taxHead of taxHeaders){
  const labels=positions.filter(item=>Math.abs(item.y-taxHead.y)<=2.5);
  const quantity=labels.find(item=>/quantit/i.test(item.text));
  const unit=labels.find(item=>/unit/i.test(item.text));
  const price=labels.find(item=>/prix/i.test(item.text));
  const total=labels.find(item=>/montant/i.test(item.text));
  if(!quantity||!unit||!price||!total)continue;
  if(!(quantity.x<unit.x&&unit.x<taxHead.x&&taxHead.x<price.x&&price.x<total.x))continue;
  for(let index=0;index<candidates.length;index++){
   const row=candidates[index],reference=key(row.reference);
   if(reference.length<3||reference.length>35)continue;
   const codes=positions.filter(item=>key(item.text)===reference&&item.x<quantity.x-15&&item.y<taxHead.y-7);
   if(codes.length!==1)continue;
   const sameLine=positions.filter(item=>Math.abs(item.y-codes[0].y)<=2.5);
   const printedLabel=sameLine.filter(item=>item.x>codes[0].x&&item.x<quantity.x-8).sort((a,b)=>a.x-b.x).map(item=>item.text).join(" ");
   const expectedLabel=key(row.description),pdfLabel=key(printedLabel);
   const descriptionVerified=expectedLabel.length>=8&&pdfLabel.includes(expectedLabel);
   const values=(xmin,xmax)=>sameLine.filter(item=>item.x>=xmin&&item.x<xmax).map(item=>number(item.text)).filter(value=>value!==null);
   const exact=(min,max,target,tolerance)=>values(min,max).filter(value=>equal(value,number(target),tolerance)).length===1;
   if(!exact(quantity.x-8,unit.x, row.quantity,.001))continue;
   if(!exact(price.x-9,total.x-6,row.unit_price,.011))continue;
   if(!exact(total.x-6,Number.POSITIVE_INFINITY,row.total,.021))continue;
   const rates=values(taxHead.x-17,price.x-5).filter(value=>value>=0&&value<=100);
   if(rates.length!==1)continue;
   evidence.push({index,reference:row.reference,rate:rates[0],quantity:number(row.quantity),
    unit_price:number(row.unit_price),total:number(row.total),page:pageNumber,
    source:"pdf-native-text",descriptionVerified});
  }
  break; // Un tableau, identifié par ses cinq en-têtes et leur ordre spatial.
 }
 return evidence;
}
async function readNativePdfVatEvidence(sourceFile,candidates){
 if(!sourceFile||sourceFile!==file||!Array.isArray(candidates)||!candidates.length)return [];
 const doc=await loadPdf(),results=[];
 for(let pageNumber=1;pageNumber<=Math.min(doc.numPages,20);pageNumber++){
  if(sourceFile!==file)return [];
  const page=await doc.getPage(pageNumber);
  try{
   const content=await page.getTextContent();
   results.push(...nativeVatEvidenceForPage(content.items,candidates,pageNumber));
  }finally{page.cleanup()}
 }
 const count=new Map();
 for(const item of results)count.set(item.index,(count.get(item.index)||0)+1);
 return results.filter(item=>count.get(item.index)===1);
}
window.VeryfiNativePdfVat=Object.freeze({read:readNativePdfVatEvidence});

async function textFromPdf(doc,pageNumber){
 const p=await doc.getPage(pageNumber);
 try{
  const content=await p.getTextContent();
  return content.items.map(item=>typeof item.str==="string"?item.str+(item.hasEOL?"\n":" "):"").join("").trim().slice(0,50000);
 }finally{p.cleanup()}
}
async function textFromImage(doc,pageNumber,update){
 const p=await doc.getPage(pageNumber);
 const canvas=document.createElement("canvas");
 try{
  const one=p.getViewport({scale:1});
  const scale=Math.max(.8,Math.min(2.2,Math.sqrt(3000000/(one.width*one.height))));
  const viewport=p.getViewport({scale});
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const context=canvas.getContext("2d",{willReadFrequently:true});
  if(!context)throw Error("Impossible de créer l’image de la page.");
  await p.render({canvasContext:context,viewport,canvas}).promise;
  const api=await loadTesseract();
  if(!workerLoading)workerLoading=api.createWorker("fra+eng",1,{logger:m=>{
   if(m?.status==="recognizing text")update(Math.round((m.progress||0)*100));
  }}).catch(e=>{workerLoading=null;throw e});
  const worker=await workerLoading;
  const result=await worker.recognize(canvas);
  return String(result?.data?.text||"").trim().slice(0,50000);
 }finally{
  canvas.width=0;canvas.height=0;p.cleanup();
 }
}
async function read(pageNumber,forceScan=false){
 if(busy||!file)return;
 busy=true;
 const modal=$("freeOcrModal");
 if(!modal.open)modal.showModal();
 const current=file;
 $("freeOcr").disabled=true;$("freeOcrRead").disabled=true;$("freeOcrScan").disabled=true;$("freeOcrCopy").disabled=true;
 $("freeOcrText").value="";latestExtraction=null;$("freeOcrVerify").disabled=true;$("freeOcrReviewNote").textContent="";
 status("Chargement de PDF.js pour une lecture locale…");
 try{
  const doc=await loadPdf();
  if(file!==current||!modal.open)return;
  const page=Math.max(1,Math.min(doc.numPages,Math.floor(Number(pageNumber)||1)));
  $("freeOcrPage").max=String(doc.numPages);$("freeOcrPage").value=String(page);
  if(!blobUrl)blobUrl=URL.createObjectURL(file);
  $("freeOcrPdf").src=blobUrl+"#page="+page;
  let text="",method="";
  if(!forceScan){
   status("Extraction du texte numérique intégré au PDF…");
   text=await textFromPdf(doc,page);
   if(text.length>=30)method="pdf-text";
  }
  if(!method){
   status("OCR Tesseract local : chargement des modèles français et anglais…");
   text=await textFromImage(doc,page,pct=>{
    if(file===current&&modal.open)status("OCR Tesseract : "+pct+" %");
   });
   method="tesseract";
  }
  if(file!==current||!modal.open)return;
  const output=text.trim();
  $("freeOcrText").value=output;
  latestExtraction=output.length>=10?{file:current,page,method,text:output}:null;
  $("freeOcrVerify").disabled=!latestExtraction||!authToken;
  status((method==="pdf-text"?"Texte natif du PDF":"Tesseract local")+" · page "+page+" / "+doc.numPages+". Comparez et corrigez avant de valider.");
  $("freeOcrCopy").disabled=!text;
  if(latestExtraction&&authToken){
   try{
    const hash=await currentHash();
    const saved=await reviewRequest("GET",{file_hash:hash,page_number:page});
    if(file!==current||!modal.open||!latestExtraction||latestExtraction.page!==page)return;
    if(saved.verification){
     $("freeOcrText").value=saved.verification.verified_text;
     $("freeOcrReviewNote").textContent="Une vérification enregistrée existe pour cette page ("+new Date(saved.verification.verified_at).toLocaleString("fr-FR")+").";
    }
   }catch(e){$("freeOcrReviewNote").textContent="Historique OCR inaccessible : "+e.message}
  }
 }catch(e){
  if(modal.open)status("Lecteur de secours indisponible : "+(e?.message||"erreur inconnue")+". La facture reste intacte.");
 }finally{
  busy=false;$("freeOcr").disabled=!file;$("freeOcrRead").disabled=false;$("freeOcrScan").disabled=false;
 }
}
async function currentHash(){
 if(!file)throw Error("Aucun PDF sélectionné.");
 if(hashCache?.file===file)return hashCache.value;
 const current=file;
 const data=await crypto.subtle.digest("SHA-256",await current.arrayBuffer());
 if(file!==current)throw Error("Le PDF a changé.");
 const value=[...new Uint8Array(data)].map(n=>n.toString(16).padStart(2,"0")).join("");
 hashCache={file:current,value};
 return value;
}
async function reviewRequest(method,payload){
 if(!authToken)throw Error("Reconnectez-vous au Secrétariat pour enregistrer une validation.");
 const url="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-free-ocr-review";
 const data=method==="GET"?null:JSON.stringify(payload);
 const query=method==="GET"?"?file_hash="+encodeURIComponent(payload.file_hash)+"&page_number="+payload.page_number:"";
 const response=await fetch(url+query,{method,headers:{
  authorization:"Bearer "+authToken,...(data?{"content-type":"application/json"}:{})
 },body:data,cache:"no-store",signal:AbortSignal.timeout(20000)});
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(json.error||"Erreur HTTP "+response.status);
 return json;
}
async function confirmFreeReading(){
 if(busy||!latestExtraction||!file)return;
 const original=latestExtraction;
 const corrected=$("freeOcrText").value.trim();
 if(corrected.length<10||corrected.length>50000)return status("Le texte vérifié doit contenir entre 10 et 50 000 caractères.");
 if(!confirm("Confirmer que le texte de cette page correspond au PDF original ? Cela enregistre un exemple vérifié, sans modifier la facture ni le stock."))return;
 $("freeOcrVerify").disabled=true;
 status("Enregistrement sécurisé de la lecture vérifiée…");
 try{
  if(file!==original.file)throw Error("Le PDF a été remplacé.");
  const hash=await currentHash();
  const data=await reviewRequest("POST",{
   file_hash:hash,page_number:original.page,extraction_method:original.method,
   extracted_text:original.text,verified_text:corrected
  });
  if(file!==original.file||latestExtraction!==original)return;
  $("freeOcrReviewNote").textContent="Page "+original.page+" vérifiée et enregistrée le "+new Date(data.verification.verified_at).toLocaleString("fr-FR")+".";
  status(data.changed?"Correction OCR confirmée et mémorisée dans Supabase.":"Lecture OCR confirmée et mémorisée dans Supabase.");
 }catch(e){status("Validation OCR non enregistrée : "+(e?.message||"erreur inconnue"))}
 finally{$("freeOcrVerify").disabled=!latestExtraction||!file}
}
function openOn(page){
 if(!file){status("Ajoutez d’abord un PDF.");return}
 void read(page,false);
}
async function releaseWorker(){
 if(!workerLoading)return;
 const current=workerLoading;workerLoading=null;
 try{const worker=await current;await worker.terminate()}catch{}
}
function setup(){
 $("freeOcr").addEventListener("click",()=>openOn(1));
 $("freeOcrRead").addEventListener("click",()=>void read($("freeOcrPage").value,false));
 $("freeOcrVerify").addEventListener("click",()=>void confirmFreeReading());
 document.addEventListener("veryfi:session",e=>{
  authToken=String(e.detail?.token||"");
  $("freeOcrVerify").disabled=!authToken||!latestExtraction;
 });
 $("freeOcrScan").addEventListener("click",()=>void read($("freeOcrPage").value,true));
 $("freeOcrClose").addEventListener("click",()=>$("freeOcrModal").close());
 $("freeOcrModal").addEventListener("close",()=>{
  $("freeOcrPdf").removeAttribute("src");
  if(!busy)void releaseWorker();
 });
 $("freeOcrCopy").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText($("freeOcrText").value);status("Texte de secours copié ; les lignes Veryfi sont inchangées.")}
  catch{$("freeOcrText").select();status("Sélectionnez puis copiez le texte avec Ctrl+C.")}
 });
 $("pdfCompareFreeOcr").addEventListener("click",()=>{
  $("pdfCompare").close();openOn(pageHint);
 });
 document.addEventListener("veryfi:source-file",e=>resetFile(e.detail?.file));
 document.addEventListener("veryfi:compare-page",e=>{pageHint=Number(e.detail?.page)||1});
 window.addEventListener("pagehide",()=>{
  if(blobUrl)URL.revokeObjectURL(blobUrl);
  if(pdf)void pdf.destroy().catch(()=>{});
  void releaseWorker();
 });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();
