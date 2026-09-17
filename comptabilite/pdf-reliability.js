// Fiabilite PDF Comptabilite : analyse du PDF original + score visible + erreurs detaillees.
(()=>{
'use strict';
if(typeof processSingleAccountingFile!=='function')return;
const results=new Map();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>{let n=Number(v);if(!Number.isFinite(n)||n<0)return 0;if(n<=1.0001)n*=100;return clamp(Math.round(n),0,100)};
function reliability(ai,aiError=''){
  if(aiError||!ai)return 0;
  const checks=ai.auto_validation?.checks||{};
  const header=(pct(checks.header_confidence)+pct(checks.product_confidence))/2;
  const binary=['supplier_exact','rule_complete','supplier_only','line_confidence_100','charge_exact','no_duplicate','no_warnings','allowed_accounts'];
  const controls=100*binary.filter(k=>checks[k]===true).length/binary.length;
  const products=Array.isArray(ai.ai?.products)?ai.ai.products:[];
  const productConf=products.length?products.reduce((s,p)=>s+pct(p.confidence),0)/products.length:header;
  let score=header*.40+controls*.40+productConf*.20;
  score-=Math.min(30,(ai.auto_validation?.warnings||[]).length*5);
  return clamp(Math.round(score),0,100);
}
function level(score){return score>=95?['Très fiable','#14733e','#e7f4eb']:score>=85?['Fiable, contrôle conseillé','#765500','#fff3cd']:score>=70?['Fiabilité moyenne','#a85d00','#fff0d9']:['Fiabilité faible','#941f1f','#fdeaea']}
function issueList(ai,aiError=''){
  const out=[];
  if(aiError)out.push(`Analyse automatique incomplète : ${aiError}`);
  for(const w of ai?.auto_validation?.warnings||[])out.push(String(w));
  const c=ai?.auto_validation?.checks||{};
  const labels={supplier_exact:'Fournisseur non confirmé exactement',rule_complete:'Règle comptable fournisseur incomplète',supplier_only:'Une ou plusieurs lignes utilisent une correspondance non strictement fournisseur',line_confidence_100:'Confiance insuffisante sur une ou plusieurs lignes',charge_exact:'Total des charges différent du TTC de la facture',no_duplicate:'Doublon potentiel détecté',no_warnings:'Au moins une anomalie est présente',allowed_accounts:'Aucun compte de charge autorisé pour ce fournisseur'};
  for(const [k,l] of Object.entries(labels))if(c[k]===false)out.push(l);
  if(Number(c.header_confidence)>=0&&pct(c.header_confidence)<95)out.push(`Confiance en-tête insuffisante : ${pct(c.header_confidence)} %`);
  if(Number(c.product_confidence)>=0&&pct(c.product_confidence)<95)out.push(`Confiance extraction produits insuffisante : ${pct(c.product_confidence)} %`);
  return [...new Set(out.filter(Boolean))];
}
function productDetails(ai){
  const p=Array.isArray(ai?.ai?.products)?ai.ai.products:[];if(!p.length)return '';
  return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Fiabilité par ligne (${p.length})</summary><div style="margin-top:8px">${p.map((x,i)=>{
    const score=pct(x.confidence),errs=[];
    if(!x.account)errs.push('compte de charge non déterminé');
    if(x.amount===null||x.amount===undefined)errs.push('montant TTC manquant');
    if(x.source==='gemini_semantic')errs.push('classement proposé uniquement par interprétation Gemini');
    if(x.source==='keywords_global')errs.push('correspondance inter-fournisseur à contrôler');
    return `<div style="padding:7px 0;border-bottom:1px solid #e6ebef"><b>${esc(x.description||x.reference||`Ligne ${i+1}`)}</b> · <span style="font-weight:800">${score} %</span>${errs.length?`<div class="err" style="font-size:12px">Erreur : ${errs.map(esc).join(' · ')}</div>`:'<div class="ok" style="font-size:12px">Lecture et classement cohérents</div>'}</div>`
  }).join('')}</div></details>`;
}
function renderResult(id){
  const r=results.get(String(id));if(!r)return;
  const host=document.querySelector('#modal .card');if(!host)return;
  host.querySelector('#accountingReliabilityBox')?.remove();
  const score=reliability(r.ai,r.aiError),lv=level(score),issues=issueList(r.ai,r.aiError),box=document.createElement('div');
  box.id='accountingReliabilityBox';box.style.cssText='margin:12px 0;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';
  box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px;border-radius:9px;background:${lv[2]}"><div><b>Fiabilité estimée de la lecture</b><div style="font-size:12px">${lv[0]} · score calculé à partir de la confiance Gemini et des contrôles comptables.</div></div><div style="font-size:28px;font-weight:900;color:${lv[1]}">${score} %</div></div>${issues.length?`<div class="err" style="margin-top:10px"><b>Erreurs / points à contrôler :</b><ul style="margin:6px 0 0 20px">${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<div class="ok" style="margin-top:10px"><b>Aucune erreur détectée par les contrôles automatiques.</b></div>'}${productDetails(r.ai)}`;
  const reviewGrid=host.querySelector('.review');if(reviewGrid)reviewGrid.insertAdjacentElement('beforebegin',box);else host.prepend(box);
}

const baseReview=window.review;
if(typeof baseReview==='function')window.review=async function(id){const x=await baseReview(id);setTimeout(()=>renderResult(id),0);return x};

processSingleAccountingFile=async function(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);
  prog(2,'Préparation du PDF original…');
  const f=new FormData();
  f.append('file',file);
  f.append('raw_text','');
  f.append('supplier','');f.append('invoice_number','');f.append('invoice_date','');
  f.append('amount_ht','');f.append('amount_vat','');f.append('amount_ttc','');f.append('vat_rate','');
  prog(62,'Enregistrement sécurisé du PDF…');
  const resp=await api('upload','POST',f,true),j=await resp.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!resp.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');
  const id=j.item.id;prog(78,'Analyse visuelle du PDF original par Gemini…');let ai=null,aiError='';
  try{ai=await accountingAiApi('reanalyze','POST',{id},{attempts:2})}catch(e){aiError=e?.message||String(e);console.warn('Analyse PDF Gemini impossible',e)}
  results.set(String(id),{ai,aiError});
  const score=reliability(ai,aiError),warnings=issueList(ai,aiError);
  if(refreshAfter){await refresh();page='dashboard';render()}
  if(openReview&&!ai?.auto_validated){if(aiError)alert(`Le PDF a bien été importé. L’analyse renforcée n’a pas pu se terminer : ${aiError}. Fiabilité estimée : ${score} %. La facture reste à contrôler.`);await window.review(id)}
  return {id,autoValidated:!!ai?.auto_validated,aiError,warnings,reliability:score};
};
})();
