// Fiabilite PDF Comptabilite : le moteur IA relit le PDF original, pas seulement le texte OCR.
(()=>{
'use strict';
if(typeof processSingleAccountingFile!=='function')return;
processSingleAccountingFile=async function(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);
  prog(2,'Préparation du PDF original…');
  // Le texte navigateur reste utile pour l'affichage local, mais il n'est plus utilisé comme source principale IA.
  // Une raw_text vide force accounting-ai à télécharger et analyser le PDF original stocké dans Supabase.
  const f=new FormData();
  f.append('file',file);
  f.append('raw_text','');
  f.append('supplier','');f.append('invoice_number','');f.append('invoice_date','');
  f.append('amount_ht','');f.append('amount_vat','');f.append('amount_ttc','');f.append('vat_rate','');
  prog(62,'Enregistrement sécurisé du PDF…');
  const r=await api('upload','POST',f,true),j=await r.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!r.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');
  const id=j.item.id;prog(78,'Analyse visuelle du PDF original par Gemini…');let ai=null,aiError='';
  try{ai=await accountingAiApi('reanalyze','POST',{id},{attempts:2})}catch(e){aiError=e?.message||String(e);console.warn('Analyse PDF Gemini impossible',e)}
  if(refreshAfter){await refresh();page='dashboard';render()}
  if(openReview&&!ai?.auto_validated){if(aiError)alert(`Le PDF a bien été importé. L’analyse renforcée n’a pas pu se terminer : ${aiError}. La facture reste à contrôler.`);review(id)}
  return {id,autoValidated:!!ai?.auto_validated,aiError,warnings:ai?.auto_validation?.warnings||[]};
};
})();
