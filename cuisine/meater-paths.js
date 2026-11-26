"use strict";
(function(){
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const num=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
 const temp=v=>num(v)===null?"—":num(v).toLocaleString("fr-FR",{maximumFractionDigits:2})+" °C";
 const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"medium"}):"—";
 const active=r=>["armed","running"].includes(r?.status);
 const labels={armed:"Surveillance rapide · attente sous 10 °C",running:"Chronomètre en cours",target:"Cible technique atteinte",expired:"Délai dépassé",cancelled:"Annulé"};
 function countdown(r,now){
  if(r.status==="armed")return "En attente";
  if(!r.deadline_at)return "—";
  const end=r.finished_at?Date.parse(r.finished_at):now;
  const secs=Math.max(0,Math.ceil((Date.parse(r.deadline_at)-end)/1000));
  return String(Math.floor(secs/60)).padStart(2,"0")+":"+String(secs%60).padStart(2,"0");
 }
 function chart(r,rows){
  const start=Date.parse(r.started_at||"");
  if(!Number.isFinite(start)||!rows.length)return '<p class="muted">Le graphique démarre avec la première mesure sous 10 °C.</p>';
  const points=rows.map(v=>({t:Date.parse(v.measured_at),c:num(v.internal_c),a:num(v.ambient_c),event:v.event})).filter(v=>Number.isFinite(v.t)&&v.c!==null&&v.t>=start&&v.t<=start+3600000).sort((a,b)=>a.t-b.t);
  if(!points.length)return '<p class="muted">Aucune mesure enregistrée.</p>';
  const values=[...points.flatMap(v=>[v.c,v.a].filter(x=>x!==null)),...[r.trigger_c,r.cold_c,r.hot_c].map(num).filter(v=>v!==null)];
  const lo=Math.min(0,Math.floor(Math.min(...values)/10)*10),hi=Math.max(75,Math.ceil(Math.max(...values)/10)*10);
  const X=v=>50+720*Math.max(0,Math.min(1,(v-start)/3600000)),Y=v=>220-190*(v-lo)/(hi-lo);
  const series=(key,kind)=>{
   let d="",last=null;const dots=[];
   for(const p of points){
    if(p[key]===null){last=null;continue;}
    const x=X(p.t).toFixed(1),y=Y(p[key]).toFixed(1);
    d+=(last!==null&&p.t-last<=30000?" L":" M")+x+" "+y;last=p.t;
    dots.push('<circle class="meater-graph-dot '+kind+'" cx="'+x+'" cy="'+y+'" r="2.5"><title>'+esc(time(new Date(p.t).toISOString())+" · "+temp(p[key]))+'</title></circle>');
   }
   return '<path class="meater-graph-line '+kind+'" d="'+d+'"/>'+dots.join("");
  };
  let grid="";
  for(let i=0;i<=5;i++){const v=lo+(hi-lo)*i/5,y=Y(v);grid+='<path class="meater-graph-gridline" d="M50 '+y+' H770"/><text class="meater-graph-axis" x="43" y="'+(y+4)+'" text-anchor="end">'+Math.round(v)+'</text>';}
  for(let i=0;i<=4;i++){const x=50+180*i;grid+='<path class="meater-graph-gridline" d="M'+x+' 30 V220"/><text class="meater-graph-axis" x="'+x+'" y="241" text-anchor="middle">'+(15*i)+' min</text>';}
  const marker=(v,at,label)=>num(v)===null||!at||!Number.isFinite(Date.parse(at))?"":'<circle cx="'+X(Date.parse(at))+'" cy="'+Y(num(v))+'" r="6" fill="none" stroke="#243447" stroke-width="1.7"><title>'+esc(label+" : "+temp(v)+" · "+time(at))+'</title></circle>';
  return '<div class="meater-graph-legend"><span class="meater-graph-key meater-graph-core">À cœur</span><span class="meater-graph-key meater-graph-ambient">Ambiante</span></div><svg class="meater-graph-svg" viewBox="0 0 795 255" role="img" aria-label="Parcours mesuré, de zéro à soixante minutes">'+grid+'<path stroke="#a06313" stroke-dasharray="6 4" d="M50 '+Y(65)+' H770"/><text class="meater-graph-axis" x="765" y="'+(Y(65)-5)+'" text-anchor="end">65 °C</text>'+series("c","meater-graph-core")+series("a","meater-graph-ambient")+marker(r.trigger_c,r.started_at,"Déclenchement")+marker(r.cold_c,r.cold_at,"Proche de 3 °C")+marker(r.hot_c,r.hot_at,"Proche de 65 °C")+'</svg><p class="muted">Points réels uniquement ; les interruptions de plus de 30 s ne sont pas reliées.</p>';
 }
 function mount(root,api){
  if(!root)return;
  if(root.meaterPathRefresh){void root.meaterPathRefresh();return;}
  root.innerHTML='<section class="card"><h2>Parcours automatiques MEATER</h2><p><strong>Essai technique, hors registre HACCP.</strong> Retirez la sonde, nettoyez-la, puis cliquez sur « Décrocher / réarmer ». Le serveur surveille la première nouvelle mesure sous 10 °C et lance une heure. Aucun résultat ne valide automatiquement un plat.</p><p data-path-service class="muted"></p><p data-path-feedback role="status"></p><div data-path-probes></div><h3>Historique récent</h3><div data-path-history></div><section data-path-detail></section></section>';
  const service=root.querySelector("[data-path-service]"),feedback=root.querySelector("[data-path-feedback]"),probes=root.querySelector("[data-path-probes]"),history=root.querySelector("[data-path-history]"),detail=root.querySelector("[data-path-detail]");
  let state=null,selected=null,samples=[],loadedKey="",pending=false,busy=false,timer=null,clockTimer=null,serverOffset=0,historyError="",revision=0;
  const visible=()=>root.isConnected&&!document.hidden&&!root.closest("[hidden],.hide");
  const serverNow=()=>Date.now()+serverOffset;
  function clock(){
   if(!root.isConnected){clearInterval(clockTimer);return;}
   for(const tile of probes.querySelectorAll("[data-path-timer]")){const p=state?.paths.find(v=>v.id===tile.dataset.pathTimer);if(p)tile.textContent=countdown(p,serverNow());}
   const r=state?.paths.find(v=>v.id===selected);
   if(!r)return;
   const el=detail.querySelector("[data-path-countdown]");if(el)el.textContent=countdown(r,serverNow());
   const warn=detail.querySelector("[data-path-deadline]");if(warn)warn.textContent=r.status==="running"&&serverNow()>=Date.parse(r.deadline_at)?"Délai dépassé : contrôler le plat et vérifier la connexion.":"";
  }
  function drawDetail(){
   const r=state?.paths.find(v=>v.id===selected);
   if(!r){detail.innerHTML='<p class="muted">Sélectionnez un parcours pour afficher le chronomètre, les températures et le graphique.</p>';return;}
   const last=r.last_measure_at&&serverNow()-Date.parse(r.last_measure_at)<=120000&&!state.last_error;
   const metrics=[["Température de déclenchement",temp(r.trigger_c),time(r.started_at)],["Mesure la plus proche de 3 °C",temp(r.cold_c),time(r.cold_at)],["Mesure la plus proche de 65 °C",temp(r.hot_c),time(r.hot_at)],["Franchissement réel de 65 °C",temp(r.reached_c),r.status==="target"?time(r.finished_at):"Non confirmé"]];
   detail.innerHTML='<div class="meater-device"><h3>'+esc(r.label)+' · '+esc(labels[r.status]||r.status)+'</h3><div class="meater-graph-summary"><span>Temps restant <strong data-path-countdown>'+esc(countdown(r,serverNow()))+'</strong></span><span>Dernière mesure <strong>'+esc(temp(r.last_c))+'</strong></span><span>'+esc(time(r.last_measure_at))+(last?"":" · fraîcheur non confirmée")+'</span></div><p class="meater-error" role="alert" data-path-deadline></p>'+(r.reason?'<p class="meater-error">'+esc(r.reason)+'</p>':'')+'<div class="meater-grid">'+metrics.map(m=>'<div class="meater-tile"><small>'+esc(m[0])+'</small><strong>'+esc(m[1])+'</strong><small>'+esc(m[2])+'</small></div>').join("")+'</div>'+(historyError?'<p class="meater-error">'+esc(historyError)+'</p>':chart(r,samples))+'<h4>Relevés enregistrés · '+samples.length+'</h4><div style="max-height:340px;overflow:auto"><table style="width:100%;text-align:left"><thead><tr><th>Horodatage</th><th>À cœur</th><th>Ambiante</th><th>Événement</th></tr></thead><tbody>'+samples.slice().reverse().map(p=>'<tr><td>'+esc(time(p.measured_at))+'</td><td>'+esc(temp(p.internal_c))+'</td><td>'+esc(temp(p.ambient_c))+'</td><td>'+esc(({trigger:"Départ",periodic:"Relevé périodique",target:"Cible"})[p.event]||p.event)+'</td></tr>').join("")+'</tbody></table></div></div>';clock();
  }
  function render(){
   if(!state)return;
   const running=state.paths.filter(active);
   service.textContent=(state.configured?(state.professional?"Collecte professionnelle activée : nouveaux essais bloqués.":"Surveillance serveur : "+(running.some(r=>r.status==="armed")?"5 secondes, tant qu’une sonde attend le seuil.":running.length?"10 secondes en cours de parcours.":"En attente de réarmement.")):"MEATER non connecté.")+" Dernière réponse Cloud : "+time(state.last_ok_at)+(state.last_error?" · "+state.last_error:"");
   probes.innerHTML='<div class="meater-grid">'+state.probes.map(p=>{
    const r=running.find(v=>v.device_id===p.device_id),latest=state.paths.find(v=>v.device_id===p.device_id);
    const age=serverNow()-Date.parse(p.measured_at||"");
    const ok=p.present&&!state.last_error&&age>=-10000&&age<=120000;
    const arm=state.can_write&&state.configured&&!state.professional&&!r;
    return '<div class="meater-tile"><strong>'+esc(p.label||("Sonde "+p.slot))+'</strong><small>Station '+esc(["A","B","C"][Math.floor((p.slot-1)/4)])+' · emplacement '+esc(p.slot)+'</small><span class="meater-value">'+esc(ok?temp(p.internal_c):"—")+'</span><small>'+esc(time(p.measured_at))+'</small><small>'+esc(r?labels[r.status]:"Disponible pour un essai")+'</small>'+(r?'<strong data-path-timer="'+esc(r.id)+'">'+esc(countdown(r,serverNow()))+'</strong>':'')+(arm?'<button class="btn secondary btn-outline" type="button" data-path-arm="'+esc(p.device_id)+'">Décrocher / réarmer</button>':'')+(r&&state.can_write?'<button class="btn secondary btn-outline" type="button" data-path-cancel="'+esc(r.id)+'">Annuler le parcours</button>':'')+(latest?'<button class="btn secondary btn-outline" type="button" data-path-view="'+esc((r||latest).id)+'">Voir le parcours</button>':'')+'</div>';
   }).join("")+'</div>'+(state.probes.length?"":"<p>Aucune sonde associée.</p>");
   history.innerHTML=state.paths.length?'<div class="meater-actions">'+state.paths.map(r=>'<button type="button" class="btn secondary btn-outline" data-path-view="'+esc(r.id)+'" aria-pressed="'+(r.id===selected)+'">'+esc(r.label)+' · '+esc(labels[r.status]||r.status)+' · '+esc(time(r.started_at||r.armed_at))+'</button>').join("")+'</div>':'<p>Aucun parcours enregistré.</p>';
   drawDetail();
  }
  async function refresh(){
   if(!visible()||pending||busy)return;
   pending=true;const version=revision;
   try{
    const s=await api("meater-paths");
    if(!Array.isArray(s?.paths)||!Array.isArray(s?.probes))throw Error("Réponse de suivi invalide");
    if(!root.isConnected||version!==revision)return;
    state=s;serverOffset=Date.parse(s.now)-Date.now();if(!Number.isFinite(serverOffset))serverOffset=0;
    if(!selected||!s.paths.some(r=>r.id===selected)){selected=(s.paths.find(active)||s.paths[0])?.id||null;samples=[];loadedKey="";}
    const r=s.paths.find(v=>v.id===selected);
    const key=r?r.id+"|"+(r.last_record_at||"")+"|"+r.status:"";
    if(r&&key!==loadedKey){
     const id=selected;
     try{
      const h=await api("meater-path-history:"+id);
      if(!Array.isArray(h?.samples))throw Error("Historique invalide");
      if(selected===id&&root.isConnected&&version===revision){samples=h.samples;loadedKey=key;historyError="";}
     }catch(err){if(selected===id){historyError=String(err.message||err);}}
    }
    if(root.isConnected&&version===revision)render();
   }catch(err){if(root.isConnected){service.textContent="Suivi indisponible : "+String(err.message||err)+". Les dernières mesures ne sont pas confirmées.";}}
   finally{pending=false;}
  }
  root.addEventListener("click",async ev=>{
   const b=ev.target.closest("[data-path-view],[data-path-arm],[data-path-cancel]");if(!b||busy)return;
   if(b.hasAttribute("data-path-view")){selected=b.dataset.pathView;samples=[];loadedKey="";historyError="";render();void refresh();return;}
   if(!state?.can_write)return;
   const arm=b.hasAttribute("data-path-arm");
   if(!arm&&!window.confirm("Annuler ce parcours technique ? L’historique sera conservé."))return;
   busy=true;revision++;b.disabled=true;feedback.textContent="Commande en cours…";
   try{
    const r=await api(arm?"meater-path-arm":"meater-path-cancel","POST",arm?{device_id:b.dataset.pathArm}:{id:b.dataset.pathCancel});
    if(arm){selected=r.id;samples=[];loadedKey="";}
    feedback.textContent=arm?"Sonde réarmée. Attente d’une nouvelle mesure sous 10 °C.":"Parcours annulé.";
   }catch(err){feedback.textContent=String(err.message||err);}
   finally{busy=false;b.disabled=false;void refresh();}
  });
  timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);clearInterval(clockTimer);return;}if(visible())void refresh();},5000);
  clockTimer=setInterval(clock,1000);
  root.meaterPathRefresh=refresh;void refresh();
 }
 window.KitchenMeaterPaths={mount};
})();
