const ACCOUNTING_AI_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-ai';
const ACCOUNTING_MAX_FILES=400;
const ACCOUNTING_MAX_FILE_BYTES=20*1024*1024;
const ACCOUNTING_AI_RETRYABLE=new Set([429,502,503,504]);

const sleepAccounting=ms=>new Promise(r=>setTimeout(r,ms));

async function accountingAiApi(action,method='POST',body,{attempts=3}={}){
  let lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const u=new URL(ACCOUNTING_AI_BASE);
      u.searchParams.set('action',action);
      const r=await fetch(u.toString(),{
        method,
        headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body?JSON.stringify(body):undefined,
        cache:'no-store'
      });
      const j=await r.json().catch(()=>({error:'Réponse IA invalide'}));
      if(r.ok)return j;
      const e=new Error(j.error||`Erreur IA HTTP ${r.status}`);
      e.status=r.status;
      e.providerCode=j.provider_code||'';
      if(!ACCOUNTING_AI_RETRYABLE.has(r.status)||attempt===attempts)throw e;
      lastError=e;
    }catch(e){
      lastError=e;
      const status=Number(e?.status||0);
      if((status&&!ACCOUNTING_AI_RETRYABLE.has(status))||attempt===attempts)throw e;
    }
    await sleepAccounting(700*Math.pow(2,attempt-1));
  }
  throw lastError||new Error('Analyse IA indisponible');
}

async function ensureAccountingAiReady(){
  try{
    const h=await accountingAiApi('health','GET',undefined,{attempts:1});
    if(!h?.ok)throw new Error('Le test de connexion IA a échoué.');
    return h;
  }catch(e){
    const msg=e?.message||String(e);
    throw new Error(`Gemini indisponible : ${msg}`);
  }
}

const loadBeforeAutoAi=load;
load=async function(){
  await loadBeforeAutoAi();
  if($('who'))$('who').textContent=(db.current_user.display_name||'Comptabilité')+' · import toujours possible · validation automatique seulement si fiable';
};

const baseAccountingProg=prog;
let accountingBatchProgress=null;
prog=function(v,t){
  if(accountingBatchProgress){
    const {index,total}=accountingBatchProgress;
    const pct=((index+(Math.max(0,Math.min(100,Number(v)||0))/100))/Math.max(1,total))*100;
    return baseAccountingProg(Math.max(1,Math.min(100,pct)),`Facture ${index+1}/${total} · ${t}`);
  }
  return baseAccountingProg(v,t);
};

async function processSingleAccountingFile(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);
  prog(2,'Préparation du PDF…');
  const t=await textPdf(file),f=new FormData();
  f.append('file',file);
  f.append('raw_text',t||'');
  f.append('supplier','');
  f.append('invoice_number','');
  f.append('invoice_date','');
  f.append('amount_ht','');
  f.append('amount_vat','');
  f.append('amount_ttc','');
  f.append('vat_rate','');
  prog(82,'Enregistrement sécurisé…');
  const r=await api('upload','POST',f,true),j=await r.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!r.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');
  const id=j.item.id;
  prog(91,'Analyse Gemini du PDF…');
  let ai=null,aiError='';
  try{ai=await accountingAiApi('reanalyze','POST',{id},{attempts:2})}catch(e){aiError=e?.message||String(e);console.warn('Analyse Gemini automatique impossible',e)}
  if(refreshAfter){
    await refresh();
    page='dashboard';
    render();
  }
  if(openReview&&!ai?.auto_validated){
    if(aiError)alert(`Le PDF a bien été importé. Gemini n’a pas pu terminer l’analyse : ${aiError}. La facture reste à contrôler et peut être réanalysée plus tard.`);
    review(id);
  }
  return {id,autoValidated:!!ai?.auto_validated,aiError,warnings:ai?.auto_validation?.warnings||[]};
}

processFile=async function(file){
  try{
    accountingBatchProgress=null;
    await processSingleAccountingFile(file,{openReview:true,refreshAfter:true});
  }catch(e){
    const m=$('imsg');
    if(m){m.className='status err';m.textContent=e.message}
    else alert(e.message||String(e));
  }
};

