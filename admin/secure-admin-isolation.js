(()=>{
  'use strict';
  const AUTH='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-central-auth';
  const DASH='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-dashboard-api';
  const legacyApi=api;
  async function central(action,method='POST',body,withAuth=false){
    const u=new URL(AUTH);u.searchParams.set('action',action);
    const r=await fetch(u,{method,headers:{'content-type':'application/json',...(withAuth&&token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const j=await r.json().catch(()=>({error:'Réponse invalide'}));
    if(!r.ok)throw new Error(j.error||'Erreur serveur');return j
  }
  async function dashboard(action){
    const u=new URL(DASH);u.searchParams.set('action',action);
    const r=await fetch(u,{headers:{authorization:'Bearer '+token},cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse invalide'}));
    if(!r.ok)throw new Error(j.error||'Erreur serveur');return j
  }
  api=async function(action,method='GET',body){
    if(action==='login')return central('login','POST',body,false);
    if(action==='change-password')return central('change-password','POST',body,true);
    if(action==='data'){
      const ctx=await dashboard('context');
      if(ctx.current_user?.is_super_admin)return legacyApi(action,method,body);
      return dashboard('base')
    }
    const ctx=await dashboard('context');
    if(!ctx.current_user?.is_super_admin)throw new Error('Cette opération est réservée à l’administrateur principal.');
    return legacyApi(action,method,body)
  };
  const oldLogout=logout;
  logout=function(){oldLogout();sessionStorage.removeItem('college_admin_scope')};
})();