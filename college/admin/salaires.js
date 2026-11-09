/* Administration Collège : journal mensuel des éléments du personnel */
let salaryMonth=null,salaryEvents=[],salaryError="",salaryLoading=false,salaryPerson="all",salaryMonthSummaries=[],salaryHistoryError="",salaryHistoryLoading=false,salaryHistoryLoaded=false,salaryRequestVersion=0,salaryStaff=[],salaryStaffLoaded=false,salaryStaffLoading=false,salaryStaffSaving=false,salaryStaffError="",salaryStaffMessage="";
const salaryTypes={absence:"Absence",retard:"Retard",depart_anticipe:"Départ anticipé",incident:"Incident"};
const salaryStatuses={a_verifier:"À vérifier",valide:"Validé",sans_suite:"Sans suite"};
const salaryJust={non_requis:"Non requis",a_fournir:"À fournir",recu:"Reçu"};

function salaryDuration(e){
 if(e.all_day)return "Journée entière";
 let minutes=Number.isInteger(e.duration_minutes)&&e.duration_minutes>0?e.duration_minutes:null;
 if(minutes===null&&e.start_time&&e.end_time){
  const start=String(e.start_time).slice(0,5),end=String(e.end_time).slice(0,5);
  if(/^\d\d:\d\d$/.test(start)&&/^\d\d:\d\d$/.test(end)){
   const value=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
   const diff=value(end)-value(start);if(diff>0)minutes=diff;
  }
 }
 if(minutes===null)return "Non renseignée";
 return [Math.floor(minutes/60)?Math.floor(minutes/60)+" h":"",minutes%60?minutes%60+" min":""].filter(Boolean).join(" ")||"0 min";
}
async function salaryOpenIncidentPdf(id){
 const tab=window.open("","_blank");
 try{
  const u=new URL(ROOT+"/personnel-planning");u.searchParams.set("action","attachment-url");u.searchParams.set("id",id);
  const r=await fetch(u,{headers:{"x-admin-session":token},cache:"no-store"});
  const data=await r.json().catch(()=>({error:"Réponse invalide"}));
  if(!r.ok)throw Error(data.error||"Ouverture du PDF impossible");
  if(tab){tab.opener=null;tab.location.replace(data.url)}
  else alert("Autorisez les fenêtres contextuelles pour ouvrir le PDF.");
 }catch(e){if(tab)tab.close();alert(e.message)}
}

function salaryCurrentMonth(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).format(new Date())}
function salaryGroups(){const groups=new Map();for(const e of salaryEvents){const name=String(e.personnel_name||"").trim(),key=name.normalize("NFKC").replace(/\s+/g," ").toLocaleLowerCase("fr");if(!groups.has(key))groups.set(key,{name,items:[]});groups.get(key).items.push(e)}return [...groups.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,"fr"))}

