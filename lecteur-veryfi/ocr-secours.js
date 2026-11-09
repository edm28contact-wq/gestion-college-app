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
