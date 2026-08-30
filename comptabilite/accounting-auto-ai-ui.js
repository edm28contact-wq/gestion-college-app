const ACCOUNTING_AI_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-ai';

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

processFile=async function(file){
  if(!file||file.type!=='application/pdf'){alert('PDF requis.');return}
  try{
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
    let ai=null;
    try{ai=await accountingAiApi('reanalyze','POST',{id})}catch(e){console.warn('Analyse IA automatique impossible',e)}
    await refresh();
    page='dashboard';
    render();
    if(ai?.auto_validated){
      return;
    }
    if(!ai){alert('La facture a bien été enregistrée, mais l’analyse IA automatique n’a pas abouti. Elle reste à contrôler.');}
    review(id);
  }catch(e){
    const m=$('imsg');
    if(m){m.className='status err';m.textContent=e.message}
    else alert(e.message||String(e));
  }
};
