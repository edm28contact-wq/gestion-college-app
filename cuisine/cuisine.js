"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let token=sessionStorage.getItem("kitchen_token")||"",data=null,page="dashboard",busy=false,loadEpoch=0;
let dashboardRefreshAt=0,dashboardRefreshInFlight=false,dashboardRefreshError="";
let alarmAudio=null,alarmEnabled=false,alarmSilenced=false,lastSirenAt=0;
const alarmed=new Set();
const initialTitle=document.title;
function activeCriticalCycles(){return (data?.reheats||[]).filter(r=>r.status==="en_cours"&&canFinish(r.due_at)).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at))}
function alarmLabel(r){return ovenName(r)+" — "+dishName(r)}
function activateSound(){unlockAlarm();alarmEnabled=!!alarmAudio;alarmSilenced=false;lastSirenAt=0;checkReheatAlarms()}
function silenceAlarm(){alarmSilenced=true;lastSirenAt=Date.now();updateCriticalAlert()}
const remainingMs=due=>new Date(due).getTime()-Date.now();
const canFinish=due=>Number.isFinite(new Date(due).getTime())&&remainingMs(due)<5*60*1000;
const canRecordReheat=()=>data?.me.scope==="staff"&&!data.me.existingAccount;
function unlockAlarm(){try{alarmAudio??=new (window.AudioContext||window.webkitAudioContext)();alarmEnabled=true;if(alarmAudio.state==="suspended")alarmAudio.resume().catch(()=>{});}catch{alarmEnabled=false;}}
function soundAlarm(){try{
 if(!alarmEnabled||alarmSilenced||!alarmAudio||alarmAudio.state!=="running")return;
 // Five strong alternating alarm pulses, under four seconds per series.
 for(let i=0;i<6;i++){
  const osc=alarmAudio.createOscillator(),gain=alarmAudio.createGain(),start=alarmAudio.currentTime+i*.56;
  osc.type="square";osc.frequency.setValueAtTime(i%2?660:880,start);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.linearRampToValueAtTime(.12,start+.025);
  gain.gain.setValueAtTime(.12,start+.33);
  gain.gain.exponentialRampToValueAtTime(.0001,start+.43);
  osc.connect(gain);gain.connect(alarmAudio.destination);osc.start(start);osc.stop(start+.44);
 }
}catch{}}

