// OCR PDF adaptatif partage Comptabilite / Secretariat.
// Le PDF original reste intact : seules des images temporaires haute resolution sont traitees en memoire.
(()=>{
'use strict';
let attempts=0;
const boot=()=>{
  attempts++;
  if(typeof window.textPdf!=='function'||!window.pdfjsLib||!window.Tesseract){if(attempts<180)setTimeout(boot,100);return}
  if(window.__pdfOcrHq?.active&&Number(window.__pdfOcrHq.version)>=3)return;

  const MAX_PAGES=30;
  const FULL_SCALE=4.2;              // ~300 dpi
  const ZONE_SCALE=8.3;              // ~600 dpi sur petites zones
  const MAX_FULL_PIXELS=14_000_000;
  const MAX_ZONE_PIXELS=10_000_000;
  const MIN_NATIVE_CHARS=380;
  const MIN_NATIVE_ITEMS=16;
  const SECOND_PASS_CONFIDENCE=88;
  const ZONE_PASS_CONFIDENCE=92;
  const clean=s=>String(s||'').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  const alnum=s=>(String(s||'').match(/[A-Za-zÀ-ÿ0-9]/g)||[]).length;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function notify(v,t){try{if(typeof window.prog==='function')window.prog(v,t)}catch{}}
  function hashText(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
  function safeScale(page,target,maxPixels,ratio=1){const v=page.getViewport({scale:1}),safe=Math.sqrt(maxPixels/Math.max(1,v.width*v.height*ratio));return clamp(Math.min(target,safe),2.2,target)}
  function preprocess(ctx,w,h,mode='normal'){
    const im=ctx.getImageData(0,0,w,h),d=im.data;
    const factor=mode==='binary'?2.05:mode==='strong'?1.68:1.30;
    const threshold=mode==='binary'?182:mode==='strong'?150:132;
    for(let i=0;i<d.length;i+=4){let g=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];g=(g-128)*factor+128;if(mode==='binary')g=g<threshold?0:255;else{if(g<threshold)g*=mode==='strong'?.78:.9;if(g>235)g=255}g=clamp(Math.round(g),0,255);d[i]=d[i+1]=d[i+2]=g;d[i+3]=255}ctx.putImageData(im,0,0)
  }
  async function render(page,{scale,mode='normal',zone=null}={}){
    const vp=page.getViewport({scale});
    const sx=zone?Math.floor(vp.width*zone.x):0,sy=zone?Math.floor(vp.height*zone.y):0,sw=zone?Math.floor(vp.width*zone.w):Math.floor(vp.width),sh=zone?Math.floor(vp.height*zone.h):Math.floor(vp.height);
    const full=document.createElement('canvas');full.width=Math.max(1,Math.floor(vp.width));full.height=Math.max(1,Math.floor(vp.height));const fc=full.getContext('2d',{willReadFrequently:true});fc.fillStyle='#fff';fc.fillRect(0,0,full.width,full.height);await page.render({canvasContext:fc,viewport:vp,background:'rgb(255,255,255)'}).promise;
    let cv=full;
    if(zone){cv=document.createElement('canvas');cv.width=Math.max(1,sw);cv.height=Math.max(1,sh);cv.getContext('2d',{willReadFrequently:true}).drawImage(full,sx,sy,sw,sh,0,0,sw,sh);full.width=1;full.height=1}
    preprocess(cv.getContext('2d',{willReadFrequently:true}),cv.width,cv.height,mode);return cv
  }
  async function makeWorker(){const w=await Tesseract.createWorker('fra',1,{logger:m=>{if(m?.status==='recognizing text')notify(48+Math.round((Number(m.progress)||0)*42),'OCR adaptatif · lecture des petits caractères…')}});try{await w.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'600',tessedit_pageseg_mode:'3'})}catch{}return w}
  async function recognize(worker,canvas,psm='3'){try{await worker.setParameters({tessedit_pageseg_mode:String(psm)})}catch{}const r=await worker.recognize(canvas);const x={text:clean(r?.data?.text||''),confidence:Number(r?.data?.confidence||0)};canvas.width=1;canvas.height=1;return x}
  async function fullPass(worker,page,n){const scale=safeScale(page,FULL_SCALE,MAX_FULL_PIXELS),modes=['normal','strong'];let best={text:'',confidence:0,mode:'none',scale};for(const mode of modes){notify(38,`Page ${n} · OCR ${mode==='normal'?'300 dpi':'contraste renforcé'}…`);const r=await recognize(worker,await render(page,{scale,mode}),'3');if(r.confidence>best.confidence||r.text.length>best.text.length*1.2)best={...r,mode,scale};if(best.confidence>=SECOND_PASS_CONFIDENCE&&best.text.length>250)break}if(best.confidence<SECOND_PASS_CONFIDENCE){const r=await recognize(worker,await render(page,{scale,mode:'binary'}),'6');if(r.confidence>best.confidence||r.text.length>best.text.length*1.15)best={...r,mode:'binary',scale}}return best}
  async function zonePass(worker,page,n){const zones=[{name:'haut',x:0,y:0,w:1,h:.36,psm:'6'},{name:'milieu',x:0,y:.24,w:1,h:.55,psm:'6'},{name:'bas',x:0,y:.67,w:1,h:.33,psm:'6'}],out=[];for(const z of zones){const ratio=z.w*z.h,scale=safeScale(page,ZONE_SCALE,MAX_ZONE_PIXELS,ratio);notify(62,`Page ${n} · zoom 600 dpi zone ${z.name}…`);let best={text:'',confidence:0,mode:'normal',scale};for(const mode of ['normal','strong','binary']){const r=await recognize(worker,await render(page,{scale,mode,zone:z}),z.psm);if(r.confidence>best.confidence||r.text.length>best.text.length*1.2)best={...r,mode,scale};if(best.confidence>=ZONE_PASS_CONFIDENCE&&best.text.length>80)break}out.push({...z,...best})}return out}
  function nativeMeta(tc,pageNo,vp){const rows=[];for(const it of tc.items||[]){const s=clean(it.str);if(!s)continue;const tr=it.transform||[],x=Number(tr[4]||0),y=Number(tr[5]||0),xn=vp.width?clamp(x/vp.width,0,1):0,yn=vp.height?clamp(1-y/vp.height,0,1):0;rows.push({text:s,page:pageNo,x:xn,y:yn,zone:yn<.36?'haut':yn>.67?'bas':'milieu'})}return rows}
  function findField(rows,patterns){for(const re of patterns){for(const r of rows){if(re.test(norm(r.text)))return {page:r.page,zone:r.zone,x:Number(r.x.toFixed(3)),y:Number(r.y.toFixed(3)),confidence:100}}}return null}
  function signatures(text){return [...new Set(String(text||'').split(/\n+/).map(clean).filter(s=>s.length>=14&&s.length<=150&&!/^[\d\s.,€%\/-]+$/.test(s)).slice(0,20))]}
  function layoutFrom(pages,count){const rows=pages.flatMap(p=>p.nativeRows||[]),fields={};fields.invoice_number=findField(rows,[/facture/,/invoice/,/n facture/]);fields.invoice_date=findField(rows,[/date facture/,/date document/,/^date$/]);fields.amount_ht=findField(rows,[/total ht/,/montant ht/,/net ht/]);fields.amount_vat=findField(rows,[/total tva/,/montant tva/,/^tva$/]);fields.amount_ttc=findField(rows,[/total ttc/,/net a payer/,/montant ttc/,/a payer/]);const basis=pages.map(p=>`${p.n}:${p.nativeRows?.slice(0,24).map(r=>norm(r.text).replace(/\d+/g,'#')).join('|')}`).join('||');const quality=Math.round(pages.reduce((s,p)=>s+Math.max(Number(p.ocrConfidence||0),p.native.length>300?98:70),0)/Math.max(1,pages.length));return {version:3,fingerprint:`p${count}-${hashText(basis)}`,page_count:count,quality,fields,signatures:signatures(pages.map(p=>p.native).join('\n'))}}
  async function highQualityTextPdf(file){
    if(!file)throw new Error('PDF manquant.');const bytes=new Uint8Array(await file.arrayBuffer()),pdf=await window.pdfjsLib.getDocument({data:bytes}).promise,count=Math.min(pdf.numPages,MAX_PAGES),pages=[];let totalNative=0,weak=0;
    for(let n=1;n<=count;n++){const page=await pdf.getPage(n),tc=await page.getTextContent(),vp=page.getViewport({scale:1}),native=clean((tc.items||[]).map(x=>String(x.str||'')).join(' ')),chars=alnum(native),items=(tc.items||[]).length,needsOcr=chars<MIN_NATIVE_CHARS||items<MIN_NATIVE_ITEMS;if(needsOcr)weak++;totalNative+=chars;pages.push({page,n,native,chars,items,needsOcr,nativeRows:nativeMeta(tc,n,vp)});notify(5+Math.round(24*n/count),`Analyse structure page ${n}/${count}…`)}
    const scanLike=totalNative<Math.max(1000,count*300)||weak>=Math.ceil(count/3),targets=scanLike?pages:pages.filter(x=>x.needsOcr);
    if(targets.length){const worker=await makeWorker();for(let i=0;i<targets.length;i++){const x=targets[i],full=await fullPass(worker,x.page,x.n);x.ocr=full.text;x.ocrConfidence=full.confidence;x.ocrScale=full.scale;x.ocrMode=full.mode;if(full.confidence<93||x.needsOcr||full.text.length<600)x.zones=await zonePass(worker,x.page,x.n);notify(48+Math.round(45*(i+1)/targets.length),`OCR page ${x.n}/${count} · confiance ${Math.round(full.confidence)} %`)}await worker.terminate()}
    const blocks=[];for(const x of pages){const zoneText=(x.zones||[]).map(z=>`--- ZONE ${z.name.toUpperCase()} · OCR ${Math.round(z.confidence)} % ---\n${z.text}`).join('\n');const useOcr=!!x.ocr&&(x.needsOcr||x.chars<140||x.ocr.length>x.native.length*1.28),main=useOcr?x.ocr:x.native,source=useOcr?`OCR HD x${Number(x.ocrScale||0).toFixed(1)} ${x.ocrMode}`:'texte PDF natif';blocks.push(`=== PAGE ${x.n} · ${source} ===\n${main}${zoneText?`\n${zoneText}`:''}`)}
    const layout=layoutFrom(pages,count);window.__lastPdfOcrMeta={version:3,file_name:file.name,page_count:count,scan_like:scanLike,layout,pages:pages.map(x=>({page:x.n,native_chars:x.chars,native_items:x.items,ocr_confidence:x.ocrConfidence??null,ocr_mode:x.ocrMode??null,zones:(x.zones||[]).map(z=>({name:z.name,confidence:Math.round(z.confidence),scale:Number(z.scale.toFixed(2))}))}))};notify(97,targets.length?'Lecture adaptative haute définition terminée.':'Texte PDF natif exploitable.');return blocks.join('\n\n').trim()
  }
  window.textPdf=highQualityTextPdf;window.getLastPdfOcrMeta=()=>window.__lastPdfOcrMeta||null;window.__pdfOcrHq={active:true,version:3,fullScale:FULL_SCALE,zoneScale:ZONE_SCALE,maxPages:MAX_PAGES};
  const zoomFrames=()=>document.querySelectorAll('iframe.pdf').forEach(f=>{if(f.dataset.hqZoom==='1')return;const src=String(f.getAttribute('src')||'');if(!src)return;f.dataset.hqZoom='1';if(!src.includes('#'))f.setAttribute('src',src+'#zoom=200')});new MutationObserver(zoomFrames).observe(document.documentElement,{subtree:true,childList:true});zoomFrames();
};boot();
})();
