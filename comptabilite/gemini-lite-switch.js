const ACCOUNTING_AI_LITE_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-ai-lite';

accountingAiApi=async function(action,method='POST',body){
  const u=new URL(ACCOUNTING_AI_LITE_BASE);
  u.searchParams.set('action',action);
  const r=await fetch(u.toString(),{
    method,
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body?JSON.stringify(body):undefined,
    cache:'no-store'
  });
  const j=await r.json().catch(()=>({error:'Réponse Gemini invalide'}));
  if(!r.ok){
    const e=new Error(j.error||`Erreur Gemini HTTP ${r.status}`);
    e.status=r.status;
    e.providerCode=j.provider_code||'';
    e.model=j.model||'';
    throw e;
  }
  return j;
};

ensureAccountingAiReady=async function(){
  const h=await accountingAiApi('health','GET');
  if(!h?.ok)throw new Error('Le test Gemini a échoué.');
  return h;
};

const previousTestGeminiLite=testGeminiAccounting;
testGeminiAccounting=async function(){
  try{
    const btn=$('testGemini');if(btn)btn.disabled=true;
    baseAccountingProg(5,'Test Gemini Flash-Lite…');
    const h=await ensureAccountingAiReady();
    const fallback=Array.isArray(h.fallbacks_used)&&h.fallbacks_used.length?` · secours utilisés : ${h.fallbacks_used.map(x=>x.model).join(', ')}`:'';
    alert(`Gemini fonctionne. Modèle actif : ${h.primary_model||'Flash-Lite'}${fallback}`);
  }catch(e){
    alert(e?.message||String(e));
  }finally{
    const btn=$('testGemini');if(btn)btn.disabled=false;
    baseAccountingProg(0,'');
  }
};

loadGeminiConfig=async function(){
  const box=$('geminiConfigState');if(!box)return;
  try{
    const c=await accountingAiApi('gemini-config','GET');
    box.className='status '+(c.configured?'ok':'err');
    box.textContent=c.configured
      ?`Gemini configuré · modèle principal : ${c.model} · secours : ${(c.fallback_models||[]).join(' → ')}`
      :'Gemini n’est pas encore configuré.';
  }catch(e){
    box.className='status err';
    box.textContent=e?.message||String(e);
  }
};
