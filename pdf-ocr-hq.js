// OCR PDF haute definition partage par Comptabilite et Secretariat.
// Le PDF original n'est jamais modifie : seules des images temporaires haute resolution sont generees en memoire.
(()=>{
'use strict';
const baseTextPdf=window.textPdf;
if(typeof baseTextPdf!=='function'||!window.pdfjsLib||!window.Tesseract)return;

const MAX_PAGES=20;
const TARGET_SCALE=4.2; // environ 300 dpi depuis un PDF 72 dpi
const MAX_PIXELS=12_000_000;
const MIN_NATIVE_CHARS=420;
const MIN_NATIVE_ITEMS=18;
const SECOND_PASS_CONFIDENCE=84;

const clean=s=>String(s||'').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const alnum=s=>(String(s||'').match(/[A-Za-zÀ-ÿ0-9]/g)||[]).length;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function notify(v,t){try{if(typeof window.prog==='function')window.prog(v,t)}catch{}}

function pageScale(page){
  const v=page.getViewport({scale:1});
  const safe=Math.sqrt(MAX_PIXELS/Math.max(1,v.width*v.height));
  return clamp(Math.min(TARGET_SCALE,safe),2.6,TARGET_SCALE);
}

async function renderPage(page,strong=false){
  const scale=pageScale(page),vp=page.getViewport({scale});
  const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.floor(vp.width));
  cv.height=Math.max(1,Math.floor(vp.height));
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
  await page.render({canvasContext:ctx,viewport:vp,background:'rgb(255,255,255)'}).promise;

  // Grayscale + contraste. La seconde passe est plus forte pour le texte tres fin/fade.
  const im=ctx.getImageData(0,0,cv.width,cv.height),d=im.data;
  const factor=strong?1.65:1.28;
  const blackPoint=strong?148:132;
  for(let i=0;i<d.length;i+=4){
    let g=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    g=(g-128)*factor+128;
    if(strong){
      if(g<blackPoint)g*=0.82;
      else if(g>225)g=255;
    }else if(g>242)g=255;
    g=clamp(Math.round(g),0,255);
    d[i]=d[i+1]=d[i+2]=g;d[i+3]=255;
  }
  ctx.putImageData(im,0,0);
  return {canvas:cv,scale};
}

async function makeWorker(){
  const w=await Tesseract.createWorker('fra',1,{logger:m=>{
    if(m?.status==='recognizing text')notify(55+Math.round((Number(m.progress)||0)*35),'OCR HD · lecture des petites lignes…');
  }});
  try{await w.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_pageseg_mode:'3'})}catch{}
  return w;
}

async function recognizeBest(worker,page,pageNo){
  notify(48,`Page ${pageNo} · zoom haute definition…`);
  const first=await renderPage(page,false);
  notify(52,`Page ${pageNo} · OCR zoom x${first.scale.toFixed(1)}…`);
  const r1=await worker.recognize(first.canvas);
  let best=r1,mode='normal';
  const conf=Number(r1?.data?.confidence||0);
  if(conf<SECOND_PASS_CONFIDENCE){
    notify(67,`Page ${pageNo} · seconde lecture contraste renforce…`);
    const second=await renderPage(page,true);
    const r2=await worker.recognize(second.canvas);
    if(Number(r2?.data?.confidence||0)>conf){best=r2;mode='contraste'}
    second.canvas.width=1;second.canvas.height=1;
  }
  first.canvas.width=1;first.canvas.height=1;
  return {text:clean(best?.data?.text||''),confidence:Number(best?.data?.confidence||0),scale:first.scale,mode};
}

async function highQualityTextPdf(file){
  if(!file)throw new Error('PDF manquant.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise;
  const count=Math.min(pdf.numPages,MAX_PAGES),pages=[];
  let totalNative=0,weak=0;

  // 1) Texte natif : prioritaire quand le PDF contient un vrai calque texte.
  for(let n=1;n<=count;n++){
    const page=await pdf.getPage(n),tc=await page.getTextContent();
    const native=clean((tc.items||[]).map(x=>String(x.str||'')).join(' '));
    const chars=alnum(native),items=(tc.items||[]).length;
    const needsOcr=chars<MIN_NATIVE_CHARS||items<MIN_NATIVE_ITEMS;
    if(needsOcr)weak++;
    totalNative+=chars;
    pages.push({page,n,native,chars,items,needsOcr});
    notify(5+Math.round(28*n/count),`Analyse PDF page ${n}/${count}…`);
  }

  // PDF scanne/mixte : OCR de toutes les pages si le calque texte global est insuffisant.
  const scanLike=totalNative<Math.max(900,count*260)||weak>=Math.ceil(count/3);
  const targets=scanLike?pages:pages.filter(x=>x.needsOcr);
  let worker=null;
  if(targets.length){
    worker=await makeWorker();
    for(let i=0;i<targets.length;i++){
      const x=targets[i];
      const o=await recognizeBest(worker,x.page,x.n);
      x.ocr=o.text;x.ocrConfidence=o.confidence;x.ocrScale=o.scale;x.ocrMode=o.mode;
      notify(48+Math.round(45*(i+1)/targets.length),`OCR HD page ${x.n}/${count} · confiance ${Math.round(o.confidence)} %`);
    }
    await worker.terminate();
  }

  const blocks=[];
  for(const x of pages){
    // Sur une page numerique, le texte PDF natif reste le plus fidele.
    // Sur une page scannee/faible, l'OCR zoome remplace le texte natif pauvre.
    const useOcr=!!x.ocr&&(x.needsOcr||x.chars<120||x.ocr.length>x.native.length*1.35);
    const text=useOcr?x.ocr:x.native;
    const source=useOcr?`OCR HD x${Number(x.ocrScale||0).toFixed(1)}${x.ocrMode==='contraste'?' contraste':''}`:'texte PDF natif';
    blocks.push(`=== PAGE ${x.n} · ${source} ===\n${text}`);
  }
  notify(96,targets.length?'Lecture haute definition terminee.':'Texte PDF natif de haute qualite detecte.');
  return blocks.join('\n\n').trim();
}

window.textPdf=highQualityTextPdf;
window.__pdfOcrHq={version:1,targetScale:TARGET_SCALE,maxPixels:MAX_PIXELS};

// Le lecteur PDF de controle humain s'ouvre egalement avec un zoom confortable.
const zoomFrames=()=>document.querySelectorAll('iframe.pdf').forEach(f=>{
  if(f.dataset.hqZoom==='1')return;
  const src=String(f.getAttribute('src')||'');if(!src)return;
  f.dataset.hqZoom='1';
  if(!src.includes('#'))f.setAttribute('src',src+'#zoom=175');
});
new MutationObserver(zoomFrames).observe(document.documentElement,{subtree:true,childList:true});
zoomFrames();
})();
