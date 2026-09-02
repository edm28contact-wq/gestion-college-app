function geminiRetryDelayMs(response,errorText,attempt){
  const retryAfter=Number(response?.headers?.get?.('retry-after')||0);
  if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.min(15000,Math.ceil(retryAfter*1000)+500);
  const match=String(errorText||'').match(/retry\s+in\s+([0-9.]+)s/i);
  if(match){const seconds=Number(match[1]);if(Number.isFinite(seconds)&&seconds>0)return Math.min(15000,Math.ceil(seconds*1000)+500)}
  return Math.min(5000,800*Math.pow(2,Math.max(0,attempt-1)));
}

accountingAiApi=async function(action,method='POST',body,{attempts=1}={}){
  let lastError=null;
  const maxAttempts=Math.max(1,Math.min(action==='reanalyze'?2:2,Number(attempts)||1));
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    let response=null;
    try{
      const u=new URL(ACCOUNTING_AI_BASE);u.searchParams.set('action',action);
      response=await fetch(u.toString(),{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
      const j=await response.json().catch(()=>({error:'Réponse Gemini invalide'}));
      if(response.ok)return j;
      const e=new Error(j.error||`Erreur Gemini HTTP ${response.status}`);e.status=response.status;e.providerCode=j.provider_code||'';
      if(!ACCOUNTING_AI_RETRYABLE.has(response.status)||attempt===maxAttempts)throw e;
      lastError=e;
      if(response.status===504)throw e;
      const delay=geminiRetryDelayMs(response,e.message,attempt);
      if(typeof baseAccountingProg==='function'&&response.status===429)baseAccountingProg(92,`Quota Gemini temporaire · nouvel essai dans ${Math.max(1,Math.ceil(delay/1000))} s…`);
      await sleepAccounting(delay);
    }catch(e){
      lastError=e;const status=Number(e?.status||0);
      if(status===504||attempt===maxAttempts||(status&&!ACCOUNTING_AI_RETRYABLE.has(status)))throw e;
      await sleepAccounting(geminiRetryDelayMs(response,e?.message||'',attempt));
    }
  }
  throw lastError||new Error('Gemini indisponible');
};
