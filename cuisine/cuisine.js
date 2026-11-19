"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let token=sessionStorage.getItem("kitchen_token")||"",data=null,page="dashboard",busy=false;
let alarmAudio=null;
const alarmed=new Set();
const remainingMs=due=>new Date(due).getTime()-Date.now();
const canFinish=due=>Number.isFinite(new Date(due).getTime())&&remainingMs(due)<5*60*1000;
function unlockAlarm(){try{alarmAudio??=new (window.AudioContext||window.webkitAudioContext)();if(alarmAudio.state==="suspended")alarmAudio.resume().catch(()=>{});}catch{}}
function soundAlarm(){try{if(!alarmAudio||alarmAudio.state!=="running")return;for(let i=0;i<3;i++){const oscillator=alarmAudio.createOscillator(),gain=alarmAudio.createGain(),at=alarmAudio.currentTime+i*.38;oscillator.frequency.value=760;gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.16,at+.02);gain.gain.exponentialRampToValueAtTime(.0001,at+.25);oscillator.connect(gain);gain.connect(alarmAudio.destination);oscillator.start(at);oscillator.stop(at+.26)}}catch{}}
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
async function staffList(){try{const v=await request("staff-list","GET",undefined,false);$("agent").innerHTML='<option value="">Sélectionner un agent</option>'+v.staff.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");if(!v.staff.length)status("Aucun agent créé. Ouvrez Administration Collège → Gestion Cuisine.",true,"loginStatus")}catch(e){status(e.message,true,"loginStatus")}}
async function login(){if(busy)return;busy=true;$("connect").disabled=true;try{
 const v=await request("login","POST",{staff_id:$("agent").value,pin:$("pin").value},false);
 token=v.token;sessionStorage.setItem("kitchen_token",token);$("pin").value="";await load();
}catch(e){status(e.message,true,"loginStatus")}finally{busy=false;$("connect").disabled=false}}
function logout(){token="";data=null;sessionStorage.removeItem("kitchen_token");$("app").classList.add("hide");$("login").classList.remove("hide");staffList()}
async function load(){try{data=await request("list");$("login").classList.add("hide");$("app").classList.remove("hide");$("identity").textContent=data.me.name;$("todayLabel").textContent=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());render();}catch(e){if(/Session|accès non autorisé/i.test(e.message))logout();status(e.message,true,token?"message":"loginStatus")}}
function switchPage(next){
 if(!["dashboard","reheat","cold","tasks"].includes(next))return;
 page=next;render();
 document.querySelector(".nav")?.scrollIntoView?.({block:"start",behavior:"smooth"});
}
function render(){
 if(!data)return;
 document.querySelectorAll("[data-page]").forEach(b=>{b.classList.toggle("active",b.dataset.page===page);if(b.dataset.page===page)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
 if(page==="dashboard")renderDashboard();
 else if(page==="cold")renderCold();
 else if(page==="reheat"){renderReheat();updateReheatControls();}
 else renderTasks();
}
function dayOf(iso){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso))}
function latestByRoom(){const m=new Map();for(const r of data.cold)if(!m.has(r.room_id))m.set(r.room_id,r);return m}
function roomName(id){return data.rooms.find(x=>x.id===id)?.label||"Chambre inconnue"}
function ovenName(r){return r.oven_label_snapshot||(data.ovens||[]).find(x=>x.id===r.oven_id)?.label||("Four "+r.oven_number)}
function dishName(r){return r.dish_type_label_snapshot||(data.dishes||[]).find(x=>x.id===r.dish_type_id)?.label||"Plat non précisé"}
function deltaC(r){if(r.end_temperature_c==null)return"";const change=Number(r.end_temperature_c)-Number(r.start_temperature_c);return(change>=0?"+":"")+number(change)+" °C"}
function renderDashboard(){
 const day=today(),coldToday=data.cold.filter(r=>dayOf(r.measured_at)===day),checked=new Set(coldToday.map(r=>r.room_id));
 const done=new Set(data.checks.filter(r=>r.performed_on===day).map(r=>r.task_id));
 const open=data.reheats.filter(r=>r.status==="en_cours");
 const alarms=data.cold.filter(r=>dayOf(r.measured_at)===day&&r.is_alert).length+data.reheats.filter(r=>dayOf(r.started_at)===day&&r.status==="alerte").length;
 $("content").innerHTML=
 '<div class="banner"><div class="eyebrow">Aujourd’hui en cuisine</div><h1>Que voulez-vous faire ?</h1><p>Choisissez une action. Vous n’avez besoin que de quelques saisies pour enregistrer chaque contrôle.</p></div>'+
 '<div class="grid-3" style="margin-bottom:20px">'+
 '<div class="stat-box"><div class="muted">Chambres contrôlées aujourd’hui</div><div class="big-number">'+checked.size+' / '+data.rooms.length+'</div></div>'+
 '<div class="stat-box"><div class="muted">Remises en température en cours</div><div class="big-number">'+open.length+'</div></div>'+
 '<div class="stat-box"><div class="muted">Nettoyages validés</div><div class="big-number">'+done.size+' / '+data.tasks.length+'</div></div></div>'+
 '<div class="grid" style="margin-bottom:18px">'+
 '<div class="action-card"><div><span class="eyebrow">Cuisson</span><h2>Remise en température</h2><p>Départ de la chambre froide, lancement du four et mesure finale à cœur.</p></div><button class="btn btn-primary" type="button" data-go="reheat">Ouvrir les fours · '+open.length+' en cours</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Contrôle quotidien</span><h2>Chambres froides</h2><p>Saisissez la température réellement lue dans chaque chambre froide.</p></div><button class="btn btn-accent" type="button" data-go="cold">Faire un relevé · '+(data.rooms.length-checked.size)+' restant(s)</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Fin de service</span><h2>Nettoyage</h2><p>Cochez les tâches uniquement lorsqu’elles ont été effectuées.</p></div><button class="btn btn-outline" type="button" data-go="tasks">Voir les tâches</button></div>'+
 '<div class="action-card"><div><span class="eyebrow">Historique</span><h2>Suivi des contrôles</h2><p>Consultez les températures enregistrées et les alertes dans les pages correspondantes.</p></div><button class="btn btn-outline" type="button" data-go="reheat">Voir les remises en température</button></div></div>'+
 (alarms?'<div class="card info-warn"><strong>'+alarms+' anomalie(s) signalée(s) aujourd’hui.</strong> Prévenez le responsable et appliquez la procédure corrective prévue.</div>':'')+
 (open.length?'<div class="card"><div class="section-heading"><div><h2>Fours en cours</h2><p>Le compte à rebours continue même si vous changez de rubrique.</p></div><button type="button" class="btn btn-small btn-outline" data-go="reheat">Voir les cycles</button></div>'+
 open.map(r=>'<div class="line"><div><strong>'+esc(ovenName(r))+' · '+esc(dishName(r))+'</strong><div class="subline">'+esc(r.cold_room_label_snapshot||roomName(r.cold_room_id))+'</div></div><strong>'+remaining(r.due_at)+'</strong></div>').join("")+'</div>':'');
}

function renderCold(){
 const day=today(),last=latestByRoom(),todayIds=new Set(data.cold.filter(r=>dayOf(r.measured_at)===day).map(r=>r.room_id));
 $("content").innerHTML=
 '<div class="section-heading"><div><div class="eyebrow">Contrôle des équipements</div><h1>Chambres froides</h1><p>Une température par chambre, relevée directement sur l’équipement.</p></div><span class="tag">'+todayIds.size+' / '+data.rooms.length+' contrôlées aujourd’hui</span></div>'+
 '<div class="grid">'+data.rooms.map(r=>{
 const current=last.get(r.id),done=todayIds.has(r.id),sensor=(data.connected||[]).find(d=>d.kind==="cold_room"&&d.room_id===r.id&&d.provider==="govee");
 const threshold=r.min_c===null?'≤ '+number(r.max_c)+' °C':number(r.min_c)+' à '+number(r.max_c)+' °C';
 return '<div class="tile"><div class="row between"><h3>'+esc(r.label)+'</h3><span class="tag '+(done?'tag-ok':'tag-warn')+'">'+(done?'Relevée aujourd’hui':'À contrôler')+'</span></div>'+
 '<div class="subline">Plage autorisée : '+esc(threshold)+'</div>'+
 (sensor?'<p class="help">Capteur Govee : <strong>'+esc(sensor.status==='online'?'Dernière valeur reçue':'Non connecté')+'</strong>'+(sensor.last_temperature_c==null?'':' · '+number(sensor.last_temperature_c)+' °C')+(sensor.last_checked_at?' · '+clock(sensor.last_checked_at):'')+'</p>':'')+
 (current?'<p class="help">Dernier relevé : <strong>'+number(current.temperature_c)+' °C</strong> · '+clock(current.measured_at)+' <span class="tag '+(current.is_alert?'tag-alert':'tag-ok')+'">'+(current.is_alert?'Hors seuil':'Dans la plage')+'</span></p>':'<p class="help">Aucun relevé enregistré.</p>')+
 '<form data-cold="'+esc(r.id)+'"><div class="field"><label>Température mesurée (°C)</label><input type="number" required step="0.1" min="-60" max="60" name="temperature_c" inputmode="decimal" placeholder="Ex. 2,5"></div>'+
 '<button class="btn btn-primary" type="submit">Enregistrer la mesure</button></form></div>'}).join("")+'</div>'+
 '<div class="card" style="margin-top:17px"><div class="section-heading"><div><h2>Derniers relevés</h2><p>Mesures horodatées et conservées automatiquement.</p></div></div>'+
 (data.cold.length?data.cold.slice(0,12).map(r=>'<div class="line"><div><strong>'+esc(roomName(r.room_id))+'</strong><div class="subline">'+clock(r.measured_at)+' · '+(r.source==='govee_cloud'?'Capteur Govee':esc(staffName(r.taken_by)))+'</div></div><div class="row"><strong>'+number(r.temperature_c)+' °C</strong><span class="tag '+(r.is_alert?'tag-alert':'tag-ok')+'">'+(r.is_alert?'Hors seuil':'Conforme au seuil')+'</span></div></div>').join(""):'<div class="empty"><strong>Pas encore de relevé</strong>Les mesures apparaîtront ici.</div>')+'</div>';
}

function remaining(iso){const n=Math.ceil((new Date(iso).getTime()-Date.now())/1000);if(n<=0)return"Contrôle attendu";return Math.floor(n/60)+" min "+String(n%60).padStart(2,"0")+" s";}
function renderReheat(){
 const open=data.reheats.filter(x=>x.status==="en_cours"),recent=data.reheats.filter(x=>x.status!=="en_cours").slice(0,12);
 const d=data.defaults||{},roomOptions=data.rooms.map(r=>'<option value="'+esc(r.id)+'" '+(d.default_cold_room_id===r.id?'selected':'')+'>'+esc(r.label)+'</option>').join("");
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
 (recent.length?recent.map(r=>'<div class="line"><div><strong>'+equipment(r)+'</strong><div class="subline">'+esc(dishName(r))+' · '+clock(r.started_at)+'</div><div class="subline">'+number(r.start_temperature_c)+' °C → '+number(r.end_temperature_c)+' °C · Écart : '+deltaC(r)+'</div></div><span class="tag '+(r.status==='alerte'?'tag-alert':'tag-ok')+'">'+(r.status==='alerte'?'À contrôler':'Seuils atteints')+'</span></div>').join(""):'<div class="empty"><strong>Aucun contrôle terminé</strong>Les contrôles apparaîtront ici.</div>')+'</div>'+
 '<p class="guided-note">Le minuteur est une aide à l’organisation, pas une preuve de conformité sanitaire. Les mesures sont conservées avec leur heure de saisie et les alertes restent visibles en administration.</p>';
}

function renderTasks(){
 const day=today(),checks=data.checks.filter(t=>t.performed_on===day),done=new Set(checks.map(x=>x.task_id));
 $("content").innerHTML='<div class="section-heading"><div><div class="eyebrow">Suivi quotidien</div><h1>Nettoyage</h1><p>Validez uniquement les tâches réellement réalisées aujourd’hui.</p></div><span class="tag">'+done.size+' / '+data.tasks.length+' validées</span></div>'+
 '<div class="card"><div class="task-list">'+data.tasks.map(t=>{
 const c=checks.find(x=>x.task_id===t.id),locked=t.assigned_to&&t.assigned_to!==data.me.id;
 return '<div class="task-item '+(done.has(t.id)?'done':'')+'"><div><strong>'+esc(t.label)+'</strong><small>'+(t.assigned_to?'Responsable : '+esc(staffName(t.assigned_to)):'Tâche commune')+(c?' · Confirmée à '+clock(c.performed_at)+' par '+esc(staffName(c.performed_by)):'')+'</small></div>'+
 (done.has(t.id)?'<span class="tag tag-ok">Réalisée</span>':'<button class="btn btn-primary btn-small" type="button" data-task="'+esc(t.id)+'" '+(locked?'disabled':'')+'>'+(locked?'Attribuée à un autre agent':'Marquer comme réalisée')+'</button>')+'</div>'
 }).join("")+'</div></div>'+
 '<p class="guided-note">Un clic crée une validation horodatée au nom de l’agent connecté. Les tâches non faites restent visibles dans le suivi administratif.</p>';
}

async function save(action,body){if(busy)return;busy=true;try{const result=await request(action,"POST",body);await load();if(result.alert)status("Contrôle enregistré avec anomalie : prévenir le responsable et effectuer une action corrective.",true);else status("Enregistré avec date, heure et nom de l’agent.");}catch(e){status(e.message,true);}finally{busy=false}}
document.addEventListener("submit",e=>{const form=e.target;if(!(form instanceof HTMLFormElement))return;if(!form.matches("[data-cold],#startReheat,[data-finish]"))return;e.preventDefault();const t=form.elements.namedItem("temperature_c")?.value;if(form.dataset.cold)save("cold-reading",{room_id:form.dataset.cold,temperature_c:t});else if(form.id==="startReheat"){unlockAlarm();save("start-reheat",{cold_room_id:form.elements.namedItem("cold_room_id").value,oven_id:form.elements.namedItem("oven_id").value,dish_type_id:form.elements.namedItem("dish_type_id").value,temperature_c:t});}else if(form.dataset.finish){if(!canFinish(form.dataset.due)){status("Saisie bloquée : attendez les 5 dernières minutes.",true);return;}save("finish-reheat",{id:form.dataset.finish,temperature_c:t})}});
document.addEventListener("click",e=>{const b=e.target.closest?.("button[data-task]");if(b)save("task-check",{task_id:b.dataset.task})});
$("loginForm").addEventListener("submit",e=>{e.preventDefault();login()});$("logout").addEventListener("click",logout);$("refresh").addEventListener("click",load);
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.page)));
document.addEventListener("click",e=>{const b=e.target.closest?.("[data-go]");if(b)switchPage(b.dataset.go)});
function updateReheatControls(){
 if(!data)return;
 for(const form of document.querySelectorAll("form[data-finish][data-due]")){
   const unlocked=canFinish(form.dataset.due),ms=remainingMs(form.dataset.due);
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
function checkReheatAlarms(){
 if(!data)return;
 for(const r of data.reheats.filter(x=>x.status==="en_cours")){
   const ms=remainingMs(r.due_at);
   for(const stage of ["five","zero"]){
     if(stage==="five"&&ms>5*60000)continue;
     if(stage==="zero"&&ms>0)continue;
     const key=r.id+":"+stage;
     if(alarmed.has(key))continue;
     alarmed.add(key);
     status(stage==="five"?"Plus que 5 minutes : préparez le contrôle à cœur.":"Chrono terminé : contrôlez immédiatement la température à cœur.",true);
     soundAlarm();
     if(navigator.vibrate)navigator.vibrate([200,100,200]);
   }
 }
}
document.addEventListener("click",e=>{if(e.target.closest?.("#enableKitchenAlarm")){unlockAlarm();soundAlarm();status("Alarme sonore testée. Gardez l’application ouverte.");}});
setInterval(()=>{if(!data)return;if(page==="reheat")updateReheatControls();checkReheatAlarms();},1000);
if(token)load();else staffList();