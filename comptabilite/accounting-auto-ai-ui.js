const ACCOUNTING_AI_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-ai';
const ACCOUNTING_MAX_FILES=400;
const ACCOUNTING_MAX_FILE_BYTES=20*1024*1024;

async function accountingAiApi(action,method='POST',body){
  const u=new URL(ACCOUNTING_AI_BASE);
  u.searchParams.set('action',action);
  const r=await fetch(u.toString(),{
    method,
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body?JSON.stringify(body):undefined,
    cache:'no-store'
  });
  const j=await r.json().catch(()=>({error:'Réponse IA invalide'}));
  if(!r.ok)throw new Error(j.error||'Erreur IA');
  return j;
}

const loadBeforeAutoAi=load;
load=async function(){
  await loadBeforeAutoAi();
  if($('who'))$('who').textContent=(db.current_user.display_name||'Comptabilité')+' · validation automatique si fiable, sinon contrôle humain';
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
  if(!file||file.type!=='application/pdf')throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);
  prog(2,'Préparation…');
  const t=await textPdf(file),a=amounts(t),f=new FormData();
  f.append('file',file);
  f.append('raw_text',t);
  f.append('supplier',supplier(t));
  f.append('invoice_number',invNo(t));
  f.append('invoice_date',invDate(t));
  f.append('amount_ht',a.ht??'');
  f.append('amount_vat',a.vat??'');
  f.append('amount_ttc',a.ttc??'');
  f.append('vat_rate',a.rate??'');
  prog(82,'Enregistrement…');
  const r=await api('upload','POST',f,true),j=await r.json();
  const id=j.item.id;
  prog(91,'Analyse IA et contrôles de fiabilité…');
  let ai=null,aiError='';
  try{ai=await accountingAiApi('reanalyze','POST',{id})}catch(e){aiError=e?.message||String(e);console.warn('Analyse IA automatique impossible',e)}
  if(refreshAfter){
    await refresh();
    page='dashboard';
    render();
  }
  if(openReview&&!ai?.auto_validated){
    if(aiError)alert('La facture a bien été enregistrée, mais l’analyse IA automatique n’a pas abouti. Elle reste à contrôler.');
    review(id);
  }
  return {id,autoValidated:!!ai?.auto_validated,aiError};
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
  if(pdfs.length!==files.length){alert('Seuls les fichiers PDF seront traités.');}
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
      if(res.aiError)errors.push(`${file.name} : analyse IA non aboutie`);
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
  alert(`Import terminé : ${ok} facture(s) enregistrée(s), ${validated} validée(s) automatiquement, ${toReview} à contrôler, ${failed} échec(s).${detail}`);
}

importPage=function(){
  $('content').innerHTML=`<div class="card"><h2>Importer des factures PDF</h2><p class="muted">Tu peux déposer jusqu’à <b>${ACCOUNTING_MAX_FILES} factures PDF à la fois</b>. Chaque fichier reste limité à 20 Mo. Les factures sont traitées une par une pour éviter de saturer le navigateur.</p><div id="drop" class="drop"><b>Déposer jusqu’à ${ACCOUNTING_MAX_FILES} PDF ici</b><br><span class="muted">Sélection multiple autorisée · 20 Mo maximum par fichier</span><input id="file" class="hide" type="file" accept="application/pdf" multiple></div><br><progress id="prog" class="hide" max="100" value="0" style="width:100%"></progress><div id="imsg" class="status"></div></div>`;
  const d=$('drop'),f=$('file');
  d.onclick=()=>f.click();
  f.onchange=()=>processAccountingFiles(f.files);
  d.ondragover=e=>{e.preventDefault();d.classList.add('drag')};
  d.ondragleave=()=>d.classList.remove('drag');
  d.ondrop=e=>{e.preventDefault();d.classList.remove('drag');processAccountingFiles(e.dataTransfer.files)};
};
