(() => {
  "use strict";

  const PDF_LIB = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs";
  const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs";
  const OCR_LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
  const EXCEL_LIB = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_PAGES = 50;
  const MAX_PIXELS = 5_000_000;
  const $ = id => document.getElementById(id);
  const state = {file:null, url:null, pages:[], selected:0, processing:false, cancel:false, worker:null};
  let pdfLibrary = null;
  const scriptLoads = new Map();

  function notice(text, type="") {
    const node = $("status");
    node.textContent = text;
    node.className = "status " + type;
  }
  function progress(percent, text) {
    $("progress").value = Math.min(100, Math.max(0, Math.round(percent)));
    $("progress").classList.remove("hide");
    if(text) notice(text);
  }
  function loadScript(url, globalName) {
    if(window[globalName]) return Promise.resolve(window[globalName]);
    if(!scriptLoads.has(url)) {
      const promise = new Promise((resolve,reject) => {
        const script = document.createElement("script");
        script.src=url;
        script.onload=() => window[globalName] ? resolve(window[globalName]) : reject(new Error("Bibliothèque "+globalName+" indisponible."));
        script.onerror=() => reject(new Error("Téléchargement de "+globalName+" impossible. Vérifiez votre connexion."));
        document.head.appendChild(script);
      });
      scriptLoads.set(url,promise);
    }
    return scriptLoads.get(url);
  }
  async function getPdfLibrary() {
    if(!pdfLibrary) {
      pdfLibrary = import(PDF_LIB).then(module => {
        module.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        return module;
      }).catch(error => {pdfLibrary=null;throw error;});
    }
    return pdfLibrary;
  }
  function nativeLines(content) {
    const items = (content.items||[]).filter(it => typeof it.str==="string" && it.str.trim()).map(it => ({
      str:it.str, x:Number(it.transform?.[4]||0),y:Number(it.transform?.[5]||0),
      width:Number(it.width||0),size:Math.max(5,Math.abs(Number(it.transform?.[3]||11)))
    }));
    items.sort((a,b) => b.y-a.y || a.x-b.x);
    const groups=[];
    for(const item of items) {
      let group=groups[groups.length-1];
      const tolerance=Math.max(2,Math.min(5,item.size*.32));
      if(!group || Math.abs(group.y-item.y)>tolerance) {
        group={y:item.y,items:[]};
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups.map(group => {
      const chunks=group.items.sort((a,b)=>a.x-b.x);
      let line="",previous=null;
      for(const chunk of chunks) {
        if(previous) {
          const gap=chunk.x-(previous.x+previous.width);
          if(gap>Math.max(2,previous.size*.28)) {
            const spaces=Math.min(12,Math.max(1,Math.round(gap/Math.max(3,previous.size*.5))));
            line+=" ".repeat(spaces);
          }
        }
        line+=chunk.str;
        previous=chunk;
      }
      return line.trimEnd();
    }).filter(line=>line.trim().length>0).join("\n");
  }
  function nativeIsUseful(text) {
    const chars=(text.match(/[A-Za-zÀ-ÿ0-9]/g)||[]).length;
    const invalid=(text.match(/\uFFFD/g)||[]).length;
    return chars>=80 && text.split("\n").filter(x=>x.trim()).length>=3 && invalid/Math.max(1,chars)<.025;
  }
  async function recognizePage(page, number, total) {
    if(!state.worker) {
      progress((number-1)/total*100+3, "Initialisation OCR français / anglais...");
      const Tesseract=await loadScript(OCR_LIB,"Tesseract");
      state.worker=await Tesseract.createWorker(["fra","eng"],1,{
        logger:m=>{
          if(m?.status==="recognizing text" && Number.isFinite(Number(m.progress))) {
            const p=(number-1+Number(m.progress))/total*100;
            progress(p,"OCR page "+number+"/"+total+" : "+Math.round(Number(m.progress)*100)+" %");
          }
        }
      });
      try{await state.worker.setParameters({preserve_interword_spaces:"1"});}catch{}
    }
    const base=page.getViewport({scale:1});
    const factor=Math.min(2.5,Math.sqrt(MAX_PIXELS/Math.max(1,base.width*base.height)));
    const viewport=page.getViewport({scale:factor});
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.ceil(viewport.width));
    canvas.height=Math.max(1,Math.ceil(viewport.height));
    const context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)throw new Error("Canvas indisponible pour l'OCR.");
    context.fillStyle="#fff";
    context.fillRect(0,0,canvas.width,canvas.height);
    try {
      await page.render({canvasContext:context,viewport,background:"rgb(255,255,255)"}).promise;
      const result=await state.worker.recognize(canvas);
      return {text:String(result?.data?.text||"").trim(),confidence:Number(result?.data?.confidence)||0};
    } finally {
      canvas.width=0;
      canvas.height=0;
    }
  }
  function updateControls() {
    $("run").disabled=state.processing||!state.file;
    $("cancel").disabled=!state.processing;
    const hasText=state.pages.some(p=>p.text.trim());
    for(const id of ["exportTxt","exportExcel","copy"])$(id).disabled=state.processing||!hasText;
  }
  function selectPage(index) {
    if(!state.pages.length) {
      $("pagePicker").innerHTML="";
      $("pageText").value="";
      $("pageText").disabled=true;
      $("pageInfo").textContent="Aucune page analysée.";
      return;
    }
    state.selected=Math.max(0,Math.min(state.pages.length-1,index));
    const picker=$("pagePicker");
    picker.innerHTML="";
    for(const p of state.pages) {
      const option=document.createElement("option");
      option.value=String(p.number-1);
      option.textContent="Page "+p.number+" — "+p.source+(p.warning?" (à vérifier)":"");
      picker.appendChild(option);
    }
    picker.value=String(state.selected);
    const p=state.pages[state.selected];
    $("pageText").value=p.text;
    $("pageText").disabled=state.processing;
    $("pageInfo").textContent=p.source+(p.confidence!==null?" · confiance OCR estimée : "+Math.round(p.confidence)+" %":"")+(p.warning?" · "+p.warning:"");
    if(state.url) $("preview").src=state.url+"#page="+p.number+"&zoom=page-fit";
  }
  function updateSummary() {
    const count=state.pages.length,scanned=state.pages.filter(p=>p.source==="OCR").length,warnings=state.pages.filter(p=>!!p.warning).length;
    $("summary").textContent=count+" page(s) traitée(s) · "+scanned+" page(s) par OCR · "+warnings+" page(s) à vérifier.";
    selectPage(state.selected);
    updateControls();
  }
  function acceptFile(file) {
    if(state.processing)return;
    if(state.url) URL.revokeObjectURL(state.url);
    state.file=null; state.pages=[]; state.selected=0; state.url=null;
    document.dispatchEvent(new CustomEvent("invoice-reader:reset"));
    $("preview").removeAttribute("src");
    $("fileName").textContent="";
    $("summary").textContent="";
    $("progress").classList.add("hide");
    selectPage(0);
    if(!file){updateControls();return;}
    if(!/\.pdf$/i.test(file.name) && file.type!=="application/pdf") {
      notice("Format refusé : sélectionnez un PDF.", "err");updateControls();return;
    }
    if(file.size===0 || file.size>MAX_BYTES) {
      notice("Taille invalide : le PDF doit faire entre 1 octet et 20 Mo.", "err");updateControls();return;
    }
    document.dispatchEvent(new CustomEvent("invoice-reader:reset"));
    state.file=file;
    state.url=URL.createObjectURL(file);
    $("preview").src=state.url+"#page=1&zoom=page-fit";
    $("fileName").textContent=file.name+" ("+(file.size/1024/1024).toFixed(2)+" Mo)";
    notice("PDF chargé. Cliquez sur « Transcrire le PDF ». Le fichier reste dans votre navigateur.");
    updateControls();
    void run();
  }
  async function run() {
    if(state.processing||!state.file)return;
    state.processing=true;state.cancel=false;state.pages=[];state.selected=0;updateControls();
    let pdf=null,completed=false;
    try {
      const lib=await getPdfLibrary();
      progress(1,"Ouverture du PDF...");
      const loading=lib.getDocument({data:new Uint8Array(await state.file.arrayBuffer())});
      pdf=await loading.promise;
      if(pdf.numPages>MAX_PAGES)throw new Error("Ce lecteur accepte jusqu'à "+MAX_PAGES+" pages : découpez le document pour conserver une OCR fiable.");
      const mode=$("mode").value;
      for(let n=1;n<=pdf.numPages;n++) {
        if(state.cancel)throw new Error("Lecture interrompue à la demande. Les pages déjà lues restent exportables.");
        progress(((n-1)/pdf.numPages)*100,"Extraction page "+n+"/"+pdf.numPages+"...");
        let page=null,text="",source="PDF",confidence=null,warning="";
        try {
          page=await pdf.getPage(n);
          const native=nativeLines(await page.getTextContent());
          text=native;
          if(mode==="ocr" || (mode==="auto" && !nativeIsUseful(native))) {
            const recognized=await recognizePage(page,n,pdf.numPages);
            if(recognized.text.trim()) {
              text=recognized.text;
              source="OCR";
              confidence=recognized.confidence;
              if(confidence<65)warning="OCR peu sûr : vérifiez chaque valeur sur le PDF.";
            } else {
              source=native.trim()?"PDF partiel":"Aucun texte";
              warning="L'OCR n'a détecté aucun texte. Vérification manuelle nécessaire.";
            }
          } else if(!native.trim()) {
            source="Aucun texte";
            warning="PDF sans texte exploitable. Essayez le mode « Forcer OCR ».";
          }
        } catch(error) {
          source=text.trim()?"PDF partiel":"Échec";
          warning="Lecture incomplète : "+(error?.message||String(error));
        } finally {
          try{page?.cleanup();}catch{}
        }
        state.pages.push({number:n,text,source,confidence,warning});
        state.selected=n-1;
        updateSummary();
        progress(n/pdf.numPages*100,"Page "+n+"/"+pdf.numPages+" traitée.");
      }
      completed=true;
    } catch(error) {
      notice(error?.message||String(error),"err");
    } finally {
      try{await state.worker?.terminate();}catch{}
      state.worker=null;
      try{await pdf?.destroy();}catch{}
      state.processing=false;
      updateControls();updateSummary();
      if(completed){
        document.dispatchEvent(new CustomEvent("invoice-reader:ready",{detail:{fileName:state.file?.name||"",pages:state.pages.map(p=>({number:p.number,text:p.text,source:p.source,warning:p.warning}))}}));
        const warnings=state.pages.filter(p=>p.warning).length;
        notice(warnings?"Transcription terminée : "+warnings+" page(s) à vérifier avant utilisation.":"Transcription terminée. Contrôlez le texte avant de l'utiliser.",warnings?"warn":"ok");
      }
    }
  }
  function filename(extension) {
    const stem=(state.file?.name||"facture").replace(/\.pdf$/i,"").replace(/[^\wÀ-ÿ.-]+/g,"_").slice(0,75);
    return (stem||"facture")+"_transcription."+extension;
  }
  function fullText() {
    return state.pages.map(p=>"===== PAGE "+p.number+" =====\n"+p.text).join("\n\n");
  }
  function downloadBlob(content,type,name) {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const link=document.createElement("a");
    link.href=url;link.download=name;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function exportTxt() {
    if(!state.pages.some(p=>p.text.trim()))return;
    downloadBlob("\uFEFF"+fullText(),"text/plain;charset=utf-8",filename("txt"));
    notice("Transcription texte téléchargée. Vérifiez les pages OCR avant utilisation.","ok");
  }
  async function exportExcel() {
    if(!state.pages.some(p=>p.text.trim()))return;
    const button=$("exportExcel");
    button.disabled=true;
    try {
      const XLSX=await loadScript(EXCEL_LIB,"XLSX");
      const wb=XLSX.utils.book_new();
      const lines=[["Page","Ligne","Texte transcrit","Source","Contrôle"]];
      for(const page of state.pages) {
        const rowTexts=page.text.split(/\r?\n/);
        rowTexts.forEach((text,i)=>lines.push([page.number,i+1,text,page.source,page.warning||""]));
      }
      const sheet=XLSX.utils.aoa_to_sheet(lines);
      sheet["!cols"]=[{wch:8},{wch:9},{wch:90},{wch:18},{wch:65}];
      XLSX.utils.book_append_sheet(wb,sheet,"Lignes");
      const pages=[["Page","Source","Confiance OCR estimée (%)","Contrôle","Texte complet"]];
      state.pages.forEach(p=>pages.push([p.number,p.source,p.confidence??"",p.warning,p.text]));
      const pageSheet=XLSX.utils.aoa_to_sheet(pages);
      pageSheet["!cols"]=[{wch:8},{wch:18},{wch:26},{wch:65},{wch:100}];
      XLSX.utils.book_append_sheet(wb,pageSheet,"Pages");
      const info=XLSX.utils.aoa_to_sheet([["Fichier PDF",state.file?.name||""],["Pages transcrites",state.pages.length],["Méthode","Texte natif PDF / OCR local"],["Note","Transcription brute. Aucun montant ni compte n'a été inventé ou validé."]]);
      info["!cols"]=[{wch:25},{wch:110}];
      XLSX.utils.book_append_sheet(wb,info,"Informations");
      XLSX.writeFile(wb,filename("xlsx"),{compression:true});
      notice("Excel créé : onglets Lignes, Pages et Informations. Contrôlez les données OCR.","ok");
    } catch(error) {
      notice("Export Excel indisponible : "+(error?.message||String(error))+". L'export TXT reste accessible.","err");
    } finally {
      updateControls();
    }
  }
  window.InvoiceReader={file(){return state.file},focusPage(number){const index=state.pages.findIndex(p=>p.number===Number(number));if(index>=0)selectPage(index)},pages(){return state.pages.map(p=>({number:p.number,text:p.text,source:p.source,warning:p.warning}))}};
  function showOrigin() {
    const origin=new URLSearchParams(location.search).get("origine");
    $("back").href=origin==="secretariat"?"../secretariat/factures-v25/":"../comptabilite/";
    $("back").textContent=origin==="secretariat"?"Retour Secrétariat":"Retour Comptabilité";
  }
  function boot() {
    showOrigin();
    $("file").addEventListener("change",e=>acceptFile(e.target.files?.[0]));
    $("run").addEventListener("click",run);
    $("cancel").addEventListener("click",()=>{state.cancel=true;notice("Arrêt demandé : fin de la page en cours...","warn")});
    $("pagePicker").addEventListener("change",e=>selectPage(Number(e.target.value)));
    $("pageText").addEventListener("input",e=>{
      const p=state.pages[state.selected];
      if(p)p.text=e.target.value;
      document.dispatchEvent(new CustomEvent("invoice-reader:edited"));
    });
    $("exportTxt").addEventListener("click",exportTxt);
    $("exportExcel").addEventListener("click",exportExcel);
    $("copy").addEventListener("click",async()=>{
      try{await navigator.clipboard.writeText(fullText());notice("Transcription copiée.","ok");}
      catch{notice("Copie impossible : utilisez le téléchargement TXT.","err");}
    });
    const drop=$("drop");
    drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag")});
    drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
    drop.addEventListener("drop",e=>{
      e.preventDefault();drop.classList.remove("drag");
      if(e.dataTransfer?.files?.length)acceptFile(e.dataTransfer.files[0]);
    });
    window.addEventListener("beforeunload",()=>{if(state.url)URL.revokeObjectURL(state.url)});
    selectPage(0);updateControls();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
  else boot();
})();