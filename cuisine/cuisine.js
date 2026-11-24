"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let token=sessionStorage.getItem("kitchen_token")||"",data=null,page="dashboard",busy=false,coldRoomSelected="",coldHistory=[],coldTotal=0,coldOffset=0,coldLoading=false;
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
async function fetchColdPage(offset=0,limit=100,roomId=coldRoomSelected){
 const query=new URLSearchParams({action:"cold-history",offset:String(offset),limit:String(limit)});
 if(roomId)query.set("room_id",roomId);
 const res=await fetch(API+"?"+query,{headers:{"x-admin-session":token},cache:"no-store"});
 const json=await res.json().catch(()=>({error:"Réponse invalide"}));
 if(!res.ok)throw Error(json.error||"Impossible de charger les relevés");
 return json;
}
async function refreshColdHistory(offset=0){
 if(coldLoading)return;
 coldLoading=true;
 try{
  const room=coldRoomSelected;
  const result=await fetchColdPage(offset,25,room);
  if(room!==coldRoomSelected)return;
  coldHistory=result.readings;coldTotal=result.total;coldOffset=offset;
  if(page==="cold")renderCold();
 }catch(err){status(err.message,true)}finally{coldLoading=false}
}
async function exportCold(format){
 const rooms=data.rooms,staff=data.staff,exportRoom=coldRoomSelected,label=exportRoom?roomName(exportRoom):"Toutes les chambres";
 const buttons=document.querySelectorAll("[data-cold-export]");buttons.forEach(b=>b.disabled=true);
 try{
  const count=await window.CuisineReports[format]({
   rooms,staff,roomLabel:label,
   fetchPage:(offset,limit)=>fetchColdPage(offset,limit,exportRoom),
   notify:(done,total)=>status("Préparation de l’export : "+done+" / "+total+" relevés…")
  });
  status("Export "+format.toUpperCase()+" généré : "+count+" relevé(s).");
 }catch(err){status("Export impossible : "+err.message,true)}
 finally{buttons.forEach(b=>b.disabled=false)}
}
async function staffList(){try{const v=await request("staff-list","GET",undefined,false);$("agent").innerHTML='<option value="">Sélectionner un agent</option>'+v.staff.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");if(!v.staff.length)status("Aucun agent créé. Ouvrez Administration Collège → Gestion Cuisine.",true,"loginStatus")}catch(e){status(e.message,true,"loginStatus")}}
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
function logout(){$("kitchenFirstPassword")?.classList.add("hide");$("accountLoginForm")?.classList.remove("hide");token="";data=null;alarmEnabled=false;alarmSilenced=false;document.title=initialTitle;sessionStorage.removeItem("kitchen_token");$("app").classList.add("hide");$("login").classList.remove("hide");$("kitchenCriticalAlert").hidden=true;staffList()}
async function load(){try{data=await request("list");dashboardRefreshAt=Date.now();dashboardRefreshError="";$("login").classList.add("hide");$("app").classList.remove("hide");$("identity").textContent=data.me.name;$("todayLabel").textContent=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());render();if(page==="cold")refreshColdHistory(coldOffset);checkReheatAlarms();}catch(e){if(/Session|accès non autorisé/i.test(e.message))logout();status(e.message,true,token?"message":"loginStatus")}}
function switchPage(next){
 if(!["dashboard","reheat","cold","tasks"].includes(next))return;
 page=next;render();if(page==="dashboard"&&Date.now()-dashboardRefreshAt>=60000)refreshDashboardReadings();
 document.querySelector(".nav")?.scrollIntoView?.({block:"start",behavior:"smooth"});
}
function render(){
 if(!data)return;
 document.querySelectorAll("[data-page]").forEach(b=>{b.classList.toggle("active",b.dataset.page===page);if(b.dataset.page===page)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
 if(page==="dashboard")renderDashboard();
 else if(page==="cold"){renderCold();if(coldHistory.length===0&&coldTotal===0&&!coldLoading)refreshColdHistory(0);}
 else if(page==="reheat"){renderReheat();updateReheatControls();}
 else renderTasks();
 updateCriticalAlert();
 const viewOnly=data.me.scope==="viewer";
 $("readonlyNotice").hidden=!viewOnly;
 for(const button of document.querySelectorAll("#content form button[type=submit]")){if(viewOnly)button.disabled=true}
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
  const received=stamp?new Date(stamp).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}):"Aucune mesure";
  const origin=sensor?"Capteur "+esc(sensor.model):"Saisie manuelle";
  const schedule=!enabled?"Collecte automatique suspendue":mode==="times"
   ?"Heures fixes : "+esc((room.auto_collection_times||[]).join(", "))
   :"Toutes les "+interval+" min (24 h/24)";
  const nextLabel=enabled&&sensor&&Number.isFinite(next)?" · Prochain : "+new Date(next).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}):"";
  const problem=alert?(recent?"Température hors seuil : vérification nécessaire.":"Dernier relevé hors seuil : contrôler sur place."):"";
  return '<article class="cold-live-tile'+(recent&&alert?' cold-live-alert':'')+'">'+
   '<div class="cold-live-top"><h3>'+esc(room.label)+'</h3><span class="tag '+tagClass+'">'+label+'</span></div>'+
   '<div class="cold-live-value">'+(measured?number(reading.temperature_c)+' °C':'—')+'</div>'+
   '<div class="subline">'+origin+' · '+(sensor?'Reçue le ':'Relevée le ')+received+'</div>'+
   '<div class="subline">'+schedule+nextLabel+'</div>'+
   (problem?'<p class="cold-live-warning">'+problem+'</p>':'')+
   (!sensor?'<p class="help">Associez un thermomètre dans Administration → Gestion Cuisine.</p>':'')+
   '</article>';
 }).join("");
 return '<section class="card cold-live-section">'+
  '<div class="section-heading"><div><div class="eyebrow">Surveillance des chambres froides</div><h2>Dernières températures reçues</h2><p>Collecte serveur selon la programmation de chaque chambre, même lorsque le site est fermé. Les valeurs affichées ne sont pas des mesures instantanées.</p></div><button type="button" class="btn btn-outline btn-small" data-go="cold">Voir les relevés</button></div>'+
  (dashboardRefreshError?'<p class="info info-warn">'+esc(dashboardRefreshError)+'</p>':'')+
  '<div class="cold-live-grid">'+(tiles||'<div class="empty">Aucune chambre froide active.</div>')+'</div></section>';
}
async function refreshDashboardReadings(){
 if(!data||!token||page!=="dashboard"||busy||dashboardRefreshInFlight||document.hidden||document.getElementById("kitchenTaskEditor"))return;
 const currentToken=token;dashboardRefreshInFlight=true;
 try{
  const fresh=await request("list");
  if(token!==currentToken||!data||page!=="dashboard"||document.getElementById("kitchenTaskEditor"))return;
  data=fresh;dashboardRefreshAt=Date.now();dashboardRefreshError="";
  renderDashboard();updateCriticalAlert();
 }catch(err){
  if(token!==currentToken)return;
  if(/Session expirée|accès non autorisé/i.test(String(err.message))){logout();return}
  dashboardRefreshError="Actualisation temporairement indisponible. Vérifiez la date des mesures.";
  if(page==="dashboard"&&data)renderDashboard();
 }finally{dashboardRefreshInFlight=false}
}

