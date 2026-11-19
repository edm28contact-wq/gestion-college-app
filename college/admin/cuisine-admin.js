"use strict";
(function(){
 const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/kitchen-api";
 const node=id=>document.getElementById(id);
 const e=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const when=v=>v?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"—";
 const t=v=>Number(v).toLocaleString("fr-FR",{maximumFractionDigits:2});
 let snapshot=null,busy=false;
 async function api(action,method="GET",body){
   const token=localStorage.getItem("college_admin_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token")||"";
   const r=await fetch(API+"?action="+encodeURIComponent(action),{method,headers:{"content-type":"application/json","x-admin-session":token},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
   const j=await r.json().catch(()=>({error:"Réponse du service invalide"}));if(!r.ok)throw Error(j.error||"Service indisponible");return j;
 }
 const staff=id=>snapshot?.staff.find(x=>x.id===id)?.name||"Agent";
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
 '<div class="card"><h2>Agents de cuisine</h2><p class="muted">PIN individuel de 6 à 8 chiffres. Ne pas utiliser de PIN partagé.</p><div class="grid"><form id="kitchenAddStaff"><label>Nom de l’agent</label><input name="name" required minlength="2" maxlength="80" placeholder="Nom et prénom"><label>Code PIN</label><input name="pin" required type="password" inputmode="numeric" pattern="[0-9]{6,8}" minlength="6" maxlength="8"><button class="btn primary" type="submit">Créer l’accès</button></form><div><h3>Comptes existants</h3>'+s.staff.map(x=>'<div class="data-row">'+e(x.name)+' · '+(x.active?"Actif":"Désactivé")+'</div>').join("")+'</div></div></div>'+
 '<div class="card"><h2>Chambres froides</h2>'+rows(s.rooms,[["Chambre",x=>e(x.label)],["Type",x=>e(x.room_type)],["Limites",x=>(x.min_c===null?"≤ "+t(x.max_c):t(x.min_c)+" à "+t(x.max_c))+" °C"]])+
 '<h3>Référencer une nouvelle chambre</h3><form id="kitchenAddRoom" class="grid"><div><label>Type</label><select name="room_type"><option value="positive">Positive</option><option value="negative">Négative</option></select></div><div><label>Numéro</label><input required name="room_number" type="number" min="1" max="99"></div><div><label>Désignation</label><input required name="label" maxlength="80"></div><div><label>Minimum (°C, facultatif)</label><input name="min_c" type="number" step="0.1" min="-50" max="40"></div><div><label>Maximum (°C)</label><input required name="max_c" type="number" step="0.1" min="-50" max="40"></div><div><button class="btn primary" type="submit">Ajouter cette chambre</button></div></form></div>'+
 '<div class="card"><h2>Derniers relevés des chambres</h2>'+rows(s.cold.slice(0,35),[["Date / heure",x=>when(x.measured_at)],["Chambre",x=>e(roomname(x.room_id))],["Température",x=>t(x.temperature_c)+" °C"],["Agent",x=>e(staff(x.taken_by))],["Statut",x=>'<span class="pill '+(x.is_alert?"warning":"ok")+'">'+(x.is_alert?"Alerte":"Conforme")+'</span>'],["",x=>x.is_alert?'<button class="btn secondary" data-corrective="chambre_froide" data-id="'+attr(x,"id")+'">Action corrective</button>':""]])+'</div>'+
 '<div class="card"><h2>Remise en température · fours 1, 2 et 3</h2>'+rows(s.reheats.slice(0,40),[["Départ",x=>when(x.started_at)],["Four / Service",x=>x.oven_number+" / "+x.service_number],["Températures",x=>t(x.start_temperature_c)+" → "+(x.end_temperature_c==null?"—":t(x.end_temperature_c))+" °C"],["Échéance 55 min",x=>when(x.due_at)],["Statut",x=>e(x.status)],["",x=>x.status==="alerte"?'<button class="btn secondary" data-corrective="remise_en_temperature" data-id="'+attr(x,"id")+'">Action corrective</button>':""]])+'</div>'+
 '<div class="card"><h2>Tâches de nettoyage</h2>'+rows(s.tasks,[["Tâche",x=>e(x.label)],["Responsable",x=>x.assigned_to?e(staff(x.assigned_to)):"Commune"],["Aujourd’hui",x=>done.has(x.id)?"Réalisée":"Non validée"]])+
 '<h3>Ajouter une tâche</h3><form id="kitchenAddTask" class="grid"><div><label>Libellé</label><input required name="label" maxlength="100"></div><div><label>Responsable</label><select name="assigned_to"><option value="">Commune</option>'+s.staff.filter(x=>x.active).map(x=>'<option value="'+attr(x,"id")+'">'+e(x.name)+'</option>').join("")+'</select></div><div><button class="btn primary" type="submit">Ajouter une tâche</button></div></form></div>'+
 '<div class="card"><h2>Actions correctives enregistrées</h2>'+rows(s.notes.slice(0,30),[["Date",x=>when(x.created_at)],["Type",x=>e(x.entity_type)],["Observation",x=>e(x.note)],["Auteur",x=>e(x.created_by)]])+'</div>';
 node("kitchenReload").addEventListener("click",load);node("kitchenCsv").addEventListener("click",downloadCsv);
 }
 function downloadCsv(){if(!snapshot)return;const lines=[["Type","Date et heure","Équipement","Début °C","Fin °C","Statut","Agent"]];
 for(const x of snapshot.cold)lines.push(["Chambre froide",x.measured_at,snapshot.rooms.find(r=>r.id===x.room_id)?.label||"",x.temperature_c,"",x.is_alert?"Alerte":"Conforme",staff(x.taken_by)]);
 for(const x of snapshot.reheats)lines.push(["Remise en température",x.started_at,"Four "+x.oven_number+" / service "+x.service_number,x.start_temperature_c,x.end_temperature_c??"",x.status,staff(x.started_by)]);
 const csv="\ufeff"+lines.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const link=document.createElement("a"),u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));link.href=u;link.download="cuisine-haccp-"+new Date().toISOString().slice(0,10)+".csv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
 async function load(){try{snapshot=await api("list");render()}catch(err){node("content").innerHTML='<div class="card"><b>Impossible de charger Gestion Cuisine.</b><p class="status err">'+e(err.message)+'</p></div>'}}
 document.addEventListener("submit",evt=>{
 const form=evt.target;if(!(form instanceof HTMLFormElement)||!["kitchenAddStaff","kitchenAddRoom","kitchenAddTask"].includes(form.id))return;evt.preventDefault();
 const f=new FormData(form),values=Object.fromEntries(f.entries());
 if(form.id==="kitchenAddStaff")action("create-staff",{name:values.name,pin:values.pin});
 if(form.id==="kitchenAddRoom")action("add-room",{room_type:values.room_type,room_number:Number(values.room_number),label:values.label,min_c:values.min_c===""?null:Number(values.min_c),max_c:Number(values.max_c)});
 if(form.id==="kitchenAddTask")action("add-task",{label:values.label,assigned_to:values.assigned_to||null});
 });
 document.addEventListener("click",evt=>{const b=evt.target.closest?.("button[data-corrective]");if(!b)return;const note=prompt("Décrivez l’anomalie constatée, les mesures correctives réellement prises et le résultat du nouveau contrôle :");if(note&&note.trim().length>=3)action("corrective",{entity_type:b.dataset.corrective,entity_id:b.dataset.id,note:note.trim()})});
 window.kitchenAdminPage=function(){node("content").innerHTML='<div class="card">Chargement des relevés Cuisine…</div>';load()};
 window.kitchenAdminLoad=load;
})();