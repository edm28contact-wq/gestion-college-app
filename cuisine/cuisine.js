"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let token=sessionStorage.getItem("kitchen_token")||"",data=null,page="cold",busy=false;
let alarmAudio=null;
function unlockAlarm(){try{alarmAudio??=new (window.AudioContext||window.webkitAudioContext)();if(alarmAudio.state==="suspended")alarmAudio.resume().catch(()=>{});}catch{}}
function soundAlarm(){try{if(!alarmAudio||alarmAudio.state!=="running")return;for(let i=0;i<3;i++){const oscillator=alarmAudio.createOscillator(),gain=alarmAudio.createGain(),at=alarmAudio.currentTime+i*.38;oscillator.frequency.value=760;gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.16,at+.02);gain.gain.exponentialRampToValueAtTime(.0001,at+.25);oscillator.connect(gain);gain.connect(alarmAudio.destination);oscillator.start(at);oscillator.stop(at+.26)}}catch{}}
const clock=v=>v?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
const number=x=>Number(x).toLocaleString("fr-FR",{maximumFractionDigits:2});
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const staffName=id=>data?.staff.find(s=>s.id===id)?.name||"Agent";
function status(msg,bad=false,target="message"){const el=$(target);if(!el)return;el.textContent=msg;el.className="status "+(bad?"error":"good")}
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
async function load(){try{data=await request("list");$("login").classList.add("hide");$("app").classList.remove("hide");$("identity").textContent=data.me.name;render();status("Données actualisées")}catch(e){if(/Session|accès non autorisé/i.test(e.message))logout();status(e.message,true,token?"message":"loginStatus")}}
function render(){
 const day=today(),done=new Set(data.checks.filter(t=>t.performed_on===day).map(t=>t.task_id));
 const current=data.reheats.filter(r=>r.status==="en_cours");
 const coldDay=data.cold.filter(r=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(r.measured_at))===day);
 $("stats").innerHTML='<div class="stat"><small>Chambres contrôlées</small><strong>'+new Set(coldDay.map(x=>x.room_id)).size+'/'+data.rooms.length+'</strong></div><div class="stat"><small>Remises en cours</small><strong>'+current.length+'</strong></div><div class="stat"><small>Tâches réalisées</small><strong>'+done.size+'/'+data.tasks.length+'</strong></div>';
 document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 if(page==="cold")renderCold();else if(page==="reheat")renderReheat();else renderTasks();
}
function renderCold(){
 const latest=new Map();for(const r of data.cold)if(!latest.has(r.room_id))latest.set(r.room_id,r);
 $("content").innerHTML='<div class="card"><h2>Température des chambres froides</h2><p class="muted">Saisissez une mesure réelle. Les seuils sont définis par l’administration.</p><div class="grid">'+
 data.rooms.map(r=>{const l=latest.get(r.id);const threshold=(r.min_c===null?"≤ "+number(r.max_c)+" °C":number(r.min_c)+" à "+number(r.max_c)+" °C");
 return '<div class="card"><h3>'+esc(r.label)+'</h3><div class="details">Seuil paramétré : '+threshold+'</div><p>'+(l?'<strong>'+number(l.temperature_c)+' °C</strong> · '+clock(l.measured_at)+' <span class="pill '+(l.is_alert?"alert":"ok")+'">'+(l.is_alert?"À contrôler":"Conforme au seuil")+'</span>':'Aucun relevé')+'</p><form data-cold="'+esc(r.id)+'"><label>Nouvelle mesure en °C</label><input type="number" required step="0.1" min="-60" max="60" name="temperature_c" inputmode="decimal" placeholder="Ex. 2"><div class="actions"><button class="primary" type="submit">Enregistrer le relevé</button></div></form></div>'}).join("")+'</div></div>'+
 '<div class="card"><h2>Derniers relevés</h2>'+(data.cold.slice(0,12).map(r=>'<div class="data-row"><span>'+clock(r.measured_at)+' · '+esc(data.rooms.find(z=>z.id===r.room_id)?.label||"Chambre")+' · '+number(r.temperature_c)+' °C</span><span class="pill '+(r.is_alert?"alert":"ok")+'">'+(r.is_alert?"Alerte":"Conforme")+'</span></div>').join("")||'<p>Aucun relevé.</p>')+'</div>';
}
function remaining(iso){const n=Math.ceil((new Date(iso).getTime()-Date.now())/1000);if(n<=0)return"Contrôle attendu";return Math.floor(n/60)+" min "+String(n%60).padStart(2,"0")+" s";}
function renderReheat(){
 const open=data.reheats.filter(x=>x.status==="en_cours"),recent=data.reheats.filter(x=>x.status!=="en_cours").slice(0,10);
 $("content").innerHTML='<div class="card"><h2>Nouvelle remise en température</h2><p class="muted">Relever la température de départ à cœur, puis celle de fin. Une alarme de contrôle intervient à 55 minutes lorsque cette page reste ouverte. Deux relevés ne prouvent pas à eux seuls le temps passé entre 10 et 63 °C.</p><form id="startReheat"><div class="grid"><div class="field"><label>Four</label><select name="oven_number" required><option value="1">Four 1</option><option value="2">Four 2</option><option value="3">Four 3</option></select></div><div class="field"><label>Service</label><select name="service_number"><option value="1">Service 1</option><option value="2">Service 2</option></select></div><div class="field"><label>Température avant réchauffe (°C)</label><input name="temperature_c" required type="number" step="0.1" min="-10" max="90" placeholder="Ex. 2"></div></div><button type="submit" class="primary">Démarrer les 55 minutes</button></form></div>'+
 '<div class="card"><h2>Remises en cours</h2><div id="reheatTimers">'+(open.map(r=>'<div class="data-row" data-reheat="'+esc(r.id)+'"><div><strong>Four '+r.oven_number+' · Service '+r.service_number+'</strong><div class="details">Départ : '+clock(r.started_at)+' · '+number(r.start_temperature_c)+' °C</div><div class="clock" data-due="'+esc(r.due_at)+'">'+remaining(r.due_at)+'</div></div><form data-finish="'+esc(r.id)+'"><label>Température finale à cœur (°C)</label><input required type="number" step="0.1" min="-10" max="120" name="temperature_c" placeholder="63 minimum"><button type="submit" class="primary">Terminer et contrôler</button></form></div>').join("")||'<p class="muted">Aucun cycle en cours.</p>')+'</div></div>'+
 '<div class="card"><h2>Historique récent</h2>'+(recent.map(r=>'<div class="data-row"><span>Four '+r.oven_number+' · Service '+r.service_number+' · '+clock(r.started_at)+'<span class="details"> · '+number(r.start_temperature_c)+' → '+number(r.end_temperature_c)+' °C</span></span><span class="pill '+(r.status==="alerte"?"alert":"ok")+'">'+(r.status==="alerte"?"À contrôler":"Température finale atteinte")+'</span></div>').join("")||'<p>Aucune mesure terminée.</p>')+'</div>';
}
function renderTasks(){
 const day=today(),checks=data.checks.filter(t=>t.performed_on===day),done=new Set(checks.map(x=>x.task_id));
 $("content").innerHTML='<div class="card"><h2>Nettoyage quotidien</h2><p class="muted">Validez chaque tâche après exécution réelle. Une tâche attribuée à un agent ne peut pas être validée par un autre.</p>'+
 data.tasks.map(t=>{const c=checks.find(x=>x.task_id===t.id),locked=t.assigned_to&&t.assigned_to!==data.me.id;return '<div class="data-row"><div><strong>'+esc(t.label)+'</strong><div class="details">'+(t.assigned_to?"Responsable : "+esc(staffName(t.assigned_to)):"Tâche commune")+(c?" · "+clock(c.performed_at)+" · "+esc(staffName(c.performed_by)):"")+'</div></div>'+(done.has(t.id)?'<span class="pill ok">Réalisée</span>':'<button type="button" data-task="'+esc(t.id)+'" '+(locked?"disabled":"")+'>Valider la tâche</button>')+'</div>'}).join("")+'</div>';
}
async function save(action,body){if(busy)return;busy=true;document.querySelectorAll("button").forEach(b=>b.disabled=true);try{const r=await request(action,"POST",body);await load();if(r.alert)status("Alerte : relevé enregistré, action corrective à prévoir.",true);else status("Enregistrement horodaté effectué.");}catch(e){status(e.message,true)}finally{busy=false;document.querySelectorAll("button").forEach(b=>{if(!b.hasAttribute("data-task"))b.disabled=false});if(data)render()}}
document.addEventListener("submit",e=>{const form=e.target;if(!(form instanceof HTMLFormElement))return;if(!form.matches("[data-cold],#startReheat,[data-finish]"))return;e.preventDefault();const t=form.elements.namedItem("temperature_c")?.value;if(form.dataset.cold)save("cold-reading",{room_id:form.dataset.cold,temperature_c:t});else if(form.id==="startReheat"){unlockAlarm();save("start-reheat",{oven_number:Number(form.elements.namedItem("oven_number").value),service_number:Number(form.elements.namedItem("service_number").value),temperature_c:t});}else save("finish-reheat",{id:form.dataset.finish,temperature_c:t})});
document.addEventListener("click",e=>{const b=e.target.closest?.("button[data-task]");if(b)save("task-check",{task_id:b.dataset.task})});
$("connect").addEventListener("click",login);$("pin").addEventListener("keydown",e=>{if(e.key==="Enter")login()});$("logout").addEventListener("click",logout);$("refresh").addEventListener("click",load);
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.page;render()}));
let notified=new Set();setInterval(()=>{if(!data||page!=="reheat")return;for(const el of document.querySelectorAll("[data-due]")){const date=el.dataset.due;el.textContent=remaining(date);if(new Date(date).getTime()<=Date.now()&&!notified.has(date)){notified.add(date);status("55 minutes écoulées : contrôlez la température à cœur.",true);soundAlarm();if(navigator.vibrate)navigator.vibrate([200,100,200]);}}},1000);
if(token)load();else staffList();