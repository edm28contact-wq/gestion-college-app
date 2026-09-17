// Fiabilite PDF Comptabilite : OCR local HD + analyse IA + double verification + apprentissage fournisseur.
(()=>{
'use strict';
if(typeof processSingleAccountingFile!=='function')return;
const VERIFIER='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-pdf-verifier';
const LEARNER='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/supplier-template-learn';
const results=new Map();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>{let n=Number(v);if(!Number.isFinite(n)||n<0)return 0;if(n<=1.0001)n*=100;return clamp(Math.round(n),0,100)};
async function verifyPdf(id){const r=await fetch(VERIFIER,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({id}),cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse de vérification invalide'}));if(!r.ok)throw new Error(j.error||'Vérification PDF impossible');return j}
async function learnSupplierTemplate(id,score){const r=await fetch(LEARNER,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({mode:'accounting',invoice_id:id,confidence:score}),cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse apprentissage invalide'}));if(!r.ok)throw new Error(j.error||'Apprentissage fournisseur impossible');return j}
function strongVerifier(v){if(!v?.ok||v?.degraded)return false;const c=v.checks||{};return Number(v.score)>=94&&c.supplier_agreement===true&&c.supplier_profile_match===true&&c.invoice_number_agreement===true&&c.date_agreement===true&&c.amount_ht_agreement===true&&c.amount_vat_agreement===true&&c.amount_ttc_agreement===true&&c.arithmetic_ok===true&&Number(c.line_agreement)>=90&&c.line_sum_agreement===true}
function informationalWarning(w,ai,v){const s=String(w||'');const oneAllowed=Array.isArray(ai?.ai?.allowed_charge_accounts)&&ai.ai.allowed_charge_accounts.length===1;return (strongVerifier(v)||Number(v?.score||0)>=94)&&oneAllowed&&s.startsWith('Compte proposé par nature Gemini :')}
function reliability(ai,aiError='',verifier=null,verifyError=''){
  if((aiError||!ai)&&verifier?.ok)return clamp(Math.round(Number(verifier.score||0)),0,100);
  if(aiError||!ai)return 0;
  const checks=ai.auto_validation?.checks||{};
  const header=(pct(checks.header_confidence)+pct(checks.product_confidence))/2;
  const binary=['rule_complete','charge_exact','no_duplicate','allowed_accounts'];
  const controls=100*binary.filter(k=>checks[k]===true).length/binary.length;
  const products=Array.isArray(ai.ai?.products)?ai.ai.products:[];
  const productConf=products.length?products.reduce((s,p)=>s+pct(p.confidence),0)/products.length:header;
  const realWarnings=(ai.auto_validation?.warnings||[]).filter(w=>!informationalWarning(w,ai,verifier));
  let primary=header*.45+controls*.35+productConf*.20-Math.min(20,realWarnings.length*5);
  if(strongVerifier(verifier))primary=Math.max(primary,Number(verifier.score||0));
  else if(verifier?.ok)primary=Math.max(primary*.55+Number(verifier.score||0)*.45,Number(verifier.score||0)-5);
  if(verifyError&&!verifier?.ok)primary-=5;
  return clamp(Math.round(primary),0,100);
}
function level(score){return score>=97?['Très fiable','#14733e','#e7f4eb']:score>=90?['Fiable','#14733e','#edf7f0']:score>=80?['Fiable, contrôle conseillé','#765500','#fff3cd']:score>=70?['Fiabilité moyenne','#a85d00','#fff0d9']:['Fiabilité faible','#941f1f','#fdeaea']}
function issueList(ai,verifier=null){
  const out=[];
  for(const w of ai?.auto_validation?.warnings||[])if(!informationalWarning(w,ai,verifier))out.push(String(w));
  if(verifier?.ok&&!verifier.degraded)for(const w of verifier?.errors||[])out.push(String(w));
  const c=ai?.auto_validation?.checks||{},verified=strongVerifier(verifier),oneAllowed=Array.isArray(ai?.ai?.allowed_charge_accounts)&&ai.ai.allowed_charge_accounts.length===1;
  if(c.rule_complete===false)out.push('Règle comptable fournisseur incomplète');
  if(c.charge_exact===false)out.push('Total des charges différent du TTC de la facture');
  if(c.no_duplicate===false)out.push('Doublon potentiel détecté');
  if(c.allowed_accounts===false)out.push('Aucun compte de charge autorisé pour ce fournisseur');
  if(ai&&!verified){
    if(c.supplier_exact===false&&Number(verifier?.score||0)<90)out.push('Fournisseur non confirmé exactement');
    if(c.supplier_only===false&&!oneAllowed&&Number(verifier?.score||0)<90)out.push('Une ou plusieurs lignes utilisent une correspondance comptable non spécifique au fournisseur');
    if(c.line_confidence_100===false&&Number(verifier?.score||0)<90)out.push('Confiance insuffisante sur une ou plusieurs lignes');
    if(Number(c.header_confidence)>=0&&pct(c.header_confidence)<95&&Number(verifier?.score||0)<90)out.push(`Confiance en-tête insuffisante : ${pct(c.header_confidence)} %`);
    if(Number(c.product_confidence)>=0&&pct(c.product_confidence)<95&&Number(verifier?.score||0)<90)out.push(`Confiance extraction produits insuffisante : ${pct(c.product_confidence)} %`);
  }
  return [...new Set(out.filter(Boolean))];
}
function technicalList(aiError='',verifier=null,verifyError=''){
  const out=[];
  if(aiError)out.push(`Analyse IA principale indisponible : ${aiError}`);
  if(verifyError)out.push(`Vérification IA indisponible : ${verifyError}`);
  if(verifier?.degraded)out.push('Mode de secours actif : le score utilise les données déjà extraites, le modèle fournisseur et les contrôles arithmétiques locaux.');
  for(const x of verifier?.provider_errors||[])out.push(String(x));
  return [...new Set(out.filter(Boolean))];
}
function productDetails(ai,verifier){
  const p=Array.isArray(ai?.ai?.products)?ai.ai.products:[];if(!p.length)return '';
  const verified=strongVerifier(verifier)||Number(verifier?.score||0)>=94,oneAllowed=Array.isArray(ai?.ai?.allowed_charge_accounts)&&ai.ai.allowed_charge_accounts.length===1;
  return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Fiabilité par ligne (${p.length})</summary><div style="margin-top:8px">${p.map((x,i)=>{
    let score=pct(x.confidence),errs=[];
    if(!x.account)errs.push('compte de charge non déterminé');
    if(x.amount===null||x.amount===undefined)errs.push('montant TTC manquant');
    if(x.source==='gemini_semantic'&&!(verified&&oneAllowed))errs.push('classement proposé uniquement par interprétation Gemini');
    if(x.source==='keywords_global'&&!verified)errs.push('correspondance inter-fournisseur à contrôler');
    if(verified&&x.account&&x.amount!==null&&x.amount!==undefined)score=Math.max(score,95);
    return `<div style="padding:7px 0;border-bottom:1px solid #e6ebef"><b>${esc(x.description||x.reference||`Ligne ${i+1}`)}</b> · <span style="font-weight:800">${score} %</span>${errs.length?`<div class="err" style="font-size:12px">À contrôler : ${errs.map(esc).join(' · ')}</div>`:'<div class="ok" style="font-size:12px">Lecture confirmée par les contrôles croisés</div>'}</div>`
  }).join('')}</div></details>`;
}
function verifierDetails(v){if(!v?.ok)return '';const c=v.checks||{},a=v.first||v.local||{},b=v.second||v.local||{},title=v.degraded?'Contrôles de secours':'Double vérification indépendante';return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">${title}</summary><div style="margin-top:8px;font-size:13px"><div class="${Number(v.score)>=90?'ok':'err'}"><b>Score de vérification : ${Number(v.score||0)} %</b></div><div>Fournisseur : ${esc(a.supplier||'?')} / ${esc(b.supplier||'?')}</div><div>Facture : ${esc(a.invoice_number||'?')} / ${esc(b.invoice_number||'?')}</div><div>Date : ${esc(a.invoice_date||'?')} / ${esc(b.invoice_date||'?')}</div><div>TTC : ${esc(a.amount_ttc??'?')} € / ${esc(b.amount_ttc??'?')} €</div><div>Lignes contrôlées : ${Number(a.line_count||b.line_count||0)} · concordance ${Number(c.line_agreement||0)} %</div>${v.degraded?'<div class="muted" style="margin-top:5px">Une partie des contrôles IA était indisponible ; les contrôles déterministes restent affichés séparément.</div>':''}</div></details>`}
function learningDetails(r){if(!r?.learning)return '';const l=r.learning;if(l.learned)return `<div class="ok" style="margin-top:8px;font-size:12px"><b>Modèle fournisseur appris.</b> ${esc(l.supplier||'Fournisseur')} possède maintenant ${Number(l.model_count||0)} modèle(s) reconnu(s).</div>`;if(l.reason==='confidence_too_low')return '<div class="muted" style="margin-top:8px;font-size:12px">Modèle non appris : fiabilité insuffisante pour éviter un mauvais apprentissage.</div>';return ''}
function renderResult(id){
  const r=results.get(String(id));if(!r)return;
  const host=document.querySelector('#modal .card');if(!host)return;
  host.querySelector('#accountingReliabilityBox')?.remove();
  const score=reliability(r.ai,r.aiError,r.verifier,r.verifyError),lv=level(score),issues=issueList(r.ai,r.verifier),tech=technicalList(r.aiError,r.verifier,r.verifyError),box=document.createElement('div');
  box.id='accountingReliabilityBox';box.style.cssText='margin:12px 0;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';
  const issueHtml=issues.length?`<div class="err" style="margin-top:10px"><b>Erreurs / points à contrôler sur la facture :</b><ul style="margin:6px 0 0 20px">${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<div class="ok" style="margin-top:10px"><b>Aucune incohérence de facture détectée par les contrôles disponibles.</b></div>';
  const techHtml=tech.length?`<details style="margin-top:9px"><summary style="cursor:pointer;font-weight:700;color:#765500">Incidents techniques (${tech.length})</summary><ul class="muted" style="margin:6px 0 0 20px">${tech.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:'';
  box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px;border-radius:9px;background:${lv[2]}"><div><b>Fiabilité estimée de la lecture</b><div style="font-size:12px">${lv[0]} · OCR HD + données extraites + modèle fournisseur + contrôles arithmétiques + contrôles IA disponibles.</div></div><div style="font-size:28px;font-weight:900;color:${lv[1]}">${score} %</div></div>${issueHtml}${techHtml}${learningDetails(r)}${verifierDetails(r.verifier)}${productDetails(r.ai,r.verifier)}`;
  const reviewGrid=host.querySelector('.review');if(reviewGrid)reviewGrid.insertAdjacentElement('beforebegin',box);else host.prepend(box);
}

const baseReview=window.review;
if(typeof baseReview==='function')window.review=async function(id){const x=await baseReview(id);setTimeout(()=>renderResult(id),0);return x};

processSingleAccountingFile=async function(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);
  prog(2,'Lecture locale haute définition du PDF…');
  let t='',localSupplier='',localNumber='',localDate='',a={ht:null,vat:null,ttc:null,rate:null};
  try{
    t=await textPdf(file);
    if(typeof supplier==='function')localSupplier=supplier(t)||'';
    if(typeof invNo==='function')localNumber=invNo(t)||'';
    if(typeof invDate==='function')localDate=invDate(t)||'';
    if(typeof amounts==='function')a=amounts(t)||a;
  }catch(e){console.warn('Extraction locale PDF incomplète',e)}
  const f=new FormData();f.append('file',file);f.append('raw_text',t||'');f.append('supplier',localSupplier);f.append('invoice_number',localNumber);f.append('invoice_date',localDate);f.append('amount_ht',a.ht??'');f.append('amount_vat',a.vat??'');f.append('amount_ttc',a.ttc??'');f.append('vat_rate',a.rate??'');
  prog(58,'Enregistrement sécurisé du PDF et des données locales…');
  const resp=await api('upload','POST',f,true),j=await resp.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!resp.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');
  const id=j.item.id;let ai=null,aiError='',verifier=null,verifyError='',learning=null;
  prog(70,'Analyse comptable IA…');
  try{ai=await accountingAiApi('reanalyze','POST',{id},{attempts:2})}catch(e){aiError=e?.message||String(e);console.warn('Analyse PDF IA impossible',e)}
  prog(84,'Vérification indépendante et contrôles locaux…');
  try{verifier=await verifyPdf(id)}catch(e){verifyError=e?.message||String(e);console.warn('Vérification PDF indépendante impossible',e)}
  const score=reliability(ai,aiError,verifier,verifyError),warnings=issueList(ai,verifier);
  if(score>=85&&(ai||Number(verifier?.score||0)>=90)){prog(94,'Apprentissage du modèle fournisseur…');try{learning=await learnSupplierTemplate(id,score)}catch(e){console.warn('Apprentissage fournisseur impossible',e)}}
  results.set(String(id),{ai,aiError,verifier,verifyError,learning,local:{supplier:localSupplier,invoice_number:localNumber,invoice_date:localDate,amounts:a}});
  if(refreshAfter){await refresh();page='dashboard';render()}
  if(openReview&&!ai?.auto_validated){await window.review(id)}
  return {id,autoValidated:!!ai?.auto_validated,aiError,verifyError,warnings,reliability:score,verified:strongVerifier(verifier),learning};
};
})();
