/* Administration Collège : journal mensuel des éléments du personnel */
let salaryMonth=null,salaryEvents=[],salaryError="",salaryLoading=false,salaryPerson="all",salaryMonthSummaries=[],salaryHistoryError="",salaryHistoryLoading=false,salaryHistoryLoaded=false,salaryRequestVersion=0,salaryStaff=[],salaryStaffLoaded=false,salaryStaffLoading=false,salaryStaffSaving=false,salaryStaffError="",salaryStaffMessage="",salaryProfileEmployeeId="",salaryProfileMonth="",salaryProfileEvents=[],salaryProfileLoading=false,salaryProfileError="",salaryProfileLoaded=false,salaryProfileRequestVersion=0;
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



function salaryStaffKey(name){
 return String(name??"").normalize("NFKC").replace(/\s+/g," ").trim()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"");
}
function salaryRecordedMinutes(event){
 if(event.all_day)return null;
 const minutes=event.duration_minutes;
 if(Number.isInteger(minutes)&&minutes>0&&minutes<=1440)return minutes;
 const start=String(event.start_time||"").slice(0,5),end=String(event.end_time||"").slice(0,5);
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
 if(!time.test(start)||!time.test(end))return null;
 const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
 const difference=minute(end)-minute(start);
 return difference>0&&difference<=1440?difference:null;
}
function salaryLateMinutes(event){
 return event.event_type==="retard"?salaryRecordedMinutes(event):null;
}
function salaryProfileTotals(events,month){
 const year=String(month).slice(0,4);
 const inMonth=e=>String(e.event_date||"").slice(0,7)===month;
 const inYear=e=>String(e.event_date||"").slice(0,4)===year;
 const group=(type,predicate)=>events.filter(e=>e.event_type===type&&predicate(e));
 const total=items=>items.reduce((sum,e)=>sum+(salaryRecordedMinutes(e)??0),0);
 const missing=items=>items.filter(e=>salaryRecordedMinutes(e)===null).length;
 const lateMonth=group("retard",inMonth),lateYear=group("retard",inYear);
 const earlyMonth=group("depart_anticipe",inMonth),earlyYear=group("depart_anticipe",inYear);
 const absenceMonth=group("absence",inMonth),absenceYear=group("absence",inYear);
 const incidentMonth=group("incident",inMonth),incidentYear=group("incident",inYear);
 // One "all_day" is stored as 1440 by the planning, but 24h is not a paid shift.
 // Do not turn a full-day absence into 24 hours of absence.
 const hoursMonth=[...lateMonth,...earlyMonth,...absenceMonth];
 const hoursYear=[...lateYear,...earlyYear,...absenceYear];
 return {
  monthMinutes:total(lateMonth),yearMinutes:total(lateYear),
  monthCount:lateMonth.length,yearCount:lateYear.length,
  monthMissing:missing(lateMonth),yearMissing:missing(lateYear),
  earlyMonthMinutes:total(earlyMonth),earlyYearMinutes:total(earlyYear),
  earlyMonthCount:earlyMonth.length,earlyYearCount:earlyYear.length,
  earlyMonthMissing:missing(earlyMonth),earlyYearMissing:missing(earlyYear),
  incidentMonthMinutes:total(incidentMonth),incidentYearMinutes:total(incidentYear),
  incidentMonthCount:incidentMonth.length,incidentYearCount:incidentYear.length,
  incidentMonthMissing:missing(incidentMonth),incidentYearMissing:missing(incidentYear),
  absenceMonthMinutes:total(absenceMonth),absenceYearMinutes:total(absenceYear),
  absenceMonthCount:absenceMonth.length,absenceYearCount:absenceYear.length,
  absenceMonthMissing:missing(absenceMonth),absenceYearMissing:missing(absenceYear),
  totalMonthMinutes:total(hoursMonth),totalYearMinutes:total(hoursYear),
  totalMonthCount:hoursMonth.length,totalYearCount:hoursYear.length,
  totalMonthMissing:missing(hoursMonth),totalYearMissing:missing(hoursYear),
  eventCount:events.length,incidentCount:events.filter(e=>e.event_type==="incident").length
 };
}
function salaryFormatLate(minutes){
 const n=Number(minutes)||0;
 return Math.floor(n/60)+" h "+String(n%60).padStart(2,"0");
}
const salaryWeekdayNames=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
let salaryPayrollDraft=null,salaryPayrollMessage="";
function salaryWorkingDays(month,days){
 const [year,m]=month.split("-").map(Number);
 let count=0;
 for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++){
  if(days.includes(new Date(Date.UTC(year,m-1,d)).getUTCDay()))count++;
 }
 return count;
}
const salaryCalendars=new Map(),salaryCalendarRequests=new Set();
async function salaryCalendarEnsure(month,force=false){
 if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(month)||!token||page!=="salaires")return;
 if(salaryCalendarRequests.has(month)||!force&&salaryCalendars.has(month))return;
 salaryCalendarRequests.add(month);
 try{
  const data=await call(ROOT+'/personnel-planning','calendar-month','GET',undefined,{month});
  if(data.month!==month)throw new Error("Réponse de calendrier incohérente");
  salaryCalendars.set(month,{...data,error:""});
 }catch(e){
  salaryCalendars.set(month,{holidays:null,vacations:null,error:frError(e.message)});
 }finally{
  salaryCalendarRequests.delete(month);
  if(page==="salaires"&&(salaryMonth===month||salaryProfileEmployeeId&&salaryProfileMonth===month))salaryPage();
 }
}
function salaryCalendarBreakdown(staff,month,overrides){
 const days=overrides?.days||staff.working_weekdays||[1,2,3,4,5];
 const excludePublic=overrides?.excludePublic??staff.exclude_public_holidays??true;
 const excludeSchool=overrides?.excludeSchool??staff.exclude_school_holidays??false;
 const source=salaryCalendars.get(month);
 const base=salaryWorkingDays(month,days);
 if((excludePublic&&!Array.isArray(source?.holidays))||(excludeSchool&&!Array.isArray(source?.vacations))){
  return {base,net:null,publicDays:null,schoolDays:null,excludedPublic:excludePublic,excludedSchool:excludeSchool,source};
 }
 const holidays=new Set((source?.holidays||[]).map(x=>x.date));
 const vacations=source?.vacations||[];
 const [year,m]=month.split("-").map(Number);
 let publicDays=0,schoolDays=0,net=0;
 for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++){
  const date=month+"-"+String(d).padStart(2,"0"),weekday=new Date(Date.UTC(year,m-1,d)).getUTCDay();
  if(!days.includes(weekday))continue;
  if(excludePublic&&holidays.has(date)){publicDays++;continue}
  if(excludeSchool&&vacations.some(v=>date>v.start&&date<v.end)){schoolDays++;continue}
  net++;
 }
 return {base,net,publicDays,schoolDays,excludedPublic:excludePublic,excludedSchool:excludeSchool,source};
}
function salaryCalendarResultHtml(staff,month,overrides){
 const r=salaryCalendarBreakdown(staff,month,overrides),loading=salaryCalendarRequests.has(month);
 if(r.net===null)return '<span class="err">'+r.base+' jours planifiés · '+(loading||!r.source?'Vérification du calendrier officiel…':'Calendrier incomplet : '+esc(r.source.error||'source officielle indisponible'))+'</span>';
 return '<b>'+r.net+'</b> jour(s) théoriques travaillés sur '+r.base+' planifié(s)'+
  (r.excludedPublic?' · '+r.publicDays+' jour(s) férié(s) déduit(s)':'')+
  (r.excludedSchool?' · '+r.schoolDays+' jour(s) de vacances scolaires déduit(s)':'');
}
function salaryPayrollPanel(staff,month){
 const days=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.days:(Array.isArray(staff.working_weekdays)?staff.working_weekdays:[1,2,3,4,5]);
 const benefits=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.benefits:(Array.isArray(staff.benefits_in_kind)?staff.benefits_in_kind:[]);
 const total=benefits.reduce((n,b)=>n+(Number(b.amount)||0),0);
 const activeDraft=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft:null;
 const excludePublic=activeDraft?.excludePublic??staff.exclude_public_holidays??true;
 const excludeSchool=activeDraft?.excludeSchool??staff.exclude_school_holidays??false;
 return '<section class="card" style="margin:12px 0"><h3>Planning et avantages en nature</h3>'+
  '<p class="muted">Calcul mensuel selon les jours habituels du salarié et les calendriers officiels de France métropolitaine et des vacances scolaires de la zone C (académie de Versailles). Les congés individuels et les fermetures particulières restent à saisir séparément.</p>'+
  '<div style="display:flex;gap:12px;flex-wrap:wrap">'+salaryWeekdayNames.map((name,i)=>'<label style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" style="width:auto" data-payroll-day="'+i+'" '+(days.includes(i)?'checked':'')+'>'+name+'</label>').join("")+'</div>'+
  '<p><label><input type="checkbox" id="salaryExcludePublic" style="width:auto" '+(excludePublic?'checked':'')+'> Déduire les jours fériés non travaillés</label></p>'+
  '<p><label><input type="checkbox" id="salaryExcludeSchool" style="width:auto" '+(excludeSchool?'checked':'')+'> Déduire les vacances scolaires (uniquement si non travaillées selon le contrat)</label></p>'+
  '<p id="salaryPayrollWorkingCount">'+salaryCalendarResultHtml(staff,month,{days,excludePublic,excludeSchool})+'</p>'+
  '<button type="button" class="btn secondary compact" id="salaryCalendarRetry">Actualiser le calendrier officiel</button>'+
  '<h4>Avantages en nature</h4><div id="salaryPayrollBenefits">'+benefits.map((b,i)=>'<div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap"><input data-benefit-label="'+i+'" aria-label="Désignation de l’avantage '+(i+1)+'" maxlength="100" value="'+esc(b.label)+'" placeholder="Repas, logement, véhicule…" style="flex:2;min-width:150px"><input data-benefit-amount="'+i+'" aria-label="Montant mensuel en euros" type="number" min="0" max="100000" step="0.01" value="'+esc(b.amount)+'" style="flex:1;min-width:100px"><button type="button" class="btn secondary" data-benefit-remove="'+i+'">Supprimer</button></div>').join("")+'</div>'+
  '<button type="button" class="btn secondary" id="salaryBenefitAdd">+ Ajouter un avantage</button>'+
  '<p><b id="salaryBenefitTotal">'+total.toLocaleString("fr-FR",{style:"currency",currency:"EUR"})+'</b> / mois (valorisation indicative, à vérifier pour la paie)</p>'+
  '<button type="button" class="btn primary" id="salaryPayrollSave" '+(salaryStaffSaving?'disabled':'')+'>Enregistrer le planning et les avantages</button>'+
  (salaryPayrollMessage?'<p role="status">'+esc(salaryPayrollMessage)+'</p>':'')+'</section>';
}
function salaryPayrollReadDraft(){
 const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);
 if(!staff)return;
 const days=[...document.querySelectorAll("[data-payroll-day]:checked")].map(x=>Number(x.dataset.payrollDay));
 const benefits=[...document.querySelectorAll("[data-benefit-label]")].map(x=>({label:x.value,amount:Number(document.querySelector('[data-benefit-amount="'+x.dataset.benefitLabel+'"]')?.value)}));
 salaryPayrollDraft={id:staff.id,days,benefits,excludePublic:document.getElementById("salaryExcludePublic")?.checked??staff.exclude_public_holidays??true,excludeSchool:document.getElementById("salaryExcludeSchool")?.checked??staff.exclude_school_holidays??false};
}
function salaryPayrollRefreshDraft(){
 salaryPayrollReadDraft();
 salaryPage();
}
async function salaryPayrollSave(){
 if(salaryStaffSaving||!salaryPayrollDraft)return;
 const {id,days,benefits,excludePublic,excludeSchool}=salaryPayrollDraft;
 if(benefits.some(b=>!b.label.trim()||!Number.isFinite(b.amount)||b.amount<0||!Number.isInteger(b.amount*100))){salaryPayrollMessage="Vérifiez les désignations et montants des avantages.";salaryPage();return}
 salaryStaffSaving=true;salaryPayrollMessage="";salaryPage();
 try{
  await call(ROOT+'/personnel-planning','staff-payroll-update','POST',{id,working_weekdays:days,benefits_in_kind:benefits,exclude_public_holidays:excludePublic,exclude_school_holidays:excludeSchool});
  salaryPayrollDraft=null;salaryStaffLoaded=false;
  await salaryLoadStaff();
  salaryPayrollMessage="Planning et avantages enregistrés.";
 }catch(e){salaryPayrollMessage=frError(e.message)}
 finally{salaryStaffSaving=false;if(page==="salaires")salaryPage()}
}

