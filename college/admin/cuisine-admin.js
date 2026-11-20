"use strict";
(function(){
 const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
 const node=id=>document.getElementById(id);
 const e=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const when=v=>v?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"—";
 const t=v=>Number(v).toLocaleString("fr-FR",{maximumFractionDigits:2});
 let snapshot=null,busy=false,kitchenTab="overview",selectedColdRoom="",coldHistory=[],coldHistoryTotal=0,coldHistoryOffset=0,coldHistoryError="";
 async function api(action,method="GET",body){
   const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
   const r=await fetch(API+"?action="+encodeURIComponent(action),{method,headers:{"content-type":"application/json","x-admin-session":token},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
   const j=await r.json().catch(()=>({error:"Réponse du service invalide"}));if(!r.ok)throw Error(j.error||"Service indisponible");return j;
 }
 const staff=id=>snapshot?.staff.find(x=>x.id===id)?.name||"Agent";
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
  const current=selectedColdRoom;
  try{
   const result=await fetchColdHistoryPage(offset,50,current);
   if(current!==selectedColdRoom)return;
   coldHistory=result.readings;coldHistoryTotal=result.total;coldHistoryOffset=offset;coldHistoryError="";
   if(snapshot&&keepTab)render();
  }catch(err){coldHistoryError=err.message;if(snapshot&&keepTab)render();}
 }
 async function exportColdReadings(format){
  const busyButtons=document.querySelectorAll("[data-admin-cold-export]");
  busyButtons.forEach(b=>b.disabled=true);
  try{
   const label=selectedColdRoom?snapshot.rooms.find(r=>r.id===selectedColdRoom)?.label||"Chambre":"Toutes les chambres";
   const count=await window.CuisineReports[format]({
    fetchPage:(offset,limit)=>fetchColdHistoryPage(offset,limit),
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
 function render(){
 if(!snapshot)return;
 const s=snapshot,alerts=s.cold.filter(x=>x.is_alert).length+s.reheats.filter(x=>x.status==="alerte").length;
 const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const done=new Set(s.checks.filter(x=>x.performed_on===day).map(x=>x.task_id));
 const roomname=id=>s.rooms.find(x=>x.id===id)?.label||"Chambre";
 const rows=(list,columns)=>'<div class="table"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+list.map(x=>'<tr>'+columns.map(c=>'<td>'+c[1](x)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
 node("content").innerHTML='<div class="grid"><div class="card"><div class="muted">Chambres froides</div><div class="kpi">'+s.rooms.length+'</div></div><div class="card"><div class="muted">Cycles en cours</div><div class="kpi">'+s.reheats.filter(x=>x.status==="en_cours").length+'</div></div><div class="card"><div class="muted">Relevés signalés (historique chargé)</div><div class="kpi">'+alerts+'</div></div><div class="card"><div class="muted">Tâches du jour</div><div class="kpi">'+done.size+'/'+s.tasks.length+'</div></div></div>'+
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
 '<div class="grid"><form id="kitchenGoveeKey"><h3>1. Compte Govee</h3><p class="muted">Clé conservée chiffrée côté Supabase Vault, jamais affichée après l’enregistrement.</p><label>Clé API Govee</label><input type="password" name="api_key" required minlength="10" maxlength="240" autocomplete="new-password" placeholder="Coller votre clé Govee Home"><button class="btn primary" type="submit">Tester et enregistrer la clé</button><p class="muted">'+(s.account?.govee_key_configured?'Clé enregistrée — vous pouvez rechercher les capteurs.':'Aucune clé configurée.')+'</p></form>'+
 '<div><h3>2. Rechercher les capteurs</h3><p class="muted">L’API Govee affiche les capteurs compatibles avec votre compte. Un thermomètre Bluetooth seul peut ne pas être détecté.</p><button id="kitchenGoveeDiscover" class="btn secondary" type="button">Rechercher mes capteurs Govee</button><div id="kitchenGoveeDiscovered" class="muted" aria-live="polite">Associez un capteur par chambre froide.</div></div></div>'+
 '<h3>Capteurs associés aux chambres froides</h3>'+
 ((s.connected||[]).filter(d=>d.kind==="cold_room").length?(s.connected||[]).filter(d=>d.kind==="cold_room").map(d=>'<div class="data-row"><div><strong>'+e(d.label)+'</strong><div class="muted">'+e(s.rooms.find(r=>r.id===d.room_id)?.label||"Chambre")+' · '+e(d.model)+' · '+e(d.device_identifier)+'</div><div class="muted">État : '+e(d.status)+' · Dernière synchronisation : '+when(d.last_checked_at)+(d.last_temperature_c==null?'':' · '+t(d.last_temperature_c)+' °C')+(d.last_error?' · '+e(d.last_error):'')+'</div></div><button class="btn secondary" data-govee-sync="'+attr(d,"id")+'" type="button">Lire la température</button></div>').join(""):'<p class="muted">Aucun capteur associé.</p>')+
 '<h3>Pour plus tard : sondes de plats Testo</h3><p class="muted">Le testo 104-IR classique n’est pas une sonde API. Le 104-IR BT transmet à Testo Smart, mais aucune connexion automatique à ce site n’est activée. Il faut continuer à mesurer et saisir manuellement la température à cœur.</p>'+
 '<form id="kitchenProbeRegister" class="grid"><div><label>Désignation de la sonde</label><input name="label" required minlength="2" maxlength="80" placeholder="Ex. Sonde cuisine 1"></div><div><label>Modèle Testo</label><select name="model"><option value="testo 104-IR">testo 104-IR (manuel)</option><option value="testo 104-IR BT">testo 104-IR BT (application Testo Smart)</option></select></div><div><button class="btn secondary" type="submit">Référencer la sonde pour plus tard</button></div></form>'+
 ((s.connected||[]).filter(d=>d.kind==="food_probe").map(d=>'<div class="data-row"><strong>'+e(d.label)+'</strong><span class="muted">'+e(d.model)+' · Connexion au site non disponible</span></div>').join(""))+
 '</div>'+
 '<div class="card"><h2>Derniers relevés des chambres</h2><p class="muted">Choisissez une chambre. Le tableau affiche 50 lignes par page, mais les exports récupèrent l’intégralité de l’historique filtré.</p>'+
 '<div class="grid"><div><label for="adminColdRoomSelector">Chambre froide à consulter</label><select id="adminColdRoomSelector"><option value="">Toutes les chambres</option>'+s.rooms.map(r=>'<option value="'+attr(r,"id")+'" '+(selectedColdRoom===r.id?"selected":"")+'>'+e(r.label)+'</option>').join("")+'</select></div><div><label>Exporter les résultats</label><div class="actions"><button type="button" class="btn secondary" data-admin-cold-export="csv">Exporter CSV</button><button type="button" class="btn secondary" data-admin-cold-export="pdf">Exporter PDF</button></div></div></div>'+
 (coldHistoryError?'<p class="status err">'+e(coldHistoryError)+'</p>':'')+
 '<div class="muted">'+coldHistoryTotal+' relevé(s) trouvé(s) · page '+(Math.floor(coldHistoryOffset/50)+1)+'</div>'+
 rows(coldHistory,[["Date / heure",x=>when(x.measured_at)],["Chambre",x=>e(roomname(x.room_id))],["Température",x=>t(x.temperature_c)+" °C"],["Source",x=>x.source==="govee_cloud"?"Capteur Govee":e(staff(x.taken_by))],["Résultat",x=>'<span class="pill '+(x.is_alert?"warning":"ok")+'">'+(x.is_alert?"Hors seuil":"Dans la plage")+'</span>'],["",x=>x.is_alert?'<button class="btn secondary" data-corrective="chambre_froide" data-id="'+attr(x,"id")+'">Action corrective</button>':""]])+
 '<div class="actions"><button class="btn secondary" type="button" data-admin-cold-page="previous" '+(coldHistoryOffset===0?'disabled':'')+'>Précédent</button><button class="btn secondary" type="button" data-admin-cold-page="next" '+(coldHistoryOffset+50>=coldHistoryTotal?'disabled':'')+'>Suivant</button></div></div>'+
 '<div class="card"><h2>Remises en température · parcours chambre → four</h2>'+rows(s.reheats.slice(0,40),[["Départ",x=>when(x.started_at)],["Parcours",x=>e(x.cold_room_label_snapshot||s.rooms.find(r=>r.id===x.cold_room_id)?.label||"Chambre non renseignée")+" → "+e(x.oven_label_snapshot||s.ovens?.find(r=>r.id===x.oven_id)?.label||("Four "+x.oven_number))],["Type de plat",x=>e(x.dish_type_label_snapshot||s.dishes?.find(d=>d.id===x.dish_type_id)?.label||"Non renseigné")],["Évolution",x=>t(x.start_temperature_c)+" → "+(x.end_temperature_c==null?"—":t(x.end_temperature_c))+" °C"+(x.end_temperature_c==null?"":" (+"+t(Number(x.end_temperature_c)-Number(x.start_temperature_c))+" °C)")],["Rappel",x=>when(x.due_at)],["Évaluation",x=>x.status==="alerte"?"Température hors cible":x.status==="en_cours"?"En cours":"Température cible atteinte"],["Rappel",x=>x.ended_at&&new Date(x.ended_at)>new Date(x.due_at)?"Relevé après le rappel":"Dans le délai du rappel"],["",x=>x.status==="alerte"?'<button class="btn secondary" data-corrective="remise_en_temperature" data-id="'+attr(x,"id")+'">Action corrective</button>':""]])+'</div>'+
 '<div class="card"><h2>Tâches de nettoyage</h2>'+rows(s.tasks,[["Tâche",x=>e(x.label)],["Responsable",x=>x.assigned_to?e(staff(x.assigned_to)):"Commune"],["Aujourd’hui",x=>done.has(x.id)?"Réalisée":"Non validée"]])+
 '<h3>Ajouter une tâche</h3><form id="kitchenAddTask" class="grid"><div><label>Libellé</label><input required name="label" maxlength="100"></div><div><label>Responsable</label><select name="assigned_to"><option value="">Commune</option>'+s.staff.filter(x=>x.active).map(x=>'<option value="'+attr(x,"id")+'">'+e(x.name)+'</option>').join("")+'</select></div><div><button class="btn primary" type="submit">Ajouter une tâche</button></div></form></div>'+
 '<div class="card"><h2>Actions correctives enregistrées</h2>'+rows(s.notes.slice(0,30),[["Date",x=>when(x.created_at)],["Type",x=>e(x.entity_type)],["Observation",x=>e(x.note)],["Auteur",x=>e(x.created_by)]])+'</div>';
 
 const content=node("content"),all=Array.from(content.children),tabs=[
  ["overview","Vue d’ensemble"],["records","Relevés et alertes"],["equipment","Équipements et valeurs"],["staff","Équipe et nettoyage"]
 ];
 if(!node("kitchen-organized-styles")){
   const css=document.createElement("style");css.id="kitchen-organized-styles";
   css.textContent="#kitchen-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:13px 0 18px}#kitchen-tabs button{border:1px solid #d3dce3;border-radius:9px;padding:11px 15px;font-weight:750;background:#f1f4f6;color:#334657;cursor:pointer}#kitchen-tabs button.active{background:#243447;color:white;border-color:#243447}#content .kitchen-panel[hidden]{display:none!important}#content .kitchen-panel .grid{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}#content .kitchen-panel form{margin:10px 0 14px}#content .kitchen-panel form label{display:block;font-size:12px;font-weight:700;margin-bottom:7px}#content .kitchen-panel .card{padding:18px}#content .kitchen-panel h2{margin:0 0 9px}#content .kitchen-panel h3{margin:17px 0 9px}#content .kitchen-panel .data-row{padding:11px 0;border-bottom:1px solid #e7edf0}#content .kitchen-panel .data-row:last-child{border:0}#content .kitchen-panel .btn{margin-top:4px}#content .kitchen-section-intro{padding:18px 20px;border:1px solid #dbe4ea;border-radius:12px;background:#f5f8fa;margin-bottom:14px}#content .kitchen-section-intro h2{margin:0 0 5px}#content .kitchen-section-intro p{margin:0;color:#5d6d79;font-size:13px}#content .kitchen-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}#content .kitchen-overview-grid>div{padding:17px;background:#fff;border:1px solid #dce4e9;border-radius:12px}#content .kitchen-overview-grid strong{display:block;font-size:27px;margin:5px 0;color:#243447}#content .kitchen-overview-grid small{color:#607182}#content #kitchen-tabs{position:relative}";
   document.head.append(css);
 }
 const groups={overview:[],records:[],equipment:[],staff:[]};
 for(const el of all){
   if(el.id==="kitchen-tabs")continue;
   const heading=el.querySelector?.("h2")?.textContent||"";
   if(heading.startsWith("Gestion Cuisine"))groups.overview.push(el);
   else if(heading.startsWith("Agents de cuisine")||heading.startsWith("Tâches de nettoyage"))groups.staff.push(el);
   else if(heading.startsWith("Chambres froides")||heading.startsWith("Fours")||heading.startsWith("Types de plats")||heading.startsWith("Valeurs par défaut")||heading.startsWith("Thermomètres connectés"))groups.equipment.push(el);
   else if(heading.startsWith("Derniers relevés")||heading.startsWith("Remises en température")||heading.startsWith("Actions correctives"))groups.records.push(el);
   else groups.overview.push(el);
 }
 const header=document.createElement("div");header.id="kitchen-tabs";header.setAttribute("role","tablist");header.setAttribute("aria-label","Rubriques Gestion Cuisine");
 for(const [key,label] of tabs){
   const b=document.createElement("button");b.type="button";b.dataset.kitchenTab=key;b.textContent=label;b.setAttribute("role","tab");b.addEventListener("click",()=>{kitchenTab=key;selectTab()});header.append(b);
 }
 content.prepend(header);
 const intros={overview:["Tableau de bord","Vue rapide sur les contrôles et les tâches du jour."],records:["Historique et anomalies","Températures réellement enregistrées, résultats des remises en température et actions correctives."],equipment:["Configuration des équipements","Nommez vos chambres, fours, plats et définissez les valeurs utilisées par défaut."],staff:["Équipe de cuisine","Gérez les codes personnels MEDJEBER / MOREL et les tâches quotidiennes."]};
 const panels={};
 for(const [key] of tabs){
   const wrapper=document.createElement("section");wrapper.className="kitchen-panel";wrapper.dataset.panel=key;wrapper.setAttribute("role","tabpanel");
   const intro=document.createElement("div");intro.className="kitchen-section-intro";const h=document.createElement("h2");h.textContent=intros[key][0];const p=document.createElement("p");p.textContent=intros[key][1];intro.append(h,p);wrapper.append(intro);
   if(key==="overview"){
     const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
     const done=new Set(s.checks.filter(x=>x.performed_on===day).map(x=>x.task_id));
     const active=s.reheats.filter(x=>x.status==="en_cours");
     const todayCold=s.cold.filter(x=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(x.measured_at))===day);
     const summary=document.createElement("div");summary.className="kitchen-overview-grid";summary.innerHTML=
       '<div><small>Chambres relevées aujourd’hui</small><strong>'+new Set(todayCold.map(x=>x.room_id)).size+' / '+s.rooms.length+'</strong></div>'+
       '<div><small>Réchauffages en cours</small><strong>'+active.length+'</strong></div>'+
       '<div><small>Nettoyage terminé aujourd’hui</small><strong>'+done.size+' / '+s.tasks.length+'</strong></div>'+
       '<div><small>Alertes (historique chargé)</small><strong>'+alerts+'</strong></div>';
     wrapper.append(summary);
     const tip=document.createElement("div");tip.className="card";tip.style.marginTop="16px";tip.innerHTML='<h3>Utilisation quotidienne</h3><p>Les agents travaillent dans l’espace Cuisine. Ici, vous vérifiez les relevés, contrôlez les anomalies et adaptez les équipements ou tâches.</p>';wrapper.append(tip);
   }
   for(const el of groups[key])wrapper.append(el);
   content.append(wrapper);panels[key]=wrapper;
 }
 function selectTab(){
   for(const [key]of tabs)panels[key].hidden=key!==kitchenTab;
   header.querySelectorAll("button").forEach(b=>{const active=b.dataset.kitchenTab===kitchenTab;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active))});
 }
 selectTab();
 node("kitchenReload").addEventListener("click",load);node("kitchenCsv").addEventListener("click",downloadCsv);
 }
 function downloadCsv(){if(!snapshot)return;const lines=[["Type","Date et heure","Équipement","Début °C","Fin °C","Statut","Agent"]];
 for(const x of snapshot.cold)lines.push(["Chambre froide",x.measured_at,snapshot.rooms.find(r=>r.id===x.room_id)?.label||"",x.temperature_c,"",x.is_alert?"Alerte":"Conforme",x.source==="govee_cloud"?"Capteur Govee":staff(x.taken_by)]);
 for(const x of snapshot.reheats)lines.push(["Remise en température",x.started_at,(x.cold_room_label_snapshot||"Chambre non renseignée")+" → "+(x.oven_label_snapshot||("Four "+x.oven_number))+" · "+(x.dish_type_label_snapshot||"Plat non renseigné"),x.start_temperature_c,x.end_temperature_c??"",x.status,staff(x.started_by)]);
 const csv="\ufeff"+lines.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const link=document.createElement("a"),u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));link.href=u;link.download="cuisine-haccp-"+new Date().toISOString().slice(0,10)+".csv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
 async function load(){try{snapshot=await api("list");await refreshColdHistory(coldHistoryOffset,false);render()}catch(err){node("content").innerHTML='<div class="card"><b>Impossible de charger Gestion Cuisine.</b><p class="status err">'+e(err.message)+'</p></div>'}}

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
 const form=evt.target;if(!(form instanceof HTMLFormElement)||!["kitchenAddRoom","kitchenAddTask","kitchenAddOven","kitchenAddDish","kitchenSaveDefaults","kitchenGoveeKey","kitchenProbeRegister"].includes(form.id)&&!form.matches("[data-kitchen-pin],[data-room-edit],[data-oven-edit],[data-dish-edit],[data-govee-associate]"))return;evt.preventDefault();
 const f=new FormData(form),values=Object.fromEntries(f.entries());
 if(form.matches("[data-govee-associate]")){action("govee-add-sensor",{device:form.dataset.goveeAssociate,sku:form.dataset.sku,room_id:values.room_id,raw_unit:values.raw_unit});return;}
 if(form.matches("[data-kitchen-pin]"))action("set-staff-pin",{staff_id:form.dataset.kitchenPin,pin:values.pin});
 if(form.id==="kitchenAddRoom")action("add-room",{room_type:values.room_type,room_number:Number(values.room_number),label:values.label,min_c:values.min_c===""?null:Number(values.min_c),max_c:Number(values.max_c)});
 if(form.matches("[data-room-edit]"))action("update-room",{id:form.dataset.roomEdit,label:values.label,min_c:values.min_c===""?null:Number(values.min_c),max_c:Number(values.max_c)});
 if(form.id==="kitchenAddOven")action("add-oven",{oven_number:Number(values.oven_number),label:values.label});
 if(form.matches("[data-oven-edit]"))action("update-oven",{id:form.dataset.ovenEdit,label:values.label});
 if(form.id==="kitchenAddDish")action("add-dish-type",{label:values.label});
 if(form.matches("[data-dish-edit]"))action("update-dish-type",{id:form.dataset.dishEdit,label:values.label});
 if(form.id==="kitchenSaveDefaults")action("save-defaults",{default_cold_room_id:values.default_cold_room_id,default_oven_id:values.default_oven_id,default_dish_type_id:values.default_dish_type_id,target_start_c:Number(values.target_start_c),target_end_c:Number(values.target_end_c),reminder_minutes:Number(values.reminder_minutes)});
 if(form.id==="kitchenAddTask")action("add-task",{label:values.label,assigned_to:values.assigned_to||null});
 if(form.id==="kitchenGoveeKey")action("govee-save-key",{api_key:String(values.api_key||"")});
 if(form.id==="kitchenProbeRegister")action("probe-register",{label:values.label,model:values.model});
 });
 document.addEventListener("click",async evt=>{
 const discover=evt.target.closest?.("#kitchenGoveeDiscover");
 if(discover){
  const output=node("kitchenGoveeDiscovered");if(!output)return;
  discover.disabled=true;output.textContent="Recherche des appareils Govee…";
  try{
   const result=await api("govee-discover");
   const supported=result.devices.filter(d=>d.temperature_capability);
   if(!supported.length){output.textContent="Aucun capteur exposant sensorTemperature dans l’API Govee. Vérifiez votre modèle et la connexion Wi-Fi.";return;}
   output.innerHTML=supported.map(d=>'<form class="grid" data-govee-associate="'+e(d.device)+'" data-sku="'+e(d.sku)+'"><div><strong>'+e(d.label)+'</strong><p class="muted">'+e(d.sku)+'</p></div><div><label>Chambre froide</label><select name="room_id" required>'+snapshot.rooms.filter(r=>!r.archived_at&&!r.deleted_at).map(r=>'<option value="'+e(r.id)+'">'+e(r.label)+'</option>').join("")+'</select></div><div><label>Unité RENVOYÉE par Govee</label><select name="raw_unit" required><option value="">Choisir l’unité du capteur</option><option value="C">Celsius (°C)</option><option value="F">Fahrenheit (°F)</option></select></div><div><button class="btn primary" type="submit">Associer ce capteur</button></div></form>').join("");
  }catch(err){output.textContent=err.message;}finally{discover.disabled=false}
 }
 const sync=evt.target.closest?.("button[data-govee-sync]");
 if(sync)action("govee-sync",{id:sync.dataset.goveeSync});
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
 document.addEventListener("click",evt=>{const b=evt.target.closest?.("button[data-corrective]");if(!b)return;const note=prompt("Décrivez l’anomalie constatée, les mesures correctives réellement prises et le résultat du nouveau contrôle :");if(note&&note.trim().length>=3)action("corrective",{entity_type:b.dataset.corrective,entity_id:b.dataset.id,note:note.trim()})});
 window.kitchenAdminPage=function(){node("content").innerHTML='<div class="card">Chargement des relevés Cuisine…</div>';load()};
 window.kitchenAdminLoad=load;
})();