const ACCOUNTING_LOCAL_PDF_TIMEOUT_MS=12000;

async function waitForAccountingPdfJs(timeoutMs=4000){
  const start=Date.now();
  while(!window.pdfjsLib&&Date.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,100));
  return window.pdfjsLib||null;
}

async function extractAccountingPdfTextFast(file){
  const lib=await waitForAccountingPdfJs();
  if(!lib)return '';
  const work=(async()=>{
    const pdf=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    let text='';
    const pages=Math.min(pdf.numPages,20);
    for(let n=1;n<=pages;n++){
      const p=await pdf.getPage(n);
      const c=await p.getTextContent();
      text+=c.items.map(x=>x.str).join(' ')+'\n';
      if(typeof prog==='function')prog(4+Math.round(42*n/pages),`Lecture PDF ${n}/${pages}…`);
    }
    return text.trim();
  })();
  const timeout=new Promise(resolve=>setTimeout(()=>resolve(''),ACCOUNTING_LOCAL_PDF_TIMEOUT_MS));
  try{return String(await Promise.race([work,timeout])||'')}catch(e){console.warn('Lecture locale PDF ignorée',e);return ''}
}

processSingleAccountingFile=async function(file,{openReview=false,refreshAfter=false}={}){
  if(!file||(file.type!=='application/pdf'&&!String(file.name||'').toLowerCase().endsWith('.pdf')))throw new Error(`${file?.name||'Fichier'} : PDF requis.`);
  if(file.size>ACCOUNTING_MAX_FILE_BYTES)throw new Error(`${file.name} : dépasse 20 Mo.`);

  prog(2,'Lecture rapide du PDF…');
  const extractedText=await extractAccountingPdfTextFast(file);

  const f=new FormData();
  f.append('file',file);
  f.append('raw_text',extractedText);
  f.append('supplier','');
  f.append('invoice_number','');
  f.append('invoice_date','');
  f.append('amount_ht','');
  f.append('amount_vat','');
  f.append('amount_ttc','');
  f.append('vat_rate','');

  prog(55,extractedText?'Texte PDF lu · enregistrement…':'Lecture locale indisponible · envoi du PDF original…');
  const r=await api('upload','POST',f,true);
  const j=await r.json().catch(()=>({error:'Réponse d’import invalide'}));
  if(!r.ok||!j?.item?.id)throw new Error(j?.error||'Impossible d’enregistrer la facture');

  const id=j.item.id;
  prog(72,extractedText?'Gemini analyse le texte du PDF…':'Gemini lit directement le PDF original…');
  let ai=null,aiError='';
  try{
    ai=await accountingAiApi('reanalyze','POST',{id},{attempts:1});
  }catch(e){
    aiError=e?.message||String(e);
    console.warn('Analyse Gemini impossible',e);
  }

  if(refreshAfter){await refresh();page='dashboard';render()}
  if(openReview){
    if(aiError)alert(`Le PDF est bien enregistré. L’analyse Gemini n’a pas terminé : ${aiError}. La facture reste À contrôler.`);
    review(id);
  }
  return {id,autoValidated:false,aiError,warnings:ai?.auto_validation?.warnings||[],localTextChars:extractedText.length};
};
