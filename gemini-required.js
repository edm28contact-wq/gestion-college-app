// Garantie transversale : deux lectures Gemini obligatoires avant validation.
// Si Gemini est temporairement indisponible, le navigateur attend puis retente automatiquement.
(()=>{
'use strict';
if(window.__geminiMandatory?.active)return;

const nativeFetch=window.fetch.bind(window);
const VERIFIER='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-pdf-verifier';
const retryStatuses=new Set([429,502,503,504,546]);
const state={secretariatFirst:false,secretariatVerified:false,accountingIds:new Set(),active:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const delayFor=n=>Math.min(30000,[5000,8000,12000,18000,24000,30000][Math.min(n-1,5)]||30000);

function urlOf(input){try{return typeof input==='string'?input:input instanceof URL?input.href:String(input?.url||'')}catch{return ''}}
function tokenValue(){try{if(typeof token!=='undefined'&&token)return token}catch{}return localStorage.getItem('college_accounting_token')||localStorage.getItem('college_secretariat_token')||localStorage.getItem('edm_admin_token')||''}
function message(t){try{if(typeof window.prog==='function')window.prog(86,t)}catch{}const e=document.getElementById('status')||document.getElementById('imsg');if(e&&/Gemini/i.test(t)){e.textContent=t;e.className='status'}}
async function bodyJson(resp){try{return await resp.clone().json()}catch{return {}}}
function geminiProblem(resp,j){const t=String(j?.error||j?.message||'').toLowerCase();return retryStatuses.has(resp.status)||(resp.status>=500&&(t.includes('gemini')||t.includes('délai')||t.includes('delai')||t.includes('timeout')||t.includes('indisponible')||j?.retryable===true))}
function accountingGood(j){return !!(j?.ok&&j?.degraded!==true&&Number(j?.successful_reads)>=2&&Number(j?.required_reads)>=2&&Array.isArray(j?.models)&&j.models.length>=2&&j?.first&&j?.second)}
function readerGood(action,j){if(action==='first')return !!(j?.ok&&j?.stage==='first'&&j?.analysis&&j?.model);if(action==='verify')return !!(j?.ok&&j?.stage==='verified'&&j?.ai?.double_read===true&&j?.ai?.first_model&&j?.ai?.verify_model);return true}
function bodyId(init){try{const b=typeof init?.body==='string'?JSON.parse(init.body):null;return String(b?.id||'')}catch{return ''}}
async function ensureAccountingDoubleRead(id){const key=String(id||'');if(!key||state.accountingIds.has(key))return true;const tk=tokenValue();message('Deux lectures Gemini indépendantes obligatoires avant analyse comptable…');const r=await window.fetch(VERIFIER,{method:'POST',headers:{'content-type':'application/json',...(tk?{authorization:'Bearer '+tk}:{})},body:JSON.stringify({id:key}),cache:'no-store'}),j=await bodyJson(r);if(r.ok&&accountingGood(j)){state.accountingIds.add(key);return true}return false}

window.fetch=async function(input,init){
  const url=urlOf(input),isVerifier=url.includes('/accounting-pdf-verifier'),isReader=url.includes('/accounting-secretariat-reader'),isAccountingAi=url.includes('/accounting-ai');
  let action='';try{action=new URL(url,location.href).searchParams.get('action')||''}catch{}

  if(isAccountingAi&&action==='reanalyze'){
    const id=bodyId(init);
    if(id&&!state.accountingIds.has(id))await ensureAccountingDoubleRead(id);
    return nativeFetch(input,init)
  }
  if(!isVerifier&&!isReader)return nativeFetch(input,init);
  if(isReader&&action==='first'){state.secretariatFirst=false;state.secretariatVerified=false}

  let attempt=0;
  for(;;){
    attempt++;
    try{
      const resp=await nativeFetch(input,init),j=await bodyJson(resp);
      if(isVerifier){
        if(resp.ok&&accountingGood(j)){const id=bodyId(init);if(id)state.accountingIds.add(id);message('Deux lectures Gemini indépendantes terminées.');return resp}
        if(!resp.ok&&!geminiProblem(resp,j))return resp;
      }else{
        if(resp.ok&&readerGood(action,j)){if(action==='first')state.secretariatFirst=true;if(action==='verify')state.secretariatVerified=true;return resp}
        if(resp.ok)return resp;
        if(!geminiProblem(resp,j))return resp;
      }
    }catch(e){console.warn('Lecture Gemini temporairement indisponible',e)}
    const d=delayFor(attempt);
    message(`Gemini obligatoire : tentative ${attempt} indisponible. Nouvelle tentative dans ${Math.round(d/1000)} s. Validation bloquée.`);
    await sleep(d)
  }
};

function errorBox(t){const e=document.getElementById('saveStatus')||document.getElementById('rmsg')||document.getElementById('status');if(e){e.textContent=t;e.className='status err'}else alert(t)}
function installGuards(){
  const p=location.pathname;
  if(p.includes('/comptabilite/')){
    const f=window.validateInvoice;
    if(typeof f==='function'&&!f.__geminiMandatoryWrapped){
      const w=async function(id,...args){const key=String(id||'');if(key&&!state.accountingIds.has(key)){const ok=await ensureAccountingDoubleRead(key);if(!ok){errorBox('Validation impossible : deux lectures Gemini sont obligatoires.');return}}return f.call(this,id,...args)};
      w.__geminiMandatoryWrapped=true;
      window.validateInvoice=w
    }
  }
  if(p.includes('/secretariat/factures/')){
    const f=window.validateInvoice;
    if(typeof f==='function'&&!f.__geminiMandatoryWrapped){
      const w=async function(...args){if(!state.secretariatVerified){errorBox('Validation impossible : les deux lectures Gemini obligatoires ne sont pas terminées.');return}return f.apply(this,args)};
      w.__geminiMandatoryWrapped=true;
      window.validateInvoice=w
    }
    const r=window.resetReview;
    if(typeof r==='function'&&!r.__geminiMandatoryWrapped){
      const w=function(...args){state.secretariatFirst=false;state.secretariatVerified=false;return r.apply(this,args)};
      w.__geminiMandatoryWrapped=true;
      window.resetReview=w
    }
  }
}

let guardRounds=0;
const guardTimer=setInterval(()=>{installGuards();if(++guardRounds>120)clearInterval(guardTimer)},100);
installGuards();
window.__geminiMandatory=state;
})();
