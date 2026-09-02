(()=>{
'use strict';

const sourceLabel=s=>s==='keywords_supplier'?'Mots-clés fournisseur':s==='keywords_global'?'Mots-clés globaux':s==='gemini_semantic'?'Nature Gemini — à contrôler':'Non classé';
const scoreText=p=>p.classification_source?.startsWith('keywords')?`Score ${Number(p.match_score||0).toFixed(1)} · marge ${Number(p.match_margin||0).toFixed(1)}`:'—';

async function fetchProductAnalysis(id){
  const u=new URL(ACCOUNTING_AI_BASE);u.searchParams.set('action','product-analysis');u.searchParams.set('id',id);
  const r=await fetch(u.toString(),{headers:{...(token?{authorization:'Bearer '+token}:{})},cache:'no-store'});
  const j=await r.json().catch(()=>({products:[]}));
  if(!r.ok)throw new Error(j.error||'Analyse produits indisponible');
  return j.products||[];
}

function renderProductAnalysis(rows){
  if(!rows.length)return '<div class="muted">Aucune analyse produit enregistrée pour cette facture. Utilise « Ré-analyser avec Gemini » pour lancer l’extraction.</div>';
  return `<div class="table"><table style="min-width:980px"><thead><tr><th>#</th><th>Référence</th><th>Produit / prestation extrait</th><th>TTC</th><th>Compte choisi</th><th>Méthode</th><th>Mots-clés reconnus</th><th>Score</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.line_no}</td><td>${esc(p.product_reference||'—')}</td><td><b>${esc(p.product_description||'—')}</b>${p.matched_training_product?`<div class="muted">Correspondance : ${esc(p.matched_training_product)}</div>`:''}${p.semantic_reason?`<div class="muted">${esc(p.semantic_reason)}</div>`:''}</td><td>${p.amount_ttc==null?'—':Number(p.amount_ttc).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'}</td><td>${p.chosen_account?`<b>${esc(p.chosen_account)}</b><div class="muted">${esc(p.chosen_label||'')}</div>`:'<span class="badge warn">À déterminer</span>'}</td><td>${esc(sourceLabel(p.classification_source))}</td><td>${(p.matched_keywords||[]).length?(p.matched_keywords||[]).map(k=>`<span class="badge okb" style="margin:2px">${esc(k)}</span>`).join(''):'—'}</td><td>${esc(scoreText(p))}</td></tr>`).join('')}</tbody></table></div>`;
}

const reviewBeforeProducts=window.review;
if(typeof reviewBeforeProducts==='function')window.review=async function(id){
  await reviewBeforeProducts(id);
  const right=document.querySelector('#modal .review > div:last-child');
  if(!right)return;
  const old=document.getElementById('productKeywordAnalysis');if(old)old.remove();
  const box=document.createElement('div');box.id='productKeywordAnalysis';box.className='card';box.style.marginTop='12px';box.innerHTML='<h3>Analyse des produits et comptes de charge</h3><div class="muted">Chargement de l’analyse Gemini et des correspondances de mots-clés…</div>';
  right.appendChild(box);
  try{
    const rows=await fetchProductAnalysis(id);
    box.innerHTML=`<h3>Analyse des produits et comptes de charge</h3><p class="muted">Le compte par défaut du fournisseur n’est pas utilisé pour ce classement. Une référence exacte ou plusieurs mots-clés cohérents donnent le score principal.</p>${renderProductAnalysis(rows)}`;
  }catch(e){box.innerHTML=`<h3>Analyse des produits et comptes de charge</h3><div class="status err">${esc(e.message||String(e))}</div>`}
};

const importBeforeProducts=window.importPage;
if(typeof importBeforeProducts==='function')window.importPage=function(){
  importBeforeProducts();
  const card=document.querySelector('#content .card');
  if(card&&!document.getElementById('productKeywordImportInfo')){
    const info=document.createElement('div');info.id='productKeywordImportInfo';info.className='status ok';info.style.marginBottom='12px';
    info.innerHTML='<b>Classement produit par produit.</b> Gemini extrait chaque ligne de la facture, puis compare la référence et la désignation aux 442 produits appris et à leurs mots-clés. Le compte fournisseur par défaut ne décide pas du compte de charge.';
    const h=card.querySelector('h2');if(h)h.insertAdjacentElement('afterend',info);else card.prepend(info);
  }
};
})();
