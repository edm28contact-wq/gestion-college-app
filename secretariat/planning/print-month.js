/* Export PDF mensuel du planning. Exécution locale, aucune écriture en base. */
(()=>{
 "use strict";
 const PDF_JS="https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js";
 const TABLE_JS="https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js";
 let loader=null;

 function loadScript(src){
  return new Promise((resolve,reject)=>{
   const script=document.createElement("script");
   script.src=src;
   script.async=true;
   script.referrerPolicy="no-referrer";
   script.onload=resolve;
   script.onerror=()=>{script.remove();reject(Error("Bibliothèque PDF non chargée. Vérifiez la connexion Internet."))};
   document.head.append(script);
  });
 }
 async function libraries(){
  if(window.jspdf?.jsPDF?.API?.autoTable)return window.jspdf.jsPDF;
  if(!loader)loader=(async()=>{
   if(!window.jspdf?.jsPDF)await loadScript(PDF_JS);
   if(!window.jspdf?.jsPDF?.API?.autoTable)await loadScript(TABLE_JS);
   const Constructor=window.jspdf?.jsPDF;
   if(!Constructor?.API?.autoTable)throw Error("Générateur de tableaux PDF indisponible.");
   return Constructor;
  })().catch(error=>{loader=null;throw error});
  return loader;
 }
 const printable=value=>String(value??"")
  .normalize("NFKC")
  .replace(/\u0153/g,"oe").replace(/\u0152/g,"OE")
  .replace(/[\u2010-\u2015]/g,"-")
  .replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201c\u201d]/g,'"')
  .replace(/\u2026/g,"...").replace(/[\u0000-\u001f\u007f]/g," ")
  .replace(/[^\u0020-\u00ff]/g,"?");
 function monthLabel(month){
  const year=Number(month.slice(0,4)),m=Number(month.slice(5,7));
  return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,m-1,1)));
 }
 const typeNames={absence:"Absence",retard:"Retard",depart_anticipe:"Départ anticipé",incident:"Incident"};
 const reviewNames={a_verifier:"À vérifier",valide:"Validé",sans_suite:"Sans suite"};
 const justNames={non_requis:"Non requis",a_fournir:"À fournir",recu:"Reçu"};
 const shortName=name=>name.length>22?name.slice(0,21)+"...":name;
 function calendarCells(month,events){
  const year=Number(month.slice(0,4)),m=Number(month.slice(5,7))-1,
   first=new Date(Date.UTC(year,m,1)),offset=(first.getUTCDay()+6)%7,
   count=new Date(Date.UTC(year,m+1,0)).getUTCDate();
  const days=Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>{
   const day=i-offset+1;
   if(day<1||day>count)return "";
   const date=month+"-"+String(day).padStart(2,"0"),
    list=events.filter(e=>e.event_date===date);
   const entries=list.slice(0,2).map(e=>shortName(printable(e.personnel_name))+" - "+(typeNames[e.event_type]||"Incident"));
   if(list.length>2)entries.push("+"+(list.length-2)+" autres - voir le détail");
   return String(day)+(entries.length?"\n"+entries.join("\n"):"");
  });
  return Array.from({length:days.length/7},(_,i)=>days.slice(i*7,(i+1)*7));
 }
 const header=(pdf,text,subtitle)=>{
  pdf.setFillColor(31,44,60);pdf.rect(0,0,297,18,"F");
  pdf.setFont("helvetica","bold");pdf.setTextColor(255,255,255);pdf.setFontSize(12);
  pdf.text("COURS CHAMBERTIN  |  SECRÉTARIAT",12,11.5);
  pdf.setTextColor(31,44,60);pdf.setFontSize(16);
  pdf.text(printable(text),12,28);
  pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.setTextColor(88,105,122);
  pdf.text(printable(subtitle),12,35);
 };
 function calendar(pdf,month,events){
  const counts={
   absence:events.filter(e=>e.event_type==="absence").length,
   retard:events.filter(e=>e.event_type==="retard").length,
   depart_anticipe:events.filter(e=>e.event_type==="depart_anticipe").length,
   incident:events.filter(e=>e.event_type==="incident").length
  };
  header(pdf,"Planning des incidents - "+monthLabel(month),"Synthèse complète du mois, établie à partir des événements enregistrés.");
  pdf.setFontSize(9);pdf.setTextColor(47,67,83);
  pdf.text(printable(events.length+" événement(s)  |  "+counts.absence+" absence(s)  |  "+counts.retard+" retard(s)  |  "+counts.depart_anticipe+" départ(s)  |  "+counts.incident+" incident(s)"),12,43);
  pdf.autoTable({
   startY:49,margin:{left:12,right:12,top:21,bottom:18},tableWidth:273,
   head:[["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"]],
   body:calendarCells(month,events),
   theme:"grid",
   styles:{font:"helvetica",fontSize:8,textColor:[33,52,68],cellPadding:2,minCellHeight:21,valign:"top",overflow:"linebreak",lineWidth:.15,lineColor:[213,223,232]},
   headStyles:{fillColor:[230,238,245],textColor:[39,59,77],fontStyle:"bold",halign:"center",minCellHeight:8},
   alternateRowStyles:{fillColor:[249,251,253]},
   columnStyles:{0:{cellWidth:39},1:{cellWidth:39},2:{cellWidth:39},3:{cellWidth:39},4:{cellWidth:39},5:{cellWidth:39},6:{cellWidth:39}}
  });
  const bottom=Math.min(190,Math.max(pdf.lastAutoTable?.finalY||170,160)+8);
  pdf.setFontSize(8);pdf.setTextColor(95,105,119);
  pdf.text("Les cases présentent au maximum deux événements par jour. La liste complète figure dans les pages suivantes.",12,bottom);
  if(!events.length){
   pdf.setFont("helvetica","bold");pdf.setFontSize(10);pdf.setTextColor(31,44,60);
   pdf.text("Aucun incident enregistré pour ce mois.",12,Math.min(195,bottom+8));
  }
 }
 function register(pdf,month,events,duration){
  if(!events.length)return;
  const groups=new Map();
  for(const e of events){
   const name=printable(e.personnel_name||"Salarié non renseigné").trim()||"Salarié non renseigné";
   const key=name.toLocaleLowerCase("fr-FR");
   if(!groups.has(key))groups.set(key,{name,items:[]});
   groups.get(key).items.push(e);
  }
  pdf.addPage("a4","landscape");
  header(pdf,"Détail des incidents - "+monthLabel(month),events.length+" événement(s) classé(s) par salarié, puis par date.");
  let y=45;
  for(const {name,items} of [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,"fr"))){
   if(y>170){pdf.addPage("a4","landscape");header(pdf,"Détail des incidents - "+monthLabel(month),"Suite du registre mensuel.");y=45}
   pdf.setFont("helvetica","bold");pdf.setFontSize(11);pdf.setTextColor(31,51,72);
   pdf.text(printable(name+" - "+items.length+" événement(s)"),12,y);
   const sorted=items.slice().sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date)));
   pdf.autoTable({
    startY:y+4,margin:{left:12,right:12,top:22,bottom:18},tableWidth:273,
    head:[["Date","Type","Durée","Justificatif","PDF joint","Observations","Statut"]],
    body:sorted.map(e=>[
     printable(String(e.event_date||"").split("-").reverse().join("/")),
     printable(typeNames[e.event_type]||e.event_type),
     printable(duration(e)),
     printable(justNames[e.justification_status]||""),
     e.attachment_path?"Oui":"Non",
     printable(e.details||""),
     printable(reviewNames[e.review_status]||e.review_status||"À vérifier")
    ]),
    theme:"grid",
    styles:{font:"helvetica",fontSize:8,textColor:[32,46,61],cellPadding:2,minCellHeight:9,overflow:"linebreak",valign:"top",lineColor:[219,227,234],lineWidth:.12},
    headStyles:{fillColor:[231,239,247],textColor:[31,48,67],fontStyle:"bold"},
    alternateRowStyles:{fillColor:[249,251,253]},
    columnStyles:{0:{cellWidth:25},1:{cellWidth:28},2:{cellWidth:27},3:{cellWidth:31},4:{cellWidth:18},5:{cellWidth:117},6:{cellWidth:27}},
    rowPageBreak:"auto"
   });
   y=(pdf.lastAutoTable?.finalY||y+20)+11;
  }
 }
 async function generate({month,events,duration}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Array.isArray(events)||typeof duration!=="function")
   throw Error("Mois ou données du planning invalides.");
  const Constructor=await libraries();
  const pdf=new Constructor({orientation:"landscape",unit:"mm",format:"a4",compress:true});
  const selected=events.filter(e=>String(e.event_date||"").slice(0,7)===month);
  const sorted=selected.slice().sort((a,b)=>String(a.event_date).localeCompare(String(b.event_date))||String(a.personnel_name).localeCompare(String(b.personnel_name),"fr"));
  pdf.setProperties({title:"Planning des incidents - "+month,subject:"Suivi mensuel du personnel",author:"Cours Chambertin",creator:"Secrétariat"});
  calendar(pdf,month,sorted);
  register(pdf,month,sorted,duration);
  const pages=pdf.getNumberOfPages();
  for(let page=1;page<=pages;page++){
   pdf.setPage(page);pdf.setDrawColor(215,224,234);pdf.line(12,197,285,197);
   pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(105,115,126);
   pdf.text("Document interne - classement mensuel. Les justificatifs PDF restent séparés.",12,202);
   pdf.text("Page "+page+" / "+pages,285,202,{align:"right"});
  }
  pdf.save("planning-incidents-"+month+".pdf");
  return {month,events:sorted.length,pages};
 }
 window.generatePlanningMonthPdf=generate;
})();