function salaryMonthLabel(month){
 const [year,number]=month.split("-").map(Number);
 if(!Number.isInteger(year)||!Number.isInteger(number)||number<1||number>12)return month;
 return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,number-1,1)));
}
function salaryMonthsForOverview(){
 const current=salaryCurrentMonth(),year=Number(current.slice(0,4));
 const months=new Map();
 for(let month=1;month<=Number(current.slice(5,7));month++){
  const key=year+"-"+String(month).padStart(2,"0");
  months.set(key,{month:key,events:0,employees:0,pending:0,absences:0,retards:0,departures:0,incidents:0});
 }
 for(const item of salaryMonthSummaries){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(item.month||"")))continue;
  months.set(item.month,item);
 }
 if(!months.has(salaryMonth))months.set(salaryMonth,{month:salaryMonth,events:0,employees:0,pending:0,absences:0,retards:0,departures:0,incidents:0});
 return [...months.values()].sort((a,b)=>b.month.localeCompare(a.month));
}
function salaryOverview(){
 if(salaryHistoryLoading)return '<div class="card"><p>Chargement du récapitulatif des mois…</p></div>';
 if(salaryHistoryError)return '<div class="card"><p class="err">'+esc(salaryHistoryError)+'</p><button class="btn secondary" type="button" onclick="salaryLoadHistory()">Réessayer</button></div>';
 const months=salaryMonthsForOverview(),sections=new Map();
 for(const item of months){
  const year=item.month.slice(0,4);
  if(!sections.has(year))sections.set(year,[]);
  sections.get(year).push(item);
 }
 return '<section class="card salary-overview"><h2>Récapitulatif mensuel</h2><p class="muted">Sélectionnez un mois pour afficher ses incidents par salarié. Les mois sans incident de l’année en cours sont également affichés.</p>'+
  [...sections.entries()].map(([year,items])=>
   '<h3>'+esc(year)+'</h3><div class="salary-month-grid">'+items.map(item=>{
    const selected=item.month===salaryMonth;
    return '<button type="button" class="salary-month-tile'+(selected?' selected':'')+'" data-salary-month="'+esc(item.month)+'" aria-pressed="'+String(selected)+'">'+
     '<strong>'+esc(salaryMonthLabel(item.month))+'</strong>'+
     '<span>'+Number(item.events||0)+' événement(s) · '+Number(item.employees||0)+' salarié(s)</span>'+
     '<small>'+Number(item.absences||0)+' absence(s) · '+Number(item.retards||0)+' retard(s) · '+Number(item.departures||0)+' départ(s) · '+Number(item.incidents||0)+' incident(s)</small>'+
     '<small>'+Number(item.pending||0)+' à vérifier</small></button>';
   }).join("")+'</div>').join("")+'</section>';
}
async function salaryLoadHistory(){
 if(page!=="salaires"||!token||salaryHistoryLoading)return;
 salaryHistoryLoading=true;salaryHistoryError="";salaryPage();
 try{
  const data=await call(ROOT+'/personnel-planning','admin-months');
  salaryMonthSummaries=Array.isArray(data.months)?data.months:[];
  salaryHistoryLoaded=true;
 }catch(e){salaryHistoryError=frError(e.message)}
 finally{salaryHistoryLoading=false;if(page==="salaires")salaryPage()}
}
function salarySelectMonth(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
 salaryMonth=month;salaryPerson="all";salaryLoad();
}


