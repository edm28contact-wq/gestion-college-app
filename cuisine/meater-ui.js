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
 const state=(p,s)=>!p?"En attente d’association":!fresh(p,s)?"Aucune mesure récente":!s.enabled?"Connectée · essai":!qualified(p)?"À qualifier":linked(p,s)?(valid(p,s,linked(p,s))?"Cycle associé":"Association à contrôler"):p.cook_state==="Started"?"Disponible pour un cycle":"Connectée";
 function lastKnown(p){
  return p?.internal_c!=null&&Number.isFinite(Number(p.internal_c))&&Number.isFinite(Date.parse(p.measured_at))?'<small class="meater-warn">Dernière valeur connue (non actualisée) : '+format(p.internal_c)+'</small>':'';
 }
 function tiles(s,testing=false,compact=false){
 return stations.map((name,i)=>compact&&!slots.slice(i*4,i*4+4).some(slot=>(s.probes||[]).some(p=>p.slot===slot))?"":'<section class="meater-station"><h3>Station '+name+'</h3><div class="meater-grid">'+slots.slice(i*4,i*4+4).filter(slot=>!compact||(s.probes||[]).some(p=>p.slot===slot)).map(slot=>{
  const p=(s.probes||[]).find(x=>x.slot===slot),l=p&&linked(p,s),ok=fresh(p,s)&&(testing||(s.enabled&&qualified(p)))&&(!l||valid(p,s,l));
  return '<article class="meater-tile"><strong>'+esc(p?.label||"Sonde "+((slot-1)%4+1))+'</strong><span class="meater-state '+(ok?'meater-ok':'meater-warn')+'">'+esc(state(p,s))+'</span><small>À cœur'+(testing&&!s.enabled?' · test':'')+'</small><div class="meater-value">'+(ok?format(p.internal_c):"— °C")+'</div><small>Ambiante indiquée : '+(ok?format(p.ambient_c):"—")+'</small><small>Mesure : '+time(p?.measured_at)+'</small>'+(!ok&&testing?lastKnown(p):"")+'</article>';
 }).join("")+'</div></section>').join("");
 }
 function probeReadingMarkup(p,s){
  const ok=fresh(p,s),suffix=p.device_id.slice(-8);
  return '<div class="meater-tile"><strong>Identifiant : …'+esc(suffix)+'</strong><span class="meater-state '+(ok?'meater-ok':'meater-warn')+'">'+(ok?'Mesure récente':'Mesure indisponible ou ancienne')+'</span><small>À cœur · '+(p.slot?esc(physical(p.slot)):'Non associée')+'</small><div class="meater-value">'+(ok?format(p.internal_c):"— °C")+'</div><small>Ambiante : '+(ok?format(p.ambient_c):"—")+'</small><small>Dernière mesure : '+time(p.measured_at)+'</small></div>';
 }
 function notice(s){return (s.test_active?'<p class="meater-warn"><strong>MODE ESSAI · mesures indicatives, hors registre HACCP</strong> · Jusqu’au '+time(s.test_until)+'</p>':'<p class="muted">'+(s.enabled?"Collecte automatique de production active":s.configured?"Compte enregistré · collecte automatique suspendue":"En attente de configuration")+'</p>')+(s.last_error?'<p class="meater-error">'+esc(s.last_error)+'</p>':'');}
 function mountAdmin(root,api,manage){
  if(!root||root.dataset.meaterMounted)return;root.dataset.meaterMounted="1";
  root.innerHTML='<section class="card"><h2>Configuration MEATER · 3 stations / 12 sondes</h2><p>Utilisez le même compte MEATER Cloud pour les trois stations. La station et son numéro de sonde sont attribués après identification physique, jamais déduits du nom Cloud.</p><p>1. Connectez le compte MEATER Cloud. 2. Retirez les sondes du socle et vérifiez qu’elles remontent une température dans MEATER Cloud, puis testez la détection. 3. Attribuez les sondes reçues aux emplacements de la station A.</p><p class="muted">Connectez votre compte, détectez les sondes puis attribuez-les à leur emplacement physique. Les mesures de test restent hors du registre HACCP. La qualification des sondes et la validation manuelle des températures restent nécessaires pour le suivi des plats.</p>'+
  (manage?'<form data-meater-login class="meater-form"><label>E-mail du compte MEATER Cloud<input name="email" type="email" required autocomplete="off"></label><label>Mot de passe MEATER<input name="password" type="password" required autocomplete="new-password"></label><button type="submit" class="btn primary">Connecter le compte MEATER</button></form>':'')+
  '<p data-meater-msg role="status" aria-live="polite"></p><div data-meater-state></div></section>';
  const dest=root.querySelector("[data-meater-state]"),msg=root.querySelector("[data-meater-msg]");let busy=false,s=null,refreshing=false,revision=0;
  function qualification(p){return '<details class="meater-qualification"><summary>Dossier de qualification de la sonde</summary><p>Critère interne proposé : écart absolu + incertitude du référent ≤ 0,5 °C aux deux points ; durée de validité interne : 1 an. Ce n’est pas un seuil légal universel. À valider dans le PMS.</p><form data-meater-qualification="'+esc(p.device_id)+'" class="meater-form"><label>Certificat fabricant (référence)<input required name="manufacturer_certificate" minlength="3" maxlength="240"></label><label>Certificat thermomètre de référence<input required name="reference_certificate" minlength="3" maxlength="240"></label>'+
  [["cold_ref","Référence près de 0 °C",-2,5],["cold_probe","Sonde au point froid",-10,105],["hot_ref","Référence près de 63–70 °C",60,75],["hot_probe","Sonde au point chaud",-10,105],["reference_uncertainty","Incertitude du référent (°C)",0,0.5]].map(([key,title,min,max])=>'<label>'+title+'<input name="'+key+'" type="number" required step="0.01" min="'+min+'" max="'+max+'"></label>').join("")+
  '<label class="meater-check"><input type="checkbox" name="transmission_verified"> Identification et transmission vérifiées dans les fours</label><label class="meater-check"><input type="checkbox" name="hygiene_verified"> Aptitude contact alimentaire, insertion, nettoyage et désinfection vérifiés</label><button class="btn primary" type="submit">Enregistrer le résultat de qualification</button></form></details>';}
  function liveMarkup(){
   const list=s.probes||[];
   return notice(s)+'<p><strong>Station A : '+list.filter(p=>p.slot>=1&&p.slot<=4).length+' / 4 associées</strong> · Total : '+list.filter(p=>p.slot).length+' / 12 associées · '+list.filter(qualified).length+' / 12 qualifiées · '+list.filter(p=>fresh(p,s)).length+' sondes détectées récemment.</p><p class="muted">Dernier test réussi : '+time(s.last_ok_at)+'</p>'+
   (manage?'<div class="meater-actions"><button type="button" data-meater-test class="btn secondary" '+(!s.configured?'disabled':'')+'>Tester / détecter les sondes</button><button type="button" data-meater-refresh class="btn secondary">Actualiser les températures</button><button type="button" data-meater-test-mode="'+(!s.test_active)+'" class="btn secondary" '+(!s.configured||s.enabled?'disabled':'')+'>'+(s.test_active?"Arrêter le mode essai":"Démarrer un essai de 2 h")+'</button><button type="button" data-meater-enable="'+(!s.enabled)+'" class="btn primary" '+(!s.enabled&&(!s.configured||!list.some(p=>qualified(p)&&fresh(p,s)))?'disabled':'')+'>'+(s.enabled?"Suspendre":"Activer")+' la collecte de production</button>'+'</div>':'')+
   (!s.enabled&&s.configured&&!list.some(p=>qualified(p)&&fresh(p,s))?'<p class="muted">La collecte de production nécessite une qualification réelle. Le mode essai permet de suivre les quatre sondes toutes les 30 secondes sans remplir le dossier.</p>':'')+
   (list.some(p=>!p.slot)?'<h3>Sondes détectées non associées · '+list.filter(p=>!p.slot).length+'</h3><p>Les températures sont visibles sans affectation ni qualification. Identifiez chaque sonde physiquement avant de choisir son emplacement.</p><div class="meater-grid">'+list.filter(p=>!p.slot).map(p=>probeReadingMarkup(p,s)).join("")+'</div>':'')+
   tiles(s,true);
  }
  function readingLine(p){
   return 'À cœur : '+(fresh(p,s)?format(p.internal_c):"—")+' · Ambiante : '+(fresh(p,s)?format(p.ambient_c):"—")+' · '+time(p.measured_at);
  }
  function render(){
   if(!root.isConnected)return;
   const list=s.probes||[];
   const login=root.querySelector("[data-meater-login]");if(login)for(const el of login.elements)el.disabled=false;
   dest.innerHTML='<div data-meater-live>'+liveMarkup()+'</div><h3>Identification et qualification</h3><p>Retirez et identifiez les sondes une par une. Un certificat individuel est disponible dans l’application MEATER. Conservez les originaux avec les pièces du PMS.</p>'+
   (list.length?list.map(p=>'<div class="meater-device"><strong>'+esc(label(p))+'</strong><div class="muted">ID : '+esc(p.device_id)+' · '+esc(state(p,s))+' · Qualification valable jusqu’au '+time(p.qualification_expires_at)+'</div><p data-meater-reading="'+esc(p.device_id)+'">'+readingLine(p)+'</p>'+
    (manage?'<form data-meater-probe="'+esc(p.device_id)+'" class="meater-form"><label>Emplacement physique<select name="slot"><option value="">Non associée</option>'+slots.map(i=>'<option value="'+i+'" '+(p.slot===i?'selected':'')+' '+(list.some(q=>q.device_id!==p.device_id&&q.slot===i)?'disabled':'')+'>'+physical(i)+'</option>').join("")+'</select></label><label>Nom<input required name="label" maxlength="80" value="'+esc(p.label||physical(p.slot))+'"></label><button type="submit" class="btn secondary">Enregistrer l’affectation</button></form>'+(p.slot?qualification(p):''):'')+'</div>').join(""):'<p>Aucune sonde détectée. Vérifiez la connexion Wi-Fi/Cloud de la station et retirez les sondes du socle. Lancez une cuisson d’essai dans l’application si les mesures ne remontent pas. Relancez le test après 30 secondes.</p>');
  }
  async function refreshLive(){
   if(!root.isConnected||document.hidden||busy||refreshing||!s?.configured)return;
   refreshing=true;const version=revision;
   try{
    const next=await api("meater-status");
    if(!root.isConnected||busy||version!==revision)return;
    s=next;
    const live=dest.querySelector("[data-meater-live]");if(live)live.innerHTML=liveMarkup();
    const byId=new Map((s.probes||[]).map(p=>[p.device_id,p]));
    for(const el of dest.querySelectorAll("[data-meater-reading]")){
     const p=byId.get(el.dataset.meaterReading);el.textContent=p?readingLine(p):"Mesure indisponible";
    }
   }catch{
    if(root.isConnected&&!busy&&version===revision){
     s={...s,last_error:"Actualisation impossible. Les températures ne sont pas confirmées."};
     const live=dest.querySelector("[data-meater-live]");if(live)live.innerHTML=liveMarkup();
     for(const el of dest.querySelectorAll("[data-meater-reading]"))el.textContent="Mesure indisponible";
    }
   }finally{refreshing=false;}
  }
  async function run(action,body){
   if(busy)return;busy=true;revision++;msg.textContent="Chargement…";
   try{
    let r=action?await api(action,"POST",body):null;
    if(action==="meater-login"){
     try{r=await api("meater-test","POST",{});}catch(err){
      try{s=await api("meater-status");render();}catch{}
      msg.textContent="Compte connecté, mais premier test impossible : "+(err.message||"Erreur de détection.")+" Réessayez avec Tester / détecter les sondes.";
      return;
     }
    }
    s=await api("meater-status");render();
    msg.textContent=r?.skipped?"Test récent : réessayez dans 30 secondes.":action==="meater-login"?(Number(r?.received)>0?"Compte connecté · "+r.received+" sonde(s) détectée(s). Enregistrez leur affectation.":"Compte connecté. Aucune mesure récente : vérifiez MEATER Cloud et relancez le test."):action==="meater-test"?(Number(r?.received)>0?r.received+" sonde(s) avec mesure récente détectée(s). Identifiez-les et enregistrez leur affectation.":"Connexion réussie, aucune mesure récente. Vérifiez MEATER Cloud et relancez le test."):r?.recorded?(r.qualified?"Qualification enregistrée : critères internes satisfaits.":"Qualification enregistrée : non validée. Sonde bloquée."):action==="meater-probe-config"?"Affectation enregistrée.":action==="meater-test-mode"?(s.test_active?"Essai automatique actif pour 2 h. Aucune mesure ajoutée au registre HACCP.":"Mode essai arrêté."):"État actualisé.";
   }catch(err){
    const step=({"meater-login":"Connexion MEATER","meater-test":"Détection des sondes","meater-probe-config":"Affectation de la sonde","meater-qualification":"Qualification","meater-enable":"Collecte automatique","meater-test-mode":"Mode essai"})[action]||"Chargement MEATER";
    const message=step+" : "+(err.message||"Opération impossible.");
    if(action==="meater-test"){try{s=await api("meater-status");render();}catch{}}
    msg.textContent=message;
   }finally{busy=false;}
  }
  root.addEventListener("submit",ev=>{const f=ev.target;if(!f.matches("[data-meater-login],[data-meater-probe],[data-meater-qualification]"))return;ev.preventDefault();if(!manage||busy)return;const fd=new FormData(f),v=Object.fromEntries(fd.entries());
   if(f.matches("[data-meater-login]")){if(s?.configured&&!confirm("Reconnexion : les qualifications et associations actives seront réinitialisées. Continuer ?"))return;f.elements.password.value="";run("meater-login",{email:v.email,password:v.password});}
   else if(f.matches("[data-meater-probe]"))run("meater-probe-config",{device_id:f.dataset.meaterProbe,slot:v.slot?Number(v.slot):null,label:v.label,qualified:false});
   else {for(const k of ["cold_ref","cold_probe","hot_ref","hot_probe","reference_uncertainty"])v[k]=Number(v[k]);v.transmission_verified=fd.has("transmission_verified");v.hygiene_verified=fd.has("hygiene_verified");run("meater-qualification",{device_id:f.dataset.meaterQualification,evidence:v});}
  });
  root.addEventListener("click",ev=>{if(!manage||busy)return;const b=ev.target.closest("button");if(!b)return;if(b.hasAttribute("data-meater-test"))run("meater-test",{});else if(b.hasAttribute("data-meater-refresh")){if(s?.configured)run("meater-test",{});else run(null,null);}else if(b.hasAttribute("data-meater-test-mode"))run("meater-test-mode",{enabled:b.dataset.meaterTestMode==="true"});else if(b.hasAttribute("data-meater-enable"))run("meater-enable",{enabled:b.dataset.meaterEnable==="true"});});
  const liveTimer=setInterval(()=>{if(!root.isConnected){clearInterval(liveTimer);return;}void refreshLive();},30000);
  run(null,null).then(()=>{
   if(root.isConnected&&manage&&s?.configured&&!(s.probes||[]).some(p=>fresh(p,s)))void run("meater-test",{});
  });
 }
 function poll(root,api,render){let pending=false;async function refresh(){if(!root.isConnected||document.hidden||pending)return;pending=true;try{const s=await api("meater-status");if(root.isConnected)render(s);}catch{if(root.isConnected)render(null);}finally{pending=false;}}refresh();const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}refresh();},30000);return refresh;}
 function dashboardMarkup(s,diagnostic=false){
  if(!s)return '<section class="card"><h2>Sondes MEATER</h2><p class="meater-error">État indisponible. Contrôles manuels nécessaires.</p></section>';
  const assigned=(s.probes||[]).filter(p=>Number.isInteger(p.slot)&&p.slot>=1&&p.slot<=12).length;
  return '<section class="card"><h2>Sondes MEATER · '+assigned+' / 12 associées</h2>'+notice(s)+(diagnostic&&!s.enabled&&!s.test_active?'<p class="muted">Consultation de diagnostic uniquement · hors registre HACCP.</p>':'')+(assigned&&!(s.probes||[]).some(p=>p.slot&&fresh(p,s))?'<p class="meater-warn">Aucune mesure MEATER récente : vérifiez les sondes hors du socle et la connexion Bluetooth/Wi-Fi de la station à MEATER Cloud. Les anciennes températures ne sont pas des mesures en direct.</p>':'')+(assigned?tiles(s,s.test_active===true||diagnostic,true):'<p class="muted">Aucune sonde associée. Aucune mesure disponible.</p>')+'</section>';
 }
 function mountDashboard(root,api,{diagnostic=false}={}){if(!root)return;poll(root,api,s=>{root.innerHTML=dashboardMarkup(s,diagnostic);});}
 function mountKitchen(root,api,getData,{showTiles=true}={}){
  if(!root)return;
  root.innerHTML='<section class="card"><h2>MEATER Pro XL · suivi complémentaire</h2><p>La température de départ et la validation finale restent manuelles. Démarrez le cycle avant d’associer une sonde physique qualifiée, avec une cuisson MEATER active.</p><p data-meater-msg role="status"></p><div data-meater-cycle-state></div></section>';
  const dest=root.querySelector("[data-meater-cycle-state]"),msg=root.querySelector("[data-meater-msg]");let busy=false;
  const refresh=poll(root,api,s=>{
   if(busy)return;
   if(!s){dest.innerHTML='<p class="meater-error">Connexion indisponible. Continuez les contrôles manuels.</p>';return;}
   const d=getData();if(!d)return;const selected=Object.fromEntries(Array.from(dest.querySelectorAll("select[data-meater-cycle]")).map(x=>[x.dataset.meaterCycle,x.value]));
   const canAttach=d.me.scope==="staff"&&!d.me.existingAccount;
   dest.innerHTML=notice(s)+(showTiles?tiles(s,s.test_active===true):"")+d.reheats.filter(r=>r.status==="en_cours").map(r=>{
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
