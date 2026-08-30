const ACCOUNTING_GEMINI_CONFIG_BASE='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-gemini-config';

async function accountingGeminiConfigApi(method='GET',body){
  const r=await fetch(ACCOUNTING_GEMINI_CONFIG_BASE,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const j=await r.json().catch(()=>({error:'Réponse de configuration Gemini invalide'}));
  if(!r.ok)throw new Error(j.error||`Erreur configuration Gemini HTTP ${r.status}`);
  return j;
}

window.saveGeminiAccountingKey=async function(){
  const input=$('geminiKey'),msg=$('geminiKeyMsg'),btn=$('saveGeminiKey');
  const apiKey=String(input?.value||'').trim();
  if(apiKey.length<20){if(msg){msg.className='status err';msg.textContent='Entre la clé Gemini complète.'}return}
  try{
    if(btn)btn.disabled=true;
    if(msg){msg.className='status';msg.textContent='Enregistrement chiffré de la clé dans Supabase Vault…'}
    await accountingGeminiConfigApi('POST',{api_key:apiKey});
    if(input)input.value='';
    if(msg){msg.className='status ok';msg.textContent='Clé Gemini enregistrée dans Supabase Vault. Le quota Google sera testé séparément.'}
    await loadGeminiConfig();
  }catch(e){
    if(msg){msg.className='status err';msg.textContent=e?.message||String(e)}
  }finally{
    if(btn)btn.disabled=false;
  }
};

const previousGeminiSettingsPage=settingsPage;
settingsPage=function(){
  previousGeminiSettingsPage();
  const btn=$('saveGeminiKey');
  if(btn)btn.textContent='Enregistrer la clé';
  const msg=$('geminiKeyMsg');
  if(msg&&!msg.textContent)msg.textContent='Enregistre d’abord la clé. Utilise ensuite “Tester la clé enregistrée”. Un quota 429 n’effacera plus la clé.';
};