const clock=v=>v?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
const number=x=>Number(x).toLocaleString("fr-FR",{maximumFractionDigits:2});
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const staffName=id=>data?.staff.find(s=>s.id===id)?.name||"Agent";
function status(msg,bad=false,target="message"){const el=$(target);if(!el)return;el.textContent=msg;el.className="status "+(bad?"error":"good");if(target==="message"&&msg)el.scrollIntoView?.({block:"nearest",behavior:"smooth"})}
async function request(action,method="GET",body,authorized=true){
 const res=await fetch(API+"?action="+encodeURIComponent(action),{method,headers:{"Content-Type":"application/json",...(authorized?{"x-admin-session":token}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
 const json=await res.json().catch(()=>({error:"Réponse du serveur invalide"}));
 if(!res.ok)throw Error(json.error||"Erreur du serveur");return json;
}
async function staffList(){try{const v=await request("staff-list","GET",undefined,false);$("agent").innerHTML='<option value="">Sélectionner un agent</option>'+v.staff.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");if(!v.staff.length)status("Aucun agent créé. Ouvrez Administration Cours Chambertin → Gestion Cuisine.",true,"loginStatus")}catch(e){status(e.message,true,"loginStatus")}}
async function login(){if(busy)return;busy=true;$("connect").disabled=true;try{
 const v=await request("login","POST",{staff_id:$("agent").value,pin:$("pin").value},false);
 token=v.token;sessionStorage.setItem("kitchen_token",token);$("pin").value="";await load();
}catch(e){status(e.message,true,"loginStatus")}finally{busy=false;$("connect").disabled=false}}
async function connectAccount(){const shared=localStorage.getItem("college_admin_token")||localStorage.getItem("college_secretariat_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";if(!shared){status("Connectez-vous d’abord à l’un des espaces administratifs avec un compte habilité, puis revenez ici.",true,"loginStatus");return}token=shared;sessionStorage.setItem("kitchen_token",token);await load()}
async function loginCentralAccount(){
 const username=$("accountUsername").value.trim().toLowerCase();
 const password=$("accountPassword").value;
 try{
  const r=await fetch("https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-api?action=login",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({username,password}),cache:"no-store"
  });
  const j=await r.json().catch(()=>({error:"Réponse invalide"}));
  if(!r.ok||!j.token)throw Error(j.error||"Connexion refusée");
  const p=j.permissions||{};
  if(j.role!=="admin"&&!["cuisine","cuisine.read","cuisine.write","cuisine.manage","college_admin"].some(k=>p[k]===true))
   throw Error("Votre compte ne dispose d'aucun accès Cuisine");
  token=j.token;$("accountPassword").value="";
  if(j.must_change_password===true){
   $("accountLoginForm").classList.add("hide");
   $("kitchenFirstPassword").classList.remove("hide");
   status("Vous devez créer votre mot de passe avant d'utiliser la Cuisine.",false,"loginStatus");
   return;
  }
  sessionStorage.setItem("kitchen_token",token);
  await load();
 }catch(e){status(e.message||"Connexion impossible",true,"loginStatus")}
}
async function finishKitchenFirstPassword(){
 const a=$("kitchenNewPassword").value,b=$("kitchenConfirmPassword").value;
 if(a.length<10||a.length>128){status("Mot de passe de 10 à 128 caractères requis.",true,"loginStatus");return}
 if(a!==b){status("Les mots de passe sont différents.",true,"loginStatus");return}
 try{
  const r=await fetch("https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-api?action=change-password",{
   method:"POST",headers:{"Content-Type":"application/json","x-admin-session":token},
   body:JSON.stringify({password:a}),cache:"no-store"
  });
  const j=await r.json().catch(()=>({error:"Réponse invalide"}));
  if(!r.ok)throw Error(j.error||"Changement de mot de passe refusé");
  token="";sessionStorage.removeItem("kitchen_token");
  $("kitchenNewPassword").value="";$("kitchenConfirmPassword").value="";
  $("kitchenFirstPassword").classList.add("hide");$("accountLoginForm").classList.remove("hide");
  status("Mot de passe enregistré. Reconnectez-vous à la Cuisine.",false,"loginStatus");
 }catch(e){status(e.message||"Changement impossible",true,"loginStatus")}
}
function logout(){
 window.KitchenPhoto?.closeCapture();loadEpoch++;token="";data=null;page="dashboard";dashboardRefreshAt=0;alarmEnabled=false;alarmSilenced=false;alarmed.clear();
 $("content").replaceChildren();$("kitchenAdminLink").hidden=true;$("kitchenFirstPassword")?.classList.add("hide");$("accountLoginForm")?.classList.remove("hide");
 document.title=initialTitle;sessionStorage.removeItem("kitchen_token");$("app").classList.add("hide");$("login").classList.remove("hide");$("kitchenCriticalAlert").hidden=true;staffList();
}
function updateTodayLabel(){$("todayLabel").textContent=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());}
async function load(){
 const currentToken=token,epoch=++loadEpoch;
 try{
  const fresh=await request("list");
  if(token!==currentToken||epoch!==loadEpoch)return false;
  data=fresh;dashboardRefreshAt=Date.now();dashboardRefreshError="";
  $("login").classList.add("hide");$("app").classList.remove("hide");$("identity").textContent=data.me.name;updateTodayLabel();render();checkReheatAlarms();return true;
 }catch(e){if(token!==currentToken||epoch!==loadEpoch)return false;if(/Session|accès non autorisé/i.test(e.message))logout();status(e.message,true,token?"message":"loginStatus");return false;}
}
function switchPage(next){
 if(!data||!["dashboard","reheat","cold"].includes(next))return;
 if(next==="cold"&&!canRecordReheat())return;
 page=next;render();if(page==="dashboard"&&Date.now()-dashboardRefreshAt>=60000)refreshDashboardReadings();
 $("workNav")?.scrollIntoView?.({block:"start",behavior:"smooth"});
}
function render(){
 if(!data)return;
 $("workNav").hidden=page!=="dashboard";$("workBack").hidden=page==="dashboard";
 $("kitchenAdminLink").hidden=data.me.scope!=="admin";
 if(page==="reheat"){renderReheat();updateReheatControls();}
 else if(page==="cold")renderCold();
 else renderDashboard();
 updateCriticalAlert();
 $("readonlyNotice").hidden=canCheckTasks();
}
function dayOf(iso){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso))}
function latestByRoom(){const m=new Map();for(const r of data.cold)if(!m.has(r.room_id))m.set(r.room_id,r);return m}
function activeRooms(){return data.rooms.filter(r=>!r.archived_at&&!r.deleted_at)}
function roomName(id){return data.rooms.find(x=>x.id===id)?.label||"Chambre inconnue"}
function ovenName(r){return r.oven_label_snapshot||(data.ovens||[]).find(x=>x.id===r.oven_id)?.label||("Four "+r.oven_number)}
function dishName(r){return r.dish_type_label_snapshot||(data.dishes||[]).find(x=>x.id===r.dish_type_id)?.label||"Plat non précisé"}
function deltaC(r){if(r.end_temperature_c==null)return"";const change=Number(r.end_temperature_c)-Number(r.start_temperature_c);return(change>=0?"+":"")+number(change)+" °C"}
function renderColdOverview(){
 const rooms=activeRooms();
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
   '</article>';
 }).join("");
 return '<section class="card cold-live-section">'+
  '<div class="section-heading"><div><div class="eyebrow">Surveillance des chambres froides</div><h2>Dernières températures reçues</h2><p>Collecte serveur selon la programmation de chaque chambre, même lorsque le site est fermé. Les valeurs affichées ne sont pas des mesures instantanées.</p></div>'+(data.me?.scope==="staff"&&!data.me.existingAccount?'<button type="button" class="btn btn-outline btn-small" data-go="cold">Contrôle manuel</button>':'')+'</div>'+
  (dashboardRefreshError?'<p class="info info-warn">'+esc(dashboardRefreshError)+'</p>':'')+
  '<div class="cold-live-grid">'+(tiles||'<div class="empty">Aucune chambre froide active.</div>')+'</div></section>';
}
async function refreshDashboardReadings(){
 if(!data||!token||page!=="dashboard"||busy||dashboardRefreshInFlight||document.hidden||document.getElementById("kitchenPhotoCapture"))return;
 const currentToken=token,previousData=data,epoch=loadEpoch;dashboardRefreshInFlight=true;
 try{
  const fresh=await request("list");
  if(token!==currentToken||data!==previousData||epoch!==loadEpoch||page!=="dashboard"||busy||document.getElementById("kitchenPhotoCapture"))return;
  data=fresh;dashboardRefreshAt=Date.now();dashboardRefreshError="";updateTodayLabel();
  renderDashboard();updateCriticalAlert();
 }catch(err){
  if(token!==currentToken||epoch!==loadEpoch)return;
  if(/Session expirée|accès non autorisé/i.test(String(err.message))){logout();return}
  dashboardRefreshError="Actualisation temporairement indisponible. Vérifiez la date des mesures.";
  if(page==="dashboard"&&data&&!document.getElementById("kitchenPhotoCapture"))renderDashboard();
 }finally{dashboardRefreshInFlight=false}
}
function visibleTasks(tasks,me){
 return (tasks||[]).filter(t=>!isRetiredCleaningTask(t)&&(me.scope!=="staff"||me.existingAccount||!t.assigned_to||t.assigned_to===me.id));
}
function isRetiredCleaningTask(t){
 return ["Nettoyage de la ligne de self","Nettoyage de la plonge","Nettoyage des fours","Nettoyage du lave-vaisselle"].includes(t.label)&&
 (t.starts_on==="2026-11-19"||(t.active===false&&t.description==="Remplacée par les lignes détaillées du protocole 7."));
}

function renderDashboard(){
 const day=today(),rooms=activeRooms();
 const alarms=[...latestByRoom().values()].filter(r=>r.is_alert&&rooms.some(room=>room.id===r.room_id)).length+data.reheats.filter(r=>dayOf(r.started_at)===day&&r.status==="alerte").length;
 $("content").innerHTML=
 '<section id="dailyTasks" class="work-section" aria-label="Tâches à faire">'+renderTasks()+'</section>'+
 '<section id="sensorResults" class="work-section" aria-label="Résultats des sondes"><div class="section-heading work-heading"><div><div class="eyebrow">Mesures automatiques</div><h1>Résultats des sondes</h1><p>Dernières valeurs reçues et état des équipements. Les températures ne sont pas des mesures instantanées.</p></div></div>'+
 (alarms?'<div class="card info-warn"><strong>'+alarms+' écart(s) nécessitant une vérification.</strong> Derniers relevés froids ou anomalies de réchauffage du jour. Prévenez le responsable.</div>':'')+
 renderColdOverview()+'<div id="meaterDashboardPanel"><div class="card"><h2>Sondes MEATER</h2><p class="muted">Chargement des dernières mesures…</p></div></div></section>';
 window.KitchenMeater.mountDashboard($("meaterDashboardPanel"),request);
}
function renderCold(){
 const rooms=activeRooms(),last=latestByRoom();
 $("content").innerHTML=
 '<div class="section-heading"><div><div class="eyebrow">Contrôle de service</div><h1>Contrôler une chambre froide</h1><p>Enregistrez uniquement une température réellement mesurée sur place.</p></div></div>'+
 '<div class="grid">'+rooms.map(r=>{
 const current=last.get(r.id),sensor=(data.connected||[]).find(d=>d.kind==="cold_room"&&d.room_id===r.id&&d.provider==="govee");
 const threshold=r.min_c===null?'≤ '+number(r.max_c)+' °C':number(r.min_c)+' à '+number(r.max_c)+' °C';
 return '<div class="tile card"><h3>'+esc(r.label)+'</h3><div class="subline">Plage configurée : '+esc(threshold)+'</div>'+
 (sensor?'<p class="help">Capteur Govee : <strong>'+esc(sensor.status==='online'?'Dernière valeur reçue':'Non connecté')+'</strong></p>':'')+
 (current?'<p class="help">Dernier relevé : <strong>'+number(current.temperature_c)+' °C</strong> · '+clock(current.measured_at)+' · '+(current.source==='govee_cloud'?'Capteur Govee':'Saisie manuelle')+' <span class="tag '+(current.is_alert?'tag-alert':'tag-ok')+'">'+(current.is_alert?'Hors seuil':'Dans la plage')+'</span></p>':'<p class="help">Aucun relevé enregistré.</p>')+
 (canRecordReheat()?'<form data-cold="'+esc(r.id)+'"><div class="field"><label>Température mesurée (°C)</label><input type="number" required step="0.1" min="-60" max="60" name="temperature_c" inputmode="decimal" placeholder="Ex. 2,5"></div><button class="btn btn-primary" type="submit">Enregistrer la mesure</button></form>':'')+'</div>';
 }).join("")+'</div>'+(rooms.length?'':'<div class="card empty">Aucune enceinte active.</div>');
}
function remaining(iso){const n=Math.ceil((new Date(iso).getTime()-Date.now())/1000);if(n<=0)return"Contrôle attendu";return Math.floor(n/60)+" min "+String(n%60).padStart(2,"0")+" s";}
function renderReheat(){
 const open=data.reheats.filter(x=>x.status==="en_cours");
 const d=data.defaults||{},roomOptions=activeRooms().map(r=>'<option value="'+esc(r.id)+'" '+(d.default_cold_room_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const ovenOptions=(data.ovens||[]).map(r=>'<option value="'+esc(r.id)+'" '+(d.default_oven_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const dishOptions=(data.dishes||[]).map(r=>'<option value="'+esc(r.id)+'" '+(d.default_dish_type_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 $("content").innerHTML=
 '<div class="section-heading"><div><div class="eyebrow">De la chambre froide au four</div><h1>Remise en température</h1><p>Effectuez les contrôles réels de départ et de fin du cycle.</p></div><button type="button" class="btn btn-outline btn-small" id="enableKitchenAlarm">Tester l’alarme</button></div>'+
 (canRecordReheat()?'<div class="card"><div class="section-heading"><div><h2>1. Démarrer un réchauffage</h2><p>Sélectionnez le plat, sa chambre froide et le four. Mesurez la température du plat à cœur avant de commencer.</p></div><span class="tag">Départ · chambre froide</span></div>'+
 '<form id="startReheat"><div class="field-grid">'+
 '<div class="field"><label>Type de plat</label><select name="dish_type_id" required><option value="">Choisir un type</option>'+dishOptions+'</select></div>'+
 '<div class="field"><label>Chambre froide de départ</label><select name="cold_room_id" required><option value="">Choisir une chambre</option>'+roomOptions+'</select></div>'+
 '<div class="field"><label>Four utilisé</label><select name="oven_id" required><option value="">Choisir un four</option>'+ovenOptions+'</select></div>'+
 '<div class="field"><label>Température mesurée du plat avant réchauffage (°C)</label><input name="temperature_c" required type="number" step="0.1" min="-10" max="90" inputmode="decimal" placeholder="Ex. 2"></div></div>'+
 '<div class="row between"><div class="help">Référence de départ : '+number(d.target_start_c??2)+' °C. Ne saisissez pas une valeur non mesurée.</div><button type="submit" class="btn btn-primary">Démarrer le chronomètre</button></div></form></div>':'')+
 '<div id="meaterReheatPanel"></div>'+
 '<div class="card"><div class="section-heading"><div><h2>2. Fours en cours</h2><p>Mesurez dès que le plat est prêt. Le rappel est un contrôle attendu, pas une autorisation de servir.</p></div><span class="tag">'+open.length+' cycle(s)</span></div>'+
 (open.length?open.map(r=>{
 const allow=canRecordReheat(),reminder=canFinish(r.due_at),ms=remainingMs(r.due_at),duration=(r.reminder_minutes||55)*60000,progress=Math.min(100,Math.max(0,(duration-ms)/duration*100));
 return '<div class="timer-card '+(ms<=0?'is-late':reminder?'is-ready':'')+'" data-reheat="'+esc(r.id)+'">'+
 '<div class="row between"><div><div class="eyebrow">'+esc(dishName(r))+'</div><h3>'+esc(ovenName(r))+'</h3></div><span class="tag '+(ms<=0?'tag-alert':reminder?'tag-warn':'tag-warn')+'" data-cycle-state>'+(ms<=0?'Rappel dépassé':reminder?'Contrôle attendu':'En cours de chauffe')+'</span></div>'+
 '<div class="timer-details"><span>Chambre : '+esc(r.cold_room_label_snapshot||roomName(r.cold_room_id))+'</span><span>Départ : '+number(r.start_temperature_c)+' °C</span><span>Heure : '+clock(r.started_at)+'</span></div>'+
 '<div class="timer-display clock" data-due="'+esc(r.due_at)+'">'+remaining(r.due_at)+'</div>'+
 '<div class="timer-track" aria-hidden="true"><div data-progress style="width:'+progress.toFixed(1)+'%"></div></div>'+
 '<div class="timer-status" data-timer-hint>'+(allow?'Vous pouvez maintenant mesurer le plat à cœur.':'Une mesure réelle est nécessaire avant la validation.')+'</div>'+
 '<form class="finish-area" data-finish="'+esc(r.id)+'" data-due="'+esc(r.due_at)+'"><div class="field"><label>Température réelle à cœur à la sortie du four (°C)</label><input required type="number" step="0.1" min="-10" max="120" name="temperature_c" inputmode="decimal" placeholder="Minimum '+number(r.target_end_c??63)+' °C" '+(allow?'':'disabled')+'></div>'+
 '<button type="submit" class="btn btn-accent" '+(allow?'':'disabled')+'>Valider la température finale</button><p class="help" data-lock-message>'+(allow?'Saisie disponible. Relevez la température réelle à cœur.':'Saisie réservée à un agent connecté.')+'</p></form></div>'
 }).join(""):'<div class="empty"><strong>Aucun four en cours</strong>Lancez une remise en température dans le formulaire ci-dessus.</div>')+'</div>'+
 '<p class="guided-note">Le minuteur est une aide à l’organisation, pas une preuve de conformité sanitaire. Les mesures sont conservées avec leur heure de saisie et les alertes restent visibles en administration.</p>';
 window.KitchenMeater.mountKitchen($("meaterReheatPanel"),request,()=>data,{showTiles:false});
}

function canCheckTasks(){return data?.me.scope==="staff"&&!data.me.existingAccount}
function renderTaskItems(tasks){
 const done=new Map(data.checks.filter(c=>c.performed_on===today()).map(c=>[c.task_id,c]));
 const camera='<svg class="task-camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="14" r="4"/></svg>';
 return '<ul class="task-list checklist">'+(tasks.map(t=>{
 const c=done.get(t.id),locked=t.assigned_to&&t.assigned_to!==data.me.id,optional=(data.optional_tasks||[]).some(x=>x.id===t.id);
 const available=!c&&!locked&&t.active!==false&&(t.scheduled!==false||optional)&&canCheckTasks();
 const label=c?(c.photo_bytes>0?"Photo enregistrée":"Ancienne validation · sans photo"):locked?"Attribuée à un autre agent":t.active===false?"Désactivée":t.scheduled===false&&!optional?"Non prévue aujourd’hui":!canCheckTasks()?"À réaliser · lecture seule":optional?"Valider si utilisée · Photo":"Prendre une photo";
 const detail=(t.assigned_to?'Responsable : '+esc(staffName(t.assigned_to)):'Tâche commune')+(t.scheduled_time?' · '+esc(String(t.scheduled_time).slice(0,5)):'')+(c?' · Confirmée à '+clock(c.performed_at)+' par '+esc(staffName(c.performed_by)):'');
 return '<li class="checklist-row'+(c?' done':'')+'"><button type="button" class="checklist-toggle" role="checkbox" aria-checked="'+(c?'true':'false')+'" aria-label="'+esc(t.label+' — '+label)+'"'+(available?' data-task="'+esc(t.id)+'"':' disabled')+'>'+
 '<span class="checklist-box" aria-hidden="true">'+(c?'&#10003;':'')+'</span><span class="checklist-title"><strong>'+esc(t.label)+'</strong><small>'+detail+'</small></span>'+
 '<span class="checklist-proof'+(c&&c.photo_bytes>0?' has-proof':'')+'">'+camera+'<span>'+esc(label)+'</span></span></button>'+
 (t.description&&t.description!=="Protocole 7 – nettoyage du self"?'<p class="checklist-notes">'+esc(t.description)+'</p>':'')+(t.instructions?'<p class="checklist-notes">'+esc(t.instructions)+'</p>':'')+'</li>';
 }).join("")||'<li class="muted checklist-empty">Aucune tâche à afficher.</li>')+'</ul>';
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
function cleaningFrequency(t){
 const days=["","lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"],names=(t.weekdays||[]).map(n=>days[n]).filter(Boolean).join(", ");
 return t.recurrence==="daily"?"Tous les jours":t.recurrence==="weekly"?"Chaque semaine"+(names?" · "+names:""):t.recurrence==="monthly"?"Une fois par mois"+(names?" · premier "+names:""):t.recurrence==="on_demand"?"Selon utilisation":t.recurrence==="once"?"Ponctuelle":"Selon programmation";
}
function renderScheduledPreview(tasks,upcoming=false){
 return '<ul class="checklist-planned">'+tasks.map(t=>'<li><span><strong>'+esc(t.label)+'</strong><small>'+esc(cleaningFrequency(t))+'</small></span><span class="checklist-planned-state">'+(upcoming?'À venir':'Non prévue aujourd’hui')+'</span></li>').join("")+'</ul>';
}
function renderUpcomingPlan(plan){
 if(!plan||!Array.isArray(plan.tasks)||!plan.tasks.length)return "";
 const date=String(plan.date||"").split("-").reverse().join("/");
 return '<div class="card checklist-card checklist-upcoming"><div class="row between"><h2>Planning complet à partir du '+esc(date)+'</h2><span class="tag">'+plan.tasks.length+' tâches</span></div><p class="help">Aperçu du prochain planning. Aucune de ces tâches ne peut être validée ici avant sa date prévue.</p>'+
 cleaningSections([],[],plan.tasks).map(g=>'<section class="checklist-section"><header class="checklist-section-heading"><h3>'+esc(g.title)+'</h3><span class="checklist-section-count">'+g.unscheduled.length+' tâches</span></header>'+renderScheduledPreview(g.unscheduled,true)+'</section>').join("")+'</div>';
}
function renderCleaningSections(tasks,optional,done,unscheduled=[]){
 return cleaningSections(tasks,optional,unscheduled).map(g=>{
  const complete=g.tasks.filter(t=>done.has(t.id)).length,total=g.tasks.length;
  const count=total?'<span class="checklist-section-count '+(complete===total?'is-complete':'')+'">'+complete+' / '+total+' validées</span>':'<span class="checklist-section-count">'+(g.optional.length?'Selon utilisation':'Non prévue aujourd’hui')+'</span>';
  const optionalCount=g.optional.filter(t=>done.has(t.id)).length;
  return '<section class="checklist-section" aria-labelledby="cleaning-'+g.key+'"><header class="checklist-section-heading"><h3 id="cleaning-'+g.key+'">'+esc(g.title)+'</h3>'+count+'</header>'+
  (total?renderTaskItems(g.tasks):'')+
  (g.optional.length?'<div class="checklist-optional"><div class="checklist-optional-heading"><strong>Tâches selon utilisation</strong><span>'+optionalCount+' / '+g.optional.length+' réalisées</span></div><p class="help">À cocher uniquement si le matériel a été utilisé et nettoyé. Hors obligations quotidiennes.</p>'+renderTaskItems(g.optional)+'</div>':'')+
  (g.unscheduled.length?renderScheduledPreview(g.unscheduled):'')+'</section>';
 }).join("");
}
function renderTasks(){
 const done=new Set(data.checks.filter(c=>c.performed_on===today()).map(c=>c.task_id));
 const tasks=visibleTasks(data.tasks,data.me),optional=visibleTasks(data.optional_tasks,data.me),pending=tasks.filter(t=>!done.has(t.id)),completed=tasks.length-pending.length,progress=tasks.length?Math.round(completed/tasks.length*100):0;
 const shown=new Set([...tasks,...optional].map(t=>t.id)),notDue=visibleTasks(data.task_plan?.date===today()?data.task_plan.tasks:[],data.me).filter(t=>!shown.has(t.id));
 const nextPlan=data.task_plan_next?{...data.task_plan_next,tasks:visibleTasks(data.task_plan_next.tasks,data.me)}:null;
 const transitionOnly=!tasks.length&&!optional.length&&!notDue.length&&!!nextPlan?.tasks.length;
 const open=data.reheats.filter(r=>r.status==="en_cours");
 return '<div class="section-heading work-heading"><div><div class="eyebrow">Votre journée</div><h1>Tâches à faire</h1><p>Vos tâches et les tâches communes prévues aujourd’hui.</p></div>'+(transitionOnly?'<span class="tag">'+nextPlan.tasks.length+' tâches du nouveau planning</span>':'<span class="tag '+(pending.length?'tag-warn':'tag-ok')+'">'+pending.length+' à réaliser · '+completed+' / '+tasks.length+' validées</span>')+'</div>'+
 (transitionOnly?'':'<div class="card checklist-card"><div class="row between"><h2>Checklist de nettoyage</h2><strong class="checklist-percent">'+progress+' %</strong></div><div class="checklist-progress" role="progressbar" aria-label="Avancement du nettoyage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+progress+'"><span style="width:'+progress+'%"></span></div><p class="help">Cochez une tâche après nettoyage. Prenez une photo : la case sera cochée uniquement après son enregistrement.</p>'+
 (!tasks.length?'<div class="empty"><strong>Aucune tâche de nettoyage prévue aujourd’hui.</strong></div>':'')+
 (nextPlan?.tasks.length?'<p class="checklist-plan-note">Le planning du jour est encore en vigueur. Le prochain planning complet figure ci-dessous.</p>':'')+
 renderCleaningSections(tasks,optional,done,notDue)+
 (tasks.length&&!pending.length?'<p class="checklist-complete" role="status">Toutes les tâches prévues sont validées.</p>':'')+'</div>')+
 renderUpcomingPlan(nextPlan)+
 (canRecordReheat()||open.length?'<div class="card"><h2>Contrôles de service</h2><div class="work-actions">'+(canRecordReheat()?'<button class="btn btn-outline" type="button" data-go="reheat">Démarrer une remise en température</button><button class="btn btn-outline" type="button" data-go="cold">Contrôler une chambre froide</button>':'')+'</div>'+
 (open.length?open.map(r=>'<div class="line"><div><strong>'+esc(ovenName(r))+' · '+esc(dishName(r))+'</strong><div class="subline">Mesure finale à cœur · <span class="clock" data-due="'+esc(r.due_at)+'">'+esc(remaining(r.due_at))+'</span></div></div><button class="btn btn-primary btn-small" type="button" data-go="reheat">'+(canRecordReheat()?'Faire le contrôle':'Voir le contrôle')+'</button></div>').join(""):'')+'</div>':'');
}
async function save(action,body){if(busy)return;busy=true;try{const result=await request(action,"POST",body);await load();if(result.alert)status("Contrôle enregistré avec anomalie : prévenir le responsable et effectuer une action corrective.",true);else status("Enregistré avec date, heure et nom de l’agent.");}catch(e){status(e.message,true);}finally{busy=false}}
document.addEventListener("submit",e=>{const form=e.target;if(!(form instanceof HTMLFormElement))return;if(!form.matches("[data-cold],#startReheat,[data-finish]"))return;e.preventDefault();const t=form.elements.namedItem("temperature_c")?.value;if(form.dataset.cold)save("cold-reading",{room_id:form.dataset.cold,temperature_c:t});else if(form.id==="startReheat"){unlockAlarm();save("start-reheat",{cold_room_id:form.elements.namedItem("cold_room_id").value,oven_id:form.elements.namedItem("oven_id").value,dish_type_id:form.elements.namedItem("dish_type_id").value,temperature_c:t});}else if(form.dataset.finish){if(!canRecordReheat()){status("Une connexion agent est nécessaire.",true);return;}if(Number(t)<Math.max(63,Number(data.reheats.find(r=>r.id===form.dataset.finish)?.target_end_c||63))&&!confirm("Température sous la cible. Ne servez pas ce plat. Confirmer la fin du cycle avec anomalie ?"))return;save("finish-reheat",{id:form.dataset.finish,temperature_c:t})}});
document.addEventListener("click",e=>{
 const b=e.target.closest?.("button[data-task][role=checkbox]");if(!b||b.disabled||b.getAttribute("aria-checked")!=="false"||!canCheckTasks()||busy)return;
 const task=[...(data.tasks||[]),...(data.optional_tasks||[])].find(t=>t.id===b.dataset.task);
 if(!task||isRetiredCleaningTask(task)||task.assigned_to&&task.assigned_to!==data.me.id||data.checks.some(c=>c.task_id===task.id&&c.performed_on===today()))return;
 const currentToken=token,currentDay=today();let confirmed=null;
 window.KitchenPhoto.capture({
  label:task.label,
  onSubmit:async photo=>{
   if(token!==currentToken||!canCheckTasks()||currentDay!==today())throw Error("La session ou la date a changé. Actualisez.");
   const result=await request("task-check","POST",{task_id:task.id,day:currentDay,photo_jpeg:photo});
   if(!result.check||result.check.task_id!==task.id||result.check.performed_on!==currentDay||!(result.check.photo_bytes>0))throw Error("Validation non confirmée. Actualisez les tâches.");
   confirmed=result.check;
  },
  onSaved:async()=>{
   if(token!==currentToken||!data||!confirmed)return;
   if(currentDay===today()){
    data.checks=[...data.checks.filter(c=>c.task_id!==task.id||c.performed_on!==currentDay),confirmed];
    if(page==="dashboard"&&$("dailyTasks"))$("dailyTasks").innerHTML=renderTasks();
   }
   if(await load())status("Tâche cochée. Photo, date, heure et nom de l’agent enregistrés.");
  }
 });
});
$("loginForm").addEventListener("submit",e=>{e.preventDefault();login()});$("connectAccount")?.addEventListener("click",connectAccount);$("accountLoginForm")?.addEventListener("submit",e=>{e.preventDefault();loginCentralAccount()});$("kitchenFirstPassword")?.addEventListener("submit",e=>{e.preventDefault();finishKitchenFirstPassword()});$("logout").addEventListener("click",logout);$("refresh").addEventListener("click",load);
document.addEventListener("click",e=>{
 const go=e.target.closest?.("[data-go]");if(go){switchPage(go.dataset.go);return;}
 const section=e.target.closest?.("[data-section]");if(section&&data&&page==="dashboard")$(section.dataset.section)?.scrollIntoView?.({block:"start",behavior:"smooth"});
});
function updateReheatControls(){
 if(!data)return;
 for(const form of document.querySelectorAll("form[data-finish][data-due]")){
   const unlocked=canRecordReheat(),reminder=canFinish(form.dataset.due),ms=remainingMs(form.dataset.due);
   const input=form.elements.namedItem("temperature_c"),button=form.querySelector('button[type="submit"]');
   if(input)input.disabled=!unlocked;
   if(button)button.disabled=!unlocked;
   const note=form.querySelector("[data-lock-message]");
   if(note)note.textContent=unlocked?"Saisie disponible. Relevez la température réelle à cœur.":"Saisie réservée à un agent connecté.";
   const card=form.closest(".timer-card");
   if(card){
     card.classList.toggle("is-ready",reminder&&ms>0);
     card.classList.toggle("is-late",ms<=0);
     const state=card.querySelector("[data-cycle-state]"),hint=card.querySelector("[data-timer-hint]"),progress=card.querySelector("[data-progress]");
     if(state){state.className="tag "+(ms<=0?"tag-alert":"tag-warn");state.textContent=ms<=0?"Rappel dépassé":reminder?"Contrôle attendu":"En cours de chauffe";}
     if(hint)hint.textContent=unlocked?"Vous pouvez mesurer le plat à cœur.":"Une mesure réelle est nécessaire avant la validation.";
     if(progress){const started=new Date(form.dataset.due).getTime()-(Number(data.reheats.find(r=>r.id===form.dataset.finish)?.reminder_minutes)||55)*60000;const duration=new Date(form.dataset.due).getTime()-started;progress.style.width=Math.min(100,Math.max(0,(Date.now()-started)/duration*100))+"%";}
   }
 }
 for(const el of document.querySelectorAll(".clock[data-due]"))el.textContent=remaining(el.dataset.due);
}
function updateCriticalAlert(){
 const active=activeCriticalCycles(),panel=$("kitchenCriticalAlert");
 panel.hidden=active.length===0;
 document.title=active.length?"⚠ CONTRÔLE À FAIRE ("+active.length+") — Cuisine":initialTitle;
 $("kitchenAlertGo").textContent=canRecordReheat()?"Faire le contrôle maintenant":"Voir le contrôle";
 if(!active.length)return;
 const r=active[0],late=remainingMs(r.due_at)<=0;
 $("kitchenAlertCount").textContent=active.length+" contrôle(s) à effectuer";
 $("kitchenAlertTime").textContent=late?"DÉLAI DÉPASSÉ":remaining(r.due_at);
 const title=late?"CONTRÔLE IMMÉDIAT — CHRONO TERMINÉ":"CONTRÔLE DE TEMPÉRATURE À EFFECTUER";
 if($("kitchenAlertTitle").textContent!==title)$("kitchenAlertTitle").textContent=title;
 const details=active.map(x=>alarmLabel(x)+(remainingMs(x.due_at)<=0?" (en retard)":"")).join(" · ");
 if($("kitchenAlertContext").textContent!==details)$("kitchenAlertContext").textContent=details;
 $("kitchenAlertMute").textContent=alarmSilenced?"Son coupé — reprendre":"Couper le son";
 $("kitchenAlertEnable").hidden=alarmEnabled;
 $("kitchenAlertAudioHelp").textContent=alarmSilenced?
  "Son coupé. Le contrôle reste obligatoire et l’alerte reste affichée.":
  alarmEnabled?"Son activé : rappel répété jusqu’au contrôle final. Laissez cette page ouverte.":
  "Son inactif : appuyez sur « Activer le son ». Le navigateur peut limiter l’audio en arrière-plan.";
}
function checkReheatAlarms(){
 if(!data)return;
 const active=activeCriticalCycles(),now=Date.now();
 updateCriticalAlert();
 if(!active.length){alarmSilenced=false;lastSirenAt=0;return}
 for(const r of active){
  const ms=remainingMs(r.due_at);
  for(const stage of ["five","zero"]){
   if(stage==="five"&&ms>5*60000)continue;
   if(stage==="zero"&&ms>0)continue;
   const key=r.id+":"+stage;
   if(!alarmed.has(key)){
    alarmed.add(key);
    if(navigator.vibrate)navigator.vibrate([250,150,250]);
   }
  }
 }
 if(alarmEnabled&&!alarmSilenced&&alarmAudio?.state==="running"&&now-lastSirenAt>=12000){
  lastSirenAt=now;
  soundAlarm();
  if(navigator.vibrate)navigator.vibrate([300,180,300,180,300]);
 }
}
document.addEventListener("click",e=>{
 if(e.target.closest?.("#enableKitchenAlarm")){activateSound();if(activeCriticalCycles().length===0){if(alarmAudio?.state==="running")soundAlarm();else alarmAudio?.resume?.().then(()=>soundAlarm()).catch(()=>{});status("Son activé. Laissez la page ouverte pour les prochains contrôles.")}}
 if(e.target.closest?.("#kitchenAlertEnable"))activateSound();
 if(e.target.closest?.("#kitchenAlertMute")){if(alarmSilenced)activateSound();else silenceAlarm()}
 if(e.target.closest?.("#kitchenAlertGo")){
  const current=activeCriticalCycles()[0];if(!current)return;
  switchPage("reheat");
  document.querySelector('[data-reheat="'+current.id+'"] .finish-area')?.scrollIntoView?.({behavior:"smooth",block:"center"});
  document.querySelector('[data-reheat="'+current.id+'"] input[name="temperature_c"]')?.focus?.({preventScroll:true});
 }
});
setInterval(()=>{if(!data)return;if(page==="reheat"||page==="dashboard")updateReheatControls();checkReheatAlarms();},1000);
setInterval(refreshDashboardReadings,60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-dashboardRefreshAt>=60000)refreshDashboardReadings()});
if(token)load();else staffList();