function salaryStaffProfilePanel(){
 if(!salaryProfileEmployeeId)return "";
 const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);
 if(!staff)return "";
 const month=salaryProfileMonth||salaryCurrentMonth(),year=month.slice(0,4);
 const totals=salaryProfileTotals(salaryProfileEvents,month);
 const events=salaryProfileEvents;
 const monthPartial=totals.totalMonthMissing>0,yearPartial=totals.totalYearMissing>0;
 const summary='<div class="salary-profile-kpis">'+
  '<div><span>Total des heures · '+esc(salaryMonthLabel(month))+'</span><strong>'+salaryFormatLate(totals.totalMonthMinutes)+'</strong><small>'+(monthPartial?'Total partiel · '+totals.totalMonthMissing+' événement(s) sans durée en heures':totals.totalMonthCount+' événement(s) comptabilisé(s)')+'</small></div>'+
  '<div><span>Total des heures · année '+esc(year)+'</span><strong>'+salaryFormatLate(totals.totalYearMinutes)+'</strong><small>'+(yearPartial?'Total partiel · '+totals.totalYearMissing+' événement(s) sans durée en heures':totals.totalYearCount+' événement(s) comptabilisé(s)')+'</small></div>'+
  '<div><span>Historique complet</span><strong>'+totals.eventCount+' événement(s)</strong><small>'+totals.incidentCount+' incident(s) · toutes périodes</small></div></div>';
 const incompleteInfo=yearPartial?'<p class="salary-profile-explain" role="status"><b>Attention : cumul horaire partiel.</b> '+totals.totalYearMissing+' événement(s) de '+esc(year)+' ne possèdent pas de durée horaire exploitable (notamment une absence en journée entière). Une journée entière ne vaut pas automatiquement 24 h : renseignez sa durée de travail réelle pour l’inclure dans le total.</p>':
  !totals.totalYearCount?'<p class="salary-profile-explain">Aucun retard, départ anticipé ou absence déclaré pour '+esc(year)+'.</p>':'';
 const otherTotals='<div class="salary-profile-secondary">'+
  '<div><h3>Retards</h3><p><b>'+salaryFormatLate(totals.monthMinutes)+'</b> ce mois · '+totals.monthCount+' événement(s)</p><p><b>'+salaryFormatLate(totals.yearMinutes)+'</b> sur l’année · '+totals.yearCount+' événement(s)</p>'+(totals.yearMissing?'<small>'+totals.yearMissing+' événement(s) sans durée additionnable</small>':'')+'</div>'+
  '<div><h3>Départs anticipés</h3><p><b>'+salaryFormatLate(totals.earlyMonthMinutes)+'</b> ce mois · '+totals.earlyMonthCount+' événement(s)</p><p><b>'+salaryFormatLate(totals.earlyYearMinutes)+'</b> sur l’année · '+totals.earlyYearCount+' événement(s)</p>'+(totals.earlyYearMissing?'<small>'+totals.earlyYearMissing+' événement(s) sans durée additionnable</small>':'')+'</div>'+
  '<div><h3>Absences</h3><p><b>'+salaryFormatLate(totals.absenceMonthMinutes)+'</b> ce mois · '+totals.absenceMonthCount+' absence(s)</p><p><b>'+salaryFormatLate(totals.absenceYearMinutes)+'</b> sur l’année · '+totals.absenceYearCount+' absence(s)</p>'+(totals.absenceYearMissing?'<small>'+totals.absenceYearMissing+' absence(s) en journée entière ou sans durée exploitable</small>':'')+'</div>'+
  '<div><h3>Autres incidents (hors total)</h3><p><b>'+totals.incidentMonthCount+'</b> incident(s) ce mois · '+salaryFormatLate(totals.incidentMonthMinutes)+' renseignées</p><p><b>'+totals.incidentYearCount+'</b> sur l’année · '+salaryFormatLate(totals.incidentYearMinutes)+' renseignées</p>'+(totals.incidentYearMissing?'<small>'+totals.incidentYearMissing+' sans durée additionnable</small>':'')+'</div></div>';
 const content=salaryProfileLoading?'<p class="muted">Chargement de l’historique des événements…</p>':
  salaryProfileError?'<p class="err" role="alert">'+esc(salaryProfileError)+'</p>':
  salaryProfileLoaded?
   summary+incompleteInfo+otherTotals+'<p class="muted">Total global = retards + départs anticipés + absences, uniquement pour les durées horaires connues. Les incidents génériques sont listés séparément et ne sont pas ajoutés au total. Les événements ci-dessous couvrent toutes les années disponibles ; aucune retenue de paie n’est calculée.</p>'+
    (events.length?'<div class="table"><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Observation</th><th>Justificatif</th><th>Statut</th><th>PDF</th></tr></thead><tbody>'+
      events.map(e=>'<tr><td>'+esc(e.event_date||"")+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(e.details||"—")+'</td><td>'+esc(salaryJust[e.justification_status]||"—")+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td><td>'+(e.attachment_path?'<button class="btn secondary compact" type="button" data-salary-profile-pdf="'+esc(e.id)+'">Voir PDF</button>':'—')+'</td></tr>').join("")+
    '</tbody></table></div>':'<p class="muted">Aucun incident ou événement enregistré pour ce salarié.</p>'):
   '<p class="muted">Aucune donnée chargée.</p>';
 return '<section class="card salary-profile" id="salaryProfile" aria-labelledby="salaryProfileTitle">'+
  '<div class="salary-profile-head"><div><h2 id="salaryProfileTitle">Fiche salarié — '+esc(staff.name)+'</h2><p class="muted">'+(staff.archived?'Salarié archivé · historique conservé':'Salarié actif')+'</p></div>'+
  '<button class="btn secondary" type="button" id="salaryProfileClose">Fermer la fiche</button></div>'+
  '<div class="actions"><label for="salaryProfileMonth">Mois de référence</label><input id="salaryProfileMonth" type="month" value="'+esc(month)+'"'+(salaryProfileLoading?' disabled':'')+'><button class="btn secondary" type="button" id="salaryProfileRefresh"'+(salaryProfileLoading?' disabled':'')+'>Actualiser l’historique</button></div>'+
  '<p class="muted">Le cumul annuel correspond à l’année du mois sélectionné.</p>'+salaryPayrollPanel(staff,month)+content+'</section>';
}
async function salaryOpenStaffProfile(id){
 if(salaryView==="events")salaryView="staff";
 const staff=salaryStaff.find(p=>p.id===id);
 if(!staff)return;
 if(salaryProfileEmployeeId!==id)salaryProfileMonth=salaryCurrentMonth();
 salaryPayrollDraft=null;salaryPayrollMessage="";
 salaryProfileEmployeeId=id;salaryProfileEvents=[];salaryProfileLoaded=false;salaryProfileError="";salaryProfileLoading=true;
 const version=++salaryProfileRequestVersion;
 if(page==="salaires"){
  salaryPage();
  $('salaryProfile')?.scrollIntoView({behavior:"smooth",block:"start"});
 }
 try{
  const history=await call(ROOT+"/personnel-planning","admin-months");
  if(version!==salaryProfileRequestVersion)return;
  if(!Array.isArray(history.months))throw Error("Historique mensuel indisponible.");
  const months=[...new Set(history.months.filter(m=>Number(m.events)>0&&/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m.month||""))).map(m=>m.month))];
  const employeeKey=String(staff.name_key||salaryStaffKey(staff.name));
  const found=[];
  for(let i=0;i<months.length;i+=4){
   const batch=await Promise.all(months.slice(i,i+4).map(month=>
    call(ROOT+"/personnel-planning","admin-list","GET",undefined,{month})));
   if(version!==salaryProfileRequestVersion)return;
   for(const result of batch){
    if(!Array.isArray(result.events))throw Error("Un mois de l’historique est incomplet.");
    found.push(...result.events.filter(e=>salaryStaffKey(e.personnel_name)===employeeKey));
   }
  }
  if(version!==salaryProfileRequestVersion)return;
  salaryProfileEvents=[...new Map(found.map(e=>[e.id,e])).values()].sort((a,b)=>
   String(b.event_date||"").localeCompare(String(a.event_date||""))||
   String(b.created_at||"").localeCompare(String(a.created_at||"")));
  salaryProfileLoaded=true;
 }catch(e){
  if(version===salaryProfileRequestVersion)salaryProfileError=frError(e.message);
 }finally{
  if(version===salaryProfileRequestVersion){
   salaryProfileLoading=false;
   if(page==="salaires")salaryPage();
  }
 }
}
function salaryCloseStaffProfile(){
 salaryProfileRequestVersion++;
 salaryPayrollDraft=null;salaryPayrollMessage="";
 salaryProfileEmployeeId="";salaryProfileEvents=[];salaryProfileError="";salaryProfileLoading=false;
 salaryProfileLoaded=false;
 if(page==="salaires")salaryPage();
}

