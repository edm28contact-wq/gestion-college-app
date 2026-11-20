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
 window.CuisineReports={csv,pdf,headings,lineValues};
})();