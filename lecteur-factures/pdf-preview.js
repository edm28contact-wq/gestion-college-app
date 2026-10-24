(()=>{
"use strict";
// PDF preview only: no OCR, no extraction, no remote upload.
const $=id=>document.getElementById(id);
const input=$("invoicePdf"),frame=$("invoicePreview"),empty=$("pdfEmpty"),status=$("pdfStatus"),open=$("pdfOpen"),remove=$("pdfRemove");
if(!input||!frame||!empty||!status||!open||!remove)return;
const MAX_SIZE=20*1024*1024;
let currentUrl=null;
function notice(text,error=false){
 status.textContent=text;status.className="muted"+(error?" err":"");
}
function clearPreview(resetInput=true){
 const previous=currentUrl;currentUrl=null;
 frame.removeAttribute("src");frame.hidden=true;empty.hidden=false;
 open.removeAttribute("href");open.hidden=true;remove.hidden=true;
 if(resetInput)input.value="";
 if(previous)URL.revokeObjectURL(previous);
}
async function openFile(file){
 if(!file)return;
 if(file.size<=0||file.size>MAX_SIZE){notice("Le PDF doit avoir une taille comprise entre 1 octet et 20 Mo.",true);input.value="";return}
 if(!/\.pdf$/i.test(file.name)&&file.type!=="application/pdf"){notice("Choisissez une facture au format PDF.",true);input.value="";return}
 let signature;
 try{signature=new TextDecoder("ascii").decode(await file.slice(0,8).arrayBuffer())}
 catch{notice("Impossible de lire le fichier PDF.",true);input.value="";return}
 if(!signature.startsWith("%PDF-")){notice("Ce fichier ne semble pas être un PDF valide.",true);input.value="";return}
 const existing=!!$("sourceText")?.value?.trim()||!!$("cleanText")?.value?.trim();
 if(existing&&!confirm("Importer une nouvelle facture effacera la transcription et le tableur actuels. Continuer ?")){
  input.value="";return;
 }
 if(existing)document.dispatchEvent(new Event("invoice-pdf:replace"));
 const newUrl=URL.createObjectURL(file),previous=currentUrl;currentUrl=newUrl;
 frame.src=newUrl;frame.hidden=false;empty.hidden=true;
 open.href=newUrl;open.hidden=false;remove.hidden=false;
 notice("Facture affichée : "+file.name+" ("+(file.size/1024/1024).toFixed(2)+" Mo). Prévisualisation locale, sans OCR.");
 if(previous)URL.revokeObjectURL(previous);
}
input.addEventListener("change",()=>{void openFile(input.files?.[0])});
remove.addEventListener("click",()=>{clearPreview();notice("Facture retirée de l’aperçu. La transcription et le tableau restent inchangés.")});
window.addEventListener("pagehide",()=>{if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null;});
})();