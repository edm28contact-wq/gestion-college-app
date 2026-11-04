(()=>{
"use strict";
const input=document.getElementById("invoicePdf");
const preview=document.getElementById("invoicePreview");
const empty=document.getElementById("pdfEmpty");
const open=document.getElementById("pdfOpen");
const remove=document.getElementById("pdfRemove");
const status=document.getElementById("pdfStatus");
let url=null;
function clear(){
 if(url){URL.revokeObjectURL(url);url=null}
 preview.removeAttribute("src");preview.hidden=true;
 open.removeAttribute("href");open.hidden=true;remove.hidden=true;empty.hidden=false;
}
function changed(){
 clear();
 const file=input.files?.[0];
 if(!file){status.textContent="Aucune facture importée.";document.dispatchEvent(new Event("invoice-pdf:replace"));return}
 if(!/\.pdf$/i.test(file.name)){
  input.value="";status.textContent="Fichier invalide : sélectionnez une facture PDF.";document.dispatchEvent(new Event("invoice-pdf:replace"));return;
 }
 url=URL.createObjectURL(file);
 preview.src=url;preview.hidden=false;empty.hidden=true;
 open.href=url;open.hidden=false;remove.hidden=false;
 status.textContent="Facture prête : "+file.name+" · cliquez sur Lire avec Veryfi (maximum 6 Mo).";
 document.dispatchEvent(new Event("invoice-pdf:replace"));
}
input.addEventListener("change",changed);
remove.addEventListener("click",()=>{input.value="";changed()});
window.addEventListener("pagehide",()=>{if(url)URL.revokeObjectURL(url)});
})();