const ROOT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/';
const MODE=ROOT+'system-mode?action=status';
const ROUTER=ROOT+'sandbox-router';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
function targetFor(u){
  if(u.origin!=='https://zreegtzfpwrjgdhhunxx.supabase.co'||!u.pathname.includes('/functions/v1/'))return null;
  const slug=u.pathname.split('/').pop()||'',action=u.searchParams.get('action')||'';
  if(['system-mode','sandbox-router','sandbox-api','secretariat-account-api'].includes(slug))return null;
  if(slug==='admin-api'&&['login','change-password'].includes(action))return null;
  if(slug==='accounting-api'&&['login','change-password','setup-account'].includes(action))return null;
  // L'analyse de facture est en lecture seule : on utilise le vrai détecteur,
  // mais l'enregistrement reste routé vers les tables bac à sable.
  if(slug==='invoice-api'&&action==='suggest')return null;
  if(slug==='app-api')return 'app';
  if(slug==='admin-api')return 'admin';
  if(slug==='site-admin-api')return 'site-admin';
  if(slug==='invoice-api')return 'invoice';
  if(slug==='accounting-api')return 'accounting';
  if(slug==='accounting-rules'||slug==='admin-accounting-rules')return 'rules';
  if(slug==='accounting-control')return 'control';
  if(slug==='accounting-batch-export')return 'batch-export';
  if(slug==='accounting-actions'&&action==='export-batch')return 'batch-export';
  return null;
}
async function testActive(){try{const r=await fetch(MODE,{cache:'no-store'});if(!r.ok)return false;const j=await r.json();return !!j.test_mode}catch{return false}}
self.addEventListener('fetch',event=>{
  const req=event.request,u=new URL(req.url),target=targetFor(u);if(!target)return;
  event.respondWith((async()=>{
    if(!await testActive())return fetch(req);
    const r=new URL(ROUTER);r.searchParams.set('target',target);const action=u.searchParams.get('action')||'';if(action)r.searchParams.set('action',action);for(const [k,v] of u.searchParams.entries())if(k!=='action')r.searchParams.append(k,v);
    return fetch(new Request(r.toString(),req));
  })());
});
