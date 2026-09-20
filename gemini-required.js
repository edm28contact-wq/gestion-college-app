// Deux lectures Gemini obligatoires, avec troisième lecture automatique de départage si nécessaire.
// Les erreurs temporaires sont retentées; les erreurs de configuration bloquent clairement le traitement.
(()=>{
'use strict';
if(window.__geminiMandatory?.active)return;

const nativeFetch=window.fetch.bind(window);
const VERIFIER='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-pdf-verifier';
const retryStatuses=new Set([429,502,503,504,546]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state={secretariatFirst:false,secretariatVerified:false,accounting:new Map(),active:true};

function urlOf(input){try{return typeof input==='string'?input:input instanceof URL?input.href:String(input?.url||'')}catch{return ''}}
function tokenValue(){try{if(typeof token!=='undefined'&&token)return token}catch{}return localStorage.getItem('college_accounting_token')||localStorage.getItem('college_secretariat_token')||localStorage.getItem('edm_admin_token')||''}
function message(t,err=false){try{if(typeof window.prog==='function')window.prog(86,t)}catch{}const e=document.getElementById('status')||document.getElementById('imsg');if(e){e.textContent=t;e.className='status '+(err?'err':'')}}
async function bodyJson(resp){try{return await resp.clone().json()}catch{return {}}}
function bodyId(init){try{const b=typeof init?.body==='string'?JSON.parse(init.body):null;return String(b?.id||'')}catch{return ''}}
function retryDelay(j,attempt){const server=Math.max(0,Number(j?.retry_after_sec||0))*1000;if(server)return Math.min(120000,server+1000);return Math.min(30000,[5000,8000,12000,18000,24000,30000][Math.min(attempt-1,5)]||30000)}
function permanent(j,status){const t=String(j?.error||'').toLowerCase();return j?.configuration_required===true||t.includes('configuration_required')||t.includes('non configur')||t.includes('clé gemini refus')||status===401||status===403||(status===400&&j?.retryable!==true)}
function temporary(j,status){return j?.retryable===true||retryStatuses.has(status)||status>=500}
function readerGood(action,j){if(action==='first')return !!(j?.ok&&j?.stage==='first'&&j?.analysis&&j?.model);if(action==='verify')return !!(j?.ok&&j?.stage==='verified'&&j?.ai?.double_read===true&&j?.ai?.first_model&&j?.ai?.verify_model);return true}
function accountingGood(j){return !!(j?.ok&&j?.successful_reads>=2&&j?.required_reads>=2&&j?.consensus&&Array.isArray(j?.models)&&j.models.length>=2)}

async function verifierCall(action,body){
  const tk=tokenValue();
  const r=await nativeFetch(VERIFIER+'?action='+encodeURIComponent(action),{method:'POST',headers:{'content-type':'application/json',...(tk?{authorization:'Bearer '+tk}:{})},body:JSON.stringify(body),cache:'no-store'});
  return {r,j:await bodyJson(r)}
}
async function readAccounting(id,readNo){
  let attempt=0;
  for(;;){
    attempt++;
    try{
      message(readNo===3?`Lecture Gemini 3/3 de départage · tentative ${attempt}…`:`Lecture Gemini ${readNo}/2 obligatoire · tentative ${attempt}…`);
      const {r,j}=await verifierCall('read',{id,read_no:readNo});
      if(r.ok&&j?.ok&&j?.analysis&&j?.model)return j;
      if(permanent(j,r.status)){message(j?.error||'Gemini non configuré.',true);throw new Error(j?.error||'Gemini non configuré.')}
      if(!temporary(j,r.status))throw new Error(j?.error||`Lecture Gemini ${readNo} impossible`);
      const d=retryDelay(j,attempt);message(`Gemini temporairement indisponible. Nouvelle tentative de la lecture ${readNo===3?'3/3':readNo+'/2'} dans ${Math.round(d/1000)} s.`);await sleep(d)
    }catch(e){
      if(/non configur|clé gemini refus|configuration_required/i.test(String(e?.message||e)))throw e;
      const d=retryDelay({},attempt);message(`Connexion Gemini indisponible. Nouvelle tentative de la lecture ${readNo===3?'3/3':readNo+'/2'} dans ${Math.round(d/1000)} s.`);await sleep(d)
    }
  }
}
async function ensureAccountingDoubleRead(id){
  const key=String(id||'');if(!key)throw new Error('Facture manquante');
  if(state.accounting.has(key))return state.accounting.get(key);
  const first=await readAccounting(key,1);
  const second=await readAccounting(key,2);
  message('Comparaison des deux lectures Gemini…');
  let compared=await verifierCall('compare',{id:key,first:first.analysis,second:second.analysis,first_model:first.model,second_model:second.model});
  if(!compared.r.ok)throw new Error(compared.j?.error||'Comparaison Gemini impossible');
  if(compared.j?.requires_third_read===true){
    message('Écart détecté : troisième lecture Gemini indépendante de départage…');
    const third=await readAccounting(key,3);
    compared=await verifierCall('compare',{id:key,first:first.analysis,second:second.analysis,third:third.analysis,first_model:first.model,second_model:second.model,third_model:third.model});
  }
  const {r,j}=compared;
  if(!r.ok||!accountingGood(j))throw new Error(j?.error||'Comparaison Gemini impossible');
  state.accounting.set(key,j);
  message(j?.tie_break_used?'Trois lectures Gemini terminées · vote 2 sur 3 appliqué.':'Deux lectures Gemini indépendantes concordantes.');
  return j
}

window.fetch=async function(input,init){
  const url=urlOf(input),isReader=url.includes('/accounting-secretariat-reader'),isAccountingAi=url.includes('/accounting-ai');
  let action='';try{action=new URL(url,location.href).searchParams.get('action')||''}catch{}

  if(isAccountingAi&&action==='reanalyze'){
    const id=bodyId(init),verified=id?await ensureAccountingDoubleRead(id):null;
    let b={};try{b=typeof init?.body==='string'?JSON.parse(init.body):{}}catch{}
    const next={...(init||{}),body:JSON.stringify({...b,gemini_double_read:true,consensus:verified?.consensus||null})};
    return nativeFetch(input,next)
  }

  if(!isReader)return nativeFetch(input,init);
  if(action==='first'){state.secretariatFirst=false;state.secretariatVerified=false}
  let attempt=0;
  for(;;){
    attempt++;
    try{
      const resp=await nativeFetch(input,init),j=await bodyJson(resp);
      if(resp.ok&&readerGood(action,j)){
        if(action==='first')state.secretariatFirst=true;
        if(action==='verify')state.secretariatVerified=true;
        return resp
      }
      if(resp.ok)return resp;
      if(permanent(j,resp.status)){message(j?.error||'Gemini non configuré.',true);return resp}
      if(!temporary(j,resp.status))return resp;
      const d=retryDelay(j,attempt);message(`Gemini obligatoire · ${action==='verify'?'lecture 2/2':'lecture 1/2'} indisponible. Nouvelle tentative dans ${Math.round(d/1000)} s.`);await sleep(d)
    }catch(e){
      const m=String(e?.message||e);
      if(/non configur|clé gemini refus|configuration_required/i.test(m))throw e;
      const d=retryDelay({},attempt);message(`Gemini obligatoire · connexion indisponible. Nouvelle tentative dans ${Math.round(d/1000)} s.`);await sleep(d)
    }
  }
};

function errorBox(t){const e=document.getElementById('saveStatus')||document.getElementById('rmsg')||document.getElementById('status');if(e){e.textContent=t;e.className='status err'}else alert(t)}
function installGuards(){
  const p=location.pathname;
  if(p.includes('/comptabilite/')){
    const f=window.validateInvoice;
    if(typeof f==='function'&&!f.__geminiMandatoryWrapped){
      const w=async function(id,...args){try{if(id)await ensureAccountingDoubleRead(id)}catch(e){errorBox(e?.message||String(e));return}return f.call(this,id,...args)};
      w.__geminiMandatoryWrapped=true;window.validateInvoice=w
    }
  }
  if(p.includes('/secretariat/factures/')){
    const f=window.validateInvoice;
    if(typeof f==='function'&&!f.__geminiMandatoryWrapped){
      const w=async function(...args){if(!state.secretariatVerified){errorBox('Validation impossible : les deux lectures Gemini obligatoires ne sont pas terminées.');return}return f.apply(this,args)};
      w.__geminiMandatoryWrapped=true;window.validateInvoice=w
    }
    const r=window.resetReview;
    if(typeof r==='function'&&!r.__geminiMandatoryWrapped){
      const w=function(...args){state.secretariatFirst=false;state.secretariatVerified=false;return r.apply(this,args)};
      w.__geminiMandatoryWrapped=true;window.resetReview=w
    }
  }
}
let rounds=0;const timer=setInterval(()=>{installGuards();if(++rounds>120)clearInterval(timer)},100);installGuards();
window.__geminiMandatory={...state,ensureAccountingDoubleRead,getAccountingResult:id=>state.accounting.get(String(id||''))||null};
})();