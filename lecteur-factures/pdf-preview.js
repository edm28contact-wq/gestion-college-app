(()=>{
"use strict";
// Local PDF text extraction + optional local OCR only. No invoice/stock/accounting writes.
const PDF_LIB="https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs";
const PDF_WORKER="https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs";
const OCR_LIB="https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
const MAX_SIZE=20*1024*1024,MAX_PAGES=50,MAX_PIXELS=4500000;
const $=id=>document.getElementById(id);
const input=$("invoicePdf"),frame=$("invoicePreview"),empty=$("pdfEmpty"),status=$("pdfStatus"),open=$("pdfOpen"),remove=$("pdfRemove"),progress=$("pdfProgress"),transcribeButton=$("pdfTranscribe"),ocrButton=$("pdfForceOcr"),cancelButton=$("pdfCancel");
if(!input||!frame||!empty||!status||!open||!remove||!progress||!transcribeButton||!ocrButton||!cancelButton)return;
let currentUrl=null,currentFile=null,version=0,working=false,pdfLib=null,ocrLib=null;
function notice(text,error=false){status.textContent=text;status.className="muted"+(error?" err":"")}
function percent(n){progress.hidden=false;progress.value=Math.max(0,Math.min(100,Math.round(n)))}
function controls(){transcribeButton.disabled=!currentFile||working;ocrButton.disabled=!currentFile||working;cancelButton.hidden=!working;input.disabled=false}
function checkVersion(v){if(v!==version)throw new Error("Lecture annulée")}
async function getPdfJs(){
 if(!pdfLib)pdfLib=import(PDF_LIB).catch(()=>import("https://unpkg.com/pdfjs-dist@6.2.108/build/pdf.min.mjs")).then(module=>{module.GlobalWorkerOptions.workerSrc=PDF_WORKER;return module}).catch(e=>{pdfLib=null;throw new Error("PDF.js inaccessible : "+(e?.message||String(e)))});
 return pdfLib;
}
async function getTesseract(){
 if(window.Tesseract)return window.Tesseract;
 if(!ocrLib)ocrLib=new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=OCR_LIB;
  script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error("Moteur OCR indisponible"));
  script.onerror=()=>reject(new Error("Impossible de charger le moteur OCR. Vérifiez la connexion."));
  document.head.append(script);
 }).catch(e=>{ocrLib=null;throw e});
 return ocrLib;
}
function nativeLines(content){
 const items=(content.items||[]).filter(x=>typeof x.str==="string"&&x.str.trim()).map(x=>({
  str:x.str,x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),
  width:Number(x.width||0),size:Math.max(5,Math.abs(Number(x.transform?.[3]||11)))
 }));
 items.sort((a,b)=>b.y-a.y||a.x-b.x);
 const groups=[];
 for(const item of items){
  let g=groups[groups.length-1],tol=Math.max(2,Math.min(5,item.size*.32));
  if(!g||Math.abs(g.y-item.y)>tol){g={y:item.y,items:[]};groups.push(g)}
  g.items.push(item);
 }
 return groups.map(g=>{
  const chunks=g.items.sort((a,b)=>a.x-b.x);let line="",previous=null;
  for(const item of chunks){
   if(previous){
    const gap=item.x-(previous.x+previous.width);
    if(gap>Math.max(2,previous.size*.28)){
     const count=Math.min(16,Math.max(1,Math.round(gap/Math.max(3,previous.size*.5))));
     line+=" ".repeat(count);
    }
   }
   line+=item.str;previous=item;
  }
  return line.trimEnd();
 }).filter(x=>x.trim()).join("\n");
}
function usableNative(text){
 const chars=(text.match(/[a-zA-ZÀ-ÿ0-9]/g)||[]).length,bad=(text.match(/\uFFFD/g)||[]).length;
 return chars>=45&&text.split("\n").filter(x=>x.trim()).length>=2&&bad/Math.max(chars,1)<.03;
}
async function recognize(page,worker){
 const base=page.getViewport({scale:1});
 const scale=Math.min(2.5,Math.sqrt(MAX_PIXELS/Math.max(1,base.width*base.height)));
 const viewport=page.getViewport({scale});
 const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 const context=canvas.getContext("2d",{willReadFrequently:true});
 if(!context)throw new Error("Aucun moteur de rendu disponible pour l'OCR");
 try{
  await page.render({canvasContext:context,viewport,background:"rgb(255,255,255)"}).promise;
  let enhanced=null,baseResult=null,preparedResult=null;
  const enhancer=window.InvoiceImageEnhancer;
  try{
   if(enhancer?.prepare){
    try{
     enhanced=enhancer.prepare(canvas);
     preparedResult=await worker.recognize(enhanced.canvas);
    }catch(error){console.warn("Prétraitement OCR indisponible :",error);preparedResult=null;}
   }
   // Read the original as a fallback if the enhanced version is poor or unclear.
   if(!preparedResult||!String(preparedResult.data?.text||"").trim()||Number(preparedResult.data?.confidence||0)<76){
    baseResult=await worker.recognize(canvas);
   }
   const asData=r=>({text:String(r?.data?.text||"").trim(),confidence:Number(r?.data?.confidence)||0});
   const original=baseResult?asData(baseResult):null,improved=preparedResult?asData(preparedResult):null;
   const chooseOriginal=original&&(!improved||!enhancer||enhancer.score(original)>enhancer.score(improved)+2);
   const selected=chooseOriginal?original:(improved||original||{text:"",confidence:0});
   return {...selected,enhanced:!!improved&&!chooseOriginal,enhancementMode:!!improved&&!chooseOriginal?"Contraste et netteté améliorés":"Image originale"};
  }finally{if(enhanced?.canvas){enhanced.canvas.width=0;enhanced.canvas.height=0;}}
 }finally{canvas.width=0;canvas.height=0}
}
function allText(pages){return pages.map(x=>x.text).filter(Boolean).join("\n")}
async function transcribe(forceOcr=false){
 if(!currentFile||working)return;
 const thisVersion=++version,file=currentFile;let pdf=null,worker=null;
 let pages=[],warnings=0,scanned=0,enhancedPages=0;
 working=true;controls();percent(1);
 notice("Ouverture et transcription du PDF...");
 try{
  const lib=await getPdfJs();checkVersion(thisVersion);
  const bytes=new Uint8Array(await file.arrayBuffer());checkVersion(thisVersion);
  pdf=await lib.getDocument({data:bytes,isEvalSupported:false}).promise;checkVersion(thisVersion);
  if(pdf.numPages>MAX_PAGES)throw new Error("PDF trop long : maximum "+MAX_PAGES+" pages.");
  for(let n=1;n<=pdf.numPages;n++){
   checkVersion(thisVersion);percent(100*(n-1)/pdf.numPages);
   notice("Extraction du texte, page "+n+"/"+pdf.numPages+"...");
   const page=await pdf.getPage(n);checkVersion(thisVersion);
   let text="",source="PDF",warning="";
   try{
    const native=nativeLines(await page.getTextContent());checkVersion(thisVersion);
    text=native;
    if(forceOcr||!usableNative(native)){
     try{
      if(!worker){
       notice("Page scannée ou texte difficile : initialisation OCR local français / anglais...");
       const T=await getTesseract();checkVersion(thisVersion);
       worker=await T.createWorker(["fra","eng"],1,{logger:m=>{
        if(thisVersion!==version)return;
        if(m?.status==="recognizing text"&&Number.isFinite(Number(m.progress))){
         percent(100*(n-1+Math.max(0,Math.min(1,Number(m.progress))))/pdf.numPages);
        }
       }});
       try{await worker.setParameters({preserve_interword_spaces:"1"})}catch{}
      }
      notice("OCR local, page "+n+"/"+pdf.numPages+"...");
      const ocr=await recognize(page,worker);checkVersion(thisVersion);
      if(ocr.text){
       text=ocr.text;source=ocr.enhanced?"OCR amélioré":"OCR original";scanned++;if(ocr.enhanced)enhancedPages++;
       if(ocr.confidence<65){warning="OCR peu fiable : vérifiez les références et les montants.";warnings++}
      }else{warning="Aucun texte OCR reconnu.";warnings++}
     }catch(e){
      checkVersion(thisVersion);
      warning="OCR impossible : "+(e?.message||String(e));warnings++;
     }
    }
    if(!text.trim()&&!warning){warning="Aucun texte détecté sur cette page.";warnings++}
   }finally{try{page.cleanup()}catch{}}
   pages.push({number:n,text,source,warning});
   document.dispatchEvent(new CustomEvent("invoice-pdf:partial",{detail:{text:allText(pages),page:n,total:pdf.numPages,source}}));
   percent(100*n/pdf.numPages);
  }
  checkVersion(thisVersion);
  const result=allText(pages);
  document.dispatchEvent(new CustomEvent("invoice-pdf:transcribed",{detail:{text:result,pages,scanned,warnings,enhancedPages,fileName:file.name}}));
  if(result.trim()){
   notice("Transcription visible : "+pdf.numPages+" page(s) · "+scanned+" page(s) OCR · "+enhancedPages+" améliorée(s) · "+warnings+" page(s) à contrôler. Le tableau est rempli à partir du texte.");
  }else {notice("Aucun texte extrait. Utilisez Forcer OCR ou collez le texte.",true);document.dispatchEvent(new CustomEvent("invoice-pdf:error",{detail:{message:"Aucun texte reconnu dans ce PDF"}}));}
 }catch(e){
  if(thisVersion===version){
   const result=allText(pages);
   if(result)document.dispatchEvent(new CustomEvent("invoice-pdf:transcribed",{detail:{text:result,pages,scanned,warnings:1,enhancedPages,partial:true}}));
   document.dispatchEvent(new CustomEvent("invoice-pdf:error",{detail:{message:e?.message||String(e)}}));
   notice("Transcription incomplète : "+(e?.message||String(e))+(result?" Les pages déjà lues sont disponibles.":""),true);
  }
 }finally{
  try{await worker?.terminate()}catch{}
  try{await pdf?.destroy()}catch{}
  if(thisVersion===version){working=false;controls();if(!pages.length)progress.hidden=true}
 }
}
function clearPreview(resetInput=true){
 version++;
 const previous=currentUrl;currentUrl=null;currentFile=null;working=false;
 frame.removeAttribute("src");frame.hidden=true;empty.hidden=false;
 open.removeAttribute("href");open.hidden=true;remove.hidden=true;
 progress.hidden=true;if(resetInput)input.value="";
 if(previous)URL.revokeObjectURL(previous);
 controls();
}
async function openFile(file){
 if(!file)return;
 if(file.size<=0||file.size>MAX_SIZE){notice("PDF invalide : maximum 20 Mo.",true);input.value="";return}
 if(!/\.pdf$/i.test(file.name)&&file.type!=="application/pdf"){notice("Choisissez un fichier PDF.",true);input.value="";return}
 let signature;
 try{signature=new TextDecoder("ascii").decode(await file.slice(0,8).arrayBuffer())}
 catch{notice("Lecture impossible : fichier inaccessible.",true);input.value="";return}
 if(!signature.startsWith("%PDF-")){notice("Le fichier ne contient pas la signature d’un PDF.",true);input.value="";return}
 const existing=!!$("sourceText")?.value?.trim()||!!$("cleanText")?.value?.trim();
 if(existing&&!confirm("La nouvelle facture remplacera la transcription et le tableau actuels. Continuer ?")){input.value="";return}
 clearPreview(false);
 document.dispatchEvent(new Event("invoice-pdf:replace"));
 currentFile=file;currentUrl=URL.createObjectURL(file);
 frame.src=currentUrl;frame.hidden=false;empty.hidden=true;
 open.href=currentUrl;open.hidden=false;remove.hidden=false;
 controls();
 notice("Facture affichée : "+file.name+". Transcription du PDF en cours...");
 void transcribe(false);
}
input.addEventListener("change",()=>{void openFile(input.files?.[0])});
transcribeButton.addEventListener("click",()=>{
 if($("sourceText")?.value.trim()&&!confirm("Relancer la transcription et remplacer le tableau actuel ?"))return;
 void transcribe(false);
});
ocrButton.addEventListener("click",()=>{
 if($("sourceText")?.value.trim()&&!confirm("Relire le PDF avec OCR et remplacer le tableau actuel ?"))return;
 void transcribe(true);
});
cancelButton.addEventListener("click",()=>{version++;working=false;controls();notice("Transcription interrompue. Les pages déjà transcrites restent visibles.",true)});
remove.addEventListener("click",()=>{clearPreview();notice("PDF retiré. La transcription et le tableau restent disponibles.")});
// Called only after the server confirms the invoice, order, purchases and stock sync.
document.addEventListener("invoice-pdf:reset-after-success",()=>{clearPreview(true);notice("Prêt pour la facture suivante : importez un nouveau PDF.");});
window.addEventListener("pagehide",()=>{version++;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null});
controls();
})();