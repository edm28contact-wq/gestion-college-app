(()=>{
  const ROOT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/';
  const MODE_API=ROOT+'system-mode';
  const ROUTER=ROOT+'sandbox-router';
  const originalFetch=window.fetch.bind(window);
  const state={active:false,reason:'',started_at:null,loaded:false};
  window.GestionCollegeTestMode=state;
  let readyResolve;
  const ready=new Promise(r=>{readyResolve=r});

  function banner(){
    let el=document.getElementById('globalTestModeBanner');
    if(!state.active){if(el)el.remove();document.documentElement.classList.remove('global-test-mode');return}
    if(!el){el=document.createElement('div');el.id='globalTestModeBanner';el.style.cssText='position:sticky;top:0;z-index:100000;background:#8a1c1c;color:#fff;padding:10px 14px;text-align:center;font:800 14px system-ui,Arial;box-shadow:0 2px 8px #0003';document.body.prepend(el)}
    el.textContent='BAC À SABLE ACTIF — vous utilisez les écrans habituels avec des données de test — production protégée';
    document.documentElement.classList.add('global-test-mode');
  }

  function routeSandbox(raw){
    let u;try{u=new URL(String(raw),location.href)}catch{return null}
    if(u.origin!=='https://zreegtzfpwrjgdhhunxx.supabase.co'||!u.pathname.includes('/functions/v1/'))return null;
    const slug=u.pathname.split('/').pop()||'',action=u.searchParams.get('action')||'';
    if(['system-mode','sandbox-router','sandbox-api','sandbox-generator','sandbox-accounting-journey','accounting-ai','secretariat-account-api'].includes(slug))return null;
    if(slug==='admin-api'&&['login','change-password'].includes(action))return null;
    if(slug==='accounting-api'&&['login','change-password','setup-account'].includes(action))return null;
    if(slug==='invoice-api'&&action==='suggest')return null;
    let target='';
    if(slug==='app-api')target='app';
    else if(slug==='admin-api')target='admin';
    else if(slug==='site-admin-api')target='site-admin';
    else if(slug==='invoice-api')target='invoice';
    else if(slug==='accounting-api')target='accounting';
    else if(slug==='accounting-rules'||slug==='admin-accounting-rules')target='rules';
    else if(slug==='accounting-control')target='control';
    else if(slug==='accounting-batch-export')target='batch-export';
    else if(slug==='accounting-actions'&&action==='export-batch')target='batch-export';
    else return null;
    const r=new URL(ROUTER);r.searchParams.set('target',target);if(action)r.searchParams.set('action',action);
    for(const [k,v] of u.searchParams.entries())if(k!=='action')r.searchParams.append(k,v);
    return r.toString();
  }

  function isAllowedPassThroughWrite(raw){
    let u;try{u=new URL(String(raw),location.href)}catch{return false}
    if(u.origin!=='https://zreegtzfpwrjgdhhunxx.supabase.co'||!u.pathname.includes('/functions/v1/'))return false;
    const slug=u.pathname.split('/').pop()||'',action=u.searchParams.get('action')||'';
    if(slug==='admin-api'&&['login','change-password'].includes(action))return true;
    if(slug==='accounting-api'&&['login','change-password','setup-account'].includes(action))return true;
    if(slug==='secretariat-account-api')return true;
    return false;
  }

  window.fetch=async function(input,init={}){
    const originalUrl=typeof input==='string'?input:(input?.url||'');
    if(String(originalUrl).includes('/system-mode'))return originalFetch(input,init);
    if(!state.loaded)await ready;
    if(state.active){
      const routed=routeSandbox(originalUrl);
      if(routed){const next=typeof input==='string'?routed:new Request(routed,input);return originalFetch(next,init)}
      const method=String(init?.method||((input&&input.method)||'GET')).toUpperCase(),s=String(originalUrl||'');
      const allowedTestWrite=['/sandbox-generator','/sandbox-accounting-journey','/accounting-ai'].some(x=>s.includes(x))||isAllowedPassThroughWrite(originalUrl);
      if(!['GET','HEAD','OPTIONS'].includes(method)&&s.includes('zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/')&&!allowedTestWrite){
        let allowReadPost=false;try{const u=new URL(s);allowReadPost=u.pathname.endsWith('/invoice-api')&&u.searchParams.get('action')==='suggest'}catch{}
        if(!allowReadPost)return new Response(JSON.stringify({error:'BAC À SABLE ACTIF : cette opération n’a pas encore de route de test et la production a été bloquée par sécurité.',test_mode:true}),{status:409,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
      }
    }
    return originalFetch(input,init);
  };

  async function registerSandboxWorker(){
    if(!('serviceWorker' in navigator))return;
    try{await navigator.serviceWorker.register('/gestion-college-app/sandbox-sw.js?v=2',{scope:'/gestion-college-app/'});await navigator.serviceWorker.ready}catch(e){console.warn('Routeur bac à sable navigateur indisponible',e)}
  }

  async function refreshMode(){
    const wasLoaded=state.loaded,old=state.active;
    try{
      const r=await originalFetch(MODE_API+'?action=status',{cache:'no-store'}),j=await r.json();
      state.active=!!j.test_mode;state.reason='';state.started_at=j.started_at||null;state.loaded=true;banner();
      if(readyResolve){readyResolve();readyResolve=null}
      window.dispatchEvent(new CustomEvent('gestion-college-test-mode',{detail:{...state}}));
      const bootKey='college_sandbox_boot';
      if(state.active&&!sessionStorage.getItem(bootKey)){sessionStorage.setItem(bootKey,'1');setTimeout(()=>location.reload(),150);return}
      if(!state.active)sessionStorage.removeItem(bootKey);
      if(wasLoaded&&old!==state.active)setTimeout(()=>location.reload(),120);
      if(state.active&&typeof window.refresh==='function'&&/\/admin\/?(?:index\.html)?$/.test(location.pathname))setTimeout(()=>window.refresh().catch?.(()=>{}),180);
    }catch(e){console.warn('Mode test indisponible',e);state.loaded=true;if(readyResolve){readyResolve();readyResolve=null}}
  }
  window.refreshGestionCollegeTestMode=refreshMode;

  function loadAdminSandbox(){
    if(!/\/admin\/?(?:index\.html)?$/.test(location.pathname))return;
    if(!document.querySelector('script[data-sandbox-admin]')){const s=document.createElement('script');s.src='./sandbox-admin.js?v=3';s.defer=true;s.dataset.sandboxAdmin='1';document.head.appendChild(s)}
    if(!document.querySelector('script[data-sandbox-generator]')){const g=document.createElement('script');g.src='./sandbox-generator-ui.js?v=2';g.defer=true;g.dataset.sandboxGenerator='1';document.head.appendChild(g)}
    if(!document.querySelector('script[data-multi-app-admin]')){const m=document.createElement('script');m.src='./multi-app-admin.js?v=1';m.defer=true;m.dataset.multiAppAdmin='1';document.head.appendChild(m)}
  }

  async function loadMaintenanceInventoryConditioning(){
    const appId=(new URLSearchParams(location.search).get('id')||'').trim();
    if(appId!=='b881d941-f656-4217-8a0e-20ef7d876f21')return;
    if(!document.getElementById('maintenanceInventorySizing')){
      const style=document.createElement('style');
      style.id='maintenanceInventorySizing';
      style.textContent='#page-inventory .line{grid-template-columns:minmax(0,1fr) 220px!important;gap:14px!important}#page-inventory .invQty{min-height:58px!important;font-size:18px!important;padding:10px 12px!important;text-align:left!important}@media(max-width:650px){#page-inventory .line{grid-template-columns:1fr!important;gap:9px!important;align-items:stretch!important;padding:14px 0!important}#page-inventory .invQty{width:100%!important;min-height:58px!important;font-size:18px!important;padding:11px 13px!important;text-align:left!important}}';
      document.head.appendChild(style);
    }
    let products=[];
    try{
      const r=await originalFetch(ROOT+'app-api?id='+encodeURIComponent(appId),{cache:'no-store'}),j=await r.json();
      products=Array.isArray(j.products)?j.products:[];
    }catch(e){console.warn('Unités inventaire indisponibles',e);return}
    const byName=new Map(products.map(p=>[String(p.name||'').trim(),p]));
    const apply=()=>{
      document.querySelectorAll('.line').forEach(row=>{
        const name=row.querySelector('.name')?.textContent?.trim()||'';
        const p=byName.get(name);if(!p)return;
        const countUnit=String(p.conditionnement||p.unit||'pièce').trim();
        let box=row.querySelector('.conditioning-info');
        if(!box){box=document.createElement('div');box.className='conditioning-info';box.style.cssText='font-size:14px;font-weight:800;color:#26323c;margin-top:5px;line-height:1.4';const info=row.querySelector('.unit');if(info)info.insertAdjacentElement('afterend',box);else row.querySelector('div')?.appendChild(box)}
        const wanted='À compter en : '+countUnit;
        if(box.textContent!==wanted)box.textContent=wanted;
        const input=row.querySelector('.invQty');
        if(input){if(input.placeholder!==countUnit)input.placeholder=countUnit;const title='Saisir le nombre de '+countUnit;if(input.title!==title)input.title=title;const aria=name+' — quantité en '+countUnit;if(input.getAttribute('aria-label')!==aria)input.setAttribute('aria-label',aria)}
      });
    };
    apply();
    const observer=new MutationObserver(()=>apply());observer.observe(document.getElementById('pages')||document.body,{childList:true,subtree:true});
  }

  const boot=()=>{registerSandboxWorker();refreshMode();loadAdminSandbox();loadMaintenanceInventoryConditioning()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  setInterval(refreshMode,30000);
})();