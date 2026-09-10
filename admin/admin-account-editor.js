(()=>{
  'use strict';

  const CONTROL_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-control-center';
  const AUTH_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-central-auth';
  const PERMISSIONS=[
    ['dashboard.read','Tableau de bord'],['activity.read','Historique global'],['analytics.read','Statistiques'],['suppliers.read','Fournisseurs'],['search.read','Recherche globale'],['apps.read','Santé des applications'],['audit.read','Journal d’audit'],['trash.read','Voir la corbeille'],['trash.manage','Restaurer / gérer la corbeille'],['accounting.read','Contrôle comptabilité'],['secretariat.read','Contrôle secrétariat'],['anomalies.read','Voir les anomalies'],['anomalies.manage','Acquitter les anomalies'],['export.read','Exports'],['products.read','Produits'],['stock.read','Stocks'],['purchases.read','Achats']
  ];

  function escapeHtml(value){
    if(typeof esc==='function')return esc(value);
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function accountByUsername(username){
    return (window._ccAccounts||[]).find(account=>account.username===username)||null;
  }

  function currentToken(){
    try{return typeof token==='string'?token:''}catch{return ''}
  }

  async function request(base,action,method='POST',body){
    const url=new URL(base);url.searchParams.set('action',action);
    const response=await fetch(url,{method,headers:{'content-type':'application/json',authorization:'Bearer '+currentToken()},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const result=await response.json().catch(()=>({error:'Réponse invalide'}));
    if(response.status===401&&result.error==='Session invalide'){
      if(typeof logout==='function')logout();
      throw new Error('Session expirée');
    }
    if(!response.ok)throw new Error(result.error||'Erreur serveur');
    return result;
  }

  const control=(action,method='POST',body)=>request(CONTROL_API,action,method,body);
  const central=body=>request(AUTH_API,'change-password','POST',body);

  function permissionsHtml(permissions={}){
    return PERMISSIONS.map(([key,label])=>`<label class="cc-perm"><input class="ccaPerm" type="checkbox" value="${key}" ${permissions[key]===true?'checked':''}> ${escapeHtml(label)}</label>`).join('');
  }

  function openEditor(username=''){
    const account=username?accountByUsername(username):null;
    if(username&&!account)return alert('Compte administrateur introuvable.');
    const isMain=account?.username==='admin'&&account?.is_super_admin===true;
    const existing=!!account;
    const title=isMain?'Modifier l’administrateur principal':existing?'Modifier l’administrateur':'Nouvel administrateur';
    const passwordLabel=existing?'Nouveau mot de passe (laisser vide pour conserver)':'Mot de passe initial (14 caractères minimum)';
    const protectedBlock=isMain?`<div class="full card" style="background:#f7f9fa"><b>Protection du compte principal</b><div class="muted" style="margin-top:5px">Identifiant « admin » non modifiable. Le compte restera obligatoirement actif, super administrateur et avec tous les droits.</div></div>`:'';
    const mainPassword=isMain?`<div class="full"><label>Mot de passe actuel (obligatoire si le mot de passe change)</label><input id="ccaCurrentPass" type="password" autocomplete="current-password"></div>`:'';
    const activeField=isMain?'':`<div class="full"><label><input id="ccaActive" type="checkbox" style="width:auto" ${account?.active!==false?'checked':''}> Compte actif</label></div>`;
    const permissionBlock=isMain?'<div class="card" style="background:#f7f9fa"><b>Permissions</b><div class="muted" style="margin-top:5px">Tous les droits sont imposés côté serveur pour ce compte.</div></div>':`<div class="section-title">Permissions</div><div class="cc-perms">${permissionsHtml(account?.permissions||{})}</div>`;

    document.getElementById('modal').innerHTML=`<div class="modal"><div class="box"><h2>${title}</h2><div class="fields"><div><label>Identifiant</label><input id="ccaUser" value="${escapeHtml(account?.username||'')}" ${existing?'disabled':''}></div><div><label>Nom affiché</label><input id="ccaName" value="${escapeHtml(account?.display_name||'')}"></div>${protectedBlock}${mainPassword}<div class="full"><label>${passwordLabel}</label><input id="ccaPass" type="password" autocomplete="new-password"></div><div class="full"><label>Confirmer le nouveau mot de passe</label><input id="ccaPassConfirm" type="password" autocomplete="new-password"></div>${activeField}</div>${permissionBlock}<div class="actions" style="margin-top:16px"><button class="btn primary" id="ccaSave" type="button">Enregistrer</button><button class="btn secondary" onclick="closeModal()">Annuler</button></div><div id="ccaStatus" class="status"></div></div></div>`;
    document.getElementById('ccaSave')?.addEventListener('click',()=>save(username));
  }

  function statusError(message){
    const status=document.getElementById('ccaStatus');
    if(!status)return;
    status.className='status err';status.textContent=message;
  }

  async function save(username=''){
    const account=username?accountByUsername(username):null;
    const isMain=account?.username==='admin'&&account?.is_super_admin===true;
    const displayName=String(document.getElementById('ccaName')?.value||'').trim();
    const password=String(document.getElementById('ccaPass')?.value||'');
    const confirmation=String(document.getElementById('ccaPassConfirm')?.value||'');
    const status=document.getElementById('ccaStatus');

    if(password!==confirmation)return statusError('Les deux nouveaux mots de passe ne correspondent pas.');
    if(password&&password.length<14)return statusError('Le nouveau mot de passe doit contenir au moins 14 caractères.');

    try{
      if(status){status.className='status';status.textContent='Enregistrement sécurisé…'}
      if(isMain){
        if(password){
          const currentPassword=String(document.getElementById('ccaCurrentPass')?.value||'');
          if(!currentPassword)return statusError('Le mot de passe actuel est obligatoire pour changer le mot de passe.');
          await central({current_password:currentPassword,password,password_confirmation:confirmation,display_name:displayName});
          if(typeof closeModal==='function')closeModal();
          alert('Compte principal modifié. Le mot de passe a changé : reconnectez-vous.');
          if(typeof logout==='function')logout();
          return;
        }
        await control('save-account','POST',{username:'admin',display_name:displayName});
        if(typeof closeModal==='function')closeModal();
        if(typeof refresh==='function')await refresh();
        return;
      }

      const permissions={};
      document.querySelectorAll('.ccaPerm:checked').forEach(input=>permissions[input.value]=true);
      permissions['dashboard.read']=true;
      const target=username||String(document.getElementById('ccaUser')?.value||'').trim();
      const active=document.getElementById('ccaActive')?.checked!==false;
      await control('save-account','POST',{username:target,display_name:displayName,password,active,permissions});
      if(typeof closeModal==='function')closeModal();
      if(typeof show==='function')show('adminAccounts');
    }catch(error){statusError(error?.message||String(error))}
  }

  function patchAccountTable(){
    let onAccounts=false;
    try{onAccounts=typeof page==='string'&&page==='adminAccounts'}catch{}
    if(!onAccounts||!Array.isArray(window._ccAccounts))return;

    const addButton=[...document.querySelectorAll('#content .toolbar button')].find(button=>button.textContent?.includes('Ajouter un administrateur'));
    if(addButton&&!addButton.dataset.adminAccountEditor){
      addButton.dataset.adminAccountEditor='1';
      addButton.removeAttribute('onclick');
      addButton.addEventListener('click',()=>openEditor());
    }

    const rows=[...document.querySelectorAll('#content table tbody tr')];
    if(rows.length!==window._ccAccounts.length)return;
    rows.forEach((row,index)=>{
      const account=window._ccAccounts[index],cell=row.lastElementChild;
      if(!account||!cell||cell.querySelector('[data-admin-account-editor]'))return;
      cell.innerHTML='';
      const button=document.createElement('button');
      button.type='button';button.className='btn secondary';button.textContent='Modifier';button.dataset.adminAccountEditor='1';
      button.addEventListener('click',()=>openEditor(account.username));
      cell.appendChild(button);
    });
  }

  function patchSettingsPasswordForm(){
    const newPass=document.getElementById('newpass');
    const card=newPass?.closest('.card');
    if(!card||card.dataset.securePasswordForm==='1')return;
    card.dataset.securePasswordForm='1';
    card.innerHTML=`<h3>Changer le mot de passe administrateur</h3><label>Mot de passe actuel</label><input id="currentpass" type="password" autocomplete="current-password"><br><br><label>Nouveau mot de passe</label><input id="newpass" type="password" autocomplete="new-password" placeholder="14 caractères minimum"><br><br><label>Confirmer le nouveau mot de passe</label><input id="newpassconfirm" type="password" autocomplete="new-password"><br><br><button class="btn primary" onclick="changePassword()">Changer le mot de passe</button><p class="muted">Après modification, toutes les anciennes sessions seront invalidées et vous devrez vous reconnecter.</p>`;
  }

  async function secureChangePassword(){
    const currentPassword=String(document.getElementById('currentpass')?.value||'');
    const password=String(document.getElementById('newpass')?.value||'');
    const confirmation=String(document.getElementById('newpassconfirm')?.value||'');
    if(!currentPassword)return alert('Saisissez le mot de passe actuel.');
    if(password.length<14)return alert('Le nouveau mot de passe doit contenir au moins 14 caractères.');
    if(password!==confirmation)return alert('Les deux nouveaux mots de passe ne correspondent pas.');
    try{
      await central({current_password:currentPassword,password,password_confirmation:confirmation});
      alert('Mot de passe modifié. Reconnectez-vous.');
      if(typeof logout==='function')logout();
    }catch(error){alert(error?.message||String(error))}
  }

  function installHooks(){
    window.AdminAccountEditor={open:openEditor,save};
    window.ccEditAdmin=openEditor;
    window.changePassword=secureChangePassword;
  }

  installHooks();
  const observer=new MutationObserver(()=>{installHooks();patchAccountTable();patchSettingsPasswordForm()});
  observer.observe(document.body,{childList:true,subtree:true});
  patchAccountTable();patchSettingsPasswordForm();
})();