async function processAccountingFiles(fileList){
  const files=[...(fileList||[])];
  if(!files.length)return;
  if(files.length>ACCOUNTING_MAX_FILES){alert(`Maximum ${ACCOUNTING_MAX_FILES} factures par dépôt.`);return}
  const pdfs=files.filter(f=>f.type==='application/pdf' || String(f.name||'').toLowerCase().endsWith('.pdf'));
  if(!pdfs.length){alert('Aucun PDF sélectionné.');return}
  if(pdfs.length!==files.length)alert('Seuls les fichiers PDF seront traités.');
  let ok=0,validated=0,toReview=0,failed=0;
  const errors=[];
  accountingBatchProgress={index:0,total:pdfs.length};
  for(let i=0;i<pdfs.length;i++){
    accountingBatchProgress={index:i,total:pdfs.length};
    const file=pdfs[i];
    try{
      const res=await processSingleAccountingFile(file,{openReview:false,refreshAfter:false});
      ok++;
      if(res.autoValidated)validated++;else toReview++;
      if(res.aiError)errors.push(`${file.name} : Gemini : ${res.aiError}`);
    }catch(e){
      failed++;
      errors.push(`${file.name} : ${e?.message||String(e)}`);
    }
    baseAccountingProg(Math.round(((i+1)/pdfs.length)*100),`Traitement ${i+1}/${pdfs.length}`);
  }
  accountingBatchProgress=null;
  await refresh();
  page='dashboard';
  render();
  const detail=errors.length?`\n\n${errors.slice(0,8).join('\n')}${errors.length>8?`\n… +${errors.length-8} autre(s)`:''}`:'';
  alert(`Import terminé : ${ok} PDF enregistré(s), ${validated} validé(s) automatiquement, ${toReview} à contrôler, ${failed} échec(s) d’import.${detail}`);
}

async function testGeminiAccounting(){
  try{
    const btn=$('testGemini');
    if(btn)btn.disabled=true;
    baseAccountingProg(5,'Test de Gemini…');
    const h=await ensureAccountingAiReady();
    alert(`Gemini fonctionne. Modèle : ${h.primary_model||'configuré'} · version IA ${h.version||''}`);
  }catch(e){
    alert(e?.message||String(e));
  }finally{
    const btn=$('testGemini');
    if(btn)btn.disabled=false;
    baseAccountingProg(0,'');
  }
}

async function reanalyzePendingAccountingInvoices(){
  try{
    const btn=$('reanalyzePending');
    if(btn)btn.disabled=true;
    await refresh();
    const pending=(db.invoices||[]).filter(x=>x.created_by==='comptabilite'&&['a_controler','erreur'].includes(x.status)&&x.storage_path);
    if(!pending.length){alert('Aucune facture importée en attente de réanalyse IA.');return}
    let done=0,validated=0,failed=0;
    const errors=[];
    for(let i=0;i<pending.length;i++){
      baseAccountingProg(Math.max(1,Math.round((i/pending.length)*100)),`Réanalyse Gemini ${i+1}/${pending.length} · ${pending[i].file_name||'facture'}`);
      try{
        const r=await accountingAiApi('reanalyze','POST',{id:pending[i].id},{attempts:2});
        done++;
        if(r?.auto_validated)validated++;
      }catch(e){
        failed++;
        errors.push(`${pending[i].file_name||pending[i].id} : ${e?.message||String(e)}`);
        if(i===0)break;
      }
    }
    await refresh();
    page='dashboard';
    render();
    const detail=errors.length?`\n\n${errors.slice(0,5).join('\n')}`:'';
    alert(`Réanalyse terminée : ${done} traitée(s), ${validated} validée(s) automatiquement, ${failed} échec(s).${detail}`);
  }catch(e){
    alert(e?.message||String(e));
  }finally{
    const btn=$('reanalyzePending');
    if(btn)btn.disabled=false;
    baseAccountingProg(0,'');
  }
}

importPage=function(){
  $('content').innerHTML=`<div class="card"><h2>Importer des factures PDF</h2><p class="muted">Tu peux déposer jusqu’à <b>${ACCOUNTING_MAX_FILES} factures PDF à la fois</b>. L’import du PDF fonctionne même si Gemini est temporairement indisponible. Gemini essaie ensuite de lire le document ; en cas d’échec, la facture reste simplement <b>À contrôler</b> et pourra être réanalysée.</p><div class="actions" style="margin-bottom:12px"><button id="testGemini" class="btn secondary" onclick="testGeminiAccounting()">Tester Gemini</button><button id="reanalyzePending" class="btn secondary" onclick="reanalyzePendingAccountingInvoices()">Ré-analyser les factures déjà importées</button></div><div id="drop" class="drop"><b>Déposer jusqu’à ${ACCOUNTING_MAX_FILES} PDF ici</b><br><span class="muted">Sélection multiple autorisée · 20 Mo maximum par fichier</span><input id="file" class="hide" type="file" accept="application/pdf" multiple></div><br><progress id="prog" class="hide" max="100" value="0" style="width:100%"></progress><div id="imsg" class="status"></div></div>`;
  const d=$('drop'),f=$('file');
  d.onclick=()=>f.click();
  f.onchange=()=>processAccountingFiles(f.files);
  d.ondragover=e=>{e.preventDefault();d.classList.add('drag')};
  d.ondragleave=()=>d.classList.remove('drag');
  d.ondrop=e=>{e.preventDefault();d.classList.remove('drag');processAccountingFiles(e.dataTransfer.files)};
};