function renderDashboard(){
 const day=today(),rooms=activeRooms(),coldToday=data.cold.filter(r=>dayOf(r.measured_at)===day),checked=new Set(coldToday.filter(r=>rooms.some(room=>room.id===r.room_id)).map(r=>r.room_id));
 const done=new Set(data.checks.filter(r=>r.performed_on===day).map(r=>r.task_id));
 const open=data.reheats.filter(r=>r.status==="en_cours");
 const alarms=[...latestByRoom().values()].filter(r=>r.is_alert&&rooms.some(room=>room.id===r.room_id)).length+data.reheats.filter(r=>dayOf(r.started_at)===day&&r.status==="alerte").length;
 $("content").innerHTML=
 renderColdOverview()+
 '<div class="card"><div class="section-heading"><div><div class="eyebrow">Organisation quotidienne</div><h2>Tâches du jour</h2></div><button type="button" class="btn btn-outline btn-small" data-go="tasks">Toutes les tâches</button></div>'+renderTaskItems(data.tasks)+'</div>'+
 '<div class="grid-3" style="margin-bottom:20px">'+
 '<div class="stat-box"><div class="muted">Chambres contrôlées aujourd’hui</div><div class="big-number">'+checked.size+' / '+rooms.length+'</div></div>'+
 '<div class="stat-box"><div class="muted">Remises en température en cours</div><div class="big-number">'+open.length+'</div></div>'+
 '<div class="stat-box"><div class="muted">Nettoyages validés</div><div class="big-number">'+done.size+' / '+data.tasks.length+'</div></div></div>'+
 '<div class="grid" style="margin-bottom:18px">'+
 '<div class="action-card"><div><span class="eyebrow">Cuisson</span><h2>Remise en température</h2><p>Départ de la chambre froide, lancement du four et mesure finale à cœur.</p></div><button class="btn btn-primary" type="button" data-go="reheat">Ouvrir les fours · '+open.length+' en cours</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Contrôle quotidien</span><h2>Chambres froides</h2><p>Saisissez la température réellement lue dans chaque chambre froide.</p></div><button class="btn btn-accent" type="button" data-go="cold">Faire un relevé · '+(rooms.length-checked.size)+' restant(s)</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Fin de service</span><h2>Nettoyage</h2><p>Cochez les tâches uniquement lorsqu’elles ont été effectuées.</p></div><button class="btn btn-outline" type="button" data-go="tasks">Voir les tâches</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Historique</span><h2>Suivi des contrôles</h2><p>Consultez les températures enregistrées et les alertes dans les pages correspondantes.</p></div><button class="btn btn-outline" type="button" data-go="reheat">Voir les remises en température</button></div></div>'+
 (alarms?'<div class="card info-warn"><strong>'+alarms+' anomalie(s) nécessitant une vérification.</strong> Prévenez le responsable et appliquez la procédure corrective prévue.</div>':'')+
 (open.length?'<div class="card"><div class="section-heading"><div><h2>Fours en cours</h2><p>Le compte à rebours continue même si vous changez de rubrique.</p></div><button type="button" class="btn btn-small btn-outline" data-go="reheat">Voir les cycles</button></div>'+
 open.map(r=>'<div class="line"><div><strong>'+esc(ovenName(r))+' · '+esc(dishName(r))+'</strong><div class="subline">'+esc(r.cold_room_label_snapshot||roomName(r.cold_room_id))+'</div></div><strong>'+remaining(r.due_at)+'</strong></div>').join("")+'</div>':'');
}

