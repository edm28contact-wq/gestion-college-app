(()=>{
  'use strict';

  function enableEnterLogin(){
    const loginBox=document.getElementById('login');
    if(!loginBox||loginBox.dataset.enterLogin==='1')return;
    loginBox.dataset.enterLogin='1';
    loginBox.addEventListener('keydown',e=>{
      if(e.key!=='Enter')return;
      const target=e.target;
      if(!target||!['user','pass'].includes(target.id))return;
      if(loginBox.classList.contains('hide'))return;
      e.preventDefault();
      if(typeof window.login==='function')window.login();
    });
  }

  const GROUPS=[
    {key:'stock',label:'Stocks & achats',pages:['categories','products','events','purchases','suppliersCenter','analyticsCenter','stats']},
    {key:'apps',label:'Applications',pages:['apps','appHealth','accessLinks']},
    {key:'finance',label:'Factures & comptabilité',pages:['secretariatCenter','accountingCenter','accountingRules','accountingControl','windowsAgent']},
    {key:'control',label:'Contrôles & suivi',pages:['anomaliesCenter','activityCenter','auditCenter','globalSearch','trashCenter']},
    {key:'admin',label:'Administration',pages:['adminAccounts','dashboardPrefs','settings']}
  ];

  function addStyles(){
    if(document.getElementById('adminGroupedNavStyle'))return;
    const s=document.createElement('style');
    s.id='adminGroupedNavStyle';
    s.textContent=`
      .side,.side .nav{background:#1f2b38!important;background-color:#1f2b38!important;opacity:1!important;backdrop-filter:none!important}
      #nav.cc-grouped-nav{display:block!important;overflow-y:auto!important;overflow-x:hidden!important;padding-right:2px}
      #nav.cc-grouped-nav>.cc-nav-home{margin-bottom:7px}
      #nav.cc-grouped-nav details{display:block;width:100%;margin:5px 0;border-radius:9px;background:#1f2b38}
      #nav.cc-grouped-nav summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:10px;border-radius:8px;cursor:pointer;color:#fff;font-weight:800;background:#263646;user-select:none}
      #nav.cc-grouped-nav summary::-webkit-details-marker{display:none}
      #nav.cc-grouped-nav summary::after{content:'›';font-size:19px;line-height:1;transition:transform .16s ease;color:#bfcbd5}
      #nav.cc-grouped-nav details[open] summary::after{transform:rotate(90deg)}
      #nav.cc-grouped-nav details[open] summary{background:#314254}
      #nav.cc-grouped-nav .cc-nav-sub{padding:4px 0 3px 8px}
      #nav.cc-grouped-nav .cc-nav-sub button{width:100%;padding:8px 10px 8px 14px!important;margin:1px 0!important;font-size:13px!important;background:#1f2b38!important;color:#dce5ed!important;border-left:2px solid #41576b!important;border-radius:6px!important}
      #nav.cc-grouped-nav .cc-nav-sub button:hover,#nav.cc-grouped-nav .cc-nav-sub button.active{background:#314254!important;color:#fff!important;border-left-color:#fff!important}
      #nav.cc-grouped-nav>.cc-nav-home{width:100%;text-align:left;background:#1f2b38!important;color:#fff!important;font-weight:800!important;border:1px solid #3a4d5f!important}
      @media(max-width:900px){#nav.cc-grouped-nav{display:block!important;overflow:visible!important}#nav.cc-grouped-nav details,#nav.cc-grouped-nav>.cc-nav-home{min-width:100%}}
    `;
    document.head.appendChild(s);
  }

  function currentPage(){
    try{return typeof page==='string'?page:''}catch{return ''}
  }

  function groupNavigation(){
    const nav=document.getElementById('nav');
    if(!nav)return;
    const buttons=[...nav.querySelectorAll(':scope > button[data-p]')];
    if(!buttons.length)return;
    const isMainAdmin=buttons.some(b=>b.dataset.p==='adminAccounts');
    if(!isMainAdmin)return;

    addStyles();
    const byPage=new Map(buttons.map(b=>[b.dataset.p,b]));
    const used=new Set();
    const fragment=document.createDocumentFragment();

    const home=byPage.get('dashboard');
    if(home){home.classList.add('cc-nav-home');fragment.appendChild(home);used.add('dashboard')}
    const direction=byPage.get('directionCenter');
    if(direction){direction.classList.add('cc-nav-home');fragment.appendChild(direction);used.add('directionCenter')}

    for(const g of GROUPS){
      const items=g.pages.map(k=>byPage.get(k)).filter(Boolean);
      if(!items.length)continue;
      const details=document.createElement('details');
      details.className='cc-nav-group';
      details.dataset.group=g.key;
      if(items.some(b=>b.dataset.p===currentPage()))details.open=true;
      const summary=document.createElement('summary');
      summary.textContent=g.label;
      const sub=document.createElement('div');
      sub.className='cc-nav-sub';
      items.forEach(b=>{used.add(b.dataset.p);sub.appendChild(b)});
      details.append(summary,sub);
      fragment.appendChild(details);
    }

    const leftovers=buttons.filter(b=>!used.has(b.dataset.p));
    if(leftovers.length){
      const details=document.createElement('details');
      details.className='cc-nav-group';
      details.dataset.group='other';
      if(leftovers.some(b=>b.dataset.p===currentPage()))details.open=true;
      const summary=document.createElement('summary');summary.textContent='Autres';
      const sub=document.createElement('div');sub.className='cc-nav-sub';
      leftovers.forEach(b=>sub.appendChild(b));
      details.append(summary,sub);fragment.appendChild(details);
    }

    nav.innerHTML='';
    nav.classList.add('cc-grouped-nav');
    nav.appendChild(fragment);
  }

  function openActiveGroup(){
    const active=document.querySelector('#nav button.active');
    const details=active?.closest('details');
    if(details)details.open=true;
  }

  function installNavPatch(){
    if(window.__adminGroupedNavInstalled)return true;
    if(typeof window.initNav!=='function'||typeof window.show!=='function'||typeof window.ccRunSearch!=='function')return false;
    window.__adminGroupedNavInstalled=true;
    const originalInitNav=window.initNav;
    window.initNav=function(){
      const r=originalInitNav.apply(this,arguments);
      groupNavigation();
      return r;
    };
    const originalShow=window.show;
    window.show=function(){
      const r=originalShow.apply(this,arguments);
      setTimeout(openActiveGroup,0);
      return r;
    };
    groupNavigation();
    openActiveGroup();
    return true;
  }

  enableEnterLogin();
  addStyles();
  if(!installNavPatch()){
    let attempts=0;
    const timer=setInterval(()=>{
      enableEnterLogin();
      attempts++;
      if(installNavPatch()||attempts>200)clearInterval(timer);
    },50);
  }
})();