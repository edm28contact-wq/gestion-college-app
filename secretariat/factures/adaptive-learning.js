// Apprentissage adaptatif complémentaire du lecteur Secrétariat.
(()=>{
'use strict';
const ENDPOINT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/supplier-template-learn';
let matched=null,lastVerified=null,lastFile=null;
const layout=()=>window.getLastPdfOcrMeta?.()?.layout||null;
async function call(body){const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify(body),cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse apprentissage invalide'}));if(!r.ok)throw new Error(j.error||'Apprentissage fournisseur impossible');return j}
function linePayload(r){return [...(r?.items||[]),...(r?.unmatched||[])].map(x=>({description:x.detected_label||'',reference:x.detected_reference||'',confidence:x.reader_confidence||0}))}
function score(r){const all=[...(r?.items||[]),...(r?.unmatched||[])];if(!all.length)return 0;const conf=all.reduce((s,x)=>s+Math.max(0,Math.min(100,Number(x.reader_confidence||0)*(Number(x.reader_confidence||0)<=1?100:1))),0)/all.length,agree=100*all.filter(x=>x.double_read_agreement===true).length/all.length,mapped=100*all.filter(x=>x.product_id).length/all.length;return Math.round(conf*.5+agree*.3+mapped*.2)}
function showModel(){if(!matched?.matched)return;const box=document.getElementById('reliabilityBox');if(!box||box.querySelector('[data-adaptive-model]'))return;const d=document.createElement('div');d.dataset.adaptiveModel='1';d.className='ok';d.style.cssText='margin-top:8px;font-size:12px';d.innerHTML=`<b>Modèle fournisseur reconnu :</b> ${String(matched.supplier||'')} · correspondance ${Number(matched.score||0)} %${matched.model?.seen_count?` · modèle déjà vu ${Number(matched.model.seen_count)} fois`:''}.`;box.appendChild(d)}
const baseReader=window.reader;
if(typeof baseReader==='function')window.reader=async function(action,file,text,extra={}){
  if(action==='first'){
    lastFile=file;
    try{matched=await call({mode:'match',raw_text:text||'',file_name:file?.name||'',layout:layout()});if(matched?.matched&&Number(matched.score)>=80)extra={...extra,supplier_hint:matched.supplier,template:matched.model||{}}}catch(e){console.warn('Reconnaissance modèle fournisseur impossible',e)}
  }
  const r=await baseReader(action,file,text,extra);
  if(action==='verify'){
    lastVerified=r;
    const s=score(r);
    if(s>=85){try{await call({mode:'secretariat',supplier:r.supplier||'',file_name:file?.name||'',invoice_number:r.invoice_number||'',invoice_date:r.invoice_date||'',lines:linePayload(r),confidence:s,layout:layout()})}catch(e){console.warn('Apprentissage adaptatif impossible',e)}}
    setTimeout(showModel,0);
  }
  return r
};
const baseValidate=window.validateInvoice;
if(typeof baseValidate==='function')window.validateInvoice=async function(){
  const confirmed={supplier:document.getElementById('supplier')?.value||'',invoice_number:document.getElementById('number')?.value||'',invoice_date:document.getElementById('date')?.value||''};
  const file=lastFile||current?.file||null;
  const res=await baseValidate();
  const ok=document.getElementById('saveStatus')?.classList.contains('ok');
  if(ok&&file&&confirmed.supplier){try{const j=await call({mode:'secretariat',supplier:confirmed.supplier,file_name:file.name||'',invoice_number:confirmed.invoice_number,invoice_date:confirmed.invoice_date,lines:linePayload(lastVerified),confidence:100,layout:layout(),human_confirmed:true,confirmed_fields:confirmed});console.info('Modèle fournisseur confirmé',j?.supplier||confirmed.supplier)}catch(e){console.warn('Apprentissage de la correction humaine impossible',e)}}
  return res
};
})();
