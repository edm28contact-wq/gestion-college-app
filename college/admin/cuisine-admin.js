"use strict";
(function(){
 const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
 const node=id=>document.getElementById(id);
 const e=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const when=v=>v?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"—";
 const t=v=>Number(v).toLocaleString("fr-FR",{maximumFractionDigits:2});
 let snapshot=null,busy=false,kitchenTab="overview",selectedColdRoom="",coldHistory=[],coldHistoryTotal=0,coldHistoryOffset=0,coldHistoryError="";
 const kitchenPages={
  cuisine:[["overview","Vue d’ensemble"],["records","Relevés et alertes"],["cleaning","Tâches et photos"]],
  cuisineSettings:[["govee","Connexion Govee"],["meater","Connexion MEATER"],["pms","Plan sanitaire · HACCP"],["schedule","Programmation des relevés"],["equipment","Équipements et valeurs"],["staff","Équipe de cuisine"]]
 };
 const selectedTabs={cuisine:"overview",cuisineSettings:"govee"};
 let loadEpoch=0;
 const currentKitchenPage=()=>typeof page!=="undefined"&&Object.hasOwn(kitchenPages,page)&&canPage(page)&&goveeSession()?page:null;
 function chooseKitchenTab(section,tab){
  if(kitchenPages[section]?.some(([key])=>key===tab))selectedTabs[section]=tab;
 }
 function openKitchenTab(section,tab){
  if(!canPage(section))return;
  chooseKitchenTab(section,tab);
  show(section);
 }
 async function api(action,method="GET",body){
   const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
   const r=await fetch(API+"?action="+encodeURIComponent(action),{method,headers:{"content-type":"application/json","x-admin-session":token},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
   const j=await r.json().catch(()=>({error:"Réponse du service invalide"}));if(!r.ok)throw Error(j.error||"Service indisponible");return j;
 }
 const staff=id=>snapshot?.staff.find(x=>x.id===id)?.name||"Agent";
 let goveeDiscovery=null,goveeOwner="",goveeLoading=false,goveeVersion=0,goveeMessage="",goveeMessageBad=false;
 const goveeSession=()=>localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
 function resetGoveeDiscovery(){
  goveeVersion++;goveeOwner=goveeSession();goveeDiscovery=null;goveeLoading=false;goveeMessage="";goveeMessageBad=false;
 }
 function ensureGoveeOwner(){if(goveeOwner!==goveeSession())resetGoveeDiscovery()}
 function goveeFeedback(message,bad=false){
  goveeMessage=message;goveeMessageBad=bad;
  const target=node("kitchenGoveeActionStatus");if(target){target.textContent=message;target.style.color=bad?"#a32929":"#176b3a"}
 }
 function goveeRoomOptions(s,device){
  const linked=(s.connected||[]).filter(d=>d.kind==="cold_room"&&d.provider==="govee");
  return (s.rooms||[]).filter(r=>!r.archived_at&&!r.deleted_at&&!linked.some(d=>d.device_identifier!==device&&d.room_id===r.id));
 }
 function goveeCards(s,discovery){
  const linked=(s.connected||[]).filter(d=>d.kind==="cold_room"&&d.provider==="govee");
  const found=Array.isArray(discovery?.discovered)?discovery.discovered:Array.isArray(discovery?.devices)?discovery.devices:[];
  const measured=new Map((discovery?.devices||[]).map(d=>[d.device,d]));
  const devices=new Map(found.filter(d=>d.temperature_capability).map(d=>[d.device,d]));
  for(const sensor of linked)if(!devices.has(sensor.device_identifier))devices.set(sensor.device_identifier,{device:sensor.device_identifier,sku:sensor.model,label:sensor.label,temperature_capability:true,registered_only:true});
  const active=(s.rooms||[]).filter(r=>!r.archived_at&&!r.deleted_at);
  const occupied=active.filter(r=>linked.some(d=>d.room_id===r.id)).length;
  const summary='<p><strong>'+devices.size+' capteur(s) de température · '+occupied+' / '+active.length+' chambres associées</strong></p><p class="muted">Identifiez chaque appareil grâce à sa référence complète dans Govee Home. Les températures du test sont indicatives et ne déterminent pas automatiquement l’emplacement.</p>';
  if(!devices.size)return summary+'<p class="muted">'+(discovery?'Aucun capteur compatible trouvé.':'Cliquez sur Rechercher et tester les sondes.')+'</p>';
  return summary+[...devices.values()].map(d=>{
   const current=linked.find(x=>x.device_identifier===d.device),room=active.find(r=>r.id===current?.room_id),reading=measured.get(d.device);
   const allowed=goveeRoomOptions(s,d.device);
   const options='<option value="">Choisir une chambre froide</option>'+allowed.map(r=>'<option value="'+e(r.id)+'" '+(current?.room_id===r.id?"selected":"")+'>'+e(r.label)+'</option>').join("");
   const unit=current?.raw_unit||reading?.raw_unit||(d.sku==="H5179"?"F":"");
   const raw=reading?.raw_temperature,converted=reading?.temperature_c;
   const readingText=typeof converted==="number"&&Number.isFinite(converted)?t(converted)+" °C":typeof raw==="number"&&Number.isFinite(raw)?"Valeur brute : "+t(raw):"Aucune température testée";
   const state=reading?.online===true?"En ligne":reading?.online===false?"Hors ligne":reading?.status==="erreur_api"?"Erreur de lecture":"État non confirmé";
   const info=reading?'Test : '+readingText+' · '+state+(reading.error?' · '+reading.error:''):current?.last_checked_at?'Dernière lecture : '+(current.last_temperature_c==null?"indisponible":t(current.last_temperature_c)+" °C")+' · '+when(current.last_checked_at):"Lecture non encore effectuée";
   const outOfRange=room&&reading?.online===true&&typeof converted==="number"&&(converted>Number(room.max_c)||(room.min_c!==null&&room.min_c!==undefined&&converted<Number(room.min_c)));
   const assignment=current?'<form class="grid" data-govee-room="'+e(current.id)+'"><div><label>Chambre froide</label><select name="room_id" required>'+options+'</select></div><div><button class="btn primary" type="submit" '+(allowed.length?"":"disabled")+'>Modifier l’association</button></div></form><button class="btn secondary" type="button" data-govee-sync="'+e(current.id)+'">Enregistrer un relevé maintenant</button>':
    '<form class="grid" data-govee-associate="'+e(d.device)+'" data-sku="'+e(d.sku)+'"><div><label>Chambre froide libre</label><select required name="room_id">'+options+'</select></div><div><label>Unité brute Govee</label><select required name="raw_unit"><option value="">Confirmer l’unité</option><option value="F" '+(unit==="F"?"selected":"")+'>Fahrenheit (°F → °C)</option><option value="C" '+(unit==="C"?"selected":"")+'>Celsius (°C)</option></select></div><div><button class="btn primary" type="submit" '+(allowed.length?"":"disabled")+'>Associer à la chambre</button></div></form>';
   return '<section class="card" style="border:1px solid #dce4ea;margin:10px 0"><div class="actions" style="justify-content:space-between"><strong>'+e(d.label)+' · '+e(d.sku)+'</strong><span class="pill '+(room?"ok":"warning")+'">'+(room?e(room.label):current?"Chambre inactive":"Non associé")+'</span></div><p class="muted">Identifiant : <strong>'+e(d.device)+'</strong></p><p>'+e(info)+'</p>'+(d.registered_only&&discovery?'<p class="status err">Sonde enregistrée mais non retrouvée dans la liste Govee actuelle.</p>':'')+(outOfRange?'<p class="status err">Température hors seuil pour la chambre associée. Vérifiez l’emplacement physique et la température réelle.</p>':'')+(s.me?.scope==="admin"?assignment:'')+(!current&&!allowed.length?'<p class="muted">Toutes les chambres actives ont déjà un capteur.</p>':'')+'</section>';
  }).join("");
 }
 function renderGoveeDiscovery(){
  ensureGoveeOwner();
  const output=node("kitchenGoveeDiscovered");if(!output||!snapshot)return;
  output.innerHTML=goveeCards(snapshot,goveeDiscovery);
  const button=node("kitchenGoveeDiscover");if(button)button.disabled=goveeLoading||!snapshot.account?.govee_key_configured;
  const status=node("kitchenGoveeActionStatus");if(status){status.textContent=goveeMessage;status.style.color=goveeMessageBad?"#a32929":"#176b3a"}
 }
 async function goveeAction(name,data,form){
  if(busy||goveeLoading||snapshot?.me?.scope!=="admin")return;
  ensureGoveeOwner();const owner=goveeOwner;
  const room=(snapshot.rooms||[]).find(r=>r.id===data.room_id);
  if(name!=="govee-sync"){
   if(!room||room.archived_at||room.deleted_at)return goveeFeedback("Choisissez une chambre froide active.",true);
   const registered=(snapshot.connected||[]).find(d=>d.id===data.id);
   if(registered?.room_id===room.id)return goveeFeedback("Cette sonde est déjà associée à cette chambre.");
   if(!confirm("Associer cette sonde à « "+room.label+" » ? Vérifiez son emplacement physique. Les anciens relevés resteront dans leur historique."))return;
  }
  const buttons=form?[...form.querySelectorAll("button")]:[];
  busy=true;buttons.forEach(b=>b.disabled=true);goveeFeedback("Enregistrement en cours…");
  try{
   const result=await api(name,"POST",data);
   if(owner!==goveeSession())return;
   if(name==="govee-sync"){
    if(!result.reading)throw Error("Aucun relevé confirmé par le serveur.");
    goveeFeedback("Relevé enregistré : "+t(result.reading.temperature_c)+" °C.");
   }else{
    const id=result.sensor?.id||result.id;
    if(!id)throw Error("Association non confirmée par le serveur.");
    goveeFeedback("Association enregistrée pour "+room.label+". La collecte automatique suit la programmation de cette chambre.");
   }
   await load();
  }catch(err){if(owner===goveeSession())goveeFeedback(err.message,true)}
  finally{busy=false;buttons.forEach(b=>b.disabled=false)}
 }
 async function fetchColdHistoryPage(offset=0,limit=50,roomId=selectedColdRoom){
  const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
  const qs=new URLSearchParams({action:"cold-history",offset:String(offset),limit:String(limit)});
  if(roomId)qs.set("room_id",roomId);
  const r=await fetch(API+"?"+qs,{headers:{"x-admin-session":token},cache:"no-store"});
  const data=await r.json().catch(()=>({error:"Réponse invalide"}));
  if(!r.ok)throw Error(data.error||"Impossible de charger l'historique");
  return data;
 }
 async function refreshColdHistory(offset=0,keepTab=true){
  const current=selectedColdRoom,epoch=loadEpoch,owner=goveeSession();
  const valid=()=>current===selectedColdRoom&&epoch===loadEpoch&&owner===goveeSession()&&currentKitchenPage()==="cuisine";
  try{
   const result=await fetchColdHistoryPage(offset,50,current);
   if(!valid())return;
   coldHistory=result.readings;coldHistoryTotal=result.total;coldHistoryOffset=offset;coldHistoryError="";
   if(snapshot&&keepTab)render();
  }catch(err){if(!valid())return;coldHistoryError=err.message;if(snapshot&&keepTab)render();}
 }
 async function exportColdReadings(format){
  const busyButtons=document.querySelectorAll("[data-admin-cold-export]");
  busyButtons.forEach(b=>b.disabled=true);
  try{
   const exportRoom=selectedColdRoom,label=exportRoom?snapshot.rooms.find(r=>r.id===exportRoom)?.label||"Chambre":"Toutes les chambres";
   const count=await window.CuisineReports[format]({
    fetchPage:(offset,limit)=>fetchColdHistoryPage(offset,limit,exportRoom),
    rooms:snapshot.rooms,staff:snapshot.staff,roomLabel:label,
    notify:(done,total)=>notify("Export en cours : "+done+" / "+total+" relevés")
   });
   notify("Export "+format.toUpperCase()+" effectué : "+count+" relevé(s).");
  }catch(err){notify("Échec de l’export : "+err.message,true)}
  finally{busyButtons.forEach(b=>b.disabled=false)}
 }

 function notify(text,bad=false){const el=node("kitchenAdminMessage");if(el){el.textContent=text;el.style.color=bad?"#a32929":"#176b3a"}}
 async function action(name,data){
  if(busy)return;busy=true;try{const res=await api(name,"POST",data);await load();notify("Enregistré.");return res}
  catch(err){notify(err.message,true)}finally{busy=false}
 }
 const attr=(o,k)=>e(o[k]);
 function renderCollectionSchedules(s){
  const rooms=s.rooms.filter(r=>!r.archived_at&&!r.deleted_at);
  return '<div class="card"><h2>Programmation des relevés</h2>'+
   '<p class="muted">Chaque chambre a sa propre programmation. Les relevés automatiques se font sur le serveur, même lorsque le site est fermé. En mode intervalle, ils sont effectués jour et nuit. Les heures fixes suivent l’heure de Paris. La saisie manuelle reste disponible.</p>'+
   '<p id="kitchenScheduleStatus" class="status" role="status" aria-live="polite"></p>'+
   (rooms.length?rooms.map(r=>{
    const sensor=(s.connected||[]).find(d=>d.room_id===r.id&&d.kind==="cold_room"&&d.provider==="govee");
    const overview=(s.cold_overview||[]).find(d=>d.room_id===r.id);
    const enabled=r.auto_collection_enabled!==false,mode=r.auto_collection_mode==="times"?"times":"interval";
    const interval=r.auto_collection_interval_minutes??10,times=(r.auto_collection_times||[]).join(", ");
    const status=!enabled?"Programmation suspendue":!sensor?"En attente d’un capteur":"Programmation active";
    const last=overview?.last_reading;
    const next=enabled&&sensor&&overview?.next_slot_at?when(overview.next_slot_at):"—";
    return '<section class="card" style="border:1px solid #dce4ea;margin:12px 0"><div class="actions" style="justify-content:space-between"><h3 style="margin:0">'+e(r.label)+'</h3><span class="pill '+(enabled&&sensor?"ok":"warning")+'">'+status+'</span></div>'+
     '<p class="muted">'+(sensor?'Capteur : '+e(sensor.model)+' · '+(last?'Dernier relevé : '+t(last.temperature_c)+' °C · '+when(last.measured_at):"Aucun relevé automatique reçu"):"Aucun capteur associé. Vous pouvez préparer les réglages avant de le connecter.")+'</p>'+
     '<p><strong>Prochain créneau :</strong> '+e(next)+(enabled&&sensor?' <span class="muted">(heure de Paris)</span>':'')+'</p>'+
     '<form data-room-schedule="'+attr(r,"id")+'" class="grid">'+
     '<div><label>Collecte automatique</label><select name="enabled"><option value="yes" '+(enabled?"selected":"")+'>Activée</option><option value="no" '+(!enabled?"selected":"")+'>Suspendue</option></select></div>'+
     '<div><label>Mode de programmation</label><select name="mode"><option value="interval" '+(mode==="interval"?"selected":"")+'>Intervalle régulier (24 h/24)</option><option value="times" '+(mode==="times"?"selected":"")+'>Heures fixes chaque jour</option></select></div>'+
     '<div><label>Intervalle entre deux relevés (minutes)</label><input name="interval_minutes" type="number" min="5" max="1440" step="1" required value="'+e(interval)+'"><p class="muted">De 5 à 1 440 minutes, selon le mode choisi.</p></div>'+
     '<div><label>Heures fixes (HH:MM)</label><input name="times" type="text" maxlength="190" value="'+e(times)+'" placeholder="08:00, 12:00, 18:00"><p class="muted">Séparez les heures par une virgule. Maximum 24 horaires par jour.</p></div>'+
     '<div><button class="btn primary" type="submit">Enregistrer la programmation</button></div></form></section>';
   }).join(""):'<p>Aucune chambre froide active.</p>')+'</div>';
 }
 async function saveCollectionSchedule(form,values){
  if(busy)return;
  const status=node("kitchenScheduleStatus"),button=form.querySelector('button[type="submit"]');
  const notifySchedule=(message,bad=false)=>{const el=node("kitchenScheduleStatus")||status;if(el){el.textContent=message;el.style.color=bad?"#a32929":"#176b3a";}};
  const interval=Number(values.interval_minutes),times=String(values.times||"").split(/[,;\s]+/).map(v=>v.trim()).filter(Boolean);
  if(!Number.isInteger(interval)||interval<5||interval>1440||times.length>24||times.some(v=>!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v))||(values.mode==="times"&&!times.length)){
   notifySchedule("Vérifiez la fréquence (5 à 1 440 min) et les horaires HH:MM, séparés par des virgules.",true);return;
  }
  const roomName=snapshot?.rooms.find(r=>r.id===form.dataset.roomSchedule)?.label||"Chambre froide";
  busy=true;if(button)button.disabled=true;notifySchedule("Enregistrement de la programmation…");
  try{
   await api("save-room-collection-schedule","POST",{id:form.dataset.roomSchedule,enabled:values.enabled==="yes",mode:values.mode,interval_minutes:interval,times});
   await load();notifySchedule("Programmation enregistrée — "+roomName+".");
  }catch(err){notifySchedule(err.message,true)}finally{busy=false;if(button)button.disabled=false}
 }
function cleaningSections(tasks,optional,unscheduled=[]){
 const categories=[
  ["preparation","Préparation et hygiène",["Plans de travail","Bacs à légumes","Lave-mains"]],
  ["plonge","Plonge et vaisselle",["Lave-vaisselle","Bacs à vaisselle","Supports à couverts","Chauffe-assiettes","Nettoyage de la plonge","Nettoyage du lave-vaisselle"]],
  ["cuisson","Cuisson et remise en température",["Fours de remise en température","Bain-marie","Micro-ondes","Hottes et grilles","Friteuse / huile","Friteuse","Nettoyage des fours"]],
  ["froid","Froid et rangement",["Meubles réfrigérés","Armoires","Congélateur"]],
  ["service","Distribution et salle de restaurant",["Chariots de service","Tables","Caisse","Salle de restaurant","Table des condiments","Chaises","Cafetières","Point d’eau du self","Nettoyage de la ligne de self"]],
  ["locaux","Sols, locaux et déchets",["Poubelles","Sol","Sols de cuisine et siphons","Carrelages"]],
  ["sanitaires","Sanitaires et vestiaires",["Sanitaires","Vestiaires"]]
 ];
 const normalize=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[’‘]/g,"'").trim().replace(/\s+/g," ").toLowerCase();
 const byLabel=new Map(),groups=categories.map(([key,title,labels])=>{
  const group={key,title,tasks:[],optional:[],unscheduled:[]};
  for(const label of labels)byLabel.set(normalize(label),group);
  return group;
 });
 const other={key:"other",title:"Autres tâches",tasks:[],optional:[],unscheduled:[]};
 for(const task of tasks)(byLabel.get(normalize(task.label))||other).tasks.push(task);
 for(const task of optional)(byLabel.get(normalize(task.label))||other).optional.push(task);
 for(const task of unscheduled)(byLabel.get(normalize(task.label))||other).unscheduled.push(task);
 return [...groups,other].filter(g=>g.tasks.length||g.optional.length||g.unscheduled.length);
}

function isRetiredCleaningTask(t){
 return ["Nettoyage de la ligne de self","Nettoyage de la plonge","Nettoyage des fours","Nettoyage du lave-vaisselle"].includes(t.label)&&
 (t.starts_on==="2026-11-19"||(t.active===false&&t.description==="Remplacée par les lignes détaillées du protocole 7."));
}
 function cleaningAdminRows(settings,report,day,today){
  const checks=new Map((report.checks||[]).map(c=>[c.task_id,c]));
  const records=new Map((settings||[]).map(t=>[t.id,t]));
  for(const t of report.tasks||[])if(!records.has(t.id))records.set(t.id,t);
  for(const c of report.checks||[])if(!records.has(c.task_id))records.set(c.task_id,{id:c.task_id,label:"Tâche historique",active:false,scheduled:false});
  return [...records.values()].map(task=>{
   const check=checks.get(task.id)||null;
   const active=task.active!==false&&(!task.starts_on||task.starts_on<=day)&&(!task.ends_on||task.ends_on>=day);
   const scheduled=active&&task.scheduled===true;
   const optional=active&&task.recurrence==="on_demand"&&!scheduled;
   const state=check?(check.photo_bytes>0?"photo":"legacy"):scheduled?(day<today?"pending_past":day>today?"future":"pending"):optional?"optional":active?"not_due":"inactive";
   return {...task,check,active,scheduled,optional,state,retired:isRetiredCleaningTask(task)};
  });
 }
 function cleaningAdminFilter(rows,filter){
  return rows.filter(r=>(!filter.agent||r.assigned_to===filter.agent||r.check?.performed_by===filter.agent)&&(!filter.state||(filter.state==="done"?["photo","legacy"].includes(r.state):filter.state==="todo"?["pending","pending_past","future"].includes(r.state):r.state===filter.state)));
 }
 const cleaningStateLabels={photo:"Validée · Photo",legacy:"Validée · Sans photo ancienne",pending:"À réaliser",pending_past:"Non validée",future:"Prévue",optional:"Selon utilisation",not_due:"Non prévue ce jour",inactive:"Désactivée / hors période"};
 function cleaningAdminMarkup(rows,{day,today,filter,canManage,staffName,scheduleLabel}){
  const operational=rows.filter(r=>!r.retired),due=operational.filter(r=>r.scheduled),validated=due.filter(r=>r.check).length,photos=rows.filter(r=>r.state==="photo").length,active=operational.filter(r=>r.active||r.check),percent=due.length?Math.round(validated/due.length*100):0;
  const filtered=cleaningAdminFilter(operational,filter),visible=filtered.filter(r=>r.active||r.check),inactive=filtered.filter(r=>!r.active&&!r.check);
  const archived=cleaningAdminFilter(rows.filter(r=>r.retired&&(r.scheduled||r.check)),filter);
  const line=r=>'<div class="ka-task-row"><div class="ka-task-main"><strong>'+e(r.label)+'</strong><small>'+e(scheduleLabel(r))+'</small><small>Responsable : '+e(r.assigned_to?staffName(r.assigned_to):"Commune")+'</small></div><div class="ka-task-status"><span class="ka-task-pill '+(r.check?"ka-done":r.state==="pending_past"?"ka-missed":"")+'">'+e(cleaningStateLabels[r.state])+'</span>'+(r.check?'<small>Par '+e(staffName(r.check.performed_by))+' · '+e(when(r.check.performed_at))+'</small>':'')+'</div><div class="ka-task-buttons">'+(canManage&&r.state==="photo"?'<button type="button" class="btn secondary" data-admin-task-photo="'+e(r.check.id)+'">Voir la photo</button>':'')+(canManage&&!r.retired&&day>=today?'<button type="button" class="btn secondary" data-edit-admin-task="'+e(r.id)+'">Modifier</button>':'')+'</div></div>';
  const groups=cleaningSections(visible,[],[]);
  return '<div class="ka-task-summary"><div><small>Planning actif / historique</small><strong>'+active.length+'</strong></div><div><small>Validées / prévues</small><strong>'+validated+' / '+due.length+'</strong></div><div><small>Photos archivées</small><strong>'+photos+'</strong></div><div><small>Avancement obligatoire</small><strong>'+(due.length?percent+' %':'—')+'</strong></div></div>'+
   '<p class="muted">'+filtered.length+' tâche(s) correspondant aux filtres. Les tâches selon utilisation et non prévues ne comptent pas dans les obligations du jour.</p>'+
   groups.map(g=>{const due=g.tasks.filter(r=>r.scheduled),done=due.filter(r=>r.check).length;return '<section class="ka-task-group"><header><h3>'+e(g.title)+'</h3><span>'+done+' / '+due.length+' prévues validées</span></header>'+g.tasks.map(line).join("")+'</section>';}).join("")+
   (inactive.length?'<details class="ka-task-group"><summary>'+inactive.length+' tâche(s) désactivée(s) ou hors période</summary>'+inactive.map(line).join("")+'</details>':'')+
   (archived.length?'<details class="ka-task-group"><summary>Ancien planning archivé · '+archived.length+' tâche(s)</summary><p class="muted" style="padding:0 14px">Historique conservé avec les photos, sans possibilité de modification.</p>'+archived.map(line).join("")+'</details>':'')+
   (!filtered.length&&!archived.length?'<p class="muted">Aucune tâche ne correspond à cette sélection.</p>':'');
 }
 let cleaningDate="",cleaningFilter={agent:"",state:""},cleaningLoaded=null,cleaningEpoch=0;
 const cleaningSession=()=>localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
 const cleaningToday=()=>window.KitchenUI.today();
 function cleaningNextDay(day){return new Date(Date.parse(day+"T12:00:00Z")+86400000).toISOString().slice(0,10);}
 async function cleaningGet(action,params,initial=cleaningSession()){
  if(!initial||cleaningSession()!==initial)throw Error("Session modifiée. Reconnectez-vous.");
  const response=await fetch(API+"?"+new URLSearchParams({action,...params}),{headers:{"x-admin-session":initial},cache:"no-store"});
  if(!response.ok){const j=await response.json().catch(()=>({}));throw Error(j.error||"Service indisponible");}
  if(cleaningSession()!==initial)throw Error("Session modifiée. Reconnectez-vous.");
  return response;
 }
 function cleaningFeedback(message,bad=false){const el=node("kitchenTaskFeedback");if(el){el.textContent=message;el.style.color=bad?"#a32929":"#176b3a";}else notify(message,bad);}
 function renderCleaningAdmin(){
  const target=node("kitchenTaskList"),date=node("kitchenTasksReportDate")?.value;
  if(!target||!cleaningLoaded||cleaningLoaded.day!==date||cleaningLoaded.session!==cleaningSession())return;
  target.innerHTML=cleaningAdminMarkup(cleaningLoaded.rows,{day:date,today:cleaningToday(),filter:cleaningFilter,canManage:snapshot.me.scope==="admin",staffName:staff,scheduleLabel:window.KitchenUI.scheduleLabel});
 }
 async function refreshCleaningAdmin(){
  const target=node("kitchenTaskList"),date=node("kitchenTasksReportDate")?.value;
  if(!target)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")||!Number.isFinite(Date.parse(date+"T12:00:00Z"))){target.textContent="Choisissez une date valide.";return;}
  const epoch=++cleaningEpoch,session=cleaningSession(),owner=snapshot,manage=owner.me.scope==="admin";cleaningDate=date;cleaningLoaded=null;target.textContent="Chargement du planning et des preuves…";
  try{
   const [report,settings]=await Promise.all([cleaningGet("task-report",{date},session).then(r=>r.json()),manage?cleaningGet("task-settings",{date},session).then(r=>r.json()).then(r=>r.tasks):Promise.resolve([])]);
   if(epoch!==cleaningEpoch||target!==node("kitchenTaskList")||snapshot!==owner||session!==cleaningSession())return;
   if(!Array.isArray(report.tasks)||!Array.isArray(report.checks)||!Array.isArray(settings)||report.date!==date)throw Error("Réponse de planning invalide.");
   cleaningLoaded={day:date,session,settings,report,rows:cleaningAdminRows(settings,report,date,cleaningToday())};renderCleaningAdmin();
  }catch(err){if(epoch===cleaningEpoch&&target===node("kitchenTaskList"))target.textContent="Impossible de charger le planning : "+err.message;}
 }
 function cleaningPanel(s,day){
  const nextPlan=s.task_plan_next,hasExpandedPlan=(nextPlan?.tasks.length||0)>(s.task_plan?.tasks.length||0);
  const date=cleaningDate||(hasExpandedPlan?nextPlan.date:day),manage=s.me.scope==="admin";
  const option=(value,label,selected)=>'<option value="'+e(value)+'"'+(value===selected?' selected':'')+'>'+e(label)+'</option>';
  return '<div class="card"><h2>Tâches de nettoyage</h2><p class="muted">Planning par rubrique, suivi des validations et preuves photographiques.</p>'+
   '<div class="ka-task-toolbar"><label>Date du suivi<input id="kitchenTasksReportDate" type="date" value="'+e(date)+'"></label><label>Salarié (responsable ou ayant validé)<select id="kitchenTaskAgent">'+option("","Tous les salariés",cleaningFilter.agent)+s.staff.map(a=>option(a.id,a.name,cleaningFilter.agent)).join("")+'</select></label><label>État<select id="kitchenTaskState">'+[["","Tous les états"],["todo","À réaliser / prévues"],["done","Validées"],["photo","Avec photo"],["legacy","Anciennes sans photo"],["optional","Selon utilisation"],["not_due","Non prévues"],["inactive","Désactivées"]].map(([k,v])=>option(k,v,cleaningFilter.state)).join("")+'</select></label></div>'+
   '<div class="actions"><button type="button" class="btn secondary" data-cleaning-date="today">Aujourd’hui</button><button type="button" class="btn secondary" data-cleaning-date="tomorrow">Demain</button><button type="button" class="btn secondary" id="kitchenTasksRefresh">Actualiser</button><button class="btn primary" type="button" id="kitchenTasksPdf">Exporter le PDF du nettoyage</button>'+(manage?'<button class="btn secondary" type="button" id="kitchenTasksPhotos">Consulter les photos</button><button class="btn primary" type="button" data-add-admin-task>Ajouter une tâche</button>':'')+'</div>'+
   (s.task_plan_next?.tasks.length?'<div class="ka-task-note">Nouveau planning de '+s.task_plan_next.tasks.length+' tâches à partir du '+e(s.task_plan_next.date.split("-").reverse().join("/"))+'. <button type="button" class="btn secondary" data-cleaning-date="tomorrow">Voir le nouveau planning</button></div>':'')+
   '<p id="kitchenTaskFeedback" class="status" role="status"></p><div id="kitchenTaskList" aria-live="polite">Chargement du planning…</div></div>';
 }
 function render(){
 const section=currentKitchenPage();
 if(!snapshot||!section)return;
 const settings=section==="cuisineSettings",tabs=kitchenPages[section];
 kitchenTab=selectedTabs[section];
 const s={...snapshot,tasks:(snapshot.tasks||[]).filter(t=>!isRetiredCleaningTask(t))},latestCold=new Map();
 for(const r of s.cold)if(!latestCold.has(r.room_id))latestCold.set(r.room_id,r);
 const alerts=[...latestCold.values()].filter(r=>r.is_alert).length+s.reheats.filter(r=>r.status==="alerte").length;
 const followedByGood=r=>s.cold.some(next=>next.room_id===r.room_id&&!next.is_alert&&new Date(next.measured_at)>new Date(r.measured_at));
 const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const done=new Set(s.checks.filter(x=>x.performed_on===day).map(x=>x.task_id));
 const roomname=id=>s.rooms.find(x=>x.id===id)?.label||"Chambre";
 const rows=(list,columns)=>'<div class="table"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+list.map(x=>'<tr>'+columns.map(c=>'<td>'+c[1](x)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
 node("content").innerHTML='<div class="grid"><div class="card"><div class="muted">Chambres froides</div><div class="kpi">'+s.rooms.length+'</div></div><div class="card"><div class="muted">Cycles en cours</div><div class="kpi">'+s.reheats.filter(x=>x.status==="en_cours").length+'</div></div><div class="card"><div class="muted">Anomalies actuellement signalées</div><div class="kpi">'+alerts+'</div></div><div class="card"><div class="muted">Tâches du jour</div><div class="kpi">'+s.tasks.filter(x=>done.has(x.id)).length+'/'+s.tasks.length+'</div></div></div>'+
 '<div class="card"><h2>Gestion Cuisine</h2><p class="muted">Suivi HACCP : relevés manuels, remises en température, tâches et actions correctives. Les mesures enregistrées ne sont pas modifiables.</p><div class="actions"><a class="btn primary" href="../../cuisine/" target="_blank" rel="noopener">Ouvrir l’espace Cuisine</a><button class="btn secondary" id="kitchenReload">Actualiser les relevés</button><button class="btn secondary" id="kitchenCsv">Exporter CSV</button></div><p id="kitchenAdminMessage" class="status"></p></div>'+
 '<div class="card"><h2>Agents de cuisine</h2><p class="muted">Comptes rattachés aux salariés existants. Définissez un PIN individuel de 6 à 8 chiffres pour activer l’accès.</p>'+s.staff.map(x=>'<div class="data-row"><div><strong>'+e(x.name)+'</strong><div class="muted">Salarié : '+(x.personnel_id?"rattaché":"non rattaché")+' · '+(x.active?"Actif":"Inactif")+'</div></div><form data-kitchen-pin="'+attr(x,"id")+'"><label>Définir / renouveler le PIN</label><input name="pin" required type="password" inputmode="numeric" pattern="[0-9]{6,8}" minlength="6" maxlength="8" autocomplete="new-password"><button class="btn primary" type="submit">Enregistrer le PIN</button></form><button class="btn secondary" type="button" data-kitchen-active="'+attr(x,"id")+'" data-next="'+(!x.active)+'">'+(x.active?"Désactiver":"Activer")+'</button></div>').join("")+'</div>'+
 '<div class="card"><h2>Chambres froides — noms et seuils</h2><p class="muted">Le renommage ne change pas les mesures déjà enregistrées.</p>'+
 s.rooms.filter(x=>!x.deleted_at&&!x.archived_at).map(x=>'<form data-room-edit="'+attr(x,"id")+'" class="grid"><div><label>Chambre '+x.room_number+' · '+e(x.room_type)+'</label><input name="label" required maxlength="80" value="'+attr(x,"label")+'"></div><div><label>Minimum °C (facultatif)</label><input type="number" step="0.1" name="min_c" value="'+(x.min_c===null?"":e(x.min_c))+'"></div><div><label>Maximum °C</label><input type="number" step="0.1" name="max_c" required value="'+e(x.max_c)+'"></div><div><button type="submit" class="btn primary">Renommer / enregistrer</button></div><div><button type="button" class="btn secondary" data-archive-room="'+attr(x,"id")+'">Archiver cette chambre</button></div></form>').join("")+
 '<h3>Chambres archivées et suppressions sécurisées</h3><p class="muted">Une chambre peut être supprimée moins de 24 heures après création OU après une année complète d’archivage. Un code temporaire envoyé à l’adresse autorisée est obligatoire. Les anciens relevés restent conservés.</p>'+
 s.rooms.filter(x=>!x.deleted_at).map(x=>{const created=new Date(x.created_at).getTime(),archived=x.archived_at?new Date(x.archived_at):null,eligible=Date.now()-created<86400000||!!(archived&&Date.now()>=new Date(archived.setUTCFullYear(archived.getUTCFullYear()+1)).getTime());return '<div class="data-row"><div><strong>'+e(x.label)+'</strong><div class="muted">Créée le '+when(x.created_at)+(x.archived_at?' · Archivée le '+when(x.archived_at):' · Active')+'</div></div><button type="button" class="btn secondary" data-delete-room="'+attr(x,"id")+'" '+(eligible?'':'disabled title="Délai minimal non atteint"')+'>'+(eligible?'Demander la suppression':'Suppression indisponible')+'</button></div>'}).join("")+
 '<h3>Référencer une nouvelle chambre</h3><form id="kitchenAddRoom" class="grid"><div><label>Type</label><select name="room_type"><option value="positive">Positive</option><option value="negative">Négative</option></select></div><div><label>Numéro</label><input required name="room_number" type="number" min="1" max="99"></div><div><label>Désignation</label><input required name="label" maxlength="80"></div><div><label>Minimum °C (facultatif)</label><input name="min_c" type="number" step="0.1" min="-50" max="40"></div><div><label>Maximum °C</label><input required name="max_c" type="number" step="0.1" min="-50" max="40"></div><div><button class="btn primary" type="submit">Ajouter cette chambre</button></div></form></div>'+
 '<div class="card"><h2>Fours</h2><p class="muted">Ajoutez autant de fours que nécessaire (numéros 1 à 99) et modifiez leurs noms.</p>'+
 (s.ovens||[]).map(x=>'<form data-oven-edit="'+attr(x,"id")+'" class="grid"><div><label>Four n° '+x.oven_number+'</label><input name="label" required maxlength="80" value="'+attr(x,"label")+'"></div><div><button type="submit" class="btn primary">Renommer ce four</button></div></form>').join("")+
 '<form id="kitchenAddOven" class="grid"><div><label>Numéro du nouveau four</label><input type="number" name="oven_number" min="1" max="99" required></div><div><label>Désignation</label><input name="label" required maxlength="80" placeholder="Ex. Four vapeur"></div><div><button class="btn primary" type="submit">Ajouter un four</button></div></form></div>'+
 '<div class="card"><h2>Types de plats</h2><p class="muted">Désignations proposées dans la remise en température.</p>'+
 (s.dishes||[]).map(x=>'<form data-dish-edit="'+attr(x,"id")+'" class="grid"><div><label>Type de plat</label><input name="label" required maxlength="80" value="'+attr(x,"label")+'"></div><div><button type="submit" class="btn primary">Renommer ce type</button></div></form>').join("")+
 '<form id="kitchenAddDish" class="grid"><div><label>Nouveau type de plat</label><input name="label" required maxlength="80" placeholder="Ex. Poisson"></div><div><button class="btn primary" type="submit">Ajouter un type de plat</button></div></form></div>'+
 '<div class="card"><h2>Valeurs par défaut</h2><p class="muted">Les équipements et catégories sont présélectionnés dans Cuisine. Les températures ci-dessous restent des cibles, jamais des mesures enregistrées automatiquement.</p>'+
 '<form id="kitchenSaveDefaults" class="grid">'+
 '<div><label>Chambre froide par défaut</label><select name="default_cold_room_id" required>'+s.rooms.filter(x=>!x.archived_at&&!x.deleted_at).map(x=>'<option value="'+attr(x,"id")+'" '+(s.defaults?.default_cold_room_id===x.id?"selected":"")+'>'+e(x.label)+'</option>').join("")+'</select></div>'+
 '<div><label>Four par défaut</label><select name="default_oven_id" required>'+(s.ovens||[]).map(x=>'<option value="'+attr(x,"id")+'" '+(s.defaults?.default_oven_id===x.id?"selected":"")+'>'+e(x.label)+'</option>').join("")+'</select></div>'+
 '<div><label>Type de plat par défaut</label><select name="default_dish_type_id" required>'+(s.dishes||[]).map(x=>'<option value="'+attr(x,"id")+'" '+(s.defaults?.default_dish_type_id===x.id?"selected":"")+'>'+e(x.label)+'</option>').join("")+'</select></div>'+
 '<div><label>Cible au départ (°C)</label><input name="target_start_c" type="number" step="0.1" min="-10" max="20" required value="'+e(s.defaults?.target_start_c??2)+'"></div>'+
 '<div><label>Cible minimale en fin (°C)</label><input name="target_end_c" type="number" step="0.1" min="63" max="120" required value="'+e(s.defaults?.target_end_c??63)+'"></div>'+
 '<div><label>Rappel (minutes)</label><input name="reminder_minutes" type="number" min="1" max="60" required value="'+e(s.defaults?.reminder_minutes??55)+'"></div>'+
 '<div><button class="btn primary" type="submit">Enregistrer les valeurs par défaut</button></div></form></div>'+
 '<div class="card"><h2>Thermomètres connectés</h2><p class="muted">Govee : connexion via l’API officielle (capteurs Wi-Fi compatibles uniquement). Les sondes Testo 104-IR / 104-IR BT sont référencées pour une intégration ultérieure. Les relevés manuels restent disponibles.</p>'+
 '<div class="card" style="background:#f0f6f4;border:2px solid #8fbeb3"><h3 style="font-size:19px">Connexion Govee — une seule clé pour tous vos thermomètres</h3><p class="muted">Saisissez la clé API de votre compte Govee Home ici, une seule fois. Elle est conservée chiffrée et n’est jamais montrée dans le navigateur après l’enregistrement.</p><form id="kitchenGoveeKey"><label for="kitchenGoveeApiKey">Votre unique clé API Govee</label><div class="grid"><div><input id="kitchenGoveeApiKey" type="password" name="api_key" required minlength="10" maxlength="240" autocomplete="new-password" placeholder="Collez votre clé API Govee ici"></div><div><button class="btn primary" type="submit" id="kitchenGoveeSaveAndTest">Enregistrer la clé et tester mes appareils</button></div></div></form><p id="kitchenGoveeKeyStatus" role="status" style="font-weight:700">'+(s.account?.govee_key_configured?'Clé enregistrée · prête pour le test des appareils.':'Aucune clé enregistrée · connexion non activée.')+'</p><div class="actions"><button type="button" id="kitchenGoveeQuickTest" class="btn secondary" '+(s.account?.govee_key_configured?'':'disabled')+'>Tester la connexion et récupérer les données</button></div><div id="kitchenGoveeTestResult" aria-live="polite"></div></div>'+
 '<div class="actions"><button id="kitchenGoveeDiscover" class="btn primary" type="button">Rechercher et tester les sondes</button></div><p id="kitchenGoveeActionStatus" role="status" aria-live="polite"></p><div id="kitchenGoveeDiscovered" aria-live="polite"></div>'+ 
 '<div class="card" style="background:#f5f7fa;border:1px solid #dce3eb"><h3>H5192 — thermomètre alimentaire à deux sondes</h3><p class="muted">Le H5192 n’expose pas actuellement les deux températures à cœur via la clé de l’API publique Govee. Un connecteur distinct utilisant une passerelle Home Assistant communautaire est à étudier. La saisie manuelle reste obligatoire tant que la connexion des sondes n’a pas été validée sur votre matériel.</p></div>'+
 '<h3>Pour plus tard : sondes de plats Testo</h3><p class="muted">Le testo 104-IR classique n’est pas une sonde API. Le 104-IR BT transmet à Testo Smart, mais aucune connexion automatique à ce site n’est activée. Il faut continuer à mesurer et saisir manuellement la température à cœur.</p>'+
 '<form id="kitchenProbeRegister" class="grid"><div><label>Désignation de la sonde</label><input name="label" required minlength="2" maxlength="80" placeholder="Ex. Sonde cuisine 1"></div><div><label>Modèle Testo</label><select name="model"><option value="testo 104-IR">testo 104-IR (manuel)</option><option value="testo 104-IR BT">testo 104-IR BT (application Testo Smart)</option></select></div><div><button class="btn secondary" type="submit">Référencer la sonde pour plus tard</button></div></form>'+
 ((s.connected||[]).filter(d=>d.kind==="food_probe").map(d=>'<div class="data-row"><strong>'+e(d.label)+'</strong><span class="muted">'+e(d.model)+' · Connexion au site non disponible</span></div>').join(""))+
 '</div>'+
 renderCollectionSchedules(s)+
 '<div class="card"><h2>Derniers relevés des chambres</h2><p class="muted">Choisissez une chambre. Le tableau affiche 50 lignes par page, mais les exports récupèrent l’intégralité de l’historique filtré.</p>'+
 '<div class="grid"><div><label for="adminColdRoomSelector">Chambre froide à consulter</label><select id="adminColdRoomSelector"><option value="">Toutes les chambres</option>'+s.rooms.map(r=>'<option value="'+attr(r,"id")+'" '+(selectedColdRoom===r.id?"selected":"")+'>'+e(r.label)+'</option>').join("")+'</select></div><div><label>Exporter les résultats</label><div class="actions"><button type="button" class="btn secondary" data-admin-cold-export="csv">Exporter CSV</button><button type="button" class="btn secondary" data-admin-cold-export="pdf">Exporter PDF</button></div></div></div>'+
 (coldHistoryError?'<p class="status err">'+e(coldHistoryError)+'</p>':'')+
 '<div class="muted">'+coldHistoryTotal+' relevé(s) trouvé(s) · page '+(Math.floor(coldHistoryOffset/50)+1)+'</div>'+
 rows(coldHistory,[["Date / heure",x=>when(x.measured_at)],["Chambre",x=>e(roomname(x.room_id))],["Température",x=>t(x.temperature_c)+" °C"],["Source",x=>x.source==="govee_cloud"?"Capteur Govee":e(staff(x.taken_by))],["Résultat",x=>'<span class="pill '+(x.is_alert?"warning":"ok")+'">'+(x.is_alert?(followedByGood(x)?"Ancien écart · recontrôlé":"Hors seuil"):"Dans la plage")+'</span>'],["",x=>'<button class="btn secondary" data-corrective="chambre_froide" data-id="'+attr(x,"id")+'">Action corrective</button>']])+
 '<div class="actions"><button class="btn secondary" type="button" data-admin-cold-page="previous" '+(coldHistoryOffset===0?'disabled':'')+'>Précédent</button><button class="btn secondary" type="button" data-admin-cold-page="next" '+(coldHistoryOffset+50>=coldHistoryTotal?'disabled':'')+'>Suivant</button></div></div>'+
 '<div class="card"><h2>Remises en température · parcours chambre → four</h2>'+rows(s.reheats.slice(0,40),[["Départ",x=>when(x.started_at)],["Parcours",x=>e(x.cold_room_label_snapshot||s.rooms.find(r=>r.id===x.cold_room_id)?.label||"Chambre non renseignée")+" → "+e(x.oven_label_snapshot||s.ovens?.find(r=>r.id===x.oven_id)?.label||("Four "+x.oven_number))],["Type de plat",x=>e(x.dish_type_label_snapshot||s.dishes?.find(d=>d.id===x.dish_type_id)?.label||"Non renseigné")],["Évolution",x=>t(x.start_temperature_c)+" → "+(x.end_temperature_c==null?"—":t(x.end_temperature_c))+" °C"+(x.end_temperature_c==null?"":" (+"+t(Number(x.end_temperature_c)-Number(x.start_temperature_c))+" °C)")],["Rappel",x=>when(x.due_at)],["Évaluation",x=>x.status==="alerte"?"Température hors cible":x.status==="en_cours"?"En cours":"Température cible atteinte"],["Contrôle horaire",x=>x.ended_at?(new Date(x.ended_at)>new Date(x.due_at)?"Relevé après le rappel":"Relevé avant le rappel"):"Contrôle en cours"],["",x=>x.status==="alerte"?'<button class="btn secondary" data-corrective="remise_en_temperature" data-id="'+attr(x,"id")+'">Action corrective</button>':""]])+'</div>'+
 cleaningPanel(s,day)+
 '<div class="card"><h2>Journal des relevés invalidés</h2><p class="muted">Historique d’audit uniquement : ces valeurs ne comptent plus dans les résultats HACCP ni dans les exports standards.</p>'+rows((s.invalidated||[]),[["Mesure d’origine",x=>when(x.measured_at)],["Chambre",x=>e(roomname(x.room_id))],["Valeur initiale",x=>t(x.temperature_c)+" °C"],["Correction",x=>when(x.invalidated_at)],["Motif",x=>e(x.invalidation_reason)],["Par",x=>e(x.invalidated_by)]])+'</div>'+
 '<div class="card"><h2>Actions correctives enregistrées</h2>'+rows(s.notes.slice(0,30),[["Date",x=>when(x.created_at)],["Type",x=>e(x.entity_type)],["Observation",x=>e(x.note)],["Auteur",x=>e(x.created_by)]])+'</div>';
 
 const content=node("content"),all=Array.from(content.children);
 if(!node("kitchen-organized-styles")){
   const css=document.createElement("style");css.id="kitchen-organized-styles";
   css.textContent="#kitchen-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:13px 0 18px}#kitchen-tabs button{border:1px solid #d3dce3;border-radius:9px;padding:11px 15px;font-weight:750;background:#f1f4f6;color:#334657;cursor:pointer}#kitchen-tabs button.active{background:#243447;color:white;border-color:#243447}#content .kitchen-panel[hidden]{display:none!important}#content .kitchen-panel .grid{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}#content .kitchen-panel form{margin:10px 0 14px}#content .kitchen-panel form label{display:block;font-size:12px;font-weight:700;margin-bottom:7px}#content .kitchen-panel .card{padding:18px}#content .kitchen-panel h2{margin:0 0 9px}#content .kitchen-panel h3{margin:17px 0 9px}#content .kitchen-panel .data-row{padding:11px 0;border-bottom:1px solid #e7edf0}#content .kitchen-panel .data-row:last-child{border:0}#content .kitchen-panel .btn{margin-top:4px}#content .kitchen-section-intro{padding:18px 20px;border:1px solid #dbe4ea;border-radius:12px;background:#f5f8fa;margin-bottom:14px}#content .kitchen-section-intro h2{margin:0 0 5px}#content .kitchen-section-intro p{margin:0;color:#5d6d79;font-size:13px}#content .kitchen-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}#content .kitchen-overview-grid>div{padding:17px;background:#fff;border:1px solid #dce4e9;border-radius:12px}#content .kitchen-overview-grid strong{display:block;font-size:27px;margin:5px 0;color:#243447}#content .kitchen-overview-grid small{color:#607182}#content #kitchen-tabs{position:relative}";
   document.head.append(css);
 }
 const groups={overview:[],govee:[],meater:[],pms:[],schedule:[],records:[],equipment:[],cleaning:[],staff:[]};
 let sharedHeader=null;
 for(const el of all){
   if(el.id==="kitchen-tabs")continue;
   const heading=el.querySelector?.("h2")?.textContent||"";
   if(heading.startsWith("Gestion Cuisine"))sharedHeader=el;
   else if(heading.startsWith("Agents de cuisine"))groups.staff.push(el);
   else if(heading.startsWith("Tâches de nettoyage"))groups.cleaning.push(el);
   else if(heading.startsWith("Thermomètres connectés"))groups.govee.push(el);
   else if(heading.startsWith("Programmation des relevés"))groups.schedule.push(el);
   else if(heading.startsWith("Chambres froides")||heading.startsWith("Fours")||heading.startsWith("Types de plats")||heading.startsWith("Valeurs par défaut"))groups.equipment.push(el);
   else if(heading.startsWith("Derniers relevés")||heading.startsWith("Remises en température")||heading.startsWith("Journal des relevés invalidés")||heading.startsWith("Actions correctives"))groups.records.push(el);
   else groups.overview.push(el);
 }
 const header=document.createElement("div");header.id="kitchen-tabs";header.setAttribute("role","tablist");header.setAttribute("aria-label",settings?"Rubriques Paramètres cuisine":"Rubriques Gestion Cuisine");
 for(const [key,label] of tabs){
   const b=document.createElement("button");b.type="button";b.dataset.kitchenTab=key;b.textContent=label;b.setAttribute("role","tab");b.addEventListener("click",()=>{chooseKitchenTab(section,key);kitchenTab=key;selectTab()});header.append(b);
 }
 // Ne conserver dans le DOM que les rubriques de la page active.
 content.replaceChildren(sharedHeader,header);
 if(settings){
  sharedHeader.querySelector("h2").textContent="Paramètres cuisine";
  sharedHeader.querySelector("p").textContent="Configuration des sondes, de la collecte, du plan sanitaire, des équipements et des accès.";
  node("kitchenReload").textContent="Actualiser les paramètres";
  node("kitchenCsv").remove();
 }
 const shortcuts=sharedHeader.querySelector(".actions"),jump=document.createElement("button");
 jump.type="button";jump.className="btn secondary";jump.textContent=settings?"Relevés et alertes":"Paramètres cuisine";
 jump.addEventListener("click",()=>settings?openKitchenTab("cuisine","records"):show("cuisineSettings"));
 shortcuts.append(jump);
 const intros={overview:["Tableau de bord","Vue rapide sur les contrôles et les tâches du jour."],govee:["Connexion des thermomètres Govee","Une seule clé API pour l’ensemble des capteurs compatibles. Testez les appareils puis associez chaque sonde à sa chambre froide."],meater:["MEATER Pro XL · 3 stations","Paramétrage des douze sondes, connexion Cloud et qualification HACCP."],pms:["Plan de maîtrise sanitaire","Procédures, responsabilités, contrôles et registre des écarts."],schedule:["Programmation des relevés automatiques","Personnalisez la fréquence ou les heures de collecte de chaque chambre froide."],records:["Historique et anomalies","Températures réellement enregistrées, résultats des remises en température et actions correctives."],equipment:["Configuration des équipements","Nommez vos chambres, fours, plats et définissez les valeurs utilisées par défaut."],cleaning:["Nettoyage et preuves photographiques","Consultez et modifiez les tâches programmées, vérifiez les validations et ouvrez les photos par date."],staff:["Équipe de cuisine","Gérez les accès personnels des agents Cuisine."]};
 const panels={};
 for(const [key] of tabs){
   const wrapper=document.createElement("section");wrapper.className="kitchen-panel";wrapper.dataset.panel=key;wrapper.setAttribute("role","tabpanel");wrapper.id="kitchen-panel-"+key;
   const intro=document.createElement("div");intro.className="kitchen-section-intro";const h=document.createElement("h2");h.textContent=intros[key][0];const p=document.createElement("p");p.textContent=intros[key][1];intro.append(h,p);wrapper.append(intro);
   if(key==="meater"){const root=document.createElement("div");root.id="meaterAdminPanel";wrapper.append(root);}
   if(key==="pms"){const root=document.createElement("div");root.id="pmsAdminPanel";wrapper.append(root);}
   if(key==="overview"){
     const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
     const done=new Set(s.checks.filter(x=>x.performed_on===day).map(x=>x.task_id));
     const active=s.reheats.filter(x=>x.status==="en_cours");
     const todayCold=s.cold.filter(x=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(x.measured_at))===day);
     const summary=document.createElement("div");summary.className="kitchen-overview-grid";summary.innerHTML=
       '<div><small>Chambres relevées aujourd’hui</small><strong>'+new Set(todayCold.map(x=>x.room_id)).size+' / '+s.rooms.length+'</strong></div>'+
       '<div><small>Réchauffages en cours</small><strong>'+active.length+'</strong></div>'+
       '<div><small>Nettoyage terminé aujourd’hui</small><strong>'+s.tasks.filter(x=>done.has(x.id)).length+' / '+s.tasks.length+'</strong></div>'+
       '<div><small>Alertes (historique chargé)</small><strong>'+alerts+'</strong></div>';
     const monitor=document.createElement("div");monitor.id="adminKitchenColdOverview";monitor.className="kt-admin-cold";monitor.innerHTML=window.KitchenUI.coldOverview(s,{buttonAttributes:'data-kitchen-cold-go'});wrapper.prepend(monitor);
     const meaterMonitor=document.createElement("div");meaterMonitor.id="adminKitchenMeaterOverview";wrapper.append(meaterMonitor);
 const daily=document.createElement("div");daily.className="card";daily.innerHTML='<h2>Tâches du jour</h2><div class="kt-day-list">'+(s.tasks.map(x=>'<div class="kt-day-row"><div><strong>'+e(x.label)+'</strong><div class="muted">'+(x.assigned_to?e(staff(x.assigned_to)):"Commune")+' · '+e(window.KitchenUI.scheduleLabel(x))+'</div></div><div class="kt-task-actions"><span>'+(done.has(x.id)?"Réalisée":"À réaliser")+'</span>'+(s.me.scope==="admin"?'<button class="btn secondary" type="button" data-edit-admin-task="'+e(x.id)+'">Modifier</button>':'')+'</div></div>').join("")||'<p class="muted">Aucune tâche prévue aujourd’hui.</p>')+'</div><button type="button" class="btn secondary" data-kitchen-task-go>Gérer les tâches</button>';wrapper.append(daily,summary);
     const tip=document.createElement("div");tip.className="card";tip.style.marginTop="16px";tip.innerHTML='<h3>Utilisation quotidienne</h3><p>Les agents travaillent dans l’espace Cuisine. Ici, vous consultez les températures, les relevés, les anomalies et les validations du nettoyage. Les réglages des sondes et équipements se trouvent dans Paramètres cuisine.</p>';wrapper.append(tip);
   }
   for(const el of groups[key])wrapper.append(el);
   content.append(wrapper);panels[key]=wrapper;
 }
 function selectTab(){
   for(const [key]of tabs)panels[key].hidden=key!==kitchenTab;
   header.querySelectorAll("button").forEach(b=>{const active=b.dataset.kitchenTab===kitchenTab;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active))});
   if(kitchenTab==="govee"){
    renderGoveeDiscovery();
    if(snapshot.me.scope==="admin"&&snapshot.account?.govee_key_configured&&!goveeDiscovery&&!goveeLoading)void testGoveeConnection();
   }
   if(kitchenTab==="overview"){
    const root=node("adminKitchenMeaterOverview");
    if(root&&!root.dataset.meaterMounted&&window.KitchenMeater?.mountDashboard){root.dataset.meaterMounted="1";window.KitchenMeater.mountDashboard(root,api);}
   }
   if(kitchenTab==="cleaning")refreshCleaningAdmin();
   if(kitchenTab==="meater")window.KitchenMeater.mountAdmin(node("meaterAdminPanel"),api,snapshot.me.scope==="admin");
   if(kitchenTab==="pms")window.KitchenPMS.mount(node("pmsAdminPanel"),{api,get:async(action,params={})=>{const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";const r=await fetch(API+"?"+new URLSearchParams({action,...params}),{headers:{"x-admin-session":token},cache:"no-store"});const j=await r.json();if(!r.ok)throw Error(j.error||"Service indisponible");return j;},role:snapshot.me.scope,canWrite:snapshot.me.scope==="admin"});
 }
 selectTab();
 node("kitchenReload").addEventListener("click",load);node("kitchenCsv")?.addEventListener("click",downloadCsv);
 }
 function downloadCsv(){if(!snapshot)return;const lines=[["Type","Date et heure","Équipement","Début °C","Fin °C","Statut","Agent"]];
 for(const x of snapshot.cold)lines.push(["Chambre froide",x.measured_at,snapshot.rooms.find(r=>r.id===x.room_id)?.label||"",x.temperature_c,"",x.is_alert?"Alerte":"Conforme",x.source==="govee_cloud"?"Capteur Govee":staff(x.taken_by)]);
 for(const x of snapshot.reheats)lines.push(["Remise en température",x.started_at,(x.cold_room_label_snapshot||"Chambre non renseignée")+" → "+(x.oven_label_snapshot||("Four "+x.oven_number))+" · "+(x.dish_type_label_snapshot||"Plat non renseigné"),x.start_temperature_c,x.end_temperature_c??"",x.status,staff(x.started_by)]);
 const csv="\ufeff"+lines.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const link=document.createElement("a"),u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));link.href=u;link.download="cuisine-haccp-"+new Date().toISOString().slice(0,10)+".csv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
 async function load(){
  const section=currentKitchenPage();if(!section)return;
  const epoch=++loadEpoch,owner=goveeSession(),valid=()=>epoch===loadEpoch&&owner===goveeSession()&&currentKitchenPage()===section;
  try{
   const next=await api("list");if(!valid())return;
   snapshot=next;
   if(section==="cuisine")await refreshColdHistory(coldHistoryOffset,false);
   if(valid())render();
  }catch(err){if(valid())node("content").innerHTML='<div class="card"><b>Impossible de charger '+(section==="cuisineSettings"?"les paramètres cuisine":"Gestion Cuisine")+'.</b><p class="status err">'+e(err.message)+'</p></div>';}
 }

 document.addEventListener("change",evt=>{
  if(evt.target?.id==="adminColdRoomSelector"){
   selectedColdRoom=evt.target.value;coldHistoryOffset=0;coldHistory=[];
   refreshColdHistory(0);
  }
 });
 document.addEventListener("click",evt=>{
  const ex=evt.target.closest?.("[data-admin-cold-export]");
  if(ex){exportColdReadings(ex.dataset.adminColdExport);return}
  const pageBtn=evt.target.closest?.("[data-admin-cold-page]");
  if(pageBtn)refreshColdHistory(Math.max(0,coldHistoryOffset+(pageBtn.dataset.adminColdPage==="next"?50:-50)));
 });
 document.addEventListener("submit",evt=>{
 const form=evt.target;if(!(form instanceof HTMLFormElement)||!["kitchenAddRoom","kitchenAddOven","kitchenAddDish","kitchenSaveDefaults","kitchenGoveeKey","kitchenProbeRegister"].includes(form.id)&&!form.matches("[data-kitchen-pin],[data-room-edit],[data-oven-edit],[data-dish-edit],[data-govee-associate],[data-govee-room],[data-room-schedule]"))return;evt.preventDefault();
 const f=new FormData(form),values=Object.fromEntries(f.entries());
 if(form.matches("[data-room-schedule]")){saveCollectionSchedule(form,values);return;}
 if(form.matches("[data-govee-associate]")){void goveeAction("govee-add-sensor",{device:form.dataset.goveeAssociate,sku:form.dataset.sku,room_id:values.room_id,raw_unit:values.raw_unit},form);return;}
 if(form.matches("[data-govee-room]")){void goveeAction("govee-reassign-sensor",{id:form.dataset.goveeRoom,room_id:values.room_id},form);return;}
 if(form.matches("[data-kitchen-pin]"))action("set-staff-pin",{staff_id:form.dataset.kitchenPin,pin:values.pin});
 if(form.id==="kitchenAddRoom")action("add-room",{room_type:values.room_type,room_number:Number(values.room_number),label:values.label,min_c:values.min_c===""?null:Number(values.min_c),max_c:Number(values.max_c)});
 if(form.matches("[data-room-edit]"))action("update-room",{id:form.dataset.roomEdit,label:values.label,min_c:values.min_c===""?null:Number(values.min_c),max_c:Number(values.max_c)});
 if(form.id==="kitchenAddOven")action("add-oven",{oven_number:Number(values.oven_number),label:values.label});
 if(form.matches("[data-oven-edit]"))action("update-oven",{id:form.dataset.ovenEdit,label:values.label});
 if(form.id==="kitchenAddDish")action("add-dish-type",{label:values.label});
 if(form.matches("[data-dish-edit]"))action("update-dish-type",{id:form.dataset.dishEdit,label:values.label});
 if(form.id==="kitchenSaveDefaults")action("save-defaults",{default_cold_room_id:values.default_cold_room_id,default_oven_id:values.default_oven_id,default_dish_type_id:values.default_dish_type_id,target_start_c:Number(values.target_start_c),target_end_c:Number(values.target_end_c),reminder_minutes:Number(values.reminder_minutes)});
 
 if(form.id==="kitchenGoveeKey"){saveGoveeKeyAndTest(String(values.api_key||""));return;}
 if(form.id==="kitchenProbeRegister")action("probe-register",{label:values.label,model:values.model});
 });

 function showGoveeTestResult(result){
  const dest=node("kitchenGoveeTestResult");if(!dest)return;
  const devices=Array.isArray(result.devices)?result.devices:[];
  const received=devices.filter(d=>d.raw_temperature!==null).length;
  dest.innerHTML='<div class="card"><h3>Résultat du test Govee</h3><p class="muted">Clé acceptée · '+result.account_devices+' appareil(s) sur le compte · '+result.matching_devices+' appareil(s) sélectionné(s) pour le test · '+received+' mesure(s) disponibles.</p>'+
   (devices.length?devices.map(d=>'<div class="data-row"><div><strong>'+e(d.label)+' · '+e(d.sku)+'</strong><div class="muted">'+e(d.device)+'</div><div class="muted">'+e(d.status==='donnees_recues'?"Température reçue":d.status==="non_expose"?"Non exposé par cette API":d.status==="hors_ligne"?"Hors ligne":d.status==="sans_mesure"?"Aucune mesure disponible":d.status==="statut_non_confirme"?"Mesure disponible, état du capteur inconnu":"Erreur API")+'</div>'+(d.error?'<div class="muted">'+e(d.error)+'</div>':'')+'</div><div>'+ (d.temperature_c!==null&&d.temperature_c!==undefined?'<strong>'+t(d.temperature_c)+' °C</strong><div class="muted">Reçu : '+t(d.raw_temperature)+' °'+e(d.raw_unit||'?')+'</div>':d.raw_temperature===null?'<strong>—</strong>':'<strong>Valeur brute : '+t(d.raw_temperature)+' · unité inconnue</strong>')+'</div></div>').join(""):'<p>Aucun modèle H5179/H5192 accessible dans la réponse Govee. Cela ne signifie pas que vos appareils ne fonctionnent pas dans Govee Home.</p>')+
   '<p class="muted">H5179 configuré en °F : conversion automatique en °C avant affichage et enregistrement. Ce test ne crée aucun relevé HACCP. Le H5192 peut ne pas être accessible par l’API publique.</p></div>';
 }
 async function testGoveeConnection(){
  ensureGoveeOwner();if(goveeLoading||busy||snapshot?.me?.scope!=="admin")return;
  const owner=goveeOwner,version=++goveeVersion;
  goveeLoading=true;
  const current=()=>owner===goveeSession()&&version===goveeVersion;
  const button=node("kitchenGoveeQuickTest"),status=node("kitchenGoveeKeyStatus");
  if(button)button.disabled=true;
  goveeFeedback("Recherche des sondes et lecture des températures…");
  if(status)status.textContent="Test en cours : recherche des appareils et lecture des températures…";
  renderGoveeDiscovery();
  try{
   const result=await api("govee-test");
   if(!current())return;
   if(!Array.isArray(result.devices))throw Error("Liste Govee invalide.");
   goveeDiscovery=result;
   showGoveeTestResult(result);
   if(node("kitchenGoveeKeyStatus"))node("kitchenGoveeKeyStatus").textContent="Clé valide. Test terminé : "+result.checked_devices+" appareil(s) analysé(s).";
   goveeFeedback("Recherche terminée. Choisissez la chambre réelle de chaque sonde.");
  }catch(error){
   if(!current())return;
   goveeDiscovery={devices:[],discovered:[]};
   if(node("kitchenGoveeKeyStatus"))node("kitchenGoveeKeyStatus").textContent="Échec du test : "+error.message;
   goveeFeedback("Recherche impossible : "+error.message,true);
   const box=node("kitchenGoveeTestResult");if(box)box.textContent="Aucune donnée Govee confirmée pour le moment.";
  }finally{if(current()){goveeLoading=false;if(node("kitchenGoveeQuickTest"))node("kitchenGoveeQuickTest").disabled=false;renderGoveeDiscovery()}}
 }
 async function saveGoveeKeyAndTest(key){
  const button=node("kitchenGoveeSaveAndTest"),status=node("kitchenGoveeKeyStatus");
  if(button)button.disabled=true;
  if(status)status.textContent="Validation de la clé API Govee en cours…";
  try{
   await api("govee-save-key","POST",{api_key:key});
   resetGoveeDiscovery();if(snapshot?.account)snapshot.account.govee_key_configured=true;
   const field=node("kitchenGoveeApiKey");if(field)field.value="";
   if(status)status.textContent="Clé enregistrée et vérifiée. Lecture des capteurs…";
   await testGoveeConnection();
  }catch(error){
   if(status)status.textContent="Impossible d’enregistrer ou de vérifier la clé : "+error.message;
  }finally{if(button)button.disabled=false}
 }
 document.addEventListener("click",evt=>{
  if(evt.target.closest?.("#kitchenGoveeQuickTest"))testGoveeConnection();
 });
 document.addEventListener("click",evt=>{
 if(evt.target.closest?.("#kitchenGoveeDiscover")){void testGoveeConnection();return}
 const sync=evt.target.closest?.("button[data-govee-sync]");
 if(sync)void goveeAction("govee-sync",{id:sync.dataset.goveeSync});
});
 document.addEventListener("click",async evt=>{
 const archive=evt.target.closest?.("button[data-archive-room]");
 if(archive){
   const room=snapshot?.rooms?.find(r=>r.id===archive.dataset.archiveRoom);if(!room)return;
   if(confirm('Archiver '+room.label+' ? Cette chambre ne pourra plus recevoir de nouveaux relevés.')){
     await action("archive-room",{id:room.id});
   }
 }
 const deletion=evt.target.closest?.("button[data-delete-room]");
 if(deletion){
   const room=snapshot?.rooms?.find(r=>r.id===deletion.dataset.deleteRoom);if(!room)return;
   if(!confirm('Demander la suppression de '+room.label+' ? Les relevés HACCP seront conservés. Une authentification à enguerrand@danglade.net est obligatoire.'))return;
   try{
     const requested=await api("request-room-delete-code","POST",{id:room.id});
     if(!requested.requested)return;
     const code=prompt('Entrez le code temporaire reçu à enguerrand@danglade.net :');
     if(!code)return;
     const result=await api("delete-room","POST",{id:room.id,code:code.trim()});
     if(result.deleted){await load();notify('Chambre retirée. Les relevés historiques ont été conservés.');}
   }catch(err){notify(err.message,true);}
 }
 });
 document.addEventListener("click",evt=>{const b=evt.target.closest?.("button[data-kitchen-active]");if(b)action("set-staff-active",{staff_id:b.dataset.kitchenActive,active:b.dataset.next==="true"});});
 
 async function openTasksPhotos(selectedId=null){
  if(snapshot?.me.scope!=="admin")return;
  const date=node("kitchenTasksReportDate")?.value,initial=cleaningSession(),owner=snapshot;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")){notify("Choisissez une date de rapport.",true);return;}
  const button=node("kitchenTasksPhotos");if(button)button.disabled=true;
  try{
   const report=await (await cleaningGet("task-report",{date},initial)).json();
   if(snapshot!==owner||initial!==cleaningSession()||node("kitchenTasksReportDate")?.value!==date||kitchenTab!=="cleaning")return;
   if(selectedId&&!report.checks.some(c=>c.id===selectedId&&c.photo_bytes>0))throw Error("Cette preuve n’est plus disponible pour la date sélectionnée.");
   window.KitchenPhoto.showHistory({report,staff:owner.staff,selectedId,fetchPhoto:async id=>(await cleaningGet("task-photo",{id},initial)).blob()});
  }catch(err){cleaningFeedback(err.message,true);}
  finally{if(button)button.disabled=false;}
 }
 document.addEventListener("click",ev=>{
  const b=ev.target.closest?.("[data-admin-task-photo],#kitchenTasksPhotos,#kitchenTasksRefresh,[data-cleaning-date]");if(!b||!node("kitchenTaskList")||kitchenTab!=="cleaning")return;
  if(b.dataset.adminTaskPhoto){openTasksPhotos(b.dataset.adminTaskPhoto);return;}
  if(b.id==="kitchenTasksPhotos"){openTasksPhotos();return;}
  if(b.dataset.cleaningDate){const day=cleaningToday();node("kitchenTasksReportDate").value=b.dataset.cleaningDate==="tomorrow"?cleaningNextDay(day):day;}
  refreshCleaningAdmin();
 });
 document.addEventListener("change",ev=>{
  if(!node("kitchenTaskList")||kitchenTab!=="cleaning")return;
  if(ev.target.id==="kitchenTasksReportDate"){refreshCleaningAdmin();return;}
  if(ev.target.id==="kitchenTaskAgent"){cleaningFilter.agent=ev.target.value;renderCleaningAdmin();}
  if(ev.target.id==="kitchenTaskState"){cleaningFilter.state=ev.target.value;renderCleaningAdmin();}
 });
 async function exportTasksPDF(){
  const date=node("kitchenTasksReportDate")?.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")){cleaningFeedback("Choisissez une date de rapport.",true);return}
  const button=node("kitchenTasksPdf");if(button)button.disabled=true;
  try{
   const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
   const response=await fetch(API+"?"+new URLSearchParams({action:"task-report",date}),{headers:{"x-admin-session":token},cache:"no-store"});
   const report=await response.json().catch(()=>({error:"Réponse du serveur invalide"}));
   if(!response.ok)throw Error(report.error||"Impossible de récupérer le suivi du nettoyage");
   const result=await window.CuisineReports.tasksPdf({...report,staff:snapshot.staff});
   cleaningFeedback("PDF du nettoyage généré : "+result.completed+" tâche(s) validée(s) sur "+result.total+".");
  }catch(err){cleaningFeedback("Export PDF impossible : "+err.message,true)}
  finally{if(button)button.disabled=false}
 }
 function openCorrectiveDialog(type,id){
  let modal=node("kitchenCorrectionDialog");
  if(!modal){
   modal=document.createElement("dialog");modal.id="kitchenCorrectionDialog";
   modal.style.cssText="border:1px solid #c8d4df;border-radius:14px;padding:24px;max-width:min(550px,95vw);width:100%;color:#243447;box-shadow:0 20px 80px #162b4573";
   modal.innerHTML='<form method="dialog" id="kitchenCorrectionForm"><h2>Action corrective</h2><p id="kitchenCorrectionDetails"></p><label for="kitchenCorrectionReason">Motif de correction</label><textarea id="kitchenCorrectionReason" required minlength="8" maxlength="500" rows="3" style="width:100%;margin:10px 0 15px;padding:11px;border:1px solid #bbcbd5;border-radius:8px" placeholder="Ex. Erreur de saisie : signe moins oublié. Mesure de contrôle effectuée."></textarea><p id="kitchenCorrectionHelp" class="muted">Invalider conserve la valeur originale dans le journal d’audit, sans l’inclure dans les relevés valides et les exports standards.</p><div class="actions"><button type="button" class="btn secondary" id="kitchenCorrectionCancel">Annuler</button><button type="button" class="btn secondary" id="kitchenCorrectionNote">Documenter sans invalider</button><button type="button" class="btn primary" id="kitchenCorrectionInvalidate">Erreur de saisie — retirer du suivi</button></div><p id="kitchenCorrectionFeedback" role="status"></p></form>';
   document.body.append(modal);
   node("kitchenCorrectionCancel").addEventListener("click",()=>modal.close());
   for(const [buttonId,mode] of [["kitchenCorrectionNote","corrective"],["kitchenCorrectionInvalidate","invalidate-cold-reading"]]){
    node(buttonId).addEventListener("click",async()=>{
     const reason=node("kitchenCorrectionReason").value.trim(),feedback=node("kitchenCorrectionFeedback");
     if(reason.length<8){feedback.textContent="Indiquez un motif d’au moins 8 caractères.";return}
     if(mode==="invalidate-cold-reading"&&!confirm("Retirer ce relevé des mesures valides et des exports standards ? La valeur et le motif resteront dans l’audit."))return;
     const controls=modal.querySelectorAll("button");controls.forEach(b=>b.disabled=true);
     try{
      await api(mode,"POST",mode==="corrective"?{entity_type:modal.dataset.entityType,entity_id:modal.dataset.recordId,note:reason}:{id:modal.dataset.recordId,reason});
      modal.close();await load();notify(mode==="corrective"?"Observation enregistrée.":"Relevé invalidé pour erreur de saisie ; valeur conservée dans l’audit.");
     }catch(err){feedback.textContent=err.message;}
     finally{controls.forEach(b=>b.disabled=false)}
    });
   }
  }
  const reading=coldHistory.find(r=>r.id===id)||snapshot.cold.find(r=>r.id===id);
  modal.dataset.recordId=id;modal.dataset.entityType=type;
  node("kitchenCorrectionDetails").textContent=type==="chambre_froide"&&reading?
   "Chambre : "+(snapshot.rooms.find(r=>r.id===reading.room_id)?.label||"Inconnue")+" · "+t(reading.temperature_c)+" °C · "+when(reading.measured_at):
   "Enregistrement HACCP sélectionné.";
  node("kitchenCorrectionInvalidate").hidden=type!=="chambre_froide";
  node("kitchenCorrectionHelp").hidden=type!=="chambre_froide";
  node("kitchenCorrectionReason").value="";node("kitchenCorrectionFeedback").textContent="";
  modal.showModal();
 }

 document.addEventListener("click",evt=>{const b=evt.target.closest?.("button[data-corrective]");if(b)openCorrectiveDialog(b.dataset.corrective,b.dataset.id)});
 document.addEventListener("click",evt=>{if(evt.target.closest?.("#kitchenTasksPdf"))exportTasksPDF()});
 async function fetchTaskSettings(day){
 const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
 const r=await fetch(API+"?"+new URLSearchParams({action:"task-settings",date:day}),{headers:{"x-admin-session":token},cache:"no-store"});
 const j=await r.json().catch(()=>({error:"Réponse invalide"}));if(!r.ok||!Array.isArray(j.tasks))throw Error(j.error||"Configuration indisponible");return j.tasks;
 }
 function editAdminTask(id){
 if(busy||snapshot?.me.scope!=="admin")return;
 const fromCleaning=kitchenTab==="cleaning";
 const date=fromCleaning?node("kitchenTasksReportDate")?.value:cleaningToday();
 if(!date||date<cleaningToday())return;
 if(fromCleaning&&id&&(!cleaningLoaded||cleaningLoaded.day!==date||cleaningLoaded.session!==cleaningSession()))return;
 const task=id?(fromCleaning&&cleaningLoaded?.day===date?cleaningLoaded.settings:(snapshot.task_settings||snapshot.tasks)).find(t=>t.id===id):null;if(id&&(!task||isRetiredCleaningTask(task)))return;
 window.KitchenUI.open({task,staff:snapshot.staff,initialDate:date,completed:!!task&&snapshot.checks.some(c=>c.task_id===id&&c.performed_on===window.KitchenUI.today()),fetchTasks:fetchTaskSettings,save:(name,body)=>api(name,"POST",body),onSaved:async()=>{chooseKitchenTab("cuisine","cleaning");if(currentKitchenPage()!=="cuisine")return;kitchenTab="cleaning";cleaningDate=date;await load();const msg=node("kitchenTaskFeedback");if(msg)msg.textContent="Tâche enregistrée."}});
 }
 document.addEventListener("click",evt=>{const btn=evt.target.closest?.("[data-edit-admin-task],[data-add-admin-task]");if(btn&&node("kitchen-tabs"))editAdminTask(btn.dataset.editAdminTask||null);if(evt.target.closest?.("[data-kitchen-cold-go]"))node("kitchen-tabs")?.querySelector('[data-kitchen-tab="records"]')?.click();if(evt.target.closest?.("[data-kitchen-task-go]"))node("kitchen-tabs")?.querySelector('[data-kitchen-tab="cleaning"]')?.click()});
 let adminColdRefreshing=false;
 async function refreshAdminColdOverview(){
 const target=node("adminKitchenColdOverview");if(!target||target.closest("[hidden]")||document.hidden||busy||adminColdRefreshing||node("kitchenTaskEditor"))return;
 adminColdRefreshing=true;try{const fresh=await api("list");if(target===node("adminKitchenColdOverview")&&!node("kitchenTaskEditor"))target.innerHTML=window.KitchenUI.coldOverview(fresh,{buttonAttributes:'data-kitchen-cold-go'});}
 catch(err){if(target===node("adminKitchenColdOverview")){let warning=target.querySelector(".kt-refresh-warning");if(!warning){warning=document.createElement("p");warning.className="kt-refresh-warning";target.prepend(warning);}warning.textContent="Actualisation indisponible. Vérifiez la date des températures affichées.";}}
 finally{adminColdRefreshing=false;}
 }
 setInterval(refreshAdminColdOverview,60000);
 window.kitchenAdminOpenGovee=function(){openKitchenTab("cuisineSettings","govee")};
 window.kitchenAdminPage=function(){node("content").innerHTML='<div class="card">Chargement des relevés Cuisine…</div>';return load()};
 window.kitchenAdminSettingsPage=function(){node("content").innerHTML='<div class="card">Chargement des paramètres cuisine…</div>';return load()};
 window.kitchenAdminLoad=load;
})();