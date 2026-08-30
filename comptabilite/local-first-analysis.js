const ACCOUNTING_LOCAL_ANALYZE_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-local-analyze';

async function accountingLocalAnalyze(id){
  const r=await fetch(ACCOUNTING_LOCAL_ANALYZE_BASE,{
    method:'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify({id}),
    cache:'no-store'
  });
  const j=await r.json().catch(()=>({error:'Réponse analyse locale invalide'}));
  if(!r.ok)throw new Error(j.error||`Erreur analyse locale HTTP ${r.status}`);
  return j;
}

const previousProcessSingleAccountingFile=processSingleAccountingFile;
processSingleAccountingFile=async function(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);

  prog(2,'Préparation du PDF…');
  const t=await textPdf(file),f=new FormData();
  f.append('file',file);f.append('raw_text',t||'');f.append('supplier','');f.append('invoice_number','');f.append('invoice_date','');f.append('amount_ht','');f.append('amount_vat','');f.append('amount_ttc','');f.append('vat_rate','');
  prog(82,'Enregistrement sécurisé…');
  const r=await api('upload','POST',f,true),j=await r.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!r.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');

  const id=j.item.id;
  let analysis=null,analysisError='';
  try{
    prog(88,'Analyse locale vérifiée…');
    const local=await accountingLocalAnalyze(id);
    if(local?.handled&&local?.auto_validated){
      analysis=local;
    }else{
      prog(92,'Document ambigu · Gemini en secours…');
      try{analysis=await accountingAiApi('reanalyze','POST',{id},{attempts:2})}
      catch(e){analysisError=e?.message||String(e);console.warn('Analyse Gemini de secours impossible',e)}
    }
  }catch(e){
    analysisError=e?.message||String(e);
    console.warn('Analyse locale impossible',e);
    try{
      prog(92,'Analyse locale indisponible · Gemini en secours…');
      analysis=await accountingAiApi('reanalyze','POST',{id},{attempts:2});
      analysisError='';
    }catch(ge){analysisError=ge?.message||String(ge);console.warn('Analyse Gemini de secours impossible',ge)}
  }

  if(refreshAfter){await refresh();page='dashboard';render()}
  if(openReview&&!analysis?.auto_validated){
    if(analysisError)alert(`Le PDF a bien été importé. L’analyse automatique n’a pas pu terminer : ${analysisError}. La facture reste à contrôler.`);
    review(id);
  }
  return {id,autoValidated:!!analysis?.auto_validated,aiError:analysisError,warnings:analysis?.auto_validation?.warnings||[],source:analysis?.source||analysis?.ai?.provider||'unknown'};
};

const previousImportPageLocalFirst=importPage;
importPage=function(){
  previousImportPageLocalFirst();
  const card=$('content')?.querySelector('.card');
  const p=card?.querySelector('p.muted');
  if(p)p.innerHTML=`Jusqu’à <b>${ACCOUNTING_MAX_FILES} PDF</b>. Le PDF est d’abord analysé localement à partir du texte extrait et des profils fournisseurs historiques. Si fournisseur, numéro, date, HT, TVA, TTC, taux et règle comptable concordent, la facture est validée sans consommer Gemini. <b>Gemini n’est utilisé qu’en secours pour les documents ambigus.</b>`;
};

const previousLoadLocalFirst=load;
load=async function(){
  await previousLoadLocalFirst();
  if($('who'))$('who').textContent=(db.current_user.display_name||'Comptabilité')+' · analyse locale vérifiée · Gemini seulement en secours';
};
