(()=>{
  'use strict';

  const style=document.createElement('style');
  style.id='adminGroupedNavStyle';
  style.textContent=`
    #nav.admin-grouped-nav{display:block!important;overflow-y:auto!important;max-height:calc(100vh - 82px);padding-right:2px}
    #nav .admin-nav-home{margin-bottom:8px!important}
    #nav .admin-nav-group{margin:5px 0;border-radius:9px;overflow:hidden}
    #nav .admin-nav-group-toggle{display:flex!important;align-items:center;justify-content:space-between;width:100%!important;padding:10px!important;margin:0!important;background:#263646!important;color:#eef4f8!important;font-weight:800!important;border:0!important;border-radius:8px!important;text-align:left!important;cursor:pointer}
    #nav .admin-nav-group-toggle:hover,#nav .admin-nav-group.open>.admin-nav-group-toggle{background:#314254!important;color:#fff!important}
    #nav .admin-nav-chevron{font-size:11px;transition:transform .16s ease;opacity:.8}
    #nav .admin-nav-group.open .admin-nav-chevron{transform:rotate(90deg)}
    #nav .admin-nav-submenu{display:none;padding:3px 0 4px 8px;background:#1f2b38!important}
    #nav .admin-nav-group.open .admin-nav-submenu{display:block}
    #nav .admin-nav-submenu>button{font-size:13px!important;padding:8px 10px!important;margin:1px 0!important;border-left:2px solid #3d5164!important;border-radius:6px!important;background:#1f2b38!important}
    #nav .admin-nav-submenu>button.active,#nav .admin-nav-submenu>button:hover{background:#314254!important;border-left-color:#fff!important}
    @media(max-width:900px){#nav.admin-grouped-nav{display:flex!important;max-height:none;overflow-x:auto!important;overflow-y:visible!important;gap:5px}#nav .admin-nav-group{overflow:visible;position:relative;flex:0 0 auto}#nav .admin-nav-group-toggle{white-space:nowrap}#nav .admin-nav-submenu{position:absolute;left:0;top:100%;z-index:1000;min-width:220px;padding:6px;background:#1f2b38!important;border-radius:0 0 8px 8px;box-shadow:0 8px 20px #0004}#nav .admin-nav-group.open .admin-nav-submenu{display:block}#nav .admin-nav-home{margin-bottom:0!important;flex:0 0 auto}}
  `;
  if(!document.getElementById(style.id))document.head.appendChild(style);

  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.repeat)return;
    const target=e.target;
    if(!(target instanceof HTMLElement)||!['user','pass'].includes(target.id))return;
    const loginBox=document.getElementById('login');
    if(!loginBox||loginBox.classList.contains('hide'))return;
    e.preventDefault();
    if(typeof window.login==='function')window.login();
  });

  const GROUPS=[
    {label:'Gestion des stocks',pages:['categories','products','apps','events','purchases','stats']},
    {label:'Pilotage',pages:['directionCenter','analyticsCenter','suppliersCenter','globalSearch','activityCenter']},
    {label:'Contrôles & sécurité',pages:['anomaliesCenter','appHealth','auditCenter','trashCenter']},
    {label:'Comptabilité',pages:['accountingCenter','secretariatCenter','accountingRules','accountingControl','windowsAgent']},
    {label:'Administration',pages:['adminAccounts','dashboardPrefs','accessLinks','settings']}
  ];

  let applying=false;
  function enhanceNav(){
    if(applying)return;
    const nav=document.getElementById('nav');
    if(!nav)return;
    const directButtons=[...nav.children].filter(el=>el.tagName==='BUTTON');
    if(!directButtons.length)return;
    if(!directButtons.some(b=>b.dataset.p==='adminAccounts'))return; // administrateur principal uniquement
    applying=true;
    try{
      const current=typeof window.page==='string'?window.page:'';
      const byPage=new Map(directButtons.map(b=>[b.dataset.p,b]));
      const used=new Set();
      const frag=document.createDocumentFragment();

      const home=byPage.get('dashboard');
      if(home){home.classList.add('admin-nav-home');frag.appendChild(home);used.add('dashboard')}

      for(const group of GROUPS){
        const buttons=group.pages.map(p=>byPage.get(p)).filter(Boolean);
        if(!buttons.length)continue;
        buttons.forEach(b=>used.add(b.dataset.p));
        const wrap=document.createElement('div');
        wrap.className='admin-nav-group';
        if(buttons.some(b=>b.dataset.p===current))wrap.classList.add('open');
        const toggle=document.createElement('button');
        toggle.type='button';toggle.className='admin-nav-group-toggle';
        toggle.innerHTML=`<span>${group.label}</span><span class="admin-nav-chevron">▶</span>`;
        toggle.addEventListener('click',()=>{
          const wasOpen=wrap.classList.contains('open');
          nav.querySelectorAll('.admin-nav-group.open').forEach(x=>x.classList.remove('open'));
          if(!wasOpen)wrap.classList.add('open');
        });
        const submenu=document.createElement('div');submenu.className='admin-nav-submenu';
        buttons.forEach(b=>submenu.appendChild(b));
        wrap.append(toggle,submenu);frag.appendChild(wrap);
      }

      directButtons.filter(b=>!used.has(b.dataset.p)).forEach(b=>frag.appendChild(b));
      nav.replaceChildren(frag);
      nav.classList.add('admin-grouped-nav');
    }finally{applying=false}
  }

  const boot=()=>{
    const nav=document.getElementById('nav');
    if(!nav)return setTimeout(boot,100);
    const observer=new MutationObserver(()=>setTimeout(enhanceNav,0));
    observer.observe(nav,{childList:true});
    setTimeout(enhanceNav,50);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();