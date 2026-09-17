(()=>{
'use strict';
const PROD_ROOT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1';
const PUBLIC_ROOT='https://edm28contact-wq.github.io/gestion-college-app/college/?id=';
try{
  if(typeof token!=='undefined'&&!token){token=localStorage.getItem('edm_admin_token')||localStorage.getItem('holding_admin_token')||'';if(token)localStorage.setItem('college_admin_token',token)}
  const user=document.getElementById('user');if(user&&String(user.value).trim().toLowerCase()==='holding-admin')user.value='admin';
  if(typeof call==='function'){
    const compatCall=async(base,action,method='GET',body,params={})=>{
      const old=new URL(base),u=new URL(PROD_ROOT+old.pathname.replace(/^.*\/functions\/v1/,''));
      u.searchParams.set('action',action);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));
      const r=await fetch(u,{method,headers:{'content-type':'application/json',...(token?{'x-admin-session':token,'authorization':'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse du service invalide.'}));
      if(r.status===401&&action!=='login'){logout(false);throw new Error('Session expirée. Reconnectez-vous.')}if(!r.ok)throw new Error(frError(j.error));return j;
    };
    window.call=compatCall;
  }
}catch(e){console.error('compat production',e)}
function ensureQuickAccessLinks(){
  const actions=document.querySelector('#app .main > .top > .actions');
  if(!actions||actions.querySelector('[data-quick-access="links"]'))return;
  const access=document.createElement('a');access.className='btn secondary';access.href='../../admin/acces.html';access.textContent='Accès & liens';access.dataset.quickAccess='links';actions.prepend(access);
}
ensureQuickAccessLinks();
function loadQrLib(){return new Promise((resolve,reject)=>{if(window.QRCode)return resolve(window.QRCode);const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';s.onload=()=>window.QRCode?resolve(window.QRCode):reject(new Error('Bibliothèque QR indisponible'));s.onerror=()=>reject(new Error('Impossible de charger le générateur QR'));document.head.appendChild(s)})}
function app(id){return db?.applications?.find(a=>String(a.id)===String(id))}
function publicUrl(a){return PUBLIC_ROOT+encodeURIComponent(a.public_id)}
function downloadQr(name){const box=document.getElementById('qrAdminBox'),canvas=box?.querySelector('canvas'),img=box?.querySelector('img');const data=canvas?.toDataURL('image/png')||img?.src||'';if(!data)return alert('QR code indisponible.');const a=document.createElement('a');a.href=data;a.download='qr-'+String(name||'application').replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()+'.png';document.body.appendChild(a);a.click();a.remove()}
function qrModal(a){const u=publicUrl(a);return `<div class="modal"><div class="box" style="width:min(720px,100%);text-align:center"><div class="top" style="text-align:left"><div><h2 style="margin:0">${esc(a.name||a.code||'Application')}</h2><div class="muted">QR code généré directement à partir du lien public actif</div></div><button class="btn secondary" onclick="closeModal()">Fermer</button></div><div id="qrAdminBox" style="display:flex;justify-content:center;align-items:center;min-height:360px;padding:18px"></div><div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all;background:#f6f8fa;padding:10px;border-radius:8px;text-align:left">${esc(u)}</div><div class="actions" style="justify-content:center;margin-top:14px"><a class="btn primary" target="_blank" rel="noopener" href="${esc(u)}">Tester le lien</a><button class="btn success" onclick="downloadQr('${esc(a.code||a.name||'application')}')">Télécharger PNG</button><a class="btn secondary" href="../../admin/acces.html">Tous les QR</a></div><div id="qrAdminStatus" class="status"></div></div></div>`}
window.downloadQr=downloadQr;
window.openAppQr=async id=>{const a=app(id);if(!a)return;$('modal').innerHTML=qrModal(a);const box=$('qrAdminBox'),s=$('qrAdminStatus');try{const QR=await loadQrLib();box.innerHTML='';new QR(box,{text:publicUrl(a),width:340,height:340,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QR.CorrectLevel.H});if(s){s.className='status ok';s.textContent='QR code prêt.'}}catch(e){if(box)box.innerHTML='<div class="err">QR code indisponible.</div>';if(s){s.className='status err';s.textContent=frError(e.message)}}};
window.apps=function(){
  const list=[...db.applications].sort((a,b)=>(a.active===b.active?String(a.name).localeCompare(String(b.name),'fr'):a.active?-1:1));
  $('content').innerHTML=`<div class="toolbar"><button class="btn primary" onclick="editSite('','')">Créer une application</button><span class="muted">${list.filter(a=>a.active).length} active(s) · ${list.length} au total</span></div><br>${list.map(a=>{const c=cat(a.category_id),url=publicUrl(a),count=db.application_products.filter(m=>m.application_id===a.id&&m.active).length;return `<div class="card"><div class="top"><div><b>${esc(a.name)}</b> ${statusPill(a.active)}<div class="muted">${esc(c?.name||'Sans catégorie')} · ${count} produit(s) · code ${esc(a.code)}</div></div><div class="actions">${a.active?`<a class="btn primary compact" target="_blank" rel="noopener" href="${url}">Ouvrir</a><button class="btn success compact" onclick="openAppQr('${a.id}')">QR</button>`:''}<button class="btn secondary compact" onclick="editSite('${a.id}','${a.category_id||''}')">Configurer</button>${a.active?`<button class="btn danger compact" onclick="disableSite('${a.id}')">Désactiver</button>`:''}</div></div></div>`}).join('')||'<div class="card">Aucune application.</div>'}<div id="pageStatus" class="status"></div>`;
};
if(typeof token!=='undefined'&&token&&document.getElementById('app')?.classList.contains('hide'))enterApp().catch(()=>logout(false));
})();