function salaryStaffPanel(){
 const state=salaryStaffLoading?'<p class="muted">Chargement de la liste du personnel…</p>':
  salaryStaffError?'<p class="err">'+esc(salaryStaffError)+'</p><button type="button" class="btn secondary" onclick="salaryLoadStaff()">Réessayer</button>':'';
 const active=salaryStaff.filter(p=>!p.archived),archived=salaryStaff.filter(p=>p.archived);
 const row=p=>{
  const visible=!p.archived&&p.visible_in_planning;
  return '<tr><td><b>'+esc(p.name)+'</b></td><td>'+(p.archived?'Archivé':visible?'Visible dans le planning':'Masqué du planning')+'</td>'+
   '<td><input type="checkbox" data-salary-staff-id="'+esc(p.id)+'" '+(visible?'checked':'')+' '+(p.archived||salaryStaffSaving?'disabled':'')+' aria-label="Afficher '+esc(p.name)+' dans le planning"></td>'+
   '<td><button type="button" class="btn primary compact" data-salary-staff-profile="'+esc(p.id)+'">Voir la fiche</button></td>'+
   '<td><button type="button" class="btn secondary compact" data-salary-archive="'+esc(p.id)+'" '+(salaryStaffSaving?'disabled':'')+'>'+(p.archived?'Réactiver':'Retirer de la liste')+'</button></td></tr>';
 };
 return '<section class="card salary-personnel"><h2>Salariés affichés dans le planning</h2>'+
  '<p class="muted">Gérez ici les personnes proposées dans « Planning → Nouvel incident ». Masquer ou archiver un salarié conserve ses incidents antérieurs et les récapitulatifs de paie.</p>'+
  (salaryStaffMessage?'<p class="ok" role="status">'+esc(salaryStaffMessage)+'</p>':'')+state+
  '<form id="salaryStaffAdd" class="salary-staff-form"><label for="salaryStaffName">Nom du nouveau salarié</label>'+
  '<input id="salaryStaffName" type="text" maxlength="120" required placeholder="Nom et prénom" autocomplete="off" '+(salaryStaffSaving?'disabled':'')+'>'+
  '<label><input id="salaryStaffVisible" type="checkbox" checked> Afficher dans le planning</label>'+
  '<button type="submit" class="btn primary" '+(salaryStaffSaving?'disabled':'')+'>Ajouter le salarié</button></form>'+
  '<div class="table"><table><thead><tr><th>Salarié</th><th>État</th><th>Afficher</th><th>Fiche salarié</th><th>Action</th></tr></thead><tbody>'+
  active.map(row).join('')+archived.map(row).join('')+
  (!salaryStaff.length?'<tr><td colspan="5">Aucun salarié enregistré.</td></tr>':'')+'</tbody></table></div></section>';
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
 document.querySelectorAll('[data-salary-staff-profile]').forEach(button=>button.addEventListener('click',()=>void salaryOpenStaffProfile(button.dataset.salaryStaffProfile)));
 document.querySelectorAll("[data-payroll-day],#salaryExcludePublic,#salaryExcludeSchool").forEach(x=>x.addEventListener("change",()=>{salaryPayrollReadDraft();const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);const count=$("salaryPayrollWorkingCount");if(count&&staff)count.innerHTML=salaryCalendarResultHtml(staff,salaryProfileMonth||salaryCurrentMonth(),salaryPayrollDraft)}));
 $("salaryCalendarRetry")?.addEventListener("click",()=>void salaryCalendarEnsure(salaryProfileMonth||salaryCurrentMonth(),true));
 document.querySelectorAll("[data-benefit-label],[data-benefit-amount]").forEach(x=>x.addEventListener("change",()=>{salaryPayrollReadDraft();const total=$("salaryBenefitTotal");if(total)total.textContent=salaryPayrollDraft.benefits.reduce((n,b)=>n+(Number(b.amount)||0),0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})}));
 $("salaryBenefitAdd")?.addEventListener("click",()=>{salaryPayrollReadDraft();salaryPayrollDraft.benefits.push({label:"",amount:0});salaryPage()});
 document.querySelectorAll("[data-benefit-remove]").forEach(x=>x.addEventListener("click",()=>{salaryPayrollReadDraft();salaryPayrollDraft.benefits.splice(Number(x.dataset.benefitRemove),1);salaryPage()}));
 $("salaryPayrollSave")?.addEventListener("click",()=>{salaryPayrollReadDraft();void salaryPayrollSave()});
 const close=$('salaryProfileClose');if(close)close.addEventListener('click',salaryCloseStaffProfile);
 const refresh=$('salaryProfileRefresh');if(refresh)refresh.addEventListener('click',()=>void salaryOpenStaffProfile(salaryProfileEmployeeId));
 const month=$('salaryProfileMonth');if(month)month.addEventListener('change',()=>{
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)){salaryProfileMonth=month.value;salaryPage()}
 });
 document.querySelectorAll('[data-salary-profile-pdf]').forEach(button=>button.addEventListener('click',()=>void salaryOpenIncidentPdf(button.dataset.salaryProfilePdf)));
 document.querySelectorAll('[data-salary-staff-id]').forEach(box=>box.addEventListener('change',()=>{
  const row=salaryStaff.find(x=>x.id===box.dataset.salaryStaffId);
  if(row)void salaryUpdateStaff(row.id,false,box.checked);
 }));
 document.querySelectorAll('[data-salary-archive]').forEach(button=>button.addEventListener('click',()=>{
  const row=salaryStaff.find(x=>x.id===button.dataset.salaryArchive);
  if(row)void salaryUpdateStaff(row.id,!row.archived,row.archived);
 }));
}

