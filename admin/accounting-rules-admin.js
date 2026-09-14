// Compatibilite Gestion Holding -> backend EDM actif.
// La cle ci-dessous est la cle anonyme publique Supabase, jamais une cle service_role.
const GH_SUPABASE_URL='https://ojjbnwpkfvzjfukgqddz.supabase.co';
const GH_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoib2pqYm53cGtmdnpqZnVrZ3FkZHoiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4MzE3MjQ0OSwiZXhwIjoyMDk4NzQ4NDQ5fQ.oHKf-cT3VpyoxKrOdqj1qgHZ5TzekKsVW7XhVLNeldA';
const GH_ADMIN_API=GH_SUPABASE_URL+'/functions/v1/admin-api';

function ghHeaders(includeSession=true){
  const h={
    'content-type':'application/json',
    'apikey':GH_ANON_KEY,
    'authorization':'Bearer '+GH_ANON_KEY
  };
  if(includeSession&&token)h['x-admin-session']=token;
  return h;
}

api=async function(action,method='GET',body){
  const r=await window.fetch(GH_ADMIN_API+'?action='+encodeURIComponent(action),{
    method,
    headers:ghHeaders(action!=='login'),
    body:body?JSON.stringify(body):undefined,
    cache:'no-store'
  });
  const j=await r.json().catch(()=>({error:'Reponse invalide'}));
  if(r.status===401&&action!=='login'){
    logout();
    throw new Error('Session expiree');
  }
  if(!r.ok)throw new Error(j.error||'Erreur serveur');
  return j;
};

siteApi=async function(action='list',method='GET',body){
  if(action==='list'){
    const j=await api('data');
    return {applications:j.applications||[],application_products:j.application_products||[]};
  }
  if(action==='save'){
    const payload={...(body||{})};
    if(typeof payload.services==='string')payload.services=payload.services.split(',').map(v=>v.trim()).filter(Boolean);
    return api('save-application','POST',payload);
  }
  if(action==='delete'){
    const id=String(body?.id||'');
    const a=db?.applications?.find(x=>x.id===id);
    if(!a)throw new Error('Site introuvable');
    return api('save-application','POST',{
      id:a.id,
      code:a.code,
      name:a.name,
      category_id:a.category_id,
      active:false,
      color:a.color,
      services:a.services||[],
      description:a.description||'',
      site_options:a.site_options||{},
      product_ids:[]
    });
  }
  throw new Error('Action site inconnue');
};

const ghBaseInitNav=initNav;
initNav=function(){
  ghBaseInitNav();
  const nav=document.getElementById('nav');
  if(nav&&!nav.querySelector('[data-gh-holding]')){
    const b=document.createElement('button');
    b.type='button';
    b.dataset.ghHolding='1';
    b.textContent='Retour Holding';
    b.onclick=()=>{window.location.href='holding/';};
    nav.appendChild(b);
  }
};

if(token){
  initNav();
  setTimeout(()=>refresh().catch(()=>{}),0);
}
