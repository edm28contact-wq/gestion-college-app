"use strict";
(function(){
 const slots=Array.from({length:12},(_,i)=>i+1),stations=["A","B","C"];
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const format=v=>v!=null&&Number.isFinite(Number(v))?Number(v).toLocaleString("fr-FR",{maximumFractionDigits:2})+" °C":"—";
 const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"}):"—";
 const physical=i=>i?"Station "+stations[Math.floor((i-1)/4)]+" · sonde "+((i-1)%4+1):"Non associée";
 const label=p=>p?.label||physical(p?.slot);
 const fresh=(p,s)=>!!p&&p.fresh===true&&!s.last_error&&Date.parse(p.measured_at)>=Date.now()-120000&&Date.parse(p.measured_at)<=Date.now()+10000;
 const qualified=p=>!!p?.qualified_at&&Date.parse(p.qualification_expires_at)>Date.now();
 const links=s=>s.links||[];
 const linked=(p,s)=>links(s).find(l=>l.device_id===p.device_id);
 const valid=(p,s,l)=>s.enabled&&fresh(p,s)&&qualified(p)&&p.cook_id===l.cook_id&&Date.parse(p.measured_at)>=Date.parse(l.attached_at);
 const state=(p,s)=>!p?"En attente d’association":!fresh(p,s)?"Hors ligne / mesure ancienne":!qualified(p)?"À qualifier":!s.enabled?"Test · collecte arrêtée":linked(p,s)?(valid(p,s,linked(p,s))?"Cycle associé":"Association à contrôler"):p.cook_state==="Started"?"Disponible pour un cycle":"Connectée";
 function tiles(s,testing=false){
 return stations.map((name,i)=>'<section class="meater-station"><h3>Station '+name+'</h3><div class="meater-grid">'+slots.slice(i*4,i*4+4).map(slot=>{
  const p=(s.probes||[]).find(x=>x.slot===slot),l=p&&linked(p,s),ok=fresh(p,s)&&(testing||s.enabled)&&(!l||valid(p,s,l));
  return '<article class="meater-tile"><strong>'+esc(p?.label||"Sonde "+((slot-1)%4+1))+'</strong><span class="meater-state '+(ok?'meater-ok':'meater-warn')+'">'+esc(state(p,s))+'</span><small>À cœur'+(testing&&!s.enabled?' · test':'')+'</small><div class="meater-value">'+(ok?format(p.internal_c):"— °C")+'</div><small>Ambiante indiquée : '+(ok?format(p.ambient_c):"—")+'</small><small>Mesure : '+time(p?.measured_at)+'</small></article>';
 }).join("")+'</div></section>').join("");
 }
 function notice(s){return '<p class="muted">'+(s.enabled?"Collecte automatique active":s.configured?"Compte enregistré · collecte suspendue":"En attente de configuration")+' · '+(s.professional_permission_confirmed?"Autorisation professionnelle déclarée":"Autorisation professionnelle MEATER requise")+'</p>'+(s.last_error?'<p class="meater-error">'+esc(s.last_error)+'</p>':'');}
 function mountAdmin(root,api,manage){
  if(!root||root.dataset.meaterMounted)return;root.dataset.meaterMounted="1";
  root.innerHTML='<section class="card"><h2>Configuration MEATER · 3 stations / 12 sondes</h2><p>Utilisez le même compte MEATER Cloud pour les trois stations. La station et son numéro de sonde sont attribués après identification physique, jamais déduits du nom Cloud.</p><p class="meater-error">Avant toute utilisation professionnelle, obtenez l’autorisation écrite de MEATER pour le matériel et le Cloud/API. L’intégration reste bloquée sans cette référence. Les validations de température HACCP restent manuelles.</p>'+
  (manage?'<form data-meater-permission class="meater-form"><label>Référence de l’autorisation écrite MEATER<input name="reference" minlength="5" maxlength="500" required placeholder="Date et référence du courrier / e-mail"></label><button type="submit" class="btn secondary">Enregistrer l’autorisation</button></form><form data-meater-login class="meater-form"><label>E-mail du compte MEATER Cloud<input name="email" type="email" required autocomplete="off"></label><label>Mot de passe MEATER<input name="password" type="password" required autocomplete="new-password"></label><button type="submit" class="btn primary">Connecter le compte</button></form>':'')+
  '<p data-meater-msg role="status" aria-live="polite"></p><div data-meater-state></div></section>';
  const dest=root.querySelector("[data-meater-state]"),msg=root.querySelector("[data-meater-msg]");let busy=false,s=null;
  function qualification(p){return '<details class="meater-qualification"><summary>Dossier de qualification de la sonde</summary><p>Critère interne proposé : écart absolu + incertitude du référent ≤ 0,5 °C aux deux points ; durée de validité interne : 1 an. Ce n’est pas un seuil légal universel. À valider dans le PMS.</p><form data-meater-qualification="'+esc(p.device_id)+'" class="meater-form"><label>Certificat fabricant (référence)<input required name="manufacturer_certificate" minlength="3" maxlength="240"></label><label>Certificat thermomètre de référence<input required name="reference_certificate" minlength="3" maxlength="240"></label>'+
  [["cold_ref","Référence près de 0 °C",-2,5],["cold_probe","Sonde au point froid",-10,105],["hot_ref","Référence près de 63–70 °C",60,75],["hot_probe","Sonde au point chaud",-10,105],["reference_uncertainty","Incertitude du référent (°C)",0,0.5]].map(([key,title,min,max])=>'<label>'+title+'<input name="'+key+'" type="number" required step="0.01" min="'+min+'" max="'+max+'"></label>').join("")+
  '<label class="meater-check"><input type="checkbox" name="transmission_verified"> Identification et transmission vérifiées dans les fours</label><label class="meater-check"><input type="checkbox" name="hygiene_verified"> Aptitude contact alimentaire, insertion, nettoyage et désinfection vérifiés</label><button class="btn primary" type="submit">Enregistrer le résultat de qualification</button></form></details>';}
  function render(){
   if(!root.isConnected)return;
   const list=s.probes||[];
   const login=root.querySelector("[data-meater-login]");if(login)for(const el of login.elements)el.disabled=!s.professional_permission_confirmed;
   dest.innerHTML=notice(s)+'<p>'+list.filter(p=>p.slot).length+' / 12 associées · '+list.filter(qualified).length+' / 12 qualifiées · '+list.filter(p=>fresh(p,s)).length+' sondes détectées récemment.</p>'+
   (manage?'<div class="meater-actions"><button type="button" data-meater-test class="btn secondary" '+(!s.configured||!s.professional_permission_confirmed?'disabled':'')+'>Tester / détecter les sondes</button><button type="button" data-meater-refresh class="btn secondary">Actualiser</button><button type="button" data-meater-enable="'+(!s.enabled)+'" class="btn primary" '+(!s.configured||!s.professional_permission_confirmed?'disabled':'')+'>'+(s.enabled?"Suspendre":"Activer")+' la collecte</button>'+(s.professional_permission_confirmed?'<button type="button" data-meater-revoke class="btn secondary">Retirer l’autorisation</button>':'')+'</div>':'')+
   tiles(s,true)+'<h3>Identification et qualification</h3><p>Retirez et identifiez les sondes une par une. Un certificat individuel est disponible dans l’application MEATER. Conservez les originaux avec les pièces du PMS.</p>'+
   (list.length?list.map(p=>'<div class="meater-device"><strong>'+esc(label(p))+'</strong><div class="muted">ID : '+esc(p.device_id)+' · '+esc(state(p,s))+' · Qualification valable jusqu’au '+time(p.qualification_expires_at)+'</div>'+
    (manage?'<form data-meater-probe="'+esc(p.device_id)+'" class="meater-form"><label>Emplacement physique<select name="slot"><option value="">Non associée</option>'+slots.map(i=>'<option value="'+i+'" '+(p.slot===i?'selected':'')+' '+(list.some(q=>q.device_id!==p.device_id&&q.slot===i)?'disabled':'')+'>'+physical(i)+'</option>').join("")+'</select></label><label>Nom<input required name="label" maxlength="80" value="'+esc(p.label||physical(p.slot))+'"></label><button type="submit" class="btn secondary">Enregistrer l’affectation</button></form>'+(p.slot?qualification(p):''):'')+'</div>').join(""):'<p>Aucune sonde détectée. Les douze emplacements sont réservés, sans données fictives.</p>');
  }
  async function run(action,body){if(busy)return;busy=true;msg.textContent="Chargement…";try{const r=action?await api(action,"POST",body):null;s=await api("meater-status");render();msg.textContent=r?.skipped?"Test récent : réessayez dans 30 secondes.":r?.recorded?(r.qualified?"Qualification enregistrée : critères internes satisfaits.":"Qualification enregistrée : non validée. Sonde bloquée."):"État actualisé.";}catch(err){msg.textContent=err.message||"Opération impossible.";}finally{busy=false;}}
  root.addEventListener("submit",ev=>{const f=ev.target;if(!f.matches("[data-meater-permission],[data-meater-login],[data-meater-probe],[data-meater-qualification]"))return;ev.preventDefault();if(!manage||busy)return;const fd=new FormData(f),v=Object.fromEntries(fd.entries());
   if(f.matches("[data-meater-permission]")){if(confirm("Confirmez-vous disposer d’une autorisation écrite du fabricant couvrant l’usage professionnel et l’API ?"))run("meater-permission",{reference:v.reference});}
   else if(f.matches("[data-meater-login]")){if(s?.configured&&!confirm("Reconnexion : les qualifications et associations actives seront réinitialisées. Continuer ?"))return;f.elements.password.value="";run("meater-login",{email:v.email,password:v.password});}
   else if(f.matches("[data-meater-probe]"))run("meater-probe-config",{device_id:f.dataset.meaterProbe,slot:v.slot?Number(v.slot):null,label:v.label,qualified:false});
   else {for(const k of ["cold_ref","cold_probe","hot_ref","hot_probe","reference_uncertainty"])v[k]=Number(v[k]);v.transmission_verified=fd.has("transmission_verified");v.hygiene_verified=fd.has("hygiene_verified");run("meater-qualification",{device_id:f.dataset.meaterQualification,evidence:v});}
  });
  root.addEventListener("click",ev=>{if(!manage||busy)return;const b=ev.target.closest("button");if(!b)return;if(b.hasAttribute("data-meater-test"))run("meater-test",{});else if(b.hasAttribute("data-meater-refresh"))run(null,null);else if(b.hasAttribute("data-meater-enable"))run("meater-enable",{enabled:b.dataset.meaterEnable==="true"});else if(b.hasAttribute("data-meater-revoke")&&confirm("Retirer l’autorisation et suspendre la collecte ?"))run("meater-permission",{reference:null});});
  run(null,null);
 }
 function poll(root,api,render){let pending=false;async function refresh(){if(!root.isConnected||document.hidden||pending)return;pending=true;try{const s=await api("meater-status");if(root.isConnected)render(s);}catch{if(root.isConnected)render(null);}finally{pending=false;}}refresh();const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}refresh();},30000);return refresh;}
 function mountDashboard(root,api){if(!root)return;poll(root,api,s=>{root.innerHTML='<section class="card"><h2>MEATER Pro XL · 12 sondes</h2>'+(s?notice(s)+tiles(s):'<p class="meater-error">État indisponible. Contrôles manuels disponibles.</p>')+'<button class="btn btn-outline btn-small" type="button" data-go="reheat">Voir les cycles</button></section>';});}
 function mountKitchen(root,api,getData){
  if(!root)return;
  root.innerHTML='<section class="card"><h2>MEATER Pro XL · suivi complémentaire</h2><p>La température de départ et la validation finale restent manuelles. Démarrez le cycle avant d’associer une sonde physique qualifiée, avec une cuisson MEATER active.</p><p data-meater-msg role="status"></p><div data-meater-cycle-state></div></section>';
  const dest=root.querySelector("[data-meater-cycle-state]"),msg=root.querySelector("[data-meater-msg]");let busy=false;
  const refresh=poll(root,api,s=>{
   if(busy)return;
   if(!s){dest.innerHTML='<p class="meater-error">Connexion indisponible. Continuez les contrôles manuels.</p>';return;}
   const d=getData();if(!d)return;const selected=Object.fromEntries(Array.from(dest.querySelectorAll("select[data-meater-cycle]")).map(x=>[x.dataset.meaterCycle,x.value]));
   const canAttach=d.me.scope==="staff"&&!d.me.existingAccount;
   dest.innerHTML=notice(s)+tiles(s)+d.reheats.filter(r=>r.status==="en_cours").map(r=>{
    const l=links(s).find(x=>x.reheat_id===r.id),p=l&&(s.probes||[]).find(x=>x.device_id===l.device_id);
    const choices=(s.probes||[]).filter(x=>fresh(x,s)&&qualified(x)&&x.cook_id&&x.cook_state==="Started"&&!linked(x,s));
    return '<div class="meater-device"><strong>'+esc((r.dish_type_label_snapshot||"Plat")+" · "+(r.oven_label_snapshot||"Four "+r.oven_number))+'</strong>'+
     (l?'<p>'+esc(label(p))+' · '+(p&&valid(p,s,l)?format(p.internal_c)+(Number(p.internal_c)>=Math.max(63,Number(r.target_end_c||63))?' · Cible indicative atteinte, vérifier manuellement':''):'Mesure indisponible ou cuisson différente')+'</p>':canAttach&&r.started_by===d.me.id&&s.enabled?'<form data-meater-attach="'+esc(r.id)+'" class="meater-form"><label>Sonde<select required name="device_id" data-meater-cycle="'+esc(r.id)+'"><option value="">Sélectionner</option>'+choices.map(x=>'<option value="'+esc(x.device_id)+'" '+(selected[r.id]===x.device_id?'selected':'')+'>'+esc(label(x))+' ('+physical(x.slot)+')</option>').join("")+'</select></label><button type="submit" class="btn btn-outline" '+(!choices.length?'disabled':'')+'>Associer au plat</button></form>':'<p class="muted">Aucune sonde associée.</p>')+'</div>';
   }).join("");
  });
  root.addEventListener("submit",async ev=>{const f=ev.target;if(!f.matches("[data-meater-attach]"))return;ev.preventDefault();if(busy)return;busy=true;try{await api("meater-attach","POST",{reheat_id:f.dataset.meaterAttach,device_id:new FormData(f).get("device_id")});msg.textContent="Sonde associée au cycle.";}catch(err){msg.textContent=err.message;}finally{busy=false;refresh();}});
 }
 window.KitchenMeater={mountAdmin,mountDashboard,mountKitchen};
})();