function renderCold(){
 const day=today(),rooms=activeRooms(),last=latestByRoom(),todayIds=new Set(data.cold.filter(r=>dayOf(r.measured_at)===day&&rooms.some(room=>room.id===r.room_id)).map(r=>r.room_id));
 const selected=coldRoomSelected,visibleRooms=selected?rooms.filter(r=>r.id===selected):rooms;
 const options='<option value="">Toutes les chambres froides</option>'+rooms.map(r=>'<option value="'+esc(r.id)+'" '+(selected===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const historical=coldHistory||[];
 $("content").innerHTML=
 '<div class="section-heading"><div><div class="eyebrow">Contrôle des équipements</div><h1>Chambres froides</h1><p>Choisissez une chambre pour saisir sa température et retrouver les relevés correspondants.</p></div><span class="tag">'+todayIds.size+' / '+rooms.length+' contrôlées aujourd’hui</span></div>'+
 '<div class="card"><div class="field" style="max-width:440px"><label for="coldRoomSelector">Chambre froide à consulter</label><select id="coldRoomSelector">'+options+'</select></div>'+
 '<div class="row"><button class="btn btn-outline btn-small" type="button" data-cold-export="csv">Exporter les relevés en CSV</button><button class="btn btn-outline btn-small" type="button" data-cold-export="pdf">Exporter en PDF</button></div>'+
 '<p class="help">Les exports contiennent l’historique complet des chambres sélectionnées, même si la liste n’affiche qu’une page.</p></div>'+
 '<div class="grid">'+visibleRooms.map(r=>{
 const current=last.get(r.id),done=todayIds.has(r.id),sensor=(data.connected||[]).find(d=>d.kind==="cold_room"&&d.room_id===r.id&&d.provider==="govee");
 const threshold=r.min_c===null?'≤ '+number(r.max_c)+' °C':number(r.min_c)+' à '+number(r.max_c)+' °C';
 return '<div class="tile"><div class="row between"><h3>'+esc(r.label)+'</h3><span class="tag '+(done?'tag-ok':'tag-warn')+'">'+(done?'Relevée aujourd’hui':'À contrôler')+'</span></div>'+
 '<div class="subline">Plage configurée : '+esc(threshold)+'</div>'+
 (sensor?'<p class="help">Capteur Govee : <strong>'+esc(sensor.status==='online'?'Dernière valeur reçue':'Non connecté')+'</strong>'+(sensor.last_temperature_c==null?'':' · '+number(sensor.last_temperature_c)+' °C')+(sensor.last_checked_at?' · '+clock(sensor.last_checked_at):'')+'</p>':'')+
 (current?'<p class="help">Dernier relevé : <strong>'+number(current.temperature_c)+' °C</strong> · '+clock(current.measured_at)+' <span class="tag '+(current.is_alert?'tag-alert':'tag-ok')+'">'+(current.is_alert?'Hors seuil':'Dans la plage')+'</span></p>':'<p class="help">Aucun relevé enregistré.</p>')+
 '<form data-cold="'+esc(r.id)+'"><div class="field"><label>Température mesurée (°C)</label><input type="number" required step="0.1" min="-60" max="60" name="temperature_c" inputmode="decimal" placeholder="Ex. 2,5"></div>'+
 '<button class="btn btn-primary" type="submit">Enregistrer la mesure</button></form></div>'}).join("")+'</div>'+
 '<div class="card" style="margin-top:17px"><div class="section-heading"><div><h2>Historique des relevés</h2><p>'+coldTotal+' résultat(s) · page '+(Math.floor(coldOffset/25)+1)+'</p></div></div>'+
 (historical.length?historical.map(r=>'<div class="line"><div><strong>'+esc(roomName(r.room_id))+'</strong><div class="subline">'+clock(r.measured_at)+' · '+(r.source==='govee_cloud'?'Capteur Govee':esc(staffName(r.taken_by)))+'</div></div><div class="row"><strong>'+number(r.temperature_c)+' °C</strong><span class="tag '+(r.is_alert?'tag-alert':'tag-ok')+'">'+(r.is_alert?'Hors seuil':'Dans la plage')+'</span></div></div>').join(""):'<div class="empty"><strong>Aucun relevé pour cette sélection</strong>Les mesures apparaîtront ici.</div>')+
 '<div class="row between" style="margin-top:15px"><button type="button" class="btn btn-outline btn-small" data-cold-page="prev" '+(coldOffset===0?'disabled':'')+'>Page précédente</button><button type="button" class="btn btn-outline btn-small" data-cold-page="next" '+(coldOffset+25>=coldTotal?'disabled':'')+'>Page suivante</button></div></div>';
}
function remaining(iso){const n=Math.ceil((new Date(iso).getTime()-Date.now())/1000);if(n<=0)return"Contrôle attendu";return Math.floor(n/60)+" min "+String(n%60).padStart(2,"0")+" s";}
function renderReheat(){
 const open=data.reheats.filter(x=>x.status==="en_cours"),recent=data.reheats.filter(x=>x.status!=="en_cours").slice(0,12);
 const d=data.defaults||{},roomOptions=activeRooms().map(r=>'<option value="'+esc(r.id)+'" '+(d.default_cold_room_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const ovenOptions=(data.ovens||[]).map(r=>'<option value="'+esc(r.id)+'" '+(d.default_oven_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const dishOptions=(data.dishes||[]).map(r=>'<option value="'+esc(r.id)+'" '+(d.default_dish_type_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
 const equipment=r=>esc(r.cold_room_label_snapshot||roomName(r.cold_room_id))+' → '+esc(ovenName(r));
 $("content").innerHTML=
 '<div class="section-heading"><div><div class="eyebrow">De la chambre froide au four</div><h1>Remise en température</h1><p>Deux températures réelles, un minuteur et un historique.</p></div><button type="button" class="btn btn-outline btn-small" id="enableKitchenAlarm">Tester l’alarme</button></div>'+
 '<div class="card"><div class="section-heading"><div><h2>1. Démarrer un réchauffage</h2><p>Sélectionnez le plat, sa chambre froide et le four. Mesurez la température du plat à cœur avant de commencer.</p></div><span class="tag">Départ · chambre froide</span></div>'+
 '<form id="startReheat"><div class="field-grid">'+
 '<div class="field"><label>Type de plat</label><select name="dish_type_id" required><option value="">Choisir un type</option>'+dishOptions+'</select></div>'+
 '<div class="field"><label>Chambre froide de départ</label><select name="cold_room_id" required><option value="">Choisir une chambre</option>'+roomOptions+'</select></div>'+
 '<div class="field"><label>Four utilisé</label><select name="oven_id" required><option value="">Choisir un four</option>'+ovenOptions+'</select></div>'+
 '<div class="field"><label>Température mesurée du plat avant réchauffage (°C)</label><input name="temperature_c" required type="number" step="0.1" min="-10" max="90" inputmode="decimal" placeholder="Ex. 2"></div></div>'+
 '<div class="row between"><div class="help">Référence de départ : '+number(d.target_start_c??2)+' °C. Ne saisissez pas une valeur non mesurée.</div><button type="submit" class="btn btn-primary">Démarrer le chronomètre</button></div></form></div>'+
 '<div class="card"><div class="section-heading"><div><h2>2. Fours en cours</h2><p>La température finale sera saisissable pendant les 5 dernières minutes.</p></div><span class="tag">'+open.length+' cycle(s)</span></div>'+
 (open.length?open.map(r=>{
 const allow=canFinish(r.due_at),ms=remainingMs(r.due_at),duration=(r.reminder_minutes||55)*60000,progress=Math.min(100,Math.max(0,(duration-ms)/duration*100));
 return '<div class="timer-card '+(ms<=0?'is-late':allow?'is-ready':'')+'" data-reheat="'+esc(r.id)+'">'+
 '<div class="row between"><div><div class="eyebrow">'+esc(dishName(r))+'</div><h3>'+esc(ovenName(r))+'</h3></div><span class="tag '+(ms<=0?'tag-alert':allow?'tag-ok':'tag-warn')+'" data-cycle-state>'+(ms<=0?'Rappel dépassé':allow?'Mesure finale disponible':'En cours de chauffe')+'</span></div>'+
 '<div class="timer-details"><span>Chambre : '+esc(r.cold_room_label_snapshot||roomName(r.cold_room_id))+'</span><span>Départ : '+number(r.start_temperature_c)+' °C</span><span>Heure : '+clock(r.started_at)+'</span></div>'+
 '<div class="timer-display clock" data-due="'+esc(r.due_at)+'">'+remaining(r.due_at)+'</div>'+
 '<div class="timer-track" aria-hidden="true"><div data-progress style="width:'+progress.toFixed(1)+'%"></div></div>'+
 '<div class="timer-status" data-timer-hint>'+(allow?'Vous pouvez maintenant mesurer le plat à cœur.':'Attendez les 5 dernières minutes pour enregistrer le contrôle final.')+'</div>'+
 '<form class="finish-area" data-finish="'+esc(r.id)+'" data-due="'+esc(r.due_at)+'"><div class="field"><label>Température réelle à cœur à la sortie du four (°C)</label><input required type="number" step="0.1" min="-10" max="120" name="temperature_c" inputmode="decimal" placeholder="Minimum '+number(r.target_end_c??63)+' °C" '+(allow?'':'disabled')+'></div>'+
 '<button type="submit" class="btn btn-accent" '+(allow?'':'disabled')+'>Valider la température finale</button><p class="help" data-lock-message>'+(allow?'Saisie disponible. Relevez la température réelle à cœur.':'Saisie indisponible avant les 5 dernières minutes.')+'</p></form></div>'
 }).join(""):'<div class="empty"><strong>Aucun four en cours</strong>Lancez une remise en température dans le formulaire ci-dessus.</div>')+'</div>'+
 '<div class="card"><div class="section-heading"><div><h2>3. Derniers contrôles terminés</h2><p>Différence entre les températures réelles de départ et de fin.</p></div></div>'+
 (recent.length?recent.map(r=>'<div class="line"><div><strong>'+equipment(r)+'</strong><div class="subline">'+esc(dishName(r))+' · '+clock(r.started_at)+'</div><div class="subline">'+number(r.start_temperature_c)+' °C → '+number(r.end_temperature_c)+' °C · Écart : '+deltaC(r)+(r.ended_at&&new Date(r.ended_at)>new Date(r.due_at)?' · Mesure enregistrée après le rappel':'')+'</div></div><span class="tag '+(r.status==='alerte'?'tag-alert':'tag-ok')+'">'+(r.status==='alerte'?'À contrôler':'Seuils atteints')+'</span></div>').join(""):'<div class="empty"><strong>Aucun contrôle terminé</strong>Les contrôles apparaîtront ici.</div>')+'</div>'+
 '<p class="guided-note">Le minuteur est une aide à l’organisation, pas une preuve de conformité sanitaire. Les mesures sont conservées avec leur heure de saisie et les alertes restent visibles en administration.</p>';
}

function canManageTasks(){return data?.me.scope==="admin"}
function canCheckTasks(){return data?.me.scope==="staff"&&!data.me.existingAccount}
function renderTaskItems(tasks){
 const done=new Map(data.checks.filter(c=>c.performed_on===today()).map(c=>[c.task_id,c]));
 return '<div class="task-list">'+(tasks.map(t=>{
 const c=done.get(t.id),locked=t.assigned_to&&t.assigned_to!==data.me.id;
 const state=c?'<span class="tag tag-ok">Réalisée</span>':t.active===false?'<span class="tag tag-warn">Désactivée</span>':t.scheduled===false?'<span class="tag">Non prévue aujourd’hui</span>':canCheckTasks()?'<button class="btn btn-primary btn-small" type="button" data-task="'+esc(t.id)+'" '+(locked?'disabled':'')+'>'+(locked?'Attribuée à un autre agent':'Marquer comme réalisée')+'</button>':'<span class="tag tag-warn">À réaliser</span>';
 return '<div class="task-item '+(c?'done':'')+'"><div><strong>'+esc(t.label)+'</strong><small>'+(t.assigned_to?'Responsable : '+esc(staffName(t.assigned_to)):'Tâche commune')+' · '+esc(window.KitchenUI.scheduleLabel(t))+(c?' · Confirmée à '+clock(c.performed_at)+' par '+esc(staffName(c.performed_by)):'')+'</small>'+(t.description?'<p class="kt-task-notes">'+esc(t.description)+'</p>':'')+(t.instructions?'<p class="kt-task-notes"><b>Consignes :</b> '+esc(t.instructions)+'</p>':'')+'</div><div class="kt-task-actions">'+state+(canManageTasks()?'<button class="btn btn-outline btn-small" type="button" data-edit-kitchen-task="'+esc(t.id)+'">Modifier</button>':'')+'</div></div>';
 }).join("")||'<p class="muted">Aucune tâche à afficher.</p>')+'</div>';
}
function renderTasks(){
 const done=new Set(data.checks.filter(c=>c.performed_on===today()).map(c=>c.task_id));
 const tasks=canManageTasks()?(data.task_settings||data.tasks):data.tasks;
 $("content").innerHTML='<div class="section-heading"><div><div class="eyebrow">Suivi quotidien</div><h1>Nettoyage et tâches</h1><p>Validez uniquement les tâches réellement réalisées aujourd’hui.</p></div><div class="kt-task-actions"><span class="tag">'+data.tasks.filter(t=>done.has(t.id)).length+' / '+data.tasks.length+' validées</span>'+(canManageTasks()?'<button type="button" class="btn btn-primary" data-add-kitchen-task>Ajouter une tâche</button>':'')+'</div></div><div class="card">'+renderTaskItems(tasks)+'</div><p class="guided-note">Les validations sont horodatées.</p>';
}
async function fetchTaskSettings(day){
 const response=await fetch(API+"?"+new URLSearchParams({action:"task-settings",date:day}),{headers:{"x-admin-session":token},cache:"no-store"});
 const json=await response.json().catch(()=>({error:"Réponse invalide"}));if(!response.ok||!Array.isArray(json.tasks))throw Error(json.error||"Configuration indisponible");return json.tasks;
}
function editKitchenTask(id){
 if(!canManageTasks()||busy)return;
 const task=id?(data.task_settings||data.tasks).find(t=>t.id===id):null;if(id&&!task)return;
 const currentToken=token;
 window.KitchenUI.open({task,staff:data.staff,completed:!!task&&data.checks.some(c=>c.task_id===id&&c.performed_on===today()),fetchTasks:fetchTaskSettings,save:async(action,body)=>{if(currentToken!==token||!canManageTasks())throw Error("Session modifiée");await request(action,"POST",body)},onSaved:async()=>{await load();status("Tâche enregistrée.")}});
}
document.addEventListener("click",e=>{const btn=e.target.closest?.("[data-edit-kitchen-task],[data-add-kitchen-task]");if(btn)editKitchenTask(btn.dataset.editKitchenTask||null)});
async function save(action,body){if(busy)return;busy=true;try{const result=await request(action,"POST",body);await load();if(result.alert)status("Contrôle enregistré avec anomalie : prévenir le responsable et effectuer une action corrective.",true);else status("Enregistré avec date, heure et nom de l’agent.");}catch(e){status(e.message,true);}finally{busy=false}}
document.addEventListener("submit",e=>{const form=e.target;if(!(form instanceof HTMLFormElement))return;if(!form.matches("[data-cold],#startReheat,[data-finish]"))return;e.preventDefault();const t=form.elements.namedItem("temperature_c")?.value;if(form.dataset.cold)save("cold-reading",{room_id:form.dataset.cold,temperature_c:t});else if(form.id==="startReheat"){unlockAlarm();save("start-reheat",{cold_room_id:form.elements.namedItem("cold_room_id").value,oven_id:form.elements.namedItem("oven_id").value,dish_type_id:form.elements.namedItem("dish_type_id").value,temperature_c:t});}else if(form.dataset.finish){if(!canFinish(form.dataset.due)){status("Saisie bloquée : attendez les 5 dernières minutes.",true);return;}save("finish-reheat",{id:form.dataset.finish,temperature_c:t})}});
document.addEventListener("click",e=>{const b=e.target.closest?.("button[data-task]");if(b&&canCheckTasks())save("task-check",{task_id:b.dataset.task})});
$("loginForm").addEventListener("submit",e=>{e.preventDefault();login()});$("connectAccount")?.addEventListener("click",connectAccount);$("accountLoginForm")?.addEventListener("submit",e=>{e.preventDefault();loginCentralAccount()});$("kitchenFirstPassword")?.addEventListener("submit",e=>{e.preventDefault();finishKitchenFirstPassword()});$("logout").addEventListener("click",logout);$("refresh").addEventListener("click",load);
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.page)));
document.addEventListener("click",e=>{const b=e.target.closest?.("[data-go]");if(b)switchPage(b.dataset.go)});
document.addEventListener("change",event=>{
 if(event.target?.id==="coldRoomSelector"){
  coldRoomSelected=event.target.value;coldHistory=[];coldOffset=0;coldTotal=0;
  refreshColdHistory(0);
 }
});
document.addEventListener("click",event=>{
 const exp=event.target.closest?.("[data-cold-export]");
 if(exp){exportCold(exp.dataset.coldExport);return}
 const pg=event.target.closest?.("[data-cold-page]");
 if(pg){refreshColdHistory(Math.max(0,coldOffset+(pg.dataset.coldPage==="next"?25:-25)));return}
});
function updateReheatControls(){
 if(!data)return;
 for(const form of document.querySelectorAll("form[data-finish][data-due]")){
   const unlocked=data.me.scope!=="viewer"&&canFinish(form.dataset.due),ms=remainingMs(form.dataset.due);
   const input=form.elements.namedItem("temperature_c"),button=form.querySelector('button[type="submit"]');
   if(input)input.disabled=!unlocked;
   if(button)button.disabled=!unlocked;
   const note=form.querySelector("[data-lock-message]");
   if(note)note.textContent=unlocked?"Saisie disponible. Relevez la température réelle à cœur.":"Saisie indisponible avant les 5 dernières minutes.";
   const card=form.closest(".timer-card");
   if(card){
     card.classList.toggle("is-ready",unlocked&&ms>0);
     card.classList.toggle("is-late",ms<=0);
     const state=card.querySelector("[data-cycle-state]"),hint=card.querySelector("[data-timer-hint]"),progress=card.querySelector("[data-progress]");
     if(state){state.className="tag "+(ms<=0?"tag-alert":unlocked?"tag-ok":"tag-warn");state.textContent=ms<=0?"Rappel dépassé":unlocked?"Mesure finale disponible":"En cours de chauffe";}
     if(hint)hint.textContent=unlocked?"Vous pouvez mesurer le plat à cœur.":"Attendez les 5 dernières minutes pour enregistrer le contrôle final.";
     if(progress){const started=new Date(form.dataset.due).getTime()-(Number(data.reheats.find(r=>r.id===form.dataset.finish)?.reminder_minutes)||55)*60000;const duration=new Date(form.dataset.due).getTime()-started;progress.style.width=Math.min(100,Math.max(0,(Date.now()-started)/duration*100))+"%";}
   }
 }
 for(const el of document.querySelectorAll(".clock[data-due]"))el.textContent=remaining(el.dataset.due);
}
function updateCriticalAlert(){
 const active=activeCriticalCycles(),panel=$("kitchenCriticalAlert");
 panel.hidden=active.length===0;
 document.title=active.length?"⚠ CONTRÔLE À FAIRE ("+active.length+") — Cuisine":initialTitle;
 document.querySelectorAll('.nav [data-page="reheat"]').forEach(b=>{
  b.classList.toggle("has-check",active.length>0);
  b.textContent=active.length?"Remise en température · "+active.length+" contrôle(s)":"Remise en température";
 });
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
setInterval(()=>{if(!data)return;if(page==="reheat")updateReheatControls();checkReheatAlarms();},1000);
setInterval(refreshDashboardReadings,60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-dashboardRefreshAt>=60000)refreshDashboardReadings()});
if(token)load();else staffList();