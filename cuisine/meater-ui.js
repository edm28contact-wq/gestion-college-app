"use strict";
(function(){
 const slots=Array.from({length:12},(_,i)=>i+1),stations=["A","B","C"];
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const format=v=>v!=null&&Number.isFinite(Number(v))?Number(v).toLocaleString("fr-FR",{maximumFractionDigits:2})+" °C":"—";
 const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"}):"—";
 const physical=i=>i?"Station "+stations[Math.floor((i-1)/4)]+" · sonde "+((i-1)%4+1):"Non associée";
 const label=p=>p?.label||physical(p?.slot);
 const serverNow=s=>Number.isFinite(Date.parse(s?.now||""))?Date.parse(s.now):Date.now();
 const fresh=(p,s)=>!!p&&p.fresh===true&&!s.last_error&&Date.parse(p.measured_at)>=serverNow(s)-120000&&Date.parse(p.measured_at)<=serverNow(s)+10000;
 const qualified=p=>!!p?.qualified_at&&Date.parse(p.qualification_expires_at)>Date.now();
 const links=s=>s.links||[];
 const linked=(p,s)=>links(s).find(l=>l.device_id===p.device_id);
 const valid=(p,s,l)=>s.enabled&&fresh(p,s)&&qualified(p)&&p.cook_id===l.cook_id&&Date.parse(p.measured_at)>=Date.parse(l.attached_at);
 const unavailable=(p,s)=>{const age=serverNow(s)-Date.parse(s?.last_ok_at||"");return s?.last_error?"Valeur indisponible — erreur Cloud":p?.present===false&&s?.configured&&age>=-10000&&age<=30000?"Valeur indisponible — sonde en charge (présumée)":"Valeur indisponible — mesure ancienne ou connexion non confirmée";};
 const state=(p,s)=>!p?"En attente d’association":!fresh(p,s)?unavailable(p,s):!s.enabled?"Connectée · essai":!qualified(p)?"À qualifier":linked(p,s)?(valid(p,s,linked(p,s))?"Cycle associé":"Association à contrôler"):p.cook_state==="Started"?"Disponible pour un cycle":"Connectée";
 function lastKnown(p){
  return p?.internal_c!=null&&Number.isFinite(Number(p.internal_c))&&Number.isFinite(Date.parse(p.measured_at))?'<small class="meater-warn">Dernière valeur connue (non actualisée) : '+format(p.internal_c)+'</small>':'';
 }
 function displayable(p,s,testing){
  const l=p&&linked(p,s);
  return fresh(p,s)&&(testing||(s.enabled&&qualified(p)))&&(!l||valid(p,s,l));
 }
 function tiles(s,testing=false,compact=false,graphs=false){
 return stations.map((name,i)=>compact&&!slots.slice(i*4,i*4+4).some(slot=>(s.probes||[]).some(p=>p.slot===slot))?"":'<section class="meater-station"><h3>Station '+name+'</h3><div class="meater-grid">'+slots.slice(i*4,i*4+4).filter(slot=>!compact||(s.probes||[]).some(p=>p.slot===slot)).map(slot=>{
  const p=(s.probes||[]).find(x=>x.slot===slot),ok=displayable(p,s,testing);
  return '<article class="meater-tile"><strong>'+esc(p?.label||"Sonde "+((slot-1)%4+1))+'</strong><span class="meater-state '+(ok?'meater-ok':'meater-warn')+'">'+esc(state(p,s))+'</span><small>À cœur'+(testing&&!s.enabled?' · test':'')+'</small><div class="meater-value">'+(ok?format(p.internal_c):"— °C")+'</div><small>Ambiante indiquée : '+(ok?format(p.ambient_c):"—")+'</small><small>Mesure : '+time(p?.measured_at)+'</small>'+(!ok&&testing?lastKnown(p):"")+(graphs&&p?'<button type="button" class="btn secondary meater-graph-open" data-meater-graph="'+esc(p.device_id)+'">Voir le graphique</button>':'')+'</article>';
 }).join("")+'</div></section>').join("");
 }
 function probeReadingMarkup(p,s){
  const ok=fresh(p,s),suffix=p.device_id.slice(-8);
  return '<div class="meater-tile"><strong>Identifiant : …'+esc(suffix)+'</strong><span class="meater-state '+(ok?'meater-ok':'meater-warn')+'">'+(ok?'Mesure récente':esc(unavailable(p,s)))+'</span><small>À cœur · '+(p.slot?esc(physical(p.slot)):'Non associée')+'</small><div class="meater-value">'+(ok?format(p.internal_c):"— °C")+'</div><small>Ambiante : '+(ok?format(p.ambient_c):"—")+'</small><small>Dernière mesure : '+time(p.measured_at)+'</small></div>';
 }
 function notice(s){return (s.test_active?'<p class="meater-warn"><strong>MODE ESSAI · mesures indicatives, hors registre HACCP</strong> · Jusqu’au '+time(s.test_until)+'</p>':'<p class="muted">'+(s.enabled?"Collecte automatique de production active":s.configured?"Surveillance technique automatique active · hors registre HACCP":"En attente de configuration")+'</p>')+(s.last_error?'<p class="meater-error">'+esc(s.last_error)+'</p>':'');}
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
   (!s.enabled&&s.configured&&!list.some(p=>qualified(p)&&fresh(p,s))?'<p class="muted">La collecte de production nécessite une qualification réelle. La surveillance technique interroge les sondes toutes les 5 secondes, même hors mode essai. Les données restent hors registre HACCP.</p>':'')+
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
    msg.textContent=r?.skipped?"Collecte récente : la prochaine mesure sera actualisée automatiquement.":action==="meater-login"?(Number(r?.received)>0?"Compte connecté · "+r.received+" sonde(s) détectée(s). Enregistrez leur affectation.":"Compte connecté. Aucune mesure récente : vérifiez MEATER Cloud et relancez le test."):action==="meater-test"?(Number(r?.received)>0?r.received+" sonde(s) avec mesure récente détectée(s). Identifiez-les et enregistrez leur affectation.":"Connexion réussie, aucune mesure récente. Vérifiez MEATER Cloud et relancez le test."):r?.recorded?(r.qualified?"Qualification enregistrée : critères internes satisfaits.":"Qualification enregistrée : non validée. Sonde bloquée."):action==="meater-probe-config"?"Affectation enregistrée.":action==="meater-test-mode"?(s.test_active?"Essai automatique actif pour 2 h. Aucune mesure ajoutée au registre HACCP.":"Mode essai arrêté."):"État actualisé.";
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
  const liveTimer=setInterval(()=>{if(!root.isConnected){clearInterval(liveTimer);return;}void refreshLive();},5000);
  run(null,null).then(()=>{
   if(root.isConnected&&manage&&s?.configured&&!(s.probes||[]).some(p=>fresh(p,s)))void run("meater-test",{});
  });
 }
 function poll(root,api,render,action="meater-status",fastMode=()=>false){
  const steps=[5000,4000,3000,2000,1500,1200];
  let pending=null,timer=null,lastStarted=0,step=0,successes=0,backoff=0;
  const reset=()=>{step=0;successes=0;backoff=0;};
  const visible=()=>root.isConnected&&!document.hidden&&!root.closest("[hidden]");
  function schedule(){
   if(timer!==null){clearTimeout(timer);timer=null;}
   if(!root.isConnected){document.removeEventListener("visibilitychange",resume);return;}
   const rapid=visible()&&fastMode();
   if(!rapid)reset();
   const delay=rapid?Math.max(100,(backoff||steps[step])-(Date.now()-lastStarted)):visible()&&action==="meater-live"?5000:30000;
   timer=setTimeout(()=>{timer=null;void refresh();},delay);
  }
  function refresh(){
   if(!visible()){schedule();return Promise.resolve();}
   if(pending)return pending;
   if(timer!==null){clearTimeout(timer);timer=null;}
   const route=fastMode()?"meater-graph-live":action;
   lastStarted=Date.now();
   pending=Promise.resolve().then(()=>api(route)).then(s=>{
    if(!Array.isArray(s?.probes))throw Error("Réponse MEATER invalide");
    if(route==='meater-graph-live'&&fastMode()){
     if(s.last_error){successes=0;step=Math.max(0,step-1);backoff=/limite de requêtes/i.test(s.last_error)?60000:Math.min(30000,Math.max(10000,backoff*2));}
     else if(!s.cached&&Number(s.cloud_fresh_count)>0){backoff=0;if(++successes>=10){step=Math.min(step+1,steps.length-1);successes=0;}}
    }
    if(root.isConnected)render(s);
   }).catch(()=>{if(route==='meater-graph-live'){successes=0;step=Math.max(0,step-1);backoff=Math.min(30000,Math.max(10000,backoff*2));}if(root.isConnected)render(null);}).finally(()=>{pending=null;schedule();});
   return pending;
  }
  function resume(){if(visible())void refresh();else schedule();}
  refresh.reschedule=schedule;
  refresh.cadence=()=>backoff||steps[step];
  document.addEventListener("visibilitychange",resume);
  void refresh();return refresh;
 }
 function dashboardMarkup(s,diagnostic=false){
  if(!s)return '<section class="card"><h2>Sondes MEATER</h2><p class="meater-error">État indisponible. Contrôles manuels nécessaires.</p><button type="button" class="btn btn-outline btn-small" data-live-meater-refresh>Réessayer</button></section>';
  const assigned=(s.probes||[]).filter(p=>Number.isInteger(p.slot)&&p.slot>=1&&p.slot<=12).length;
  const cloud=s.preview?(s.last_error?"Erreur de communication Cloud":s.cloud_device_count===0?"Cloud connecté : 0 sonde transmise dans la dernière réponse.":Number.isInteger(s.cloud_device_count)?"Cloud connecté : "+s.cloud_device_count+" sonde(s) transmise(s), "+s.cloud_fresh_count+" mesure(s) récente(s) acceptée(s).":s.last_ok_at?"Dernière réponse Cloud valide · "+(s.probes||[]).filter(p=>fresh(p,s)).length+" mesure(s) récente(s).":"En attente d’une réponse Cloud."):"";
  return '<section class="card"><h2>Sondes MEATER · '+assigned+' / 12 associées</h2>'+(s.preview?'<button type="button" class="btn btn-outline btn-small" data-live-meater-refresh>Actualiser MEATER</button>':'')+notice(s)+(s.preview?'<p class="muted">Consultation indicative · '+(s.graph_requested?'graphique ouvert : interrogation rapide (limite globale MEATER Cloud : 60/min)':(s.enabled?'consultation toutes les 5 s · collecte HACCP toutes les 30 s':'surveillance automatique toutes les 5 secondes'))+', sans enregistrement supplémentaire dans le registre. Dernière réponse Cloud : '+time(s.last_ok_at)+'</p><p class="muted">'+esc(cloud)+(s.cached?' · Dernière interrogation réutilisée (limite globale).':'')+'</p>':'')+(diagnostic&&!s.enabled&&!s.test_active?'<p class="muted">Consultation de diagnostic uniquement · hors registre HACCP.</p>':'')+(assigned&&!(s.probes||[]).some(p=>p.slot&&fresh(p,s))?'<p class="meater-warn">Aucune mesure MEATER récente : vérifiez les sondes hors du socle et la connexion Bluetooth/Wi-Fi de la station à MEATER Cloud. Les anciennes températures ne sont pas des mesures en direct.</p>':'')+(assigned?tiles(s,s.test_active===true||diagnostic,true,true):'<p class="muted">Aucune sonde associée. Aucune mesure disponible.</p>')+'</section>';
 }
 const graphPeriods=[15,60,180],graphMaxAge=180*60000,graphMaxPoints=10801;
 function collectGraphSamples(history,s,diagnostic){
  if(!s){for(const entry of history.values())entry.interrupted=true;return;}
  const now=serverNow(s),assigned=(s.probes||[]).filter(p=>Number.isInteger(p.slot)&&p.slot>=1&&p.slot<=12&&typeof p.device_id==="string");
  const ids=new Set(assigned.map(p=>p.device_id));
  for(const id of history.keys())if(!ids.has(id))history.delete(id);
  for(const p of assigned){
   let entry=history.get(p.device_id);
   if(!entry||entry.slot!==p.slot){entry={slot:p.slot,points:[],interrupted:false};history.set(p.device_id,entry);}
   entry.points=entry.points.filter(q=>q.at>=now-graphMaxAge).slice(-graphMaxPoints);
   const at=Date.parse(p.measured_at),internal=p.internal_c==null?NaN:Number(p.internal_c),ambient=p.ambient_c==null?NaN:Number(p.ambient_c);
   if(!displayable(p,s,s.test_active===true||diagnostic)||!Number.isFinite(at)||!Number.isFinite(internal)){
    entry.interrupted=true;continue;
   }
   const last=entry.points[entry.points.length-1];
   if(last&&at<=last.at)continue;
   entry.points.push({at,internal,ambient:Number.isFinite(ambient)?ambient:null,gap:!!last&&(entry.interrupted||at-last.at>90000)});
   entry.interrupted=false;
   if(entry.points.length>graphMaxPoints)entry.points.shift();
  }
 }
 function graphMarkup(entry,s,p,minutes,diagnostic){
  const now=serverNow(s),points=(entry?.points||[]).filter(q=>q.at>=now-minutes*60000);
  const current=!!s&&!!p&&displayable(p,s,s.test_active===true||diagnostic);
  const fast=!!s&&s.graph_requested===true&&s.configured&&!s.enabled;
  const cadence=fast?"Mode adaptatif · interrogation de 5 à 1,2 s, selon les réponses MEATER Cloud":s?.enabled?"Suivi de production · interrogation toutes les 30 s":s?.last_error?"Erreur Cloud · reprise au rythme normal":"Surveillance technique toutes les 5 s";
  const status=cadence+' · '+(current?"Mesure récente":"Aucune nouvelle mesure confirmée · "+(p&&s?unavailable(p,s)+" · ":"")+"courbe interrompue si la transmission est coupée");
  const note='<p class="muted meater-graph-note">Historique temporaire depuis l’ouverture du tableau de bord. Une mesure réelle par horodatage, sans enregistrement HACCP. Les coupures de transmission ne sont pas interpolées.</p>';
  if(!points.length)return '<p class="'+(current?'muted':'meater-warn')+'">'+status+'</p><p>Aucune mesure récente dans cette période. Le graphique se remplira au fil des réponses MEATER.</p>'+note;
  const W=760,H=310,L=60,R=22,T=22,B=46;
  const start=Math.min(points[0].at,now-60000),end=Math.max(now,points[points.length-1].at,start+60000);
  const values=points.flatMap(q=>q.ambient===null?[q.internal]:[q.internal,q.ambient]);
  const rawMin=Math.min(...values),rawMax=Math.max(...values),span=Math.max(2,rawMax-rawMin),step=Math.max(0.5,Math.pow(10,Math.floor(Math.log10(span/4)))*Math.ceil(span/4/Math.pow(10,Math.floor(Math.log10(span/4)))));
  const min=Math.floor((rawMin-step*.5)/step)*step,max=Math.ceil((rawMax+step*.5)/step)*step;
  const x=at=>L+(at-start)/(end-start)*(W-L-R),y=v=>H-B-(v-min)/(max-min)*(H-T-B);
  const xy=n=>n.toFixed(2);
  const shortTime=at=>new Date(at).toLocaleTimeString("fr-FR",{timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit",second:end-start<5*60000?"2-digit":undefined});
  let grid="";
  for(let i=0;i<=4;i++){
   const v=min+(max-min)*i/4,yy=xy(y(v)),xx=xy(L+(W-L-R)*i/4),at=start+(end-start)*i/4;
   grid+='<path class="meater-graph-gridline" d="M '+L+' '+yy+' H '+(W-R)+' M '+xx+' '+T+' V '+(H-B)+'"/><text class="meater-graph-axis" x="'+(L-9)+'" y="'+xy(Number(yy)+4)+'" text-anchor="end">'+esc(v.toLocaleString("fr-FR",{maximumFractionDigits:1}))+'</text><text class="meater-graph-axis" x="'+xx+'" y="'+(H-B+24)+'" text-anchor="middle">'+esc(shortTime(at))+'</text>';
  }
  function series(key,kind,name){
   let path="",drawing=false,dots="",index=0;
   const dotStride=Math.max(1,Math.ceil(points.length/200));
   for(const q of points){
    const drawDot=index++%dotStride===0||index===points.length;
    const value=q[key];
    if(value===null||!Number.isFinite(value)){drawing=false;continue;}
    const px=xy(x(q.at)),py=xy(y(value));
    path+=(drawing&&!q.gap?" L ":" M ")+px+" "+py;drawing=true;
    if(drawDot)dots+='<circle class="meater-graph-dot '+kind+'" cx="'+px+'" cy="'+py+'" r="3"><title>'+esc(name+' : '+format(value)+' · '+time(new Date(q.at).toISOString()))+'</title></circle>';
   }
   return '<path class="meater-graph-line '+kind+'" d="'+path+'"/>'+dots;
  }
  const last=points[points.length-1];
  return '<p class="'+(current?'muted':'meater-warn')+'">'+status+'</p><div class="meater-graph-summary"><span><strong>'+format(last.internal)+'</strong> à cœur</span><span><strong>'+format(last.ambient)+'</strong> ambiante</span><span>'+points.length+' mesure(s) · dernière : '+time(new Date(last.at).toISOString())+'</span></div>'+
   '<div class="meater-graph-legend"><span class="meater-graph-key meater-graph-core">À cœur</span><span class="meater-graph-key meater-graph-ambient">Ambiante</span></div>'+
   '<svg class="meater-graph-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc("Évolution de la température MEATER en degrés Celsius. "+points.length+" mesures. Dernière température à cœur : "+format(last.internal)+".")+'"><text class="meater-graph-axis" x="8" y="14">°C</text>'+grid+series("internal","meater-graph-core","À cœur")+series("ambient","meater-graph-ambient","Ambiante")+'</svg>'+note;
 }
 function mountDashboard(root,api,{diagnostic=false,live=false}={}){
  if(!root)return;if(root.kitchenRefresh)return root.kitchenRefresh;
  root.innerHTML='<div data-meater-dashboard></div><section class="card meater-graph-panel" data-meater-graph-panel hidden><div class="meater-graph-header"><h3 data-meater-graph-title tabindex="-1">Graphique MEATER</h3><button type="button" class="btn secondary" data-meater-graph-close>Fermer le graphique</button></div><label class="meater-graph-period">Période <select data-meater-graph-period><option value="15">15 minutes</option><option value="60">1 heure</option><option value="180">3 heures</option></select></label><div data-meater-graph-content></div></section>';
  const dest=root.querySelector("[data-meater-dashboard]"),panel=root.querySelector("[data-meater-graph-panel]"),title=root.querySelector("[data-meater-graph-title]"),content=root.querySelector("[data-meater-graph-content]");
  const history=new Map(),showDiagnostics=diagnostic||live;let state=null,selected=null,minutes=15,fastAllowed=false;
  const fastMode=()=>live&&!!selected&&fastAllowed;
  function drawGraph(){
   if(!selected){panel.hidden=true;return;}
   const probe=(state?.probes||[]).find(p=>p.device_id===selected);
   if(state&&!probe){selected=null;panel.hidden=true;return;}
   panel.hidden=false;
   if(probe)title.textContent=label(probe)+" · Graphique en direct";
   content.innerHTML=graphMarkup(history.get(selected),state,probe,minutes,showDiagnostics)+(fastMode()&&root.kitchenRefresh?.cadence?'<p class="muted">Intervalle cible : '+(root.kitchenRefresh.cadence()/1000).toLocaleString('fr-FR')+' s</p>':'');
  }
  root.kitchenRefresh=poll(root,api,s=>{
   if(s)fastAllowed=!!s.configured&&!s.enabled&&s.graph_available!==false;
   state=s;collectGraphSamples(history,s,showDiagnostics);
   dest.innerHTML=dashboardMarkup(s,showDiagnostics);
   drawGraph();
  },live?"meater-live":"meater-status",fastMode);
  root.addEventListener("click",evt=>{
   if(evt.target.closest?.("[data-live-meater-refresh]")){void root.kitchenRefresh();return;}
   const open=evt.target.closest?.("[data-meater-graph]");
   if(open&&history.has(open.dataset.meaterGraph)){
    selected=open.dataset.meaterGraph;drawGraph();title.focus({preventScroll:true});panel.scrollIntoView?.({block:"nearest",behavior:"smooth"});if(fastMode())void root.kitchenRefresh();return;
   }
   if(evt.target.closest?.("[data-meater-graph-close]")){
    const id=selected;selected=null;drawGraph();root.kitchenRefresh.reschedule();
    for(const button of dest.querySelectorAll("[data-meater-graph]"))if(button.dataset.meaterGraph===id){button.focus();break;}
   }
  });
  root.addEventListener("change",evt=>{
   if(!evt.target.matches?.("[data-meater-graph-period]"))return;
   const value=Number(evt.target.value);if(graphPeriods.includes(value)){minutes=value;drawGraph();}
  });
  return root.kitchenRefresh;
 }
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
