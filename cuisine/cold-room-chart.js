"use strict";
(function(){
 const TZ="Europe/Paris";
 const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const periods={day:"Jour",week:"Semaine",month:"Mois",year:"Année"};
 const aggregation={day:"Toutes les mesures, regroupées au maximum par 5 minutes",week:"Agrégation horaire",month:"Agrégation journalière",year:"Agrégation mensuelle"};
 function shift(date,period,direction){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return today();
  const d=new Date(date+"T12:00:00Z");
  if(!Number.isFinite(d.getTime()))return today();
  if(period==="day")d.setUTCDate(d.getUTCDate()+direction);
  else if(period==="week")d.setUTCDate(d.getUTCDate()+7*direction);
  else if(period==="month"){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction)}
  else if(period==="year"){d.setUTCDate(1);d.setUTCMonth(0);d.setUTCFullYear(d.getUTCFullYear()+direction)}
  return d.toISOString().slice(0,10);
 }
 function localeTime(value,period){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return "—";
  const format=period==="year"?{year:"numeric",month:"short"}:
   period==="month"?{day:"numeric",month:"short"}:
   period==="week"?{weekday:"short",day:"numeric",hour:"2-digit"}:
   {hour:"2-digit",minute:"2-digit"};
  return new Intl.DateTimeFormat("fr-FR",{timeZone:TZ,...format}).format(d);
 }
 const valueC=v=>Number.isFinite(Number(v))?Number(v).toLocaleString("fr-FR",{minimumFractionDigits:1,maximumFractionDigits:2})+" °C":"—";
 const num=n=>Number(n).toLocaleString("fr-FR");
 function renderChart(data){
  const rows=Array.isArray(data?.points)?data.points:[];
  const start=Date.parse(data.start_at),end=Date.parse(data.end_at);
  const period=periods[data.period]?data.period:"day";
  const points=rows.map(x=>({
   time:Date.parse(x.at),min:Number(x.min_c),mean:Number(x.mean_c),max:Number(x.max_c),
   count:Number(x.count)||0,alerts:Number(x.alerts)||0
  })).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.min)&&
   Number.isFinite(x.mean)&&Number.isFinite(x.max)&&x.count>0&&x.time>=start&&x.time<end)
   .sort((a,b)=>a.time-b.time);
  const stats=data.summary||{};
  const heading='<div class="cold-profile-stats">'+
   '<div><small>Relevés enregistrés</small><strong>'+num(stats.readings||0)+'</strong></div>'+
   '<div><small>Minimum</small><strong>'+esc(valueC(stats.min_c))+'</strong></div>'+
   '<div><small>Moyenne</small><strong>'+esc(valueC(stats.mean_c))+'</strong></div>'+
   '<div><small>Maximum</small><strong>'+esc(valueC(stats.max_c))+'</strong></div>'+
   '<div><small>Relevés hors seuil</small><strong>'+num(stats.alerts||0)+'</strong></div></div>';
  if(!points.length||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)
   return heading+'<div class="cold-profile-empty">Aucun relevé enregistré pour cette période.</div>';
  const maxThreshold=data.room?.max_c==null?null:Number(data.room.max_c);
  const minThreshold=data.room?.min_c==null?null:Number(data.room.min_c);
  const thresholds=[maxThreshold,minThreshold].filter(Number.isFinite);
  const values=points.flatMap(x=>[x.min,x.max]).concat(thresholds);
  const minValue=Math.min(...values),maxValue=Math.max(...values);
  const margin=Math.max(0.75,(maxValue-minValue)*0.12),low=minValue-margin,high=maxValue+margin;
  const W=960,H=340,L=62,R=22,T=20,B=50;
  const pw=W-L-R,ph=H-T-B;
  const xPos=time=>L+Math.max(0,Math.min(1,(time-start)/(end-start)))*pw;
  const yPos=value=>T+(high-value)/(high-low)*ph;
  const maxGap={day:21*60000,week:2*3600000,month:36*3600000,year:46*86400000}[period];
  const path=key=>{
   let last=null,out="";
   for(const p of points){
    const next=xPos(p.time).toFixed(2)+" "+yPos(p[key]).toFixed(2);
    out+=(last!==null&&p.time-last<=maxGap?"L":"M")+next+" ";
    last=p.time;
   }
   return out.trim();
  };
  const ticks=[0,1,2,3,4].map(i=>{
   const v=low+(high-low)*(1-i/4),y=yPos(v).toFixed(2);
   return '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" class="cold-profile-gridline"/>'+
    '<text x="'+(L-9)+'" y="'+(Number(y)+4)+'" text-anchor="end" class="cold-profile-axis-label">'+esc(v.toLocaleString("fr-FR",{maximumFractionDigits:1}))+'</text>';
  }).join("");
  const xTicks=[0,1,2,3,4].map(i=>{
   const ts=start+(end-start)*i/4,x=xPos(ts).toFixed(2);
   return '<line x1="'+x+'" y1="'+(H-B)+'" x2="'+x+'" y2="'+(H-B+5)+'" class="cold-profile-tick"/>'+
    '<text x="'+x+'" y="'+(H-B+22)+'" text-anchor="middle" class="cold-profile-axis-label">'+esc(localeTime(ts,period))+'</text>';
  }).join("");
  const thresholdLines=[
   ["max",maxThreshold,"Seuil max.", "#bd4d4d"],
   ["min",minThreshold,"Seuil min.", "#b28b26"]
  ].filter(([,v])=>v!=null&&Number.isFinite(v)).map(([,v,label,color])=>
   '<line x1="'+L+'" y1="'+yPos(v).toFixed(2)+'" x2="'+(W-R)+'" y2="'+yPos(v).toFixed(2)+
   '" stroke="'+color+'" stroke-dasharray="6 5" stroke-width="1.4"><title>'+esc(label+" "+valueC(v)+" (réglage actuel)")+'</title></line>'
  ).join("");
  const dots=points.map(p=>{
   const txt=localeTime(p.time,period)+" · Minimum : "+valueC(p.min)+
    " · Moyenne : "+valueC(p.mean)+" · Maximum : "+valueC(p.max)+
    " · "+p.count+" relevé(s) · "+p.alerts+" alerte(s)";
   return '<circle cx="'+xPos(p.time).toFixed(2)+'" cy="'+yPos(p.mean).toFixed(2)+'" r="3.5" class="cold-profile-dot">'+
    '<title>'+esc(txt)+'</title></circle>';
  }).join("");
  const series=points.length<2?"":'<path class="cold-profile-curve cold-profile-min" d="'+path("min")+'"/>'+
   '<path class="cold-profile-curve cold-profile-max" d="'+path("max")+'"/>'+
   '<path class="cold-profile-curve cold-profile-mean" d="'+path("mean")+'"/>';
  const graph='<div class="cold-profile-chart-wrap"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Courbe des températures enregistrées : moyenne, minimum et maximum en degrés Celsius" preserveAspectRatio="xMidYMid meet">'+
   ticks+xTicks+thresholdLines+series+dots+
   '<text x="16" y="16" class="cold-profile-axis-label">°C</text></svg></div>';
  const legend='<div class="cold-profile-legend"><span class="cold-profile-legend-mean">Moyenne</span>'+
   '<span class="cold-profile-legend-min">Minimum</span><span class="cold-profile-legend-max">Maximum</span>'+
   (maxThreshold!==null?'<span>Seuil max. actuel : '+esc(valueC(maxThreshold))+'</span>':"")+
   (minThreshold!==null?'<span>Seuil min. actuel : '+esc(valueC(minThreshold))+'</span>':"")+'</div>';
  const foot='<p class="cold-profile-note">'+esc(aggregation[period])+
   ' · Toutes les mesures enregistrées et valides comptent dans les statistiques. Les interruptions de courbe représentent des périodes sans données ; aucune valeur n’est inventée.</p>';
  return heading+graph+legend+foot;
 }
 function open({room,fetchChart}){
  if(!room?.id||typeof fetchChart!=="function")return;
  const existing=document.getElementById("kitchenColdRoomProfile");
  if(existing){existing.close?.();existing.remove()}
  const dialog=document.createElement("dialog");
  dialog.id="kitchenColdRoomProfile";dialog.className="kitchen-cold-profile";
  let period="day",date=today(),epoch=0;
  dialog.innerHTML='<div class="cold-profile-layout">'+
   '<header class="cold-profile-header"><div><span class="cold-profile-eyebrow">Fiche chambre froide · HACCP</span>'+
   '<h2 id="coldRoomProfileTitle">'+esc(room.label)+'</h2>'+
   '<p>Historique des relevés enregistrés · horaires Europe/Paris</p></div>'+
   '<button type="button" data-cold-profile-close class="cold-profile-close" aria-label="Fermer la fiche">Fermer</button></header>'+
   '<div class="cold-profile-toolbar"><div class="cold-profile-periods" role="group" aria-label="Regrouper par période">'+
   Object.entries(periods).map(([key,label])=>'<button type="button" data-cold-profile-period="'+key+'" aria-pressed="'+(period===key)+'">'+label+'</button>').join("")+
   '</div><div class="cold-profile-date"><button type="button" data-cold-profile-step="-1" aria-label="Période précédente">‹</button>'+
   '<label>Choisir une date<input type="date" data-cold-profile-date min="2020-01-01" max="'+today()+'" value="'+date+'"></label>'+
   '<button type="button" data-cold-profile-step="1" aria-label="Période suivante">›</button></div></div>'+
   '<p data-cold-profile-status role="status" aria-live="polite"></p>'+
   '<section data-cold-profile-result aria-label="Graphique et statistiques des relevés"></section>'+
   '</div>';
  document.body.append(dialog);
  const status=dialog.querySelector("[data-cold-profile-status]"),result=dialog.querySelector("[data-cold-profile-result]");
  function updateControls(){
   dialog.querySelectorAll("[data-cold-profile-period]").forEach(b=>{
    const active=b.dataset.coldProfilePeriod===period;
    b.setAttribute("aria-pressed",String(active));
   });
   dialog.querySelector("[data-cold-profile-date]").value=date;
   dialog.querySelector('[data-cold-profile-step="1"]').disabled=shift(date,period,1)>today();
  }
  async function load(){
   const version=++epoch;
   updateControls();status.textContent="Chargement des relevés enregistrés…";
   result.replaceChildren();
   try{
    const chart=await fetchChart(room.id,period,date);
    if(!dialog.isConnected||version!==epoch)return;
    if(chart?.room?.id!==room.id||!Array.isArray(chart?.points)||chart.period!==period||chart.date!==date)
     throw Error("Réponse de l’historique invalide.");
    dialog.querySelector("#coldRoomProfileTitle").textContent=chart.room.label||room.label;
    result.innerHTML=renderChart(chart);
    status.textContent="Historique du "+new Date(chart.start_at).toLocaleDateString("fr-FR",{timeZone:TZ})+
     " au "+new Date(Date.parse(chart.end_at)-1).toLocaleDateString("fr-FR",{timeZone:TZ})+
     " · "+num(chart.summary?.readings||0)+" relevé(s) enregistrés.";
   }catch(err){
    if(!dialog.isConnected||version!==epoch)return;
    status.textContent="Historique indisponible.";
    result.innerHTML='<p class="cold-profile-error">'+esc(err.message||"Impossible de charger les températures.")+'</p>';
   }
  }
  dialog.addEventListener("click",event=>{
   const target=event.target.closest?.("button");
   if(!target)return;
   if(target.hasAttribute("data-cold-profile-close")){dialog.close();return}
   if(target.dataset.coldProfilePeriod){
    period=target.dataset.coldProfilePeriod;void load();return;
   }
   if(target.dataset.coldProfileStep){
    const next=shift(date,period,Number(target.dataset.coldProfileStep));
    if(next<=today()&&next>="2020-01-01"){date=next;void load()}
   }
  });
  dialog.querySelector("[data-cold-profile-date]").addEventListener("change",event=>{
   const next=event.target.value;
   if(/^\d{4}-\d{2}-\d{2}$/.test(next)&&next<="2100-12-31"&&next<=today()&&next>="2020-01-01"){
    date=next;void load();
   }else updateControls();
  });
  dialog.addEventListener("close",()=>{epoch++;dialog.remove()});
  dialog.showModal();
  void load();
 }
 window.KitchenColdRoomChart={open,renderChart,shift};
})();
