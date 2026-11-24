"use strict";
(function(){
 const e=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const when=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}):"—";
 const localNow=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
 const results={recorded:"Contrôle déclaré · enregistré",within_limits:"Limites mesurées respectées",alert:"Écart à traiter",review:"À vérifier"};
 const states={pending:"À définir",yes:"Applicable · paramétré",no:"Non applicable · justifié"};
 const input=(n,v="")=>'<input name="'+e(n)+'" maxlength="500" value="'+e(v)+'">';
 const options=(choices,selected="")=>choices.map(([k,v])=>'<option value="'+e(k)+'" '+(k===selected?'selected':'')+'>'+e(v)+'</option>').join("");
 function field(f){const n=e(f.key),l=e(f.label),wrap=inner=>'<label'+(f.type==="textarea"?' class="pms-wide"':'')+'>'+l+inner+'</label>';
  if(f.type==="check"||f.type==="select")return wrap('<select name="'+n+'" required><option value="">Choisir</option>'+options(f.type==="check"?[["true","Oui, vérifié"],["false","Non / non vérifié"]]:f.options.map(v=>[v,v]))+'</select>');
  if(f.type==="textarea")return wrap('<textarea name="'+n+'" required maxlength="4000" rows="3"></textarea>');
  if(f.type==="number")return wrap('<input name="'+n+'" type="number" required step="0.01" min="'+f.min+'" max="'+f.max+'">');
  if(f.type==="datetime"||f.type==="date")return wrap('<input name="'+n+'" type="'+(f.type==="datetime"?"datetime-local":"date")+'" required>');
  return wrap('<input name="'+n+'" required maxlength="500">');
 }
 function download(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
 const csvCell=v=>{let s=typeof v==="object"&&v!==null?JSON.stringify(v):String(v??"");if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 function mount(root,{api,get,role,canWrite}){
  if(!root||root.dataset.pmsMounted)return;root.dataset.pmsMounted="1";
  const manage=role==="admin";
  root.innerHTML='<section class="card pms-card"><h2>Plan de maîtrise sanitaire · HACCP</h2><p>Registre des procédures, contrôles et preuves. Aucun score de conformité automatique : adaptez le PMS à l’activité réelle et faites vérifier son application.</p><div class="pms-actions">'+[["plan","Plan sanitaire"],["record","Saisir un contrôle"],["alerts","Écarts à traiter"],["history","Historique et export"]].map(([k,v])=>'<button type="button" class="btn secondary" data-pms-tab="'+k+'">'+v+'</button>').join("")+'</div><p class="pms-msg" role="status" aria-live="polite"></p><div data-pms-body></div></section>';
  const dest=root.querySelector("[data-pms-body]"),msg=root.querySelector(".pms-msg");let data=null,busy=false,tab=manage?"plan":"record",code="",offset=0,filter="",requestId="",historyEpoch=0;
  const find=k=>data.plan.find(p=>p.code===k),title=k=>find(k)?.title||k;
  const selector=(selected,all=false)=>'<option value="">'+(all?"Toutes les rubriques":"Choisir une rubrique")+'</option>'+options(data.plan.map(p=>[p.code,p.title]),selected);
  const reasons=r=>(r.reasons||[]).length?'<p class="pms-warn">'+e(r.reasons.join(" · "))+'</p>':"";
  const summary=r=>'<strong>'+e(title(r.code))+'</strong><span class="pms-pill">'+e(results[r.result]||"Dossier à vérifier")+'</span><p>'+when(r.observed_at)+' · '+e(r.actor_name)+'</p>'+reasons(r)+'<p>Action immédiate : '+e(r.corrective_action||"—")+'</p>';
  const followupButton=r=>'<button type="button" class="btn secondary" data-pms-followups="'+e(r.id)+'">Voir le suivi</button><div data-followup-list="'+e(r.id)+'"></div>';
  function plan(){
   return '<p>'+data.plan.filter(p=>p.applicable==="yes").length+' rubriques paramétrées · '+data.plan.filter(p=>p.applicable==="no").length+' non applicables justifiées · '+data.plan.filter(p=>p.applicable==="pending").length+' à définir.</p>'+[...new Set(data.plan.map(p=>p.category))].map(c=>'<h3>'+e(c)+'</h3>'+data.plan.filter(p=>p.category===c).map(p=>'<details class="pms-entry"><summary><strong>'+e(p.title)+'</strong><span class="pms-pill">'+e(states[p.applicable])+'</span></summary><p>'+e(data.specs[p.code]?.instruction||"")+'</p><p>Responsable : '+e(p.responsible||"à définir")+' · Fréquence : '+e(p.frequency||"à définir")+' · Revue : '+e(p.next_review||"à définir")+(p.next_review&&p.next_review<today()?' · Revue échue':'')+'</p><p>Procédure : '+e(p.procedure_ref||"—")+' · Justification : '+e(p.justification||"—")+'</p>'+
   (manage?'<form data-pms-plan="'+e(p.code)+'" data-revision="'+p.revision+'" class="pms-fields"><label>Applicabilité<select name="applicable">'+options(Object.entries(states),p.applicable)+'</select></label><label>Responsable'+input("responsible",p.responsible)+'</label><label>Référence de procédure'+input("procedure_ref",p.procedure_ref)+'</label><label>Fréquence / déclencheur'+input("frequency",p.frequency)+'</label><label>Prochaine revue<input name="next_review" type="date" value="'+e(p.next_review||"")+'"></label><label class="pms-wide">Justification / analyse des dangers<textarea name="justification" maxlength="4000">'+e(p.justification)+'</textarea></label><button class="btn primary" type="submit">Enregistrer la révision</button></form>':'')+'</details>').join("")).join("");
  }
  function record(){
   const spec=data.specs[code];
   return '<label>Type de contrôle<select data-pms-code>'+selector(code)+'</select></label>'+(!canWrite?'<p>Consultation uniquement.</p>':!spec?'<p>Sélectionnez une rubrique.</p>':'<p>'+e(spec.instruction)+'</p><p>Procédure : '+e(find(code).procedure_ref||"non paramétrée · contrôle à vérifier")+'</p><form data-pms-record class="pms-fields"><label>Heure réelle du contrôle (heure locale)<input name="observed_at" type="datetime-local" required value="'+localNow()+'"></label>'+spec.fields.map(field).join("")+'<label class="pms-wide">Action immédiate en cas d’écart (isoler, prévenir, etc.)<textarea name="corrective_action" maxlength="4000" rows="3"></textarea></label><label class="pms-wide">Référence de preuve conservée (facultatif)'+input("evidence_ref")+'</label><button class="btn primary" type="submit">Enregistrer le contrôle</button></form>');
  }
  function alerts(){
   return '<p>'+data.alerts.length+' dossier(s) à traiter. Prévenez immédiatement le responsable en cas de risque sanitaire. La clôture conserve le constat d’origine.</p>'+(data.alerts.length?data.alerts.map(r=>'<article class="pms-entry">'+summary(r)+followupButton(r)+(canWrite?'<form class="pms-fields" data-pms-followup="'+e(r.id)+'"><label>Action<select name="operation"><option value="followup">Ajouter un suivi</option>'+(manage?'<option value="closed">Clôturer après vérification</option>':'')+'</select></label><label>Preuve (obligatoire à la clôture)'+input("evidence_ref")+'</label><label class="pms-wide">Mesure corrective / vérification<textarea name="note" minlength="3" maxlength="4000" required></textarea></label><button type="submit" class="btn primary">Enregistrer le suivi</button></form>':'')+'</article>').join(""):'<p>Aucun dossier ouvert dans ce registre. Cela ne démontre pas la conformité sanitaire de l’établissement.</p>');
  }
  async function history(){
   const epoch=++historyEpoch;const r=await get("pms-history",{offset:String(offset),code:filter});const holder=dest.querySelector("[data-history-results]");if(!holder||epoch!==historyEpoch)return;
   holder.innerHTML='<p>'+r.total+' contrôles · '+(r.records.length?offset+1:0)+'–'+(offset+r.records.length)+'</p>'+r.records.map(x=>'<article class="pms-entry">'+summary(x)+'<details><summary>Données et preuves</summary><dl class="pms-details">'+Object.entries(x.payload||{}).map(([k,v])=>'<div><dt>'+e(data.specs[x.code]?.fields.find(f=>f.key===k)?.label||k)+'</dt><dd>'+e(typeof v==="boolean"?(v?"Oui":"Non"):v)+'</dd></div>').join("")+'</dl><p>Justificatif : '+e(x.evidence_ref||"—")+' · Révision PMS : '+e(x.plan_revision)+' · Saisie : '+when(x.recorded_at)+'</p>'+(x.payload?.keep_until?'<p>Conservation minimale jusqu’au '+when(x.payload.keep_until)+'</p>':'')+'</details>'+((x.result==="alert"||x.result==="review")?followupButton(x):"")+'</article>').join("")+'<div class="pms-actions"><button class="btn secondary" data-pms-page="-1" '+(!offset?'disabled':'')+'>Précédent</button><button class="btn secondary" data-pms-page="1" '+(!r.has_more?'disabled':'')+'>Suivant</button></div>';
  }
  function render(){
   if(!root.isConnected||!data)return;
   historyEpoch++;root.querySelectorAll("[data-pms-tab]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.pmsTab===tab)));
   dest.innerHTML=tab==="plan"?plan():tab==="record"?record():tab==="alerts"?alerts():'<div class="pms-actions"><label>Rubrique<select data-pms-filter>'+selector(filter,true)+'</select></label><button class="btn secondary" data-pms-export>Exporter les contrôles filtrés (CSV)</button><button class="btn secondary" data-pms-export-plan>Exporter le PMS (JSON)</button></div><div data-history-results>Chargement…</div>';
   if(tab==="history")history().catch(err=>{msg.textContent=err.message;});
  }
  async function run(action,body,success){
   if(busy)return;busy=true;msg.textContent="Chargement…";
   try{const r=action?await api(action,"POST",body):null;data=await get("pms-overview");render();msg.textContent=success?success(r):"État actualisé.";}
   catch(err){msg.textContent=err.message||"Opération impossible.";}
   finally{busy=false;}
  }
  root.addEventListener("change",ev=>{const t=ev.target;if(t.matches("[data-pms-code]")){code=t.value;requestId=crypto.randomUUID();render();}if(t.matches("[data-pms-filter]")){filter=t.value;offset=0;history().catch(err=>{msg.textContent=err.message;});}});
  root.addEventListener("submit",ev=>{
   const f=ev.target;if(!f.matches("[data-pms-plan],[data-pms-record],[data-pms-followup]"))return;ev.preventDefault();if(!canWrite||busy)return;
   const v=Object.fromEntries(new FormData(f).entries());
   if(f.matches("[data-pms-plan]")){if(manage)run("pms-plan-save",{code:f.dataset.pmsPlan,revision:Number(f.dataset.revision),config:v});return;}
   if(f.matches("[data-pms-followup]")){if(v.operation==="closed"&&!confirm("Confirmez-vous avoir vérifié l’efficacité de la mesure corrective ?"))return;run("pms-followup",{id:f.dataset.pmsFollowup,...v});return;}
   try{
    const spec=data.specs[code],payload={};if(!spec)return;
    for(const k of spec.fields){const x=v[k.key];payload[k.key]=k.type==="check"?x==="true":k.type==="number"?Number(x):k.type==="datetime"?new Date(x).toISOString():x;}
    if(!requestId)requestId=crypto.randomUUID();
    run("pms-record",{code,payload,observed_at:new Date(v.observed_at).toISOString(),request_id:requestId,corrective_action:v.corrective_action,evidence_ref:v.evidence_ref},r=>{requestId=crypto.randomUUID();return "Contrôle enregistré : "+(results[r.record?.result]||"voir historique")+(r.record?.reasons?.length?" · "+r.record.reasons.join(" · "):"");});
   }catch{msg.textContent="Date ou mesure invalide.";}
  });
  root.addEventListener("click",async ev=>{const b=ev.target.closest("button");if(!b||busy||!data)return;
   if(b.dataset.pmsTab){tab=b.dataset.pmsTab;render();return;}
   if(b.dataset.pmsPage){offset=Math.max(0,offset+100*Number(b.dataset.pmsPage));try{await history();}catch(err){msg.textContent=err.message;}return;}
   if(b.dataset.pmsFollowups){try{const r=await get("pms-followups",{id:b.dataset.pmsFollowups});const holder=root.querySelector('[data-followup-list="'+b.dataset.pmsFollowups+'"]');if(holder)holder.innerHTML=(r.followups||[]).map(x=>'<p>'+when(x.recorded_at)+' · '+e(x.actor_name)+' · '+e(x.action)+' : '+e(x.note)+' · Preuve : '+e(x.evidence_ref||"—")+'</p>').join("")||'<p>Aucun suivi enregistré.</p>';}catch(err){msg.textContent=err.message;}return;}
   if(b.hasAttribute("data-pms-export-plan")){download("pms-plan-"+today()+".json",JSON.stringify({exported_at:new Date().toISOString(),plan:data.plan,open_alerts:data.alerts},null,2),"application/json");return;}
   if(b.hasAttribute("data-pms-export")){busy=true;msg.textContent="Préparation de l’export…";try{const all=[];for(let n=0;n<=1000000;n+=100){const r=await get("pms-history",{offset:String(n),code:filter});all.push(...r.records);if(!r.has_more)break;if(n===1000000)throw Error("Export trop volumineux");}const heads=["id","code","observed_at","recorded_at","actor_name","plan_revision","result","reasons","payload","corrective_action","evidence_ref","next_due"];download("pms-controles-"+today()+".csv","\ufeff"+[heads.map(csvCell).join(";"),...all.map(r=>heads.map(k=>csvCell(r[k])).join(";"))].join("\r\n"),"text/csv;charset=utf-8");msg.textContent=all.length+" contrôles exportés.";}catch(err){msg.textContent=err.message;}finally{busy=false;}}
  });
  run(null,null);
 }
 window.KitchenPMS={mount};
})();