let salaryView="staff";
function salarySwitchView(view){if(["staff","events","settings"].includes(view)){salaryView=view;salaryPage()}}
function salarySettingsPanel(){
 const month=salaryMonth||salaryCurrentMonth();
 return '<section class="card"><h2>Paramètres du personnel</h2><p class="muted">Les horaires et avantages en nature se modifient dans chaque fiche salarié.</p>'+
 '<div class="actions"><label for="salarySettingsMonth">Mois de référence</label><input id="salarySettingsMonth" type="month" value="'+esc(month)+'" style="max-width:200px"><button id="salarySettingsCalendarReload" type="button" class="btn secondary">Actualiser les calendriers</button></div>'+
 (salaryStaffLoading?'<p>Chargement…</p>':salaryStaffError?'<p class="err">'+esc(salaryStaffError)+'</p>':
 '<div class="table"><table><thead><tr><th>Salarié</th><th>Jours travaillés</th><th>Jours théoriques du mois</th><th>Avantages / mois</th><th>Action</th></tr></thead><tbody>'+
 salaryStaff.filter(p=>!p.archived).map(p=>{
 const days=Array.isArray(p.working_weekdays)?p.working_weekdays:[1,2,3,4,5],benefits=Array.isArray(p.benefits_in_kind)?p.benefits_in_kind:[];
 return '<tr><td>'+esc(p.name)+'</td><td>'+esc(days.map(d=>salaryWeekdayNames[d]).join(", ")||"Aucun")+'</td><td>'+salaryCalendarResultHtml(p,month)+'</td><td>'+esc(benefits.reduce((n,b)=>n+(Number(b.amount)||0),0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"}))+' ('+benefits.length+')</td><td><button type="button" class="btn secondary compact" data-salary-staff-profile="'+esc(p.id)+'">Configurer</button></td></tr>';
 }).join("")+'</tbody></table></div>')+
 '<p class="muted">Jours théoriques selon jours habituels, jours fériés et vacances scolaires de la zone C, suivant les options de chaque salarié. Les congés individuels ne sont pas déduits. Aucun calcul de paie automatique.</p><p><a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE</a></p></section>';
}
function salaryPage(){
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 const groups=salaryGroups(),shown=groups.filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 const total=shown.reduce((n,[,g])=>n+g.items.length,0);
 const option=(val,label)=>'<option value="'+esc(val)+'"'+(salaryPerson===val?' selected':'')+'>'+esc(label)+'</option>';
 const nav='<nav class="card" aria-label="Rubriques Salaires" style="display:flex;gap:8px;flex-wrap:wrap">'+[['staff','Liste des salariés'],['events','Événements'],['settings','Paramètres']].map(([key,label])=>'<button type="button" class="btn '+(salaryView===key?'primary':'secondary')+'" data-salary-view="'+key+'" aria-pressed="'+(salaryView===key)+'">'+label+'</button>').join('')+'</nav>';
 if(salaryView==="staff")$('content').innerHTML=nav+salaryStaffPanel()+salaryStaffProfilePanel();
 else if(salaryView==="settings")$('content').innerHTML=nav+salarySettingsPanel()+salaryStaffProfilePanel();
 else{
 $('content').innerHTML=nav+salaryOverview()+'<div class="card" id="salaryMonthDetails"><h2>Salaires – Éléments variables du mois : '+esc(salaryMonthLabel(salaryMonth))+'</h2><p class="muted">Absences, retards, départs anticipés et incidents déclarés par le secrétariat, regroupés par salarié. Ces données ne constituent pas un bulletin de salaire.</p><div class="actions" style="align-items:center;flex-wrap:wrap"><label for="salaryMonth">Mois</label><input id="salaryMonth" type="month" value="'+esc(salaryMonth)+'" style="max-width:180px"><label for="salaryPerson">Salarié</label><select id="salaryPerson" style="max-width:260px">'+option("all","Tous les salariés")+groups.map(([key,g])=>option(key,g.name)).join("")+'</select><button class="btn secondary" onclick="salaryLoad()">Actualiser</button><button class="btn primary" onclick="salaryExportCsv()" '+(!total?'disabled':'')+'>Exporter CSV</button><button class="btn secondary" onclick="salaryPrint()" '+(!total?'disabled':'')+'>Imprimer / PDF</button><a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE (Urssaf)</a></div><p class="muted">Vérifiez les données avant toute déclaration sur le TESE. Aucun transfert automatique et aucune retenue sur salaire ne sont effectués.</p></div>'+
 (salaryLoading?'<div class="card">Chargement des événements…</div>':'')+
 (salaryError?'<div class="card" style="color:#a32929">'+esc(salaryError)+'</div>':'')+
 (!salaryLoading&&!salaryError?'<div class="card"><b>'+shown.length+' salarié(s) · '+total+' événement(s) · '+shown.reduce((n,[,g])=>n+g.items.filter(e=>e.event_type==="incident").length,0)+' incident(s)</b></div>':'')+
 (!salaryLoading&&!salaryError?(shown.length?shown.map(([,g])=>'<div class="card"><h3>'+esc(g.name)+' <span class="muted">('+g.items.length+' événement(s), '+g.items.filter(e=>e.event_type==="incident").length+' incident(s))</span></h3><div class="table"><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Justificatif</th><th>PDF</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+(e.attachment_path?'<button class="btn secondary compact" type="button" onclick="salaryOpenIncidentPdf(\''+esc(e.id)+'\')">Voir le PDF</button>':'—')+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td></tr>').join("")+'</tbody></table></div></div>').join(""):'<div class="card"><p>Aucun événement enregistré pour cette période.</p></div>'):'');
 }
 document.querySelectorAll('[data-salary-view]').forEach(button=>button.addEventListener('click',()=>salarySwitchView(button.dataset.salaryView)));
 $('salarySettingsMonth')?.addEventListener('change',e=>{if(/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(e.target.value)){salaryMonth=e.target.value;salaryPage()}});
 $('salarySettingsCalendarReload')?.addEventListener('click',()=>void salaryCalendarEnsure(salaryMonth,true));
 salaryWireStaff();
 document.querySelectorAll('[data-salary-month]').forEach(button=>button.addEventListener('click',()=>salarySelectMonth(button.dataset.salaryMonth)));
 const month=$('salaryMonth');if(month)month.addEventListener('change',e=>salarySelectMonth(e.target.value));
 const person=$('salaryPerson');if(person)person.addEventListener('change',e=>{salaryPerson=e.target.value;salaryPage()});
 if(salaryView==="settings"||salaryProfileEmployeeId){
  void salaryCalendarEnsure(salaryMonth);
  if(salaryProfileEmployeeId)void salaryCalendarEnsure(salaryProfileMonth||salaryCurrentMonth());
 }

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
