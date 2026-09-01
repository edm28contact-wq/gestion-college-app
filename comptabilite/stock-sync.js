(()=>{
'use strict';
const STOCK_READER='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-secretariat-reader';
const STOCK_SYNC='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-stock-sync';
async function reader(action,file,raw,previous=null,firstModel=''){
  const f=new FormData();f.append('file',file);f.append('raw_text',raw||'');
  if(previous)f.append('previous',JSON.stringify(previous));
  if(firstModel)f.append('first_model',firstModel);
  const r=await fetch(STOCK_READER+'?action='+encodeURIComponent(action),{method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{})},body:f,cache:'no-store'});
  const j=await r.json().catch(()=>({error:'Réponse lecteur stock invalide'}));
  if(!r.ok)throw new Error(j.error||`Lecture stock HTTP ${r.status}`);
  return j;
}
async function applyStock(id,verified){
  const r=await fetch(STOCK_SYNC,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({id,supplier:verified.supplier||'',invoice_number:verified.invoice_number||'',invoice_date:verified.invoice_date||'',items:verified.items||[]}),cache:'no-store'});
  const j=await r.json().catch(()=>({error:'Réponse synchronisation stock invalide'}));
  if(!r.ok)throw new Error(j.error||`Synchronisation stock HTTP ${r.status}`);
  return j;
}
const base=processSingleAccountingFile;
processSingleAccountingFile=async function(file,options={}){
  const result=await base(file,options);
  try{
    prog(96,'Reconnaissance des produits pour le stock…');
    const raw=await textPdf(file);
    const first=await reader('first',file,raw);
    prog(98,'Vérification des quantités stock…');
    const verified=await reader('verify',file,raw,first.analysis||{},first.model||'');
    if(!Array.isArray(verified.items)||!verified.items.length){
      result.stockSync={applied:false,recognized:false,item_count:0,warnings:verified.warnings||[]};
      prog(100,'Facture enregistrée · aucun produit stock reconnu');
      return result;
    }
    const sync=await applyStock(result.id,verified);
    result.stockSync={...sync,recognized:true,warnings:verified.warnings||[]};
    if(sync.sandbox)prog(100,`Mode test · ${verified.items.length} produit(s) reconnu(s), stock réel inchangé`);
    else if(sync.already_synced)prog(100,`Stock déjà comptabilisé · aucun doublon (${verified.items.length} produit(s))`);
    else prog(100,`Stock mis à jour · ${verified.items.length} produit(s)`);
  }catch(e){
    result.stockSync={applied:false,error:e?.message||String(e)};
    console.warn('Synchronisation automatique du stock impossible',e);
    prog(100,'Facture enregistrée · synchronisation stock à contrôler');
  }
  return result;
};
})();