function salaryStaffPanel(){
 const state=salaryStaffLoading?'<p class="muted">Chargement de la liste du personnel…</p>':
  salaryStaffError?'<p class="err">'+esc(salaryStaffError)+'</p><button type="button" class="btn secondary" onclick="salaryLoadStaff()">Réessayer</button>':'';
 const active=salaryStaff.filter(p=>!p.archived),archived=salaryStaff.filter(p=>p.archived);
 const row=p=>{
  const visible=!p.archived&&p.visible_in_planning;
  return '<tr><td><b>'+esc(p.name)+'</b></td><td>'+(p.archived?'Archivé':visible?'Visible dans le planning':'Masqué du planning')+'</td>'+
   '<td><input type="checkbox" data-salary-staff-id="'+esc(p.id)+'" '+(visible?'checked':'')+' '+(p.archived||salaryStaffSaving?'disabled':'')+' aria-label="Afficher '+esc(p.name)+' dans le planning"></td>'+
   '<td><button type="button" class="btn secondary compact" data-salary-archive="'+esc(p.id)+'" '+(salaryStaffSaving?'disabled':'')+'>'+(p.archived?'Réactiver':'Retirer de la liste')+'</button></td></tr>';
 };
 return '<section class="card salary-personnel"><h2>Salariés affichés dans le planning</h2>'+
  '<p class="muted">Gérez ici les personnes proposées dans « Planning → Nouvel incident ». Masquer ou archiver un salarié conserve ses incidents antérieurs et les récapitulatifs de paie.</p>'+
  (salaryStaffMessage?'<p class="ok" role="status">'+esc(salaryStaffMessage)+'</p>':'')+state+
  '<form id="salaryStaffAdd" class="salary-staff-form"><label for="salaryStaffName">Nom du nouveau salarié</label>'+
  '<input id="salaryStaffName" type="text" maxlength="120" required placeholder="Nom et prénom" autocomplete="off" '+(salaryStaffSaving?'disabled':'')+'>'+
  '<label><input id="salaryStaffVisible" type="checkbox" checked> Afficher dans le planning</label>'+
  '<button type="submit" class="btn primary" '+(salaryStaffSaving?'disabled':'')+'>Ajouter le salarié</button></form>'+
  '<div class="table"><table><thead><tr><th>Salarié</th><th>État</th><th>Afficher</th><th>Action</th></tr></thead><tbody>'+
  active.map(row).join('')+archived.map(row).join('')+
  (!salaryStaff.length?'<tr><td colspan="4">Aucun salarié enregistré.</td></tr>':'')+'</tbody></table></div></section>';
}
async function salaryLoadStaff(){
 if(!token||salaryStaffLoading)return;
 salaryStaffLoading=true;salaryStaffError="";
 if(page==="salaires")salaryPage();
 try{
  const r=await call(ROOT+'/personnel-planning','staff-list');
  salaryStaff=Array.isArray(r.staff)?r.staff:[];
  salaryStaffLoaded=true;
 }catch(e){salaryStaffError=frError(e.message)}
 finally{salaryStaffLoading=false;if(page==="salaires")salaryPage()}
}
async function salaryAddStaff(event){
 event.preventDefault();
 if(salaryStaffSaving)return;
 const input=$('salaryStaffName'),name=input?.value.trim(),visible=$('salaryStaffVisible')?.checked===true;
 if(!name||name.length<2||name.length>120){salaryStaffError="Indiquez un nom de 2 à 120 caractères.";salaryPage();return}
 salaryStaffSaving=true;salaryStaffError="";salaryStaffMessage="";
 try{
  await call(ROOT+'/personnel-planning','staff-add','POST',{name,visible_in_planning:visible});
  salaryStaffMessage="Salarié ajouté.";
  salaryStaffLoaded=false;
 }catch(e){salaryStaffError=frError(e.message)}
 finally{salaryStaffSaving=false;await salaryLoadStaff()}
}
async function salaryUpdateStaff(id,archived,visible){
 if(salaryStaffSaving)return;
 const entry=salaryStaff.find(s=>s.id===id);
 if(!entry)return;
 if(archived&&!entry.archived&&!confirm("Retirer "+entry.name+" de la liste active ? Ses incidents historiques seront conservés."))return;
 salaryStaffSaving=true;salaryStaffError="";salaryStaffMessage="";
 try{
  await call(ROOT+'/personnel-planning','staff-update','POST',{id,archived,visible_in_planning:visible});
  salaryStaffMessage=archived?"Salarié archivé ; historique conservé.":visible?"Salarié visible dans le planning.":"Salarié masqué du planning.";
  salaryStaffLoaded=false;
 }catch(e){salaryStaffError=frError(e.message)}
 finally{salaryStaffSaving=false;await salaryLoadStaff()}
}
function salaryWireStaff(){
 const form=$('salaryStaffAdd');if(form)form.addEventListener('submit',salaryAddStaff);
 document.querySelectorAll('[data-salary-staff-id]').forEach(box=>box.addEventListener('change',()=>{
  const row=salaryStaff.find(x=>x.id===box.dataset.salaryStaffId);
  if(row)void salaryUpdateStaff(row.id,false,box.checked);
 }));
 document.querySelectorAll('[data-salary-archive]').forEach(button=>button.addEventListener('click',()=>{
  const row=salaryStaff.find(x=>x.id===button.dataset.salaryArchive);
  if(row)void salaryUpdateStaff(row.id,!row.archived,row.archived);
 }));
}

