(()=>{
  const MODE_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/system-mode';
  const originalFetch=window.fetch.bind(window);
  const state={active:false,reason:'',started_at:null,loaded:false};
  window.GestionCollegeTestMode=state;
  function banner(){
    let el=document.getElementById('globalTestModeBanner');
    if(!state.active){if(el)el.remove();document.documentElement.classList.remove('global-test-mode');return}
    if(!el){el=document.createElement('div');el.id='globalTestModeBanner';el.style.cssText='position:sticky;top:0;z-index:100000;background:#8a1c1c;color:#fff;padding:10px 14px;text-align:center;font:700 14px system-ui,Arial;box-shadow:0 2px 8px #0003';document.body.prepend(el)}
    el.textContent='MODE TEST ACTIF — production protégée — seules les données BAC À SABLE peuvent être modifiées';
    document.documentElement.classList.add('global-test-mode');
  }
  function isAllowedWrite(url){
    const s=String(url||'');
    if(s.includes('/system-mode')&&s.includes('action=set'))return true;
    if(s.includes('/sandbox-api'))return true;
    if(s.includes('/secretariat-account-api'))return true;
    const a=(()=>{try{return new URL(s,location.href).searchParams.get('action')||''}catch{return ''}})();
    return ['login','change-password','setup-account','suggest'].includes(a);
  }
  window.fetch=async function(input,init={}){
    const method=String(init?.method||((input&&input.method)||'GET')).toUpperCase();
    const url=typeof input==='string'?input:(input?.url||'');
    if(state.active&&!['GET','HEAD','OPTIONS'].includes(method)&&!isAllowedWrite(url)){
      const payload={error:'MODE TEST ACTIF : écriture de production bloquée. Utilise le BAC À SABLE pour les essais.',test_mode:true};
      return new Response(JSON.stringify(payload),{status:409,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    return originalFetch(input,init);
  };
  async function refreshMode(){
    try{const r=await originalFetch(MODE_API+'?action=status',{cache:'no-store'}),j=await r.json();state.active=!!j.test_mode;state.reason='';state.started_at=j.started_at||null;state.loaded=true;banner();window.dispatchEvent(new CustomEvent('gestion-college-test-mode',{detail:{...state}}))}catch(e){console.warn('Mode test indisponible',e)}
  }
  window.refreshGestionCollegeTestMode=refreshMode;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshMode);else refreshMode();
  setInterval(refreshMode,30000);
})();
