"use strict";
(function(){
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const number=x=>Number(x).toLocaleString("fr-FR",{maximumFractionDigits:2});
 const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const nextDay=d=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)};
 const priorities={low:"Basse",normal:"Normale",high:"Haute",urgent:"Urgente"};
 const frequencies={daily:"Tous les jours",weekly:"Chaque semaine",monthly:"Une fois par mois",on_demand:"Selon utilisation",once:"Une seule fois"};
 const days=["Lun.","Mar.","Mer.","Jeu.","Ven.","Sam.","Dim."];
 function coldOverview(data,{buttonAttributes='data-go="cold"',dashboardRefreshError=""}={}){
 const rooms=(data.rooms||[]).filter(r=>!r.archived_at&&!r.deleted_at);
 const tiles=rooms.map(room=>{
  const sensor=(data.connected||[]).find(d=>d.kind==="cold_room"&&d.provider==="govee"&&d.room_id===room.id);
  const overview=(data.cold_overview||[]).find(o=>o.room_id===room.id);
  const reading=overview?overview.last_reading:(sensor
   ?data.cold.find(r=>r.room_id===room.id&&r.source==="govee_cloud"&&r.connected_device_id===sensor.id)
   :data.cold.find(r=>r.room_id===room.id&&r.source==="manual"));
  const enabled=room.auto_collection_enabled!==false,mode=room.auto_collection_mode==="times"?"times":"interval";
  const interval=Number(room.auto_collection_interval_minutes)||10;
  const stamp=reading?.measured_at,measuredAt=stamp?Date.parse(stamp):NaN,now=Date.now(),age=now-measuredAt;
  const expected=overview?.previous_slot_at?Date.parse(overview.previous_slot_at):NaN;
  const next=overview?.next_slot_at?Date.parse(overview.next_slot_at):NaN;
  const scheduleChanged=Date.parse(room.auto_collection_updated_at||"");
  const pastDue=Number.isFinite(expected)&&now>expected+3*60000&&measuredAt<expected;
  const recent=!!sensor&&enabled&&sensor.status==="online"&&Number.isFinite(age)&&age>=-120000&&
   (mode==="times"?!!overview&&!pastDue&&(!Number.isFinite(scheduleChanged)||measuredAt>=scheduleChanged):!pastDue&&age<=(interval+3)*60000);
  const measured=reading?.temperature_c!=null&&Number.isFinite(Number(reading.temperature_c));
  const alert=!!reading?.is_alert;
  let label="Sans capteur",tagClass="tag-warn";
  if(sensor){
   if(!enabled){label="Collecte suspendue";tagClass="tag-warn"}
   else if(sensor.status==="offline"){label="Capteur hors ligne";tagClass="tag-alert"}
   else if(sensor.status==="error"){label="Connexion en erreur";tagClass="tag-alert"}
   else if(!measured){label="En attente de mesure";tagClass="tag-warn"}
   else if(!recent){label="Données anciennes";tagClass="tag-warn"}
   else if(alert){label="Hors seuil";tagClass="tag-alert"}
   else {label=mode==="times"?"À jour selon programmation":"À jour";tagClass="tag-ok"}
  }else if(measured){label="Dernier relevé manuel";tagClass="tag-warn"}
  const received=stamp?new Date(stamp).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"}):"Aucune mesure";
  const origin=sensor?"Capteur "+esc(sensor.model):"Saisie manuelle";
  const schedule=!enabled?"Collecte automatique suspendue":mode==="times"
   ?"Heures fixes : "+esc((room.auto_collection_times||[]).join(", "))
   :"Toutes les "+interval+" min (24 h/24)";
  const nextLabel=enabled&&sensor&&Number.isFinite(next)?" · Prochain : "+new Date(next).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}):"";
  const problem=alert?(recent?"Température hors seuil : vérification nécessaire.":"Dernier relevé hors seuil : contrôler sur place."):"";
  return '<article class="cold-live-tile'+(recent&&alert?' cold-live-alert':'')+'">'+
   '<div class="cold-live-top"><h3>'+esc(room.label)+'</h3><span class="tag '+tagClass+'">'+label+'</span></div>'+
   '<div class="cold-live-value">'+(measured?number(reading.temperature_c)+' °C':'—')+'</div>'+
   '<div class="subline">'+origin+' · '+(sensor?'Valeur Cloud reçue le ':'Relevée le ')+received+'</div>'+
   (sensor?'<div class="subline"><span class="tag '+(sensor.status==="online"?"tag-ok":sensor.status==="offline"||sensor.status==="error"?"tag-alert":"tag-warn")+'">'+(sensor.status==="online"?"Connexion en ligne":sensor.status==="offline"?"Connexion hors ligne":sensor.status==="error"?"Erreur de connexion":"Connexion non confirmée")+'</span></div>':'')+
   '<div class="subline">Seuil : '+(room.min_c!=null?number(room.min_c)+' à ':'max. ')+number(room.max_c)+' °C</div>'+
   '<div class="subline">'+schedule+nextLabel+'</div>'+
   (problem?'<p class="cold-live-warning">'+problem+'</p>':'')+
   (!sensor?'<p class="help">Associez un thermomètre dans Administration → Gestion Cuisine.</p>':'')+
   '<div class="cold-room-profile-actions"><button type="button" data-kitchen-cold-profile="'+esc(room.id)+'" aria-label="Voir la fiche de '+esc(room.label)+'">Voir fiche</button></div>'+
   '</article>';
 }).join("");
 return '<section class="card cold-live-section">'+
  '<div class="section-heading"><div><div class="eyebrow">Surveillance des chambres froides</div><h2>Dernières températures reçues</h2><p>Collecte serveur selon la programmation de chaque chambre, même lorsque le site est fermé. Les valeurs affichées ne sont pas des mesures instantanées.</p></div><button type="button" class="btn btn-outline btn-small" '+buttonAttributes+'>Voir les relevés</button></div>'+
  (dashboardRefreshError?'<p class="info info-warn">'+esc(dashboardRefreshError)+'</p>':'')+
  '<div class="cold-live-grid">'+(tiles||'<div class="empty">Aucune chambre froide active.</div>')+'</div></section>';
}
 function liveColdMarkup(data){
  const rooms=data?.rooms||[],serverTime=Date.parse(data?.now||""),now=Number.isFinite(serverTime)?serverTime:Date.now();
  const cards=rooms.map(room=>{
   const s=room.sensor,age=now-Date.parse(s?.checked_at||"");
   const valid=!!s&&s.status==="online"&&s.temperature_c!=null&&Number.isFinite(Number(s.temperature_c))&&Number.isFinite(age)&&age>=-10000&&age<=130000&&s.fresh!==false;
   const alert=valid&&(Number(s.temperature_c)>Number(room.max_c)||(room.min_c!=null&&Number(s.temperature_c)<Number(room.min_c)));
   const status=!s?"Sans capteur":valid?"Connexion en ligne":s.status==="offline"?"Capteur hors ligne":s.status==="error"?"Erreur de connexion":s.status==="online"?"Valeur ancienne":"En attente";
   const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"}):"—";
   return '<article class="cold-live-tile'+(alert?' cold-live-alert':'')+'"><div class="cold-live-top"><h3>'+esc(room.label)+'</h3><span class="tag '+(valid?'tag-ok':s?.status==="error"||s?.status==="offline"?'tag-alert':'tag-warn')+'">'+status+'</span></div>'+
    '<div class="cold-live-value">'+(valid?number(s.temperature_c)+' °C':'— °C')+'</div><div class="subline">Dernière réponse Cloud : '+time(s?.checked_at)+(Number.isFinite(age)&&age>=0?' · il y a '+Math.round(age/1000)+' s':'')+'</div><div class="subline">Seuil : '+(room.min_c!=null?number(room.min_c)+' à ':'max. ')+number(room.max_c)+' °C</div>'+
    (alert?'<p class="cold-live-warning">Température hors seuil : vérification nécessaire.</p>':'')+
    (!valid&&s?.temperature_c!=null?'<p class="subline">Dernière valeur Cloud (ancienne) : '+number(s.temperature_c)+' °C</p>':!valid&&s?.last_temperature_c!=null?'<p class="subline">Dernier relevé enregistré : '+number(s.last_temperature_c)+' °C · '+time(s.last_checked_at)+'</p>':'')+
    (s?.error?'<p class="cold-live-warning">'+esc(s.error)+'</p>':'')+
    '<div class="cold-room-profile-actions"><button type="button" data-kitchen-cold-profile="'+esc(room.id)+'" aria-label="Voir la fiche de '+esc(room.label)+'">Voir fiche</button></div></article>';
  }).join("");
  return '<section class="card cold-live-section"><div class="section-heading"><div><div class="eyebrow">Consultation en direct · sans enregistrement</div><h2>Températures Govee</h2><p>Interrogation Cloud toutes les 60 secondes lorsque cette page est ouverte. La fréquence de mesure physique dépend des sondes.</p></div><button type="button" class="btn btn-outline btn-small" data-live-govee-refresh>Actualiser Govee</button></div>'+
   (data&&Number.isFinite(serverTime)?'<p class="subline">Réponse du serveur : '+new Date(serverTime).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"})+' · '+(data.queried===0?"Dernière interrogation réutilisée (limite de 60 s).":Number.isInteger(data.queried)?data.queried+" capteur(s) interrogé(s).":"")+'</p>':'')+
   '<div class="cold-live-grid">'+(cards||'<div class="empty">'+(data?"Aucune chambre froide active.":"Chargement des températures…")+'</div>')+'</div></section>';
 }
 function mountLiveCold(root,api){
  if(!root)return;
  if(root.kitchenRefresh)return root.kitchenRefresh;
  let pending=null;
  root.innerHTML=liveColdMarkup(null);
  function refresh(){
   if(!root.isConnected||document.hidden||root.closest("[hidden]"))return Promise.resolve();
   if(pending)return pending;
   const b=root.querySelector("[data-live-govee-refresh]");if(b)b.disabled=true;
   pending=Promise.resolve().then(()=>api("govee-live")).then(result=>{
    if(!Array.isArray(result?.rooms)||!Number.isFinite(Date.parse(result.now)))throw Error("Réponse Govee invalide");
    if(root.isConnected)root.innerHTML=liveColdMarkup(result);
   }).catch(()=>{if(root.isConnected)root.innerHTML='<section class="card"><h2>Températures Govee</h2><p class="cold-live-warning">Interrogation indisponible. Contrôlez les températures sur place.</p><button type="button" class="btn btn-outline" data-live-govee-refresh>Réessayer</button></section>';}).finally(()=>{pending=null;});
   return pending;
  }
  root.kitchenRefresh=refresh;
  root.addEventListener("click",evt=>{if(evt.target.closest?.("[data-live-govee-refresh]"))void refresh();});
  const resume=()=>{if(!root.isConnected){clearInterval(timer);document.removeEventListener("visibilitychange",resume);return;}void refresh();};
  const timer=setInterval(resume,60000);
  document.addEventListener("visibilitychange",resume);
  void refresh();return refresh;
 }
 function scheduleLabel(t){
  const freq=frequencies[t.recurrence]||frequencies.daily;
  return (t.scheduled_time?String(t.scheduled_time).slice(0,5)+" · ":"")+freq+(["weekly","monthly"].includes(t.recurrence)?" : "+(t.recurrence==="monthly"?"1er ":"")+(t.weekdays||[]).map(d=>days[d-1]).filter(Boolean).join(", "):"")+" · Priorité "+(priorities[t.priority]||priorities.normal).toLowerCase();
 }
 function fields(t,staff,day){
  const sel=(a,b)=>a===b?" selected":"";
  const options=(obj,value)=>Object.entries(obj).map(([k,v])=>'<option value="'+esc(k)+'"'+sel(k,value)+'>'+esc(v)+'</option>').join("");
  return '<div class="kt-fields"><label>Nom de la tâche<input name="label" required minlength="3" maxlength="100" value="'+esc(t.label||"")+'"></label>'+
   '<label>Responsable<select name="assigned_to"><option value="">Tâche commune</option>'+staff.filter(x=>x.active||x.id===t.assigned_to).map(x=>'<option value="'+esc(x.id)+'"'+sel(x.id,t.assigned_to)+'>'+esc(x.name)+(x.active?'':' (inactif)')+'</option>').join("")+'</select></label>'+
   '<label class="kt-wide">Description<textarea name="description" maxlength="1000" rows="2">'+esc(t.description||"")+'</textarea></label>'+
   '<label>Heure prévue<input name="scheduled_time" type="time" value="'+esc(String(t.scheduled_time||"").slice(0,5))+'"></label>'+
   '<label>Priorité<select name="priority">'+options(priorities,t.priority||"normal")+'</select></label>'+
   '<label>Fréquence<select name="recurrence">'+options(frequencies,t.recurrence||"daily")+'</select></label>'+
   '<label>État<select name="active"><option value="true"'+sel(t.active!==false,true)+'>Active</option><option value="false"'+sel(t.active===false,true)+'>Désactivée</option></select></label>'+
   '<fieldset class="kt-wide kt-weekdays"><legend>Jours d’exécution (hebdomadaire ou premier jour sélectionné du mois)</legend>'+days.map((name,i)=>'<label><input type="checkbox" name="weekday" value="'+(i+1)+'" '+((t.weekdays||[1,2,3,4,5,6,7]).includes(i+1)?'checked':'')+'>'+name+'</label>').join("")+'</fieldset>'+
   '<label>Date de début<input name="starts_on" type="date" required value="'+esc(t.starts_on||day)+'"></label>'+
   '<label>Date de fin (facultative)<input name="ends_on" type="date" value="'+esc(t.ends_on||"")+'"></label>'+
   '<label class="kt-wide">Consignes<textarea name="instructions" maxlength="2000" rows="3">'+esc(t.instructions||"")+'</textarea></label></div>';
 }
 function open({task=null,staff=[],completed=false,initialDate=null,fetchTasks,save,onSaved}){
  if(document.getElementById("kitchenTaskEditor"))return;
  const day=today(),minimum=task&&completed?nextDay(day):day,initialDay=typeof initialDate==="string"&&initialDate>=minimum?initialDate:minimum;
  const dialog=document.createElement("dialog");dialog.id="kitchenTaskEditor";dialog.className="kt-dialog";
  dialog.innerHTML='<form class="kt-form"><div class="kt-heading"><div><h2>'+(task?"Modifier la tâche":"Ajouter une tâche")+'</h2><p>Les validations déjà enregistrées sont conservées.</p></div><button type="button" data-kt-cancel aria-label="Fermer">×</button></div>'+
   '<div class="kt-fields"><label>Date d’application<input required type="date" name="effective_on" min="'+day+'" value="'+initialDay+'"></label>'+
   (task?'<label>Appliquer à<select name="scope"><option value="future">Cette date et toutes les suivantes</option><option value="single">Cette journée uniquement</option></select></label>':'')+'</div>'+
   (completed?'<p class="kt-hint">Déjà validée aujourd’hui : la première date proposée est demain.</p>':'')+
   '<p class="kt-hint" data-kt-scope></p><div data-kt-fields></div><p role="status" aria-live="polite" class="kt-feedback"></p>'+
   '<div class="kt-actions"><button type="button" data-kt-cancel>Annuler</button><button type="submit" class="kt-primary">Enregistrer</button></div></form>';
  document.body.append(dialog);
  const form=dialog.querySelector("form"),dest=form.querySelector("[data-kt-fields]"),feedback=form.querySelector(".kt-feedback"),submit=form.querySelector("[type=submit]"),field=n=>form.elements.namedItem(n);
  let saving=false,loading=false,valid=true;
  function hint(){const single=field("scope")?.value==="single";form.querySelector("[data-kt-scope]").textContent=single?"Exception pour cette date uniquement. Les dates de début, de fin et la fréquence ne s’appliquent pas à cette exception.":task?"La programmation à partir de cette date sera remplacée, y compris les exceptions futures.":"";for(const input of dest.querySelectorAll("[name=weekday],[name=starts_on],[name=ends_on],[name=recurrence]")){input.disabled=single||input.name==="weekday"&&!["weekly","monthly"].includes(field("recurrence").value);}}
  function show(t,d){dest.innerHTML=fields(t||{},staff,d);field("recurrence").addEventListener("change",hint);hint();}
  function disabled(state){submit.disabled=state||!valid;field("effective_on").disabled=state;if(field("scope"))field("scope").disabled=state;dest.inert=state;}
  async function reloadDate(){
   const d=field("effective_on").value;if(!d||d<day)return;
   if(!task){if(field("starts_on").value<d)field("starts_on").value=d;return;}
   loading=true;valid=false;disabled(true);feedback.textContent="Chargement de la configuration à cette date…";
   try{const list=await fetchTasks(d);if(!dialog.isConnected)return;const current=list.find(t=>t.id===task.id);if(!current)throw Error("Tâche introuvable à cette date.");field("scope").value=current.single_day?"single":"future";show(current,d);valid=true;feedback.textContent="";}
   catch(err){feedback.textContent=err.message||"Chargement impossible.";}
   finally{loading=false;if(dialog.isConnected)disabled(false);}
  }
  show(task||{},initialDay);
  field("scope")?.addEventListener("change",hint);field("effective_on").addEventListener("change",reloadDate);
  for(const cancel of dialog.querySelectorAll("[data-kt-cancel]"))cancel.addEventListener("click",()=>{if(!saving)dialog.close()});
  dialog.addEventListener("cancel",ev=>{if(saving)ev.preventDefault()});
  dialog.addEventListener("close",()=>dialog.remove());
  form.addEventListener("submit",async ev=>{
   ev.preventDefault();if(saving||loading||!valid)return;
   try{
    const scope=task?field("scope").value:"future",weekdays=Array.from(dest.querySelectorAll("[name=weekday]:checked"),x=>Number(x.value));
    if(scope!=="single"&&field("recurrence").value==="weekly"&&!weekdays.length)throw Error("Sélectionnez au moins un jour.");
    if(scope!=="single"&&field("recurrence").value==="monthly"&&weekdays.length!==1)throw Error("Choisissez un seul jour : son premier passage dans chaque mois sera programmé.");
    const body={id:task?.id,label:field("label").value.trim(),assigned_to:field("assigned_to").value||null,description:field("description").value,instructions:field("instructions").value,scheduled_time:field("scheduled_time").value||null,priority:field("priority").value,recurrence:field("recurrence").value,active:field("active").value==="true",weekdays:weekdays.length?weekdays:[1,2,3,4,5,6,7],starts_on:field("starts_on").value,ends_on:field("ends_on").value||null,effective_on:field("effective_on").value,scope};
    if(scope==="single"){body.starts_on=body.effective_on;body.ends_on=null;if(body.recurrence==="monthly"&&body.weekdays.length!==1)body.weekdays=[5];}
    if(body.ends_on&&body.ends_on<body.starts_on)throw Error("La fin doit être postérieure ou égale au début.");
    if(task&&scope==="future"&&!window.confirm("Remplacer la programmation à partir du "+body.effective_on+", y compris les exceptions futures ?"))return;
    saving=true;disabled(true);feedback.textContent="Enregistrement…";
    await save(task?"update-task":"add-task",body);
    dialog.close();await onSaved();
   }catch(err){feedback.textContent=err.message||"Enregistrement impossible.";}
   finally{saving=false;if(dialog.isConnected)disabled(false);}
  });
  dialog.showModal();if(task)reloadDate();
 }
 window.KitchenUI={coldOverview,scheduleLabel,open,today,liveColdMarkup,mountLiveCold};
})();
