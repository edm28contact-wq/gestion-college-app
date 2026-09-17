// Couche de fiabilite facture : aucun doute n'est valide silencieusement.
(()=>{
'use strict';
// Charge le moteur OCR haute definition partage. Il attend automatiquement PDF.js/Tesseract.
if(!document.querySelector('script[data-pdf-ocr-hq]')){const s=document.createElement('script');s.src='../../pdf-ocr-hq.js?v=2';s.dataset.pdfOcrHq='1';document.head.appendChild(s)}
const state={verified:false,strict:false,manualChanged:false,warnings:[],unmatched:[],items:[]};
const byId=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function pct(v){let n=Number(v);if(!Number.isFinite(n)||n<0)return 0;if(n<=1.0001)n*=100;return clamp(Math.round(n),0,100)}
function ensureBox(){
  if(byId('reliabilityBox'))return byId('reliabilityBox');
  const warnings=byId('warnings');if(!warnings)return null;
  const box=document.createElement('div');box.id='reliabilityBox';box.style.cssText='margin-top:12px;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';
  warnings.insertAdjacentElement('afterend',box);return box;
}
function headerOk(){return !!String(byId('supplier')?.value||'').trim()&&!!String(byId('number')?.value||'').trim()&&/^\d{4}-\d{2}-\d{2}$/.test(String(byId('date')?.value||''));}
function lineRows(){return [...document.querySelectorAll('#lines .line')];}
function linesComplete(){const rows=lineRows();return rows.length>0&&rows.every(r=>String(r.querySelector('.lp')?.value||'').trim()&&Number(r.querySelector('.lq')?.value)>0);}
function allDetected(){return [...state.items,...state.unmatched]}
function reliabilityScore(){
  if(!state.verified)return 0;
  const all=allDetected();
  if(!all.length)return 0;
  const avgConfidence=all.reduce((s,x)=>s+pct(x.reader_confidence),0)/all.length;
  const agreement=100*all.filter(x=>x.double_read_agreement===true).length/all.length;
  const mapped=100*all.filter(x=>x.product_id).length/all.length;
  const header=headerOk()?100:45;
  let score=avgConfidence*.50+agreement*.25+mapped*.15+header*.10;
  score-=Math.min(20,state.warnings.length*4);
  score-=Math.min(25,state.unmatched.length*7);
  return clamp(Math.round(score),0,100);
}
function level(score){return score>=95?['Très fiable','#14733e','#e7f4eb']:score>=85?['Fiable, contrôle conseillé','#765500','#fff3cd']:score>=70?['Fiabilité moyenne','#a85d00','#fff0d9']:['Fiabilité faible','#941f1f','#fdeaea']}
function autoStrict(){return state.verified&&!state.manualChanged&&state.warnings.length===0&&state.unmatched.length===0&&state.items.length>0&&state.items.every(x=>x.double_read_agreement===true&&pct(x.reader_confidence)>=90&&x.product_id&&Number(x.quantity)>0)&&headerOk()&&linesComplete();}
function lineDetailHtml(){
  const all=allDetected();if(!all.length)return '';
  return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Fiabilité par ligne (${all.length})</summary><div style="margin-top:8px">${all.map((x,i)=>{
    const p=pct(x.reader_confidence),errs=[];
    if(x.double_read_agreement!==true)errs.push('désaccord entre les deux lectures');
    if(!x.product_id)errs.push('produit non reconnu');
    if(!(Number(x.quantity)>0))errs.push('quantité absente ou invalide');
    return `<div style="padding:7px 0;border-bottom:1px solid #e6ebef"><b>${safe(x.detected_label||x.detected_reference||`Ligne ${i+1}`)}</b> · <span style="font-weight:800">${p} %</span>${errs.length?`<div class="err" style="font-size:12px">Erreur : ${errs.map(safe).join(' · ')}</div>`:'<div class="ok" style="font-size:12px">Lecture concordante</div>'}</div>`
  }).join('')}</div></details>`;
}
function render(){
  state.strict=autoStrict();const box=ensureBox();if(!box)return;
  const issues=[];
  if(state.warnings.length)issues.push(...state.warnings);
  if(state.unmatched.length)issues.push(...state.unmatched.map(x=>`Ligne non associée au stock : ${x.detected_label||x.detected_reference||'ligne inconnue'}`));
  if(state.manualChanged)issues.push('Des données ont été modifiées manuellement après la double lecture.');
  if(!headerOk())issues.push('Fournisseur, numéro ou date de facture à compléter/contrôler.');
  if(!linesComplete())issues.push('Toutes les lignes doivent avoir un produit et une quantité positive.');
  const unique=[...new Set(issues.filter(Boolean))],score=reliabilityScore(),lv=level(score);
  const scoreBox=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px;border-radius:9px;background:${lv[2]}"><div><b>Fiabilité estimée de la lecture</b><div style="font-size:12px">${lv[0]} · score calculé à partir des deux lectures, des lignes reconnues et des contrôles.</div></div><div style="font-size:28px;font-weight:900;color:${lv[1]}">${score} %</div></div>`;
  if(state.strict){box.innerHTML=scoreBox+'<div class="ok" style="margin-top:10px"><b>Contrôles automatiques concordants.</b> Les deux lectures confirment les lignes, quantités et rattachements produits. Une confirmation humaine reste demandée avant mise à jour du stock.</div>'+lineDetailHtml();return}
  box.innerHTML=scoreBox+`<div class="err" style="margin-top:10px"><b>Contrôle humain obligatoire.</b> La validation automatique est bloquée tant qu'un doute existe.</div>${unique.length?`<div style="margin-top:8px"><b>Erreurs / points à contrôler :</b><ul style="margin:6px 0 10px 20px">${unique.map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div>`:''}${lineDetailHtml()}<label style="display:flex;gap:8px;align-items:flex-start;font-weight:700;margin-top:10px"><input id="manualPdfCheck" type="checkbox" style="width:auto;margin-top:3px"> J'ai comparé le PDF original avec le fournisseur, le numéro, la date, chaque produit et chaque quantité, et je confirme les corrections manuelles.</label>`;
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
    if(!state.strict&&!byId('manualPdfCheck')?.checked){if(msg){msg.className='status err';msg.textContent=`Fiabilité ${reliabilityScore()} % : cette facture contient un doute de lecture. Comparez-la au PDF puis cochez la confirmation de contrôle manuel.`}render();return}
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
