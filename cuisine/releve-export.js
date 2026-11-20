"use strict";
(function(){
 const DATE_FORMAT={timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"};
 const formatDate=value=>value?new Date(value).toLocaleString("fr-FR",DATE_FORMAT):"";
 const formatTemp=value=>Number(value).toLocaleString("fr-FR",{maximumFractionDigits:2});
 const validPrefix=value=>/^[=+\-@\t\r]/.test(value)?"'"+value:value;
 function lineValues(reading,rooms,staff){
  const room=rooms.find(x=>x.id===reading.room_id);
  const source=reading.source==="govee_cloud"?"Capteur Govee":staff.find(s=>s.id===reading.taken_by)?.name||"Agent";
  const limits=room?(room.min_c===null?"≤ "+formatTemp(room.max_c):formatTemp(room.min_c)+" à "+formatTemp(room.max_c))+" °C":"";
  return [formatDate(reading.measured_at),room?.label||"Chambre inconnue",formatTemp(reading.temperature_c)+" °C",limits,reading.is_alert?"Hors seuil":"Dans la plage",source];
 }
 const headings=["Date et heure","Chambre froide","Température","Seuil de référence","Résultat","Source"];
 function safeName(name){return String(name||"toutes").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,48)}
 function download(name,contents,mime){
  const object=URL.createObjectURL(new Blob([contents],{type:mime})),link=document.createElement("a");
  link.href=object;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(object),3000);
 }
 async function loadAll(fetchPage,notify){
  const all=[],step=500;
  for(let offset=0;offset<=1000000;offset+=step){
   const page=await fetchPage(offset,step);
   if(!Array.isArray(page.readings))throw Error("Réponse d'historique invalide");
   all.push(...page.readings);
   if(notify)notify(all.length,page.total);
   if(!page.has_more)return all;
   if(page.readings.length!==step)throw Error("Pagination incomplète ; export interrompu pour éviter un fichier tronqué");
  }
  throw Error("Historique trop volumineux : l’export intégral dépasse la limite technique");
 }
 async function csv({fetchPage,rooms,staff,roomLabel,notify}){
  const rows=await loadAll(fetchPage,notify);
  const csvRow=values=>values.map(value=>'"'+validPrefix(String(value??"")).replace(/"/g,'""')+'"').join(";");
  const lines=[headings,...rows.map(r=>lineValues(r,rooms,staff))];
  download("releves_chambres_froides_"+safeName(roomLabel)+"_"+new Date().toISOString().slice(0,10)+".csv",
   "\ufeff"+lines.map(csvRow).join("\r\n"),"text/csv;charset=utf-8");
  return rows.length;
 }
 let dependency=null;
 function ensurePDF(){
  if(window.jspdf?.jsPDF)return Promise.resolve(window.jspdf.jsPDF);
  if(dependency)return dependency;
  dependency=new Promise((resolve,reject)=>{
   const script=document.createElement("script");
   script.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
   script.async=true;
   script.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(Error("Générateur PDF indisponible"));
   script.onerror=()=>reject(Error("Impossible de charger le générateur PDF : vérifiez la connexion Internet"));
   document.head.appendChild(script);
  }).catch(error=>{dependency=null;throw error});
  return dependency;
 }
 function normalizePDF(value){
  return String(value??"").replace(/[—–]/g,"-").replace(/≤/g,"<=").replace(/→/g,"->")
   .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\xFF]/g,"?");
 }
 async function pdf({fetchPage,rooms,staff,roomLabel,notify}){
  const rows=await loadAll(fetchPage,notify);
  const jsPDF=await ensurePDF();
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
  const widths=[37,67,28,37,39,48],pageW=297,margin=15,total=widths.reduce((a,b)=>a+b,0),line=4.5;
  if(total>pageW-2*margin)throw Error("Colonnes PDF trop larges");
  let y=0,page=0;
  function newPage(){
   if(page)doc.addPage();
   page++;y=18;
   doc.setFont("helvetica","bold");doc.setFontSize(15);doc.setTextColor(32,52,71);
   doc.text("Cours Chambertin - Releves des chambres froides",margin,y);y+=8;
   doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(78,95,109);
   doc.text(normalizePDF("Sélection : "+roomLabel+" | export : "+formatDate(new Date().toISOString())+" | "+rows.length+" relevé(s)"),margin,y);y+=9;
   doc.setFillColor(32,52,71);doc.rect(margin,y-5,total,9,"F");
   doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(255,255,255);
   let x=margin;for(let i=0;i<headings.length;i++){doc.text(normalizePDF(headings[i]),x+2,y);x+=widths[i]}y+=7;
  }
  newPage();
  for(let n=0;n<rows.length;n++){
   const cells=lineValues(rows[n],rooms,staff).map(normalizePDF);
   doc.setFont("helvetica","normal");doc.setFontSize(8);
   const split=cells.map((v,i)=>doc.splitTextToSize(v,widths[i]-4));
   const h=Math.max(8,Math.max(...split.map(lines=>lines.length))*line+3);
   if(y+h>192)newPage();
   if(n%2===0){doc.setFillColor(244,247,249);doc.rect(margin,y-5,total,h,"F")}
   doc.setTextColor(rows[n].is_alert?155:34,rows[n].is_alert?39:54,rows[n].is_alert?39:70);
   let x=margin;
   for(let i=0;i<split.length;i++){doc.text(split[i],x+2,y);x+=widths[i]}
   y+=h;
  }
  if(!rows.length){doc.setFontSize(11);doc.setTextColor(90,104,115);doc.text("Aucun releve pour la selection.",margin,y+7)}
  const pages=doc.getNumberOfPages();
  for(let n=1;n<=pages;n++){
   doc.setPage(n);doc.setFont("helvetica","normal");doc.setTextColor(100,110,120);doc.setFontSize(8);
   doc.text("Releve documentaire - mesures horodatees",margin,201);
   doc.text("Page "+n+" / "+pages,pageW-margin-26,201);
  }
  doc.save("releves_chambres_froides_"+safeName(roomLabel)+"_"+new Date().toISOString().slice(0,10)+".pdf");
  return rows.length;
 }

 async function tasksPdf({date,tasks,checks,staff}){
  const jsPDF=await ensurePDF();
  const doc=new jsPDF({unit:"mm",format:"a4"});
  const margin=16,wide=178;
  const dateLabel=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",year:"numeric",month:"long",day:"numeric"}).format(new Date(date+"T12:00:00Z"));
  const byTask=new Map(checks.map(c=>[c.task_id,c]));
  const existing=tasks.filter(t=>t.active||byTask.has(t.id));
  const completed=existing.filter(t=>byTask.has(t.id)).length;
  const byId=id=>staff.find(u=>u.id===id)?.name||"Agent non renseigné";
  let page=0,y=0;
  function header(){
   if(page)doc.addPage();page++;y=17;
   doc.setFillColor(32,52,71);doc.rect(0,0,210,29,"F");
   doc.setFont("helvetica","bold");doc.setFontSize(16);doc.setTextColor(255,255,255);
   doc.text("Cours Chambertin - Suivi du nettoyage",margin,13);
   doc.setFont("helvetica","normal");doc.setFontSize(10);doc.text(normalizePDF(dateLabel),margin,21);
   y=38;doc.setFont("helvetica","bold");doc.setTextColor(32,52,71);doc.setFontSize(11);
   doc.text("Taches du jour - "+completed+" validee(s) sur "+existing.length,margin,y);y+=9;
   doc.setFillColor(234,240,244);doc.rect(margin,y-5,wide,9,"F");
   doc.setFontSize(8);doc.text("Tache",margin+3,y);doc.text("Statut",margin+86,y);
   doc.text("Responsable",margin+115,y);y+=8;
  }
  header();
  for(let i=0;i<existing.length;i++){
   const task=existing[i],check=byTask.get(task.id),owner=task.assigned_to?byId(task.assigned_to):"Commune";
   const dateTime=check?formatDate(check.performed_at):"";
   const st=check?"Validee":"Non validee";
   const person=check?byId(check.performed_by):owner;
   doc.setFontSize(9);
   const title=doc.splitTextToSize(normalizePDF(task.label),80);
   const responsible=doc.splitTextToSize(normalizePDF(person),57);
   const h=Math.max(12,6+Math.max(title.length,responsible.length)*4.8+(check?5:0));
   if(y+h>275)header();
   if(i%2===0){doc.setFillColor(246,248,250);doc.rect(margin,y-5,wide,h,"F")}
   doc.setFont("helvetica","normal");doc.setTextColor(34,54,70);
   doc.text(title,margin+3,y);
   doc.setTextColor(check?20:155,check?100:98,check?55:45);
   doc.text(st,margin+86,y);
   doc.setTextColor(34,54,70);doc.text(responsible,margin+115,y);
   if(check){doc.setFontSize(8);doc.setTextColor(90,105,118);doc.text(normalizePDF(dateTime),margin+115,y+Math.max(...responsible.map((_,i)=>i+1))*4.8)}
   y+=h;
  }
  if(!existing.length){doc.setTextColor(90,105,118);doc.text("Aucune tache configuree.",margin,y+8)}
  if(y>263)header();y+=8;doc.setFontSize(8);doc.setTextColor(90,105,118);
  const note=doc.splitTextToSize("Une tache non validee dans l'application n'est pas necessairement une tache non effectuee. Rapport etabli a partir des validations horodatees.",wide);
  doc.text(note,margin,y);
  const n=doc.getNumberOfPages();
  for(let i=1;i<=n;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(110,120,130);doc.text("Rapport de suivi - "+date,margin,289);doc.text("Page "+i+" / "+n,180,289)}
  doc.save("nettoyage_cuisine_"+date+".pdf");
  return {total:existing.length,completed};
 }
 window.CuisineReports={csv,pdf,tasksPdf,headings,lineValues};
})();