function salaryPage(){
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 const groups=salaryGroups(),shown=groups.filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 const total=shown.reduce((n,[,g])=>n+g.items.length,0);
 const option=(val,label)=>'<option value="'+esc(val)+'"'+(salaryPerson===val?' selected':'')+'>'+esc(label)+'</option>';
 $('content').innerHTML=salaryOverview()+salaryStaffPanel()+'<div class="card" id="salaryMonthDetails"><h2>Salaires – Éléments variables du mois : '+esc(salaryMonthLabel(salaryMonth))+'</h2><p class="muted">Absences, retards, départs anticipés et incidents déclarés par le secrétariat, regroupés par salarié. Ces données ne constituent pas un bulletin de salaire.</p><div class="actions" style="align-items:center;flex-wrap:wrap"><label for="salaryMonth">Mois</label><input id="salaryMonth" type="month" value="'+esc(salaryMonth)+'" style="max-width:180px"><label for="salaryPerson">Salarié</label><select id="salaryPerson" style="max-width:260px">'+option("all","Tous les salariés")+groups.map(([key,g])=>option(key,g.name)).join("")+'</select><button class="btn secondary" onclick="salaryLoad()">Actualiser</button><button class="btn primary" onclick="salaryExportCsv()" '+(!total?'disabled':'')+'>Exporter CSV</button><button class="btn secondary" onclick="salaryPrint()" '+(!total?'disabled':'')+'>Imprimer / PDF</button><a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE (Urssaf)</a></div><p class="muted">Vérifiez les données avant toute déclaration sur le TESE. Aucun transfert automatique et aucune retenue sur salaire ne sont effectués.</p></div>'+
 (salaryLoading?'<div class="card">Chargement des événements…</div>':'')+
 (salaryError?'<div class="card" style="color:#a32929">'+esc(salaryError)+'</div>':'')+
 (!salaryLoading&&!salaryError?'<div class="card"><b>'+shown.length+' salarié(s) · '+total+' événement(s) · '+shown.reduce((n,[,g])=>n+g.items.filter(e=>e.event_type==="incident").length,0)+' incident(s)</b></div>':'')+
 (!salaryLoading&&!salaryError?(shown.length?shown.map(([,g])=>'<div class="card"><h3>'+esc(g.name)+' <span class="muted">('+g.items.length+' événement(s), '+g.items.filter(e=>e.event_type==="incident").length+' incident(s))</span></h3><div class="table"><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Justificatif</th><th>PDF</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+(e.attachment_path?'<button class="btn secondary compact" type="button" onclick="salaryOpenIncidentPdf(\''+esc(e.id)+'\')">Voir le PDF</button>':'—')+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td></tr>').join("")+'</tbody></table></div></div>').join(""):'<div class="card"><p>Aucun événement enregistré pour cette période.</p></div>'):'');
 salaryWireStaff();
 document.querySelectorAll('[data-salary-month]').forEach(button=>button.addEventListener('click',()=>salarySelectMonth(button.dataset.salaryMonth)));
 const month=$('salaryMonth');if(month)month.addEventListener('change',e=>salarySelectMonth(e.target.value));
 const person=$('salaryPerson');if(person)person.addEventListener('change',e=>{salaryPerson=e.target.value;salaryPage()});
}
async function salaryLoad(){
 if(page!=="salaires"||!token)return;
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 if(!salaryHistoryLoaded&&!salaryHistoryLoading)void salaryLoadHistory();
 if(!salaryStaffLoaded&&!salaryStaffLoading)void salaryLoadStaff();
 const request=++salaryRequestVersion,month=salaryMonth;
 salaryLoading=true;salaryError="";salaryPage();
 try{
  const r=await call(ROOT+'/personnel-planning','admin-list','GET',undefined,{month});
  if(request!==salaryRequestVersion)return;
  salaryEvents=r.events||[];
 }catch(e){if(request!==salaryRequestVersion)return;salaryEvents=[];salaryError=frError(e.message)}
 finally{if(request===salaryRequestVersion){salaryLoading=false;if(page==="salaires")salaryPage()}}
}
function salaryExportCsv(){
 if(salaryLoading||salaryError)return;
 const selected=salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key).flatMap(([,g])=>g.items);
 if(!selected.length)return;
 const rows=[["Date","Salarié","Type","Journée entière","Durée (minutes)","Durée affichée","Justificatif","PDF joint","Observation","Statut","Traitement paie","Note administrative"],...selected.map(e=>[e.event_date,e.personnel_name,salaryTypes[e.event_type]||e.event_type,e.all_day?"Oui":"Non",e.duration_minutes??"",salaryDuration(e),salaryJust[e.justification_status]||"",e.attachment_path?"Oui":"Non",e.details,salaryStatuses[e.review_status]||"",e.payroll_action||"",e.payroll_note||""])];
 const content="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="salaires-incidents-"+salaryMonth+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function salaryPrint(){
 if(salaryLoading||salaryError)return;
 const groups=salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 if(!groups.length)return;
 const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Suivi salaires '+esc(salaryMonth)+'</title><style>body{font:12px Arial,sans-serif;color:#17202a;margin:16mm}h1{font-size:23px}h2{font-size:16px;margin-top:20px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px;border:1px solid #bbb;text-align:left;overflow-wrap:anywhere}th{background:#eee}tr{break-inside:avoid}p{line-height:1.5}@page{size:A4 landscape;margin:14mm}</style></head><body><h1>Éléments du personnel — '+esc(salaryMonth)+'</h1><p>Document de contrôle. Aucun calcul de retenue automatique. Vérifier avant saisie dans le TESE.</p>'+groups.map(([,g])=>'<h2>'+esc(g.name)+' — '+g.items.length+' événement(s)</h2><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Justificatif</th><th>PDF</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+esc(e.attachment_path?'PDF joint':'—')+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"")+'</td></tr>').join("")+'</tbody></table>').join("")+'</body></html>';
 const w=window.open("","_blank");if(!w){alert("Autorisez les fenêtres pop-up pour générer le PDF.");return}w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),250);
}
