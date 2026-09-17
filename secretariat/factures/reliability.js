// Couche de fiabilite facture : aucun doute n'est valide silencieusement.
(()=>{
'use strict';
// Charge le moteur OCR haute definition partage. Il attend automatiquement PDF.js/Tesseract.
if(!document.querySelector('script[data-pdf-ocr-hq]')){const s=document.createElement('script');s.src='../../pdf-ocr-hq.js?v=2';s.dataset.pdfOcrHq='1';document.head.appendChild(s)}
const state={verified:false,strict:false,manualChanged:false,warnings:[],unmatched:[],items:[]};
const byId=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensureBox(){
  if(byId('reliabilityBox'))return byId('reliabilityBox');
  const warnings=byId('warnings');if(!warnings)return null;
  const box=document.createElement('div');box.id='reliabilityBox';box.style.cssText='margin-top:12px;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';
  warnings.insertAdjacentElement('afterend',box);return box;
}
function headerOk(){return !!String(byId('supplier')?.value||'').trim()&&!!String(byId('number')?.value||'').trim()&&/^\d{4}-\d{2}-\d{2}$/.test(String(byId('date')?.value||''));}
function lineRows(){return [...document.querySelectorAll('#lines .line')];}
function linesComplete(){const rows=lineRows();return rows.length>0&&rows.every(r=>String(r.querySelector('.lp')?.value||'').trim()&&Number(r.querySelector('.lq')?.value)>0);}
function autoStrict(){return state.verified&&!state.manualChanged&&state.warnings.length===0&&state.unmatched.length===0&&state.items.length>0&&state.items.every(x=>x.double_read_agreement===true&&Number(x.reader_confidence||0)>=.90&&x.product_id&&Number(x.quantity)>0)&&headerOk()&&linesComplete();}
function render(){
  state.strict=autoStrict();const box=ensureBox();if(!box)return;
  const issues=[];
  if(state.warnings.length)issues.push(...state.warnings);
  if(state.unmatched.length)issues.push(...state.unmatched.map(x=>`Ligne non associée au stock : ${x.detected_label||x.detected_reference||'ligne inconnue'}`));
  if(state.manualChanged)issues.push('Des données ont été modifiées manuellement après la double lecture.');
  if(!headerOk())issues.push('Fournisseur, numéro ou date de facture à compléter/contrôler.');
  if(!linesComplete())issues.push('Toutes les lignes doivent avoir un produit et une quantité positive.');
  const unique=[...new Set(issues.filter(Boolean))];
  if(state.strict){box.innerHTML='<div class="ok"><b>Contrôles automatiques concordants.</b> Les deux lectures confirment les lignes, quantités et rattachements produits. Une confirmation humaine reste demandée avant mise à jour du stock.</div>';return}
  box.innerHTML=`<div class="err"><b>Contrôle humain obligatoire.</b> La validation automatique est bloquée tant qu'un doute existe.</div>${unique.length?`<ul style="margin:8px 0 10px 20px">${unique.map(x=>`<li>${safe(x)}</li>`).join('')}</ul>`:''}<label style="display:flex;gap:8px;align-items:flex-start;font-weight:700"><input id="manualPdfCheck" type="checkbox" style="width:auto;margin-top:3px"> J'ai comparé le PDF original avec le fournisseur, le numéro, la date, chaque produit et chaque quantité, et je confirme les corrections manuelles.</label>`;
}
const originalReader=window.reader;
if(typeof originalReader==='function'){
  window.reader=async function(action,file,text,extra={}){const r=await originalReader(action,file,text,extra);if(action==='verify'){
    state.verified=true;state.manualChanged=false;state.warnings=Array.isArray(r.warnings)?r.warnings:[];state.unmatched=Array.isArray(r.unmatched)?r.unmatched:[];state.items=Array.isArray(r.items)?r.items:[];
    queueMicrotask(render);
  }return r};
}
const originalValidate=window.validateInvoice;
if(typeof originalValidate==='function'){
  window.validateInvoice=async function(){
    const msg=byId('saveStatus');
    if(!headerOk()){if(msg){msg.className='status err';msg.textContent='Contrôle requis : fournisseur, numéro et date de facture doivent être renseignés.'}render();return}
    if(!linesComplete()){if(msg){msg.className='status err';msg.textContent='Contrôle requis : chaque ligne doit avoir un produit et une quantité positive.'}render();return}
    state.strict=autoStrict();
    if(!state.strict&&!byId('manualPdfCheck')?.checked){if(msg){msg.className='status err';msg.textContent='Cette facture contient un doute de lecture. Comparez-la au PDF puis cochez la confirmation de contrôle manuel.'}render();return}
    return originalValidate();
  };
}
document.addEventListener('input',e=>{
  const t=e.target;if(!(t instanceof HTMLElement))return;
  if(t.id==='manualPdfCheck')return;
  if(t.closest('#review')&&(t.matches('input,select')||t.classList.contains('lp')||t.classList.contains('lq'))){if(state.verified){state.manualChanged=true;render()}}
});
const observer=new MutationObserver(()=>{if(!byId('review')?.classList.contains('hide')&&state.verified)render()});
const review=byId('review');if(review)observer.observe(review,{attributes:true,subtree:true,childList:true});
})();
