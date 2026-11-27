/* Administration Cours Chambertin : journal mensuel des éléments du personnel */
let salaryMonth=null,salaryEvents=[],salaryError="",salaryLoading=false,salaryPerson="all",salaryMonthSummaries=[],salaryHistoryError="",salaryHistoryLoading=false,salaryHistoryLoaded=false,salaryRequestVersion=0,salaryStaff=[],salaryStaffLoaded=false,salaryStaffLoading=false,salaryStaffSaving=false,salaryStaffError="",salaryStaffMessage="",salaryProfileEmployeeId="",salaryProfileMonth="",salaryProfileEvents=[],salaryProfileLoading=false,salaryProfileError="",salaryProfileLoaded=false,salaryProfileRequestVersion=0;
let salaryProfessionalRoles=[],salaryCanWrite=false,salaryProfileEditDraft=null,salaryProfileEditMessage="",salaryRoleMessage="";
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
 if(!salaryPageVisible()||!token||salaryHistoryLoading)return;
 salaryHistoryLoading=true;salaryHistoryError="";salaryPage();
 try{
  const data=await call(ROOT+'/personnel-planning','admin-months');
  salaryMonthSummaries=Array.isArray(data.months)?data.months:[];
  salaryHistoryLoaded=true;
 }catch(e){salaryHistoryError=frError(e.message)}
 finally{salaryHistoryLoading=false;if(salaryPageVisible())salaryPage()}
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
let salaryScheduleHistory=[],salaryScheduleHistoryLoaded=false,salaryScheduleHistoryLoading=false,salaryScheduleHistoryError="";
async function salaryLoadScheduleHistory(){
 if(salaryScheduleHistoryLoading||salaryScheduleHistoryLoaded||!salaryStaffLoaded)return;
 salaryScheduleHistoryLoading=true;salaryScheduleHistoryError="";
 try{
  const result=await call(ROOT+"/personnel-planning","staff-schedule-history");
  if(!Array.isArray(result.history))throw Error("Historique horaire invalide");
  salaryScheduleHistory=result.history;salaryScheduleHistoryLoaded=true;
 }catch(e){salaryScheduleHistoryError=frError(e.message)}
 finally{salaryScheduleHistoryLoading=false;if(salaryPageVisible())salaryPage()}
}
function salaryArchivedSlots(slots){
 const weekdays=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
 const rows=[1,2,3,4,5,6,0].map(day=>{
  const times=(Array.isArray(slots)?slots:[]).filter(s=>s.day===day).map(s=>s.start+"–"+s.end);
  return times.length?'<tr><th>'+weekdays[day]+'</th><td>'+esc(times.join(" / "))+'</td></tr>':"";
 }).filter(Boolean);
 return '<table class="data-table"><tbody>'+rows.join("")+'</tbody></table>';
}
function salaryArchiveItemHtml(h){
 const schoolDays=[...new Set((h.school_weekly_work_slots||[]).map(x=>x.day))];
 const vacationDays=[...new Set((h.vacation_weekly_work_slots||[]).map(x=>x.day))];
 const school=salaryWorkSlotSummary(schoolDays,h.school_weekly_work_slots);
 const vacation=salaryWorkSlotSummary(vacationDays,h.vacation_weekly_work_slots);
 const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const current=h.source_start<=today&&h.source_end>=today;
 const isTeam=h.schedule_scope==='team';
 const scopeLabel=isTeam?'Horaires collectifs de cantine · non affectés':h.personnel_id?'Fiche reliée':'Ancien salarié non rapproché';
 const sourceLabel='Source : '+h.source_document+(h.source_sheet_name?' · onglet '+h.source_sheet_name:'');
 return '<details class="card" style="margin:10px 0"><summary><b>'+esc(h.employee_name)+'</b> · '+esc(h.source_start)+' au '+esc(h.source_end)+' · '+esc(scopeLabel)+'</summary>'+
 '<p class="muted">'+esc(sourceLabel)+'. '+(current?'Planning annuel 2026-2027 : les horaires de vacances servent aux calculs théoriques de cette année. Les créneaux scolaires sont modifiables dans la fiche.':'Archive historique sans effet sur les horaires actuels.')+'</p>'+
 '<div class="salary-profile-secondary"><div><h3>Période scolaire · '+(school.weeklyMinutes===null?'À vérifier':salaryFormatLate(school.weeklyMinutes)+' / semaine')+'</h3>'+salaryArchivedSlots(h.school_weekly_work_slots)+'</div>'+
 '<div><h3>Vacances scolaires · '+(vacation.weeklyMinutes===null?'À vérifier':salaryFormatLate(vacation.weeklyMinutes)+' / semaine')+'</h3>'+salaryArchivedSlots(h.vacation_weekly_work_slots)+'</div></div></details>';
}
function salaryArchivePanel(personnelId=null){
 const rows=salaryScheduleHistory.filter(x=>!personnelId||x.personnel_id===personnelId);
 if(salaryScheduleHistoryLoading)return '<p class="muted">Chargement des horaires historiques…</p>';
 if(salaryScheduleHistoryError)return '<p class="err">Archives indisponibles : '+esc(salaryScheduleHistoryError)+'</p><button class="btn secondary" type="button" id="salaryArchiveRetry">Réessayer</button>';
 if(!salaryScheduleHistoryLoaded)return '<p class="muted">Chargement des archives…</p>';
 if(!rows.length)return personnelId?'':'<p>Aucune archive horaire.</p>';
 return rows.map(salaryArchiveItemHtml).join("");
}


function salaryAnnualForDate(staff,date){
 if(!staff?.id||!salaryScheduleHistoryLoaded)return null;
 return salaryScheduleHistory.find(x=>x.personnel_id===staff.id&&x.schedule_scope!=='team'&&x.source_start<=date&&date<=x.source_end&&Array.isArray(x.vacation_periods)&&x.vacation_periods.length>0&&Array.isArray(x.vacation_weekly_work_slots))||null;
}
function salaryAnnualVacationOn(annual,date){
 return !!annual?.vacation_periods?.some(period=>period&&typeof period.start==='string'&&typeof period.end==='string'&&period.start<=date&&date<=period.end);
}
function salaryWorkingDays(month,days){
 const [year,m]=month.split("-").map(Number);
 let count=0;
 for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++){
  if(days.includes(new Date(Date.UTC(year,m-1,d)).getUTCDay()))count++;
 }
 return count;
}
function salaryWorkSlotSummary(days,slots){
 const minutesByDay=Array(7).fill(0),counts=Array(7).fill(0),clean=[];
 const clock=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
 const minutes=v=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
 const invalid=message=>({error:message,slots:[],weeklyMinutes:null,minutesByDay,missingDays:[]});
 if(!Array.isArray(days)||days.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(days).size!==days.length||!Array.isArray(slots))return invalid("Planning invalide.");
 for(const slot of slots){
  if(!slot||!Number.isInteger(slot.day)||slot.day<0||slot.day>6)return invalid("Jour de travail invalide.");
  if(!days.includes(slot.day))continue;
  if(slot.start===""&&slot.end==="")continue;
  if(typeof slot.start!=="string"||typeof slot.end!=="string"||!clock.test(slot.start)||!clock.test(slot.end)||slot.start>=slot.end)
   return invalid(salaryWeekdayNames[slot.day]+" : renseignez un début et une fin valides le même jour.");
  if(++counts[slot.day]>8)return invalid("8 créneaux maximum par jour.");
  clean.push({day:slot.day,start:slot.start,end:slot.end});
 }
 clean.sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start));
 for(let i=0;i<clean.length;i++){
  const slot=clean[i],previous=clean[i-1];
  if(previous?.day===slot.day&&previous.end>slot.start)return invalid(salaryWeekdayNames[slot.day]+" : les créneaux se chevauchent.");
  minutesByDay[slot.day]+=minutes(slot.end)-minutes(slot.start);
 }
 const missingDays=days.filter(d=>counts[d]===0);
 return {error:"",slots:clean,minutesByDay,missingDays,weeklyMinutes:missingDays.length?null:minutesByDay.reduce((a,b)=>a+b,0)};
}
function salaryHoursBreakdown(staff,month,overrides){
 const days=overrides?.days??staff.working_weekdays??[1,2,3,4,5];
 const slots=overrides?.slots??staff.weekly_work_slots??[];
 const summary=salaryWorkSlotSummary(days,slots);
 const calendar=salaryCalendarBreakdown(staff,month,{...overrides,days,slots});
 const monthlyMinutes=summary.weeklyMinutes===null||calendar.net===null?null:calendar.monthlyScheduledMinutes;
 return {...summary,monthlyMinutes,calendar};
}
function salaryHoursResultHtml(staff,month,overrides){
 const r=salaryHoursBreakdown(staff,month,overrides);
 if(r.error)return '<span class="err">'+esc(r.error)+'</span>';
 if(r.missingDays.length)return '<span class="muted">Horaires à compléter : '+esc(r.missingDays.map(d=>salaryWeekdayNames[d]).join(", "))+' — totaux indisponibles.</span>';
 const annual=salaryAnnualForDate(staff,month+"-15");
 const vacationDays=annual?[...new Set(annual.vacation_weekly_work_slots.map(slot=>slot.day))]:[];
 const vacation=annual?salaryWorkSlotSummary(vacationDays,annual.vacation_weekly_work_slots):null;
 const label=vacation&&!vacation.error&&vacation.weeklyMinutes!==null?' période scolaire · <b>'+salaryFormatLate(vacation.weeklyMinutes)+'</b> / semaine de vacances':'';
 return '<b>'+salaryFormatLate(r.weeklyMinutes)+'</b> / semaine'+label+' · '+(r.monthlyMinutes===null?'<span class="muted">Total mensuel : calendrier ou créneaux à vérifier</span>':'<b>'+salaryFormatLate(r.monthlyMinutes)+'</b> théoriques sur le mois sélectionné');
}
function salaryWeeklyScheduleHtml(days,slots,disabled){
 const lock=disabled?' disabled':'';
 const order=[1,2,3,4,5,6,0],stats=salaryWorkSlotSummary(days,slots);
 return '<div class="salary-weekly-grid">'+order.map(day=>{
  const active=days.includes(day);
  const existing=slots.filter(s=>s.day===day);
  const entries=existing.length?existing:[{day,start:"",end:""}];
  const dayName=salaryWeekdayNames[day],dayTotal=stats.error||stats.missingDays.includes(day)?"À renseigner":salaryFormatLate(stats.minutesByDay[day]);
  return '<section class="salary-weekday'+(active?'':' salary-day-off')+'">'+
   '<div class="salary-day-heading"><label><input type="checkbox" data-payroll-day="'+day+'" '+(active?'checked':'')+lock+'> <b>'+dayName+'</b></label><span class="muted" data-work-day-total="'+day+'">'+(active?dayTotal:"Repos")+'</span></div>'+
   '<div class="salary-day-slots"'+(active?'':' hidden')+'>'+
    entries.map((slot,index)=>'<div class="salary-slot-row" data-work-slot="'+day+'"><label><span>Début</span><input aria-label="'+dayName+' : début du créneau '+(index+1)+'" type="time" data-work-start value="'+esc(slot.start)+'"'+lock+'></label><label><span>Fin</span><input aria-label="'+dayName+' : fin du créneau '+(index+1)+'" type="time" data-work-end value="'+esc(slot.end)+'"'+lock+'></label><button class="btn secondary compact" type="button" data-remove-work-slot="'+day+':'+index+'" aria-label="Retirer le créneau '+(index+1)+' du '+dayName.toLowerCase()+'"'+lock+'>Retirer</button></div>').join("")+
    '<button type="button" class="btn secondary compact" data-add-work-slot="'+day+'"'+(disabled||entries.length>=8?' disabled':'')+'>+ Ajouter un créneau</button>'+
   '</div></section>';
 }).join("")+'</div>';
}
function salaryRefreshPayrollTotals(){
 const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);
 if(!staff||!salaryPayrollDraft)return;
 const month=salaryProfileMonth||salaryCurrentMonth(),draft=salaryPayrollDraft;
 const count=$("salaryPayrollWorkingCount"),hours=$("salaryPayrollHoursCount"),total=$("salaryBenefitTotal");
 if(count)count.innerHTML=salaryCalendarResultHtml(staff,month,draft);
 if(hours)hours.innerHTML=salaryHoursResultHtml(staff,month,draft);
 if(total){
 const pending=draft.benefits.filter(b=>b.status&&!["ok","excluded","manual"].includes(b.status));
 total.textContent=pending.length?pending.length+" avantage(s) à compléter":draft.benefits.reduce((n,b)=>n+(Number(b.amount)||0),0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
 }
 for(const [i,b] of draft.benefits.entries()){
  const status=document.querySelector('[data-benefit-status="'+i+'"]');
  if(!status)continue;
  const result=window.ChambertinBenefitQuestionnaire?.evaluate(salaryProfileMonth||salaryCurrentMonth(),b);
  if(result)status.textContent=result.message+(result.amountCents===null?" · Montant non calculable":" · "+(result.amountCents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"})+" / mois");
 }
 const stats=salaryWorkSlotSummary(draft.days,draft.slots);
 document.querySelectorAll("[data-work-day-total]").forEach(el=>{
  const day=Number(el.dataset.workDayTotal);
  el.textContent=!draft.days.includes(day)?"Repos":stats.error||stats.missingDays.includes(day)?"À renseigner":salaryFormatLate(stats.minutesByDay[day]);
 });
}
const salaryCalendars=new Map(),salaryCalendarRequests=new Set();
async function salaryCalendarEnsure(month,force=false){
 if(!/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(month)||!token||!salaryPageVisible())return;
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
  if(salaryPageVisible()&&(salaryMonth===month||salaryProfileEmployeeId&&salaryProfileMonth===month))salaryPage();
 }
}
function salaryCalendarBreakdown(staff,month,overrides){
 const days=overrides?.days??staff.working_weekdays??[1,2,3,4,5];
 const slots=overrides?.slots??staff.weekly_work_slots??[];
 const excludePublic=overrides?.excludePublic??staff.exclude_public_holidays??true;
 const excludeSchool=overrides?.excludeSchool??staff.exclude_school_holidays??false;
 const source=salaryCalendars.get(month);
 const holidays=Array.isArray(source?.holidays)?new Set(source.holidays.map(x=>x.date)):null;
 const officialVacations=Array.isArray(source?.vacations)?source.vacations:null;
 const baseline=salaryWorkSlotSummary(days,slots);
 const importedYear=salaryScheduleHistoryLoaded&&salaryScheduleHistory.some(x=>x.personnel_id===staff.id&&x.source_start==="2026-09-01"&&x.source_end==="2027-08-31");
 const inImportYear=month>="2026-09"&&month<="2027-08"&&["SEPULCHRE","SIMON","HUGUENOT","MOREL"].includes(String(staff.name).trim().toUpperCase());
 const outsideImportedYear=importedYear&&(month<"2026-09"||month>"2027-08")&&!salaryAnnualForDate(staff,month+"-15");
 const missingAnnual=inImportYear&&(!salaryScheduleHistoryLoaded||!salaryAnnualForDate(staff,month+"-15"));
 const noAnnual=missingAnnual||outsideImportedYear;
 const incompleteSource=noAnnual||(excludePublic&&!holidays)||(excludeSchool&&!officialVacations);
 const [year,m]=month.split("-").map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
 let base=0,net=0,publicDays=0,schoolDays=0,vacationDays=0,monthlyMinutes=0,missingHours=!!baseline.error;
 const workedDaysByWeekday=Array(7).fill(0),vacationCache=new Map(),scheduledMinutesByDate=Object.create(null);
 for(let d=1;d<=last;d++){
  const date=month+"-"+String(d).padStart(2,"0"),weekday=new Date(Date.UTC(year,m-1,d)).getUTCDay();
  const annual=salaryAnnualForDate(staff,date),inImportedVacation=salaryAnnualVacationOn(annual,date);
  let planned=days.includes(weekday),plan=baseline;
  if(inImportedVacation){
   if(!vacationCache.has(annual.id)){
    const holidayDays=[...new Set(annual.vacation_weekly_work_slots.map(slot=>slot.day))];
    vacationCache.set(annual.id,salaryWorkSlotSummary(holidayDays,annual.vacation_weekly_work_slots));
   }
   plan=vacationCache.get(annual.id);
   planned=plan.slots.some(slot=>slot.day===weekday);
  }
  if(!planned)continue;
  base++;
  if(excludePublic&&holidays?.has(date)){publicDays++;continue}
  const isVacation=inImportedVacation||(!annual&&officialVacations?.some(v=>date>v.start&&date<v.end));
  if(excludeSchool&&isVacation){schoolDays++;continue}
  net++;workedDaysByWeekday[weekday]++;
  if(inImportedVacation)vacationDays++;
  if(plan.error||plan.missingDays.includes(weekday)){missingHours=true;scheduledMinutesByDate[date]=null}
  else{scheduledMinutesByDate[date]=plan.minutesByDay[weekday];monthlyMinutes+=plan.minutesByDay[weekday]}
 }
 return {
  base,net:incompleteSource?null:net,publicDays,schoolDays,vacationDays,workedDaysByWeekday,
  monthlyScheduledMinutes:incompleteSource||missingHours?null:monthlyMinutes,
  scheduledMinutesByDate:incompleteSource?null:scheduledMinutesByDate,
  excludedPublic:excludePublic,excludedSchool:excludeSchool,source,
  error:outsideImportedYear?"Pas de planning annuel vérifié pour cette période.":missingAnnual?(salaryScheduleHistoryLoaded?"Planning annuel 2026-2027 introuvable.":"Chargement du planning annuel 2026-2027 nécessaire."):null
 };
}
function salaryCalendarResultHtml(staff,month,overrides){
 const r=salaryCalendarBreakdown(staff,month,overrides),loading=salaryCalendarRequests.has(month);
 if(r.net===null)return '<span class="err">'+r.base+' jours planifiés · '+(r.error?esc(r.error):loading||!r.source?'Vérification du calendrier officiel…':'Calendrier incomplet : '+esc(r.source.error||'source officielle indisponible'))+'</span>';
 return '<b>'+r.net+'</b> jour(s) théoriques travaillés sur '+r.base+' planifié(s)'+
  (r.excludedPublic?' · '+r.publicDays+' jour(s) férié(s) déduit(s)':'')+
  (r.excludedSchool?' · '+r.schoolDays+' jour(s) de vacances scolaires déduit(s)':'')+
  (r.vacationDays?' · '+r.vacationDays+' jour(s) en horaires de vacances':'');
}
function salaryPayrollPanel(staff,month){
 const days=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.days:(Array.isArray(staff.working_weekdays)?staff.working_weekdays:[1,2,3,4,5]);
 const benefits=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.benefits:(Array.isArray(staff.benefits_in_kind)?staff.benefits_in_kind:[]);
 const valuations=benefits.map(b=>window.ChambertinBenefitQuestionnaire?.evaluate(month,b));
 const pendingCount=valuations.filter(v=>!v||!["ok","excluded","manual"].includes(v.status)).length;
 const total=valuations.reduce((sum,v)=>sum+(v?.amountCents||0),0)/100;
 const activeDraft=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft:null;
 const excludePublic=activeDraft?.excludePublic??staff.exclude_public_holidays??true;
 const excludeSchool=activeDraft?.excludeSchool??staff.exclude_school_holidays??false;
 const slots=activeDraft?.slots??(Array.isArray(staff.weekly_work_slots)?staff.weekly_work_slots:[]);
 const readOnly=!salaryCanWrite||salaryStaffSaving,lock=readOnly?" disabled":"";
 return '<section class="card" id="salaryWeeklySchedule" style="margin:12px 0;scroll-margin-top:18px"><h3>Horaires de travail, planning et avantages en nature</h3>'+
  '<p class="muted">Calcul mensuel selon les horaires scolaires et, lorsqu’un planning annuel existe, les horaires spécifiques des vacances aux dates définies. Les jours fériés sont contrôlés séparément. Les congés individuels et fermetures particulières restent à saisir séparément.</p>'+
  '<h4>Horaires de période scolaire</h4><p class="muted">Cochez les jours travaillés et saisissez un ou plusieurs créneaux. Pour une pause non travaillée, séparez les créneaux (ex. 08:00–12:00 puis 13:00–17:00). Les horaires traversant minuit ne sont pas pris en charge. Le planning de vacances importé est affiché plus bas dans cette fiche.</p>'+'<div class="salary-schedule-tools"><label for="salaryScheduleCopyFrom">Recopier les horaires du</label><select id="salaryScheduleCopyFrom"'+lock+'>'+days.map(day=>'<option value="'+day+'">'+esc(salaryWeekdayNames[day])+'</option>').join("")+'</select><button type="button" class="btn secondary compact" id="salaryScheduleCopy"'+(readOnly||days.length<2?' disabled':'')+'>Appliquer aux autres jours travaillés</button></div>'+
  salaryWeeklyScheduleHtml(days,slots,readOnly)+
  '<div class="salary-hours-summary"><p class="muted">Heures théoriques selon le planning actuel, pas des heures pointées ni un historique contractuel.</p><div id="salaryPayrollHoursCount">'+salaryHoursResultHtml(staff,month,{days,slots,excludePublic,excludeSchool})+'</div></div>'+
  '<p><label><input type="checkbox" id="salaryExcludePublic" style="width:auto" '+(excludePublic?'checked':'')+lock+'> Déduire les jours fériés non travaillés</label></p>'+
  '<p><label><input type="checkbox" id="salaryExcludeSchool" style="width:auto" '+(excludeSchool?'checked':'')+lock+'> Déduire les vacances scolaires (uniquement si non travaillées selon le contrat)</label></p>'+
  '<p id="salaryPayrollWorkingCount">'+salaryCalendarResultHtml(staff,month,{days,excludePublic,excludeSchool})+'</p>'+
  '<button type="button" class="btn secondary compact" id="salaryCalendarRetry">Actualiser le calendrier officiel</button>'+
  '<h4>Avantages en nature</h4><p class="muted">Sélectionnez le type d’avantage : seules les questions utiles seront affichées. Les calculs sont des propositions pour la paie et sont datés.</p><div id="salaryPayrollBenefits">'+benefits.map((b,i)=>window.ChambertinBenefitQuestionnaire?.display(i,b,month,readOnly)||'<p class="err">Questionnaire des avantages indisponible.</p>').join("")+'</div>'+
  '<button type="button" class="btn secondary" id="salaryBenefitAdd"'+lock+'>+ Ajouter un avantage</button>'+
  '<p><b id="salaryBenefitTotal">'+(pendingCount?pendingCount+' avantage(s) à compléter':total.toLocaleString("fr-FR",{style:"currency",currency:"EUR"}))+'</b> / mois (estimation du mois sélectionné, jamais un net à virer)</p>'+
  '<p class="muted">Sources 2026 : <a href="https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/avantages-en-nature.html" target="_blank" rel="noopener noreferrer">barèmes Urssaf</a> · <a href="https://www.iledefrance-mobilites.fr/titres-et-tarifs/detail/forfait-navigo-mois" target="_blank" rel="noopener noreferrer">Navigo Mois</a>. Si le barème de l’année est absent, la valorisation est bloquée. Les anciens bulletins restent inchangés.</p>'+
  '<button type="button" class="btn primary" id="salaryPayrollSave" '+(salaryStaffSaving||!salaryCanWrite?'disabled':'')+'>Enregistrer les horaires, le planning et les avantages</button>'+
  (salaryPayrollMessage?'<p role="status">'+esc(salaryPayrollMessage)+'</p>':'')+'</section>';
}
function salaryCopyDaySchedule(){
 if(!salaryCanWrite||salaryStaffSaving)return;
 const source=Number($("salaryScheduleCopyFrom")?.value);
 salaryPayrollReadDraft();
 const draft=salaryPayrollDraft;
 if(!draft||!draft.days.includes(source))return;
 const sourceSlots=draft.slots.filter(slot=>slot.day===source);
 const validated=salaryWorkSlotSummary([source],sourceSlots);
 if(validated.error||validated.missingDays.length){
  salaryPayrollMessage=validated.error||"Complétez les créneaux du jour choisi avant de les recopier.";
  salaryPage();return;
 }
 const destinations=draft.days.filter(day=>day!==source);
 if(!destinations.length)return;
 if(draft.slots.some(slot=>destinations.includes(slot.day)&&(slot.start||slot.end))&&
    !confirm("Remplacer les horaires existants des "+destinations.length+" autres jours travaillés par ceux du "+salaryWeekdayNames[source].toLowerCase()+" ?"))return;
 draft.slots=[
  ...draft.slots.filter(slot=>!destinations.includes(slot.day)),
  ...destinations.flatMap(day=>validated.slots.map(slot=>({day,start:slot.start,end:slot.end})))
 ];
 salaryPayrollMessage="Créneaux de "+salaryWeekdayNames[source].toLowerCase()+" recopiés sur "+destinations.length+" jour(s). Cliquez sur Enregistrer pour sauvegarder.";
 salaryPage();
}
function salaryPayrollReadDraft(){
 const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);
 if(!staff||!$("salaryPayrollSave"))return;
 const days=[...document.querySelectorAll("[data-payroll-day]:checked")].map(x=>Number(x.dataset.payrollDay));
 const engine=window.ChambertinBenefitQuestionnaire;
 const previous=salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.benefits:Array.isArray(staff.benefits_in_kind)?staff.benefits_in_kind:[];
 const month=salaryProfileMonth||salaryCurrentMonth();
 const benefits=[...document.querySelectorAll("[data-benefit-row]")].map(node=>{
  const i=Number(node.dataset.benefitRow),earlier=previous[i]||{},kind=node.querySelector("[data-benefit-kind]")?.value||earlier.kind||"manual";
  const details=Object.fromEntries([...node.querySelectorAll("[data-benefit-input]")].map(el=>[el.dataset.benefitKey,String(el.value||"")]));
  const label=node.querySelector("[data-benefit-label]")?.value||"";
  const amount=Number(node.querySelector("[data-benefit-amount]")?.value);
  const checkbox=node.querySelector("[data-benefit-confirm]");
  const b={kind,label,amount:Number.isFinite(amount)?amount:0,details,confirmed:kind==="manual"?(checkbox?.checked??(earlier.confirmed!==false)):false};
  return engine?.normalize(b,month)||b;
 });
 const slots=[...document.querySelectorAll("[data-work-slot]")].map(row=>({day:Number(row.dataset.workSlot),start:row.querySelector("[data-work-start]")?.value||"",end:row.querySelector("[data-work-end]")?.value||""}));
 salaryPayrollDraft={id:staff.id,updated_at:salaryPayrollDraft?.id===staff.id?salaryPayrollDraft.updated_at:staff.updated_at,days,slots,benefits,excludePublic:document.getElementById("salaryExcludePublic")?.checked??staff.exclude_public_holidays??true,excludeSchool:document.getElementById("salaryExcludeSchool")?.checked??staff.exclude_school_holidays??false};
}
function salaryPayrollRefreshDraft(){
 salaryPayrollReadDraft();
 salaryPage();
}
async function salaryPayrollSave(){
 if(salaryStaffSaving||!salaryCanWrite||!salaryPayrollDraft)return;
 const {id,updated_at,days,slots,benefits,excludePublic,excludeSchool}=salaryPayrollDraft;
 const schedule=salaryWorkSlotSummary(days,slots);
 if(schedule.error){salaryPayrollMessage=schedule.error;salaryPage();return}
 if(benefits.some(b=>!b.label.trim()||!Number.isFinite(b.amount)||b.amount<0||Math.abs(Math.round(b.amount*100)-b.amount*100)>1e-7||b.status&&!["ok","excluded","manual"].includes(b.status))){
  salaryPayrollMessage="Complétez toutes les questions essentielles des avantages et vérifiez les montants avant enregistrement.";salaryPage();return
 }
 salaryStaffSaving=true;salaryPayrollMessage="";salaryPage();
 try{
  const saved=await call(ROOT+'/personnel-planning','staff-payroll-update','POST',{id,updated_at,working_weekdays:days,weekly_work_slots:schedule.slots,benefits_in_kind:benefits,exclude_public_holidays:excludePublic,exclude_school_holidays:excludeSchool});
  if(saved.staff?.id!==id||!Array.isArray(saved.staff.weekly_work_slots))throw Error("L'enregistrement des horaires n'a pas été confirmé.");
  salaryStaff=salaryStaff.map(p=>p.id===id?{...p,...saved.staff}:p);
  if(salaryProfileEditDraft?.id===id&&salaryProfileEditDraft.updated_at===updated_at)salaryProfileEditDraft.updated_at=saved.staff.updated_at;
  salaryPayrollDraft=null;salaryStaffLoaded=false;
  await salaryLoadStaff();
  salaryPayrollMessage="Horaires, planning et avantages enregistrés."+(schedule.missingDays.length?" Certains jours travaillés restent à compléter.":"");
 }catch(e){salaryPayrollMessage=frError(e.message)}
 finally{salaryStaffSaving=false;if(salaryPageVisible())salaryPage()}
}

function salaryRoleLabel(id){return salaryProfessionalRoles.find(r=>r.id===id)?.label||"Non attribué"}
function salaryRoleOptions(id){
 return '<option value="">Non attribué</option>'+salaryProfessionalRoles.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===id?"selected":"")+'>'+esc(r.label)+'</option>').join("");
}
function salaryIdentityPanel(staff){
 const draft=salaryProfileEditDraft?.id===staff.id?salaryProfileEditDraft:staff;
 const disabled=!salaryCanWrite||salaryStaffSaving?" disabled":"";
 return '<section class="card salary-identity" style="margin:12px 0"><h3>Identité et rôle professionnel</h3>'+
  '<p class="muted">Le rôle décrit la fonction du salarié dans le Cours Chambertin. Il ne donne aucun pouvoir d’accès au site. Les anciens événements restent rattachés à la même fiche.</p>'+
  '<form id="salaryStaffProfileEdit" class="salary-identity-fields"><div><label for="salaryEditName">Nom et prénom</label><input id="salaryEditName" name="name" maxlength="120" required value="'+esc(draft.name)+'"'+disabled+'></div>'+
  '<div><label for="salaryEditRole">Rôle professionnel</label><select id="salaryEditRole" name="professional_role_id"'+disabled+'>'+salaryRoleOptions(draft.professional_role_id)+'</select></div>'+
  '<div><button class="btn primary" type="submit"'+disabled+'>Enregistrer les modifications</button></div></form>'+
  (!salaryCanWrite?'<p class="muted">Consultation uniquement : modification réservée aux droits Salaires.</p>':'')+
  (salaryProfileEditMessage?'<p role="status">'+esc(salaryProfileEditMessage)+'</p>':'')+'</section>';
}
function salaryCaptureIdentity(){
 const staff=salaryStaff.find(p=>p.id===salaryProfileEmployeeId),form=$("salaryStaffProfileEdit");
 if(!staff||!form)return;
 salaryProfileEditDraft={id:staff.id,name:$("salaryEditName").value,professional_role_id:$("salaryEditRole").value||null,updated_at:salaryProfileEditDraft?.id===staff.id?salaryProfileEditDraft.updated_at:staff.updated_at};
}
async function salarySaveIdentity(event){
 event.preventDefault();
 if(!salaryCanWrite||salaryStaffSaving)return;
 salaryCaptureIdentity();const draft=salaryProfileEditDraft;
 if(!draft||draft.name.trim().length<2||draft.name.trim().length>120)return;
 salaryStaffSaving=true;salaryProfileEditMessage="";salaryPage();
 try{
  const r=await call(ROOT+"/personnel-planning","staff-profile-update","POST",draft);
  if(!r.staff?.id)throw Error("Modification non confirmée.");
  salaryStaff=salaryStaff.map(p=>p.id===r.staff.id?r.staff:p);
  salaryProfileEditDraft=null;salaryProfileEditMessage="Fiche salarié enregistrée.";
  salaryStaffLoaded=false;await salaryLoadStaff();
  if(salaryProfileEmployeeId===draft.id){
   if(salaryPayrollDraft?.id===draft.id&&salaryPayrollDraft.updated_at===draft.updated_at)salaryPayrollDraft.updated_at=r.staff.updated_at;
   salaryProfileEvents=salaryProfileEvents.map(e=>e.personnel_id===draft.id?{...e,personnel_name:r.staff.name}:e);
  }
  salaryEvents=salaryEvents.map(e=>e.personnel_id===draft.id?{...e,personnel_name:r.staff.name}:e);
  salaryPerson="all";
 }catch(e){salaryProfileEditMessage=frError(e.message)}
 finally{salaryStaffSaving=false;if(salaryPageVisible())salaryPage()}
}
function salaryRolesPanel(){
 const disabled=!salaryCanWrite||salaryStaffSaving?" disabled":"";
 return '<section class="card"><h2>Rôles professionnels</h2><p class="muted">Créez ou renommez les fonctions du personnel. Les rôles peuvent ensuite être affectés depuis chaque fiche salarié. Les pouvoirs informatiques sont indépendants.</p>'+
  (salaryRoleMessage?'<p role="status">'+esc(salaryRoleMessage)+'</p>':'')+
  '<form id="salaryRoleAdd" class="salary-identity-fields"><div><label for="salaryRoleName">Nouveau rôle</label><input id="salaryRoleName" name="label" maxlength="100" required placeholder="Ex. Responsable de cuisine"'+disabled+'></div><div><button class="btn primary" type="submit"'+disabled+'>Ajouter le rôle</button></div></form>'+
  '<div class="table"><table><thead><tr><th>Fonction</th><th>Salariés affectés</th><th>Action</th></tr></thead><tbody>'+salaryProfessionalRoles.map(r=>'<tr><td><input form="salary-role-'+esc(r.id)+'" name="label" aria-label="Intitulé du rôle '+esc(r.label)+'" required maxlength="100" value="'+esc(r.label)+'"'+disabled+'></td><td>'+salaryStaff.filter(p=>p.professional_role_id===r.id&&!p.archived).length+'</td><td><form id="salary-role-'+esc(r.id)+'" data-salary-role-edit="'+esc(r.id)+'"><button class="btn secondary compact" type="submit"'+disabled+'>Renommer</button></form></td></tr>').join("")+'</tbody></table></div></section>';
}
async function salarySaveRole(event){
 event.preventDefault();if(!salaryCanWrite||salaryStaffSaving)return;
 const form=event.currentTarget,label=String(new FormData(form).get("label")||"").trim(),id=form.dataset.salaryRoleEdit;
 if(label.length<2||label.length>100)return;
 salaryStaffSaving=true;salaryRoleMessage="";
 try{
  await call(ROOT+"/personnel-planning","staff-role-save","POST",{...(id?{id}:{}),label});
  salaryRoleMessage="Rôle professionnel enregistré.";salaryStaffLoaded=false;await salaryLoadStaff();
 }catch(e){salaryRoleMessage=frError(e.message)}
 finally{salaryStaffSaving=false;if(salaryPageVisible())salaryPage()}
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
  '<p class="muted">Le cumul annuel correspond à l’année du mois sélectionné.</p>'+salaryIdentityPanel(staff)+'<section class="card"><h3>Coordonnées bancaires</h3><div class="salary-bank-cell">'+salaryBankCell(staff)+'</div></section>'+(window.ChambertinNavigoProfile?.html(staff,month,salaryCanWrite)||'')+salaryPayrollPanel(staff,month)+(window.ChambertinSalaryProfileDeclaration?.html(staff,month)||'')+('<h3>Plannings annuels (période scolaire et vacances)</h3>'+salaryArchivePanel(staff.id))+content+'</section>';
}
async function salaryOpenStaffProfile(id,focusSchedule=false){
 if(salaryView==="events")salaryView="staff";
 const staff=salaryStaff.find(p=>p.id===id);
 if(!staff)return;
 if(salaryProfileEmployeeId!==id)salaryProfileMonth=salaryCurrentMonth();
 salaryPayrollDraft=null;salaryPayrollMessage="";
 salaryProfileEditDraft=null;salaryProfileEditMessage="";
 salaryProfileEmployeeId=id;salaryProfileEvents=[];salaryProfileLoaded=false;salaryProfileError="";salaryProfileLoading=true;
 const version=++salaryProfileRequestVersion;
 if(page==="salaires"){
  salaryPage();
  (focusSchedule?$('salaryWeeklySchedule'):$('salaryProfile'))?.scrollIntoView({behavior:"smooth",block:"start"});
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
    found.push(...result.events.filter(e=>e.personnel_id?e.personnel_id===id:salaryStaffKey(e.personnel_name)===employeeKey));
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
   if(salaryPageVisible())salaryPage();
  }
 }
}
function salaryCloseStaffProfile(){
 salaryProfileRequestVersion++;
 salaryPayrollDraft=null;salaryPayrollMessage="";
 salaryProfileEditDraft=null;salaryProfileEditMessage="";
 salaryProfileEmployeeId="";salaryProfileEvents=[];salaryProfileError="";salaryProfileLoading=false;
 salaryProfileLoaded=false;
 if(salaryPageVisible())salaryPage();
}

let salaryBankAvailable=false,salaryBankDialogVersion=0;
function salaryBankCell(staff){
 if(!salaryBankAvailable)return '<span class="muted">Indisponible</span>';
 const bank=staff.bank_summary;
 return (bank?'<span class="salary-bank-mask">•••• '+esc(bank.iban_last4)+'</span><small class="muted">'+esc(bank.bic)+'</small>':'<span class="muted">À renseigner</span>')+
  (salaryCanWrite?'<button type="button" class="btn secondary compact" data-salary-bank="'+esc(staff.id)+'">'+(bank?'Modifier le RIB':'Ajouter le RIB')+'</button>':'');
}
function salaryBankClear(){
 salaryBankDialogVersion++;
 const dialog=document.getElementById("salaryBankDialog");
 if(dialog){if(dialog.open)dialog.close();dialog.remove()}
}
async function salaryOpenBank(id){
 if(!salaryCanWrite||!token||!canPage("salaires"))return;
 const staff=salaryStaff.find(p=>p.id===id);
 if(!staff)return;
 salaryBankClear();
 const version=salaryBankDialogVersion,owner=token;
 const dialog=document.createElement("dialog");
 dialog.id="salaryBankDialog";dialog.className="salary-bank-dialog";dialog.setAttribute("aria-labelledby","salaryBankTitle");
 dialog.innerHTML='<h2 id="salaryBankTitle">Coordonnées bancaires — '+esc(staff.name)+'</h2><p class="muted">Vérifiez le RIB original du salarié. Le contrôle IBAN/BIC ne confirme pas l’identité du titulaire.</p><form id="salaryBankForm"><div class="salary-doc-fields"><label>IBAN<input id="salaryBankIban" autocomplete="off" spellcheck="false" maxlength="80" required disabled></label><label>BIC<input id="salaryBankBic" autocomplete="off" spellcheck="false" maxlength="30" required disabled></label></div><label class="salary-od-confirm"><input type="checkbox" id="salaryBankVerified" required disabled> J’ai vérifié ces coordonnées sur un RIB authentique.</label><p id="salaryBankMessage" role="status">Chargement sécurisé…</p><div class="actions"><button type="submit" class="btn primary" id="salaryBankSave" disabled>Enregistrer le RIB</button><button type="button" class="btn secondary" id="salaryBankCancel">Fermer</button></div></form>';
 document.body.append(dialog);dialog.showModal();
 const el=key=>dialog.querySelector("#"+key);
 const current=()=>version===salaryBankDialogVersion&&owner===token&&salaryCanWrite&&dialog.open;
 let busy=false,recordVersion=0;
 dialog.addEventListener("cancel",e=>{if(busy)e.preventDefault()});
 dialog.addEventListener("close",()=>{if(dialog.isConnected)dialog.remove();if(version===salaryBankDialogVersion)salaryBankDialogVersion++});
 el("salaryBankCancel").addEventListener("click",()=>{if(!busy)dialog.close()});
 try{
  const result=await call(ROOT+"/personnel-planning","staff-bank-detail","GET",undefined,{id});
  if(!current())return;
  if(result.ok!==true||(result.bank&&result.bank.personnel_id!==id))throw Error("Réponse bancaire invalide.");
  const bank=result.bank;recordVersion=bank?.version||0;
  el("salaryBankIban").value=bank?.iban||"";el("salaryBankBic").value=bank?.bic||"";
  for(const key of ["salaryBankIban","salaryBankBic","salaryBankVerified","salaryBankSave"])el(key).disabled=false;
  el("salaryBankMessage").textContent=bank?"Coordonnées enregistrées.":"Aucun RIB enregistré.";
 }catch(e){if(current())el("salaryBankMessage").textContent=frError(e.message);return}
 el("salaryBankForm").addEventListener("submit",async event=>{
  event.preventDefault();if(!current()||busy||!el("salaryBankVerified").checked)return;
  const iban=el("salaryBankIban").value.replace(/\s/g,"").toUpperCase(),bic=el("salaryBankBic").value.trim().toUpperCase();
  if(!confirm("Enregistrer les coordonnées bancaires de "+staff.name+" après vérification du RIB ?"))return;
  busy=true;for(const key of ["salaryBankIban","salaryBankBic","salaryBankVerified","salaryBankSave","salaryBankCancel"])el(key).disabled=true;
  el("salaryBankMessage").textContent="Enregistrement sécurisé…";
  try{
   const result=await call(ROOT+"/personnel-planning","staff-bank-save","POST",{id,iban,bic,version:recordVersion,confirmed:true});
   if(!current())return;
   if(result.ok!==true||!result.bank||!Number.isInteger(result.bank.version))throw Error("Enregistrement non confirmé.");
   salaryStaff=salaryStaff.map(p=>p.id===id?{...p,bank_summary:result.bank}:p);
   salaryBankAvailable=true;salaryStaffMessage="Coordonnées bancaires enregistrées.";
   if(typeof window.salaryOdInvalidateBank==="function")window.salaryOdInvalidateBank();
   dialog.close();salaryPage();
  }catch(e){if(current()){el("salaryBankMessage").textContent=frError(e.message);el("salaryBankVerified").checked=false}}
  finally{busy=false;if(current())for(const key of ["salaryBankIban","salaryBankBic","salaryBankVerified","salaryBankSave","salaryBankCancel"])el(key).disabled=false}
 });
}
function salaryStaffNavigoCell(staff,month){
 if(staff.archived)return '<span class="muted">Archivé</span>';
 const legal=window.ChambertinLegalPayroll;
 const result=window.ChambertinNavigoProfile?.calculate?.(staff,month,{},legal);
 if(!result)return '<span class="muted">Calcul indisponible</span>';
 if(result.status==="excluded")return '<strong>0,00 €</strong><small class="muted" style="display:block">Non pris en charge</small>';
 const cents=result.amountCents??result.referenceAmountCents;
 if(cents===null||cents===undefined)return '<span class="muted">'+esc(result.message||"Tarif non confirmé")+'</span>';
 const amount=legal?.centsToString?.(cents)||((cents/100).toFixed(2).replace(".",",")+" €");
 const note=result.status==="ok"?"Calcul mensuel · justificatif à contrôler":
  "Base temps plein indicative · horaires contractuels à compléter";
 return '<strong>'+esc(amount)+'</strong><small class="muted" style="display:block">'+esc(note)+'</small>';
}
function salaryStaffPanel(){
 const state=salaryStaffLoading?'<p class="muted">Chargement de la liste du personnel…</p>':
  salaryStaffError?'<p class="err">'+esc(salaryStaffError)+'</p><button type="button" class="btn secondary" onclick="salaryLoadStaff()">Réessayer</button>':'';
 const active=salaryStaff.filter(p=>!p.archived),archived=salaryStaff.filter(p=>p.archived);
 const month=salaryMonth||salaryCurrentMonth();
 const row=p=>{
  const visible=!p.archived&&p.visible_in_planning;
  const days=Array.isArray(p.working_weekdays)?p.working_weekdays:[1,2,3,4,5];
  const schedule=salaryWorkSlotSummary(days,Array.isArray(p.weekly_work_slots)?p.weekly_work_slots:[]);
  const hoursText=schedule.error?'Horaires invalides':schedule.missingDays.length?'À compléter':salaryFormatLate(schedule.weeklyMinutes)+' / semaine';
  return '<tr><td><b>'+esc(p.name)+'</b></td><td>'+esc(salaryRoleLabel(p.professional_role_id))+'</td><td>'+(p.archived?'Archivé':visible?'Visible dans le planning':'Masqué du planning')+'</td>'+
   '<td><input type="checkbox" data-salary-staff-id="'+esc(p.id)+'" '+(visible?'checked':'')+' '+(p.archived||salaryStaffSaving||!salaryCanWrite?'disabled':'')+' aria-label="Afficher '+esc(p.name)+' dans le planning"></td>'+
   '<td class="salary-schedule-summary">'+esc(hoursText)+'</td><td data-salary-staff-navigo="'+esc(p.id)+'">'+salaryStaffNavigoCell(p,month)+'</td><td class="salary-bank-cell">'+salaryBankCell(p)+'</td>'+
   '<td><button type="button" class="btn primary compact" data-salary-staff-profile="'+esc(p.id)+'">Ouvrir la fiche</button> <button type="button" class="btn secondary compact" data-salary-schedule-profile="'+esc(p.id)+'">Horaires</button></td>'+
   '<td><button type="button" class="btn secondary compact" data-salary-archive="'+esc(p.id)+'" '+(salaryStaffSaving||!salaryCanWrite?'disabled':'')+'>'+(p.archived?'Réactiver':'Retirer de la liste')+'</button></td></tr>';
 };
 return '<section class="card salary-personnel"><h2>Salariés affichés dans le planning</h2>'+
  '<p class="muted">Gérez ici les personnes proposées dans « Planning → Nouvel incident ». Masquer ou archiver un salarié conserve ses incidents antérieurs et les récapitulatifs de paie.</p>'+
  (salaryStaffMessage?'<p class="ok" role="status">'+esc(salaryStaffMessage)+'</p>':'')+state+
  '<form id="salaryStaffAdd" class="salary-staff-form"><label for="salaryStaffName">Nom du nouveau salarié</label>'+
  '<input id="salaryStaffName" type="text" maxlength="120" required placeholder="Nom et prénom" autocomplete="off" '+(salaryStaffSaving||!salaryCanWrite?'disabled':'')+'>'+
  '<div class="salary-staff-role"><label for="salaryStaffRole">Rôle professionnel</label><select id="salaryStaffRole" '+(!salaryCanWrite?'disabled':'')+'>'+salaryRoleOptions(null)+'</select></div>'+
  '<label><input id="salaryStaffVisible" type="checkbox" checked> Afficher dans le planning</label>'+
  '<button type="submit" class="btn primary" '+(salaryStaffSaving||!salaryCanWrite?'disabled':'')+'>Ajouter le salarié</button></form>'+
  '<div class="actions"><label for="salaryStaffNavigoMonth">Mois de référence Navigo <input id="salaryStaffNavigoMonth" type="month" value="'+esc(month)+'"></label></div>'+
  '<div class="table"><table><thead><tr><th>Salarié</th><th>Rôle professionnel</th><th>État</th><th>Afficher</th><th>Horaires scolaires hebdomadaires</th><th>Navigo Mois zones 1–5 (50 %)</th><th>IBAN / BIC</th><th>Fiche salarié</th><th>Action</th></tr></thead><tbody>'+
  active.map(row).join('')+archived.map(row).join('')+
  (!salaryStaff.length?'<tr><td colspan="9">Aucun salarié enregistré.</td></tr>':'')+'</tbody></table></div></section>';
}
async function salaryLoadStaff(){
 if(!token||salaryStaffLoading)return;
 salaryStaffLoading=true;salaryStaffError="";
 if(salaryPageVisible())salaryPage();
 try{
  const r=await call(ROOT+'/personnel-planning','staff-list');
  salaryStaff=Array.isArray(r.staff)?r.staff:[];
  salaryProfessionalRoles=Array.isArray(r.roles)?r.roles:[];salaryCanWrite=r.salary_write===true;salaryBankAvailable=r.bank_available===true;
  salaryStaffLoaded=true;
  if(salaryPageVisible())void salaryLoadScheduleHistory();
 }catch(e){salaryStaffError=frError(e.message)}
 finally{salaryStaffLoading=false;if(salaryPageVisible())salaryPage()}
}
async function salaryAddStaff(event){
 event.preventDefault();
 if(salaryStaffSaving)return;
 const input=$('salaryStaffName'),name=input?.value.trim(),visible=$('salaryStaffVisible')?.checked===true;
 if(!name||name.length<2||name.length>120){salaryStaffError="Indiquez un nom de 2 à 120 caractères.";salaryPage();return}
 salaryStaffSaving=true;salaryStaffError="";salaryStaffMessage="";
 try{
  await call(ROOT+'/personnel-planning','staff-add','POST',{name,visible_in_planning:visible,professional_role_id:$('salaryStaffRole')?.value||null});
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
 if(salaryProfileEmployeeId){
  const person=salaryStaff.find(p=>p.id===salaryProfileEmployeeId);
  if(person)window.ChambertinNavigoProfile?.mount({
   staff:person,month:salaryProfileMonth||salaryCurrentMonth(),
   editable:salaryCanWrite&&!salaryStaffSaving,
   onSave:async payload=>{
    const result=await call(ROOT+"/personnel-planning","staff-navigo-contract-update","POST",payload);
    if(!result?.staff||result.staff.id!==payload.id)throw Error("Enregistrement des horaires Navigo non confirmé.");
    const saved=result.staff;
    salaryStaff=salaryStaff.map(p=>p.id===saved.id?{...p,...saved}:p);
    if(salaryPayrollDraft?.id===saved.id&&salaryPayrollDraft.updated_at===payload.updated_at)
     salaryPayrollDraft.updated_at=saved.updated_at;
    if(salaryProfileEditDraft?.id===saved.id&&salaryProfileEditDraft.updated_at===payload.updated_at)
     salaryProfileEditDraft.updated_at=saved.updated_at;
    return saved;
   }
  });
 }
 document.querySelectorAll("[data-salary-bank]").forEach(button=>button.addEventListener("click",()=>void salaryOpenBank(button.dataset.salaryBank)));
 const form=$('salaryStaffAdd');if(form)form.addEventListener('submit',salaryAddStaff);
 $("salaryArchiveRetry")?.addEventListener("click",()=>{salaryScheduleHistoryError="";salaryScheduleHistoryLoaded=false;void salaryLoadScheduleHistory()});
 $('salaryStaffProfileEdit')?.addEventListener('submit',salarySaveIdentity);
 $('salaryEditName')?.addEventListener('input',salaryCaptureIdentity);
 $('salaryEditRole')?.addEventListener('change',salaryCaptureIdentity);
 $('salaryRoleAdd')?.addEventListener('submit',salarySaveRole);
 document.querySelectorAll('[data-salary-role-edit]').forEach(f=>f.addEventListener('submit',salarySaveRole));
 document.querySelectorAll('[data-salary-staff-profile]').forEach(button=>button.addEventListener('click',()=>void salaryOpenStaffProfile(button.dataset.salaryStaffProfile)));
 document.querySelectorAll('[data-salary-schedule-profile]').forEach(button=>button.addEventListener('click',()=>void salaryOpenStaffProfile(button.dataset.salaryScheduleProfile,true)));
 document.querySelectorAll("[data-payroll-day]").forEach(x=>x.addEventListener("change",()=>{salaryPayrollReadDraft();salaryPage()}));
 document.querySelectorAll("#salaryExcludePublic,#salaryExcludeSchool").forEach(x=>x.addEventListener("change",()=>{salaryPayrollReadDraft();salaryRefreshPayrollTotals()}));
 document.querySelectorAll("[data-work-start],[data-work-end]").forEach(x=>x.addEventListener("input",()=>{salaryPayrollReadDraft();salaryRefreshPayrollTotals()}));
 document.querySelectorAll("[data-add-work-slot]").forEach(button=>button.addEventListener("click",()=>{
  if(!salaryCanWrite||salaryStaffSaving)return;
  salaryPayrollReadDraft();const day=Number(button.dataset.addWorkSlot);
  if(!salaryPayrollDraft||!salaryPayrollDraft.days.includes(day)||salaryPayrollDraft.slots.filter(x=>x.day===day).length>=8)return;
  salaryPayrollDraft.slots.push({day,start:"",end:""});salaryPage();
 }));
 document.querySelectorAll("[data-remove-work-slot]").forEach(button=>button.addEventListener("click",()=>{
  if(!salaryCanWrite||salaryStaffSaving)return;
  salaryPayrollReadDraft();if(!salaryPayrollDraft)return;
  const [day,index]=button.dataset.removeWorkSlot.split(":").map(Number);let seen=0;
  salaryPayrollDraft.slots=salaryPayrollDraft.slots.filter(slot=>slot.day!==day||seen++!==index);salaryPage();
 }));
 $("salaryCalendarRetry")?.addEventListener("click",()=>void salaryCalendarEnsure(salaryProfileMonth||salaryCurrentMonth(),true));
 $("salaryScheduleCopy")?.addEventListener("click",salaryCopyDaySchedule);
 document.querySelectorAll("[data-benefit-label],[data-benefit-amount],[data-benefit-input]").forEach(x=>x.addEventListener("input",()=>{
  salaryPayrollReadDraft();salaryRefreshPayrollTotals();
  if(x.tagName==="SELECT")salaryPage();
 }));
 document.querySelectorAll("[data-benefit-confirm]").forEach(x=>x.addEventListener("change",()=>{salaryPayrollReadDraft();salaryRefreshPayrollTotals()}));
 document.querySelectorAll("[data-benefit-kind]").forEach(x=>x.addEventListener("change",()=>{
  salaryPayrollReadDraft();
  const i=Number(x.dataset.benefitKind),kind=x.value,q=window.ChambertinBenefitQuestionnaire;
  if(salaryPayrollDraft?.benefits[i])salaryPayrollDraft.benefits[i]={kind,label:q?.NAMES[kind]||"",amount:0,details:{},status:"missing",confirmed:false};
  salaryPage();
 }));
 $("salaryBenefitAdd")?.addEventListener("click",()=>{salaryPayrollReadDraft();salaryPayrollDraft.benefits.push(window.ChambertinBenefitQuestionnaire?.newBenefit()||{kind:"choose",label:"",amount:0,details:{},status:"missing"});const i=salaryPayrollDraft.benefits.length-1;salaryPage();document.querySelector('[data-benefit-row="'+i+'"]')?.scrollIntoView?.({block:"nearest"})});
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

let salaryView="staff",salaryAccountingEmployeeId="all",salaryAccountingView="prep";
if(typeof window!=="undefined"){
 window.salaryAccountingActiveTab=()=>salaryAccountingView;
 window.salaryAccountingOnDraftLoaded=month=>salaryAccountingUpdateNavigo(month);
}
const salaryRateStatusCache=new Map();
const salaryRateCategories={navigo:"Navigo Mois",repas:"Repas",logement:"Logement",vehicule:"Véhicule",ntic:"Outils numériques"};
function salaryInstallArchivedOfficialRates(month,archived){
 if(!archived||typeof archived!=="object")return;
 const year=Number(month.slice(0,4)),legal=window.ChambertinLegalPayroll,benefits=window.ChambertinVehicleHousing;
 for(const [category,rate] of Object.entries(archived)){
  if(rate?.year!==year||!rate?.payload||typeof rate.source!=="string"||!rate.source.startsWith("https://"))continue;
  const payload={...rate.payload,year,source:rate.source};
  if(category==="navigo")legal?.setMonthlyRate?.({...payload,status:"verified"});
  else if(category==="repas")legal?.setMealRate?.(payload);
  else benefits?.setOfficialRate?.(category,{year,payload,source:rate.source});
 }
}
function salaryRenderOfficialRateCheck(month){
 const target=document.getElementById("salaryRateVerification");
 if(!target||!(salaryMonth===month||salaryCurrentMonth()===month))return;
 const item=salaryRateStatusCache.get(month);
 target.classList.toggle("err",!!item?.error||item?.value?.status==="review"||item?.value?.status==="incomplete");
 if(!item){target.textContent="Vérification des barèmes officiels programmée le 20 de chaque mois.";return;}
 if(item.loading){target.textContent="Chargement du contrôle officiel des barèmes…";return;}
 if(item.error){target.textContent="Contrôle des taux indisponible : "+item.error+" — vérification nécessaire avant la paie.";return}
 const rate=item.value;
 const archived=Object.entries(rate?.archived||{});
 const last=archived.length?archived.reduce((acc,[,record])=>record.checkedAt&&(!acc||record.checkedAt>acc)?record.checkedAt:acc,null):null;
 const previous=archived.length?" Derniers barèmes officiels archivés : "+archived.length+"/5"+
  (last?" (validation au "+new Date(last).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"})+")":"")+
  ". Ils ne prouvent pas une vérification réussie ce mois-ci.":" Aucun barème validé archivé pour cette année.";
 if(!rate||rate.status==="not_checked"){
  target.textContent="Aucun contrôle mensuel pour "+month+". Lancement les 20 du mois (05:00 UTC), nouvelles tentatives les 21 et 22."+previous;
  return;
 }
 const validated=Object.entries(rate.categories||{}).filter(([,value])=>value?.status==="verified");
 const pending=Object.entries(rate.categories||{}).filter(([,value])=>value?.status!=="verified").map(([name])=>salaryRateCategories[name]||name);
 const date=rate.checked_at?new Date(rate.checked_at).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris"}):"inconnue";
 target.textContent="Contrôle automatique du "+date+" : "+validated.length+"/5 sources du mois vérifiées."+
  (pending.length?" Source(s) indisponible(s) ou à contrôler : "+pending.join(", ")+".":" Contrôle complet.")+previous+
  (pending.length?" Aucun barème non vérifié ne doit être appliqué à une nouvelle année.":"");
}
async function salaryEnsureOfficialRateCheck(month,force=false){
 const current=salaryRateStatusCache.get(month);
 if(current?.loading||!force&&current&&Date.now()-current.at<300000){salaryRenderOfficialRateCheck(month);return}
 salaryRateStatusCache.set(month,{loading:true,at:Date.now()});
 salaryRenderOfficialRateCheck(month);
 try{
  const value=await call(ROOT+"/personnel-planning","payroll-official-rates","GET",undefined,{month});
  salaryInstallArchivedOfficialRates(month,value.archived);
  salaryRateStatusCache.set(month,{value,loading:false,at:Date.now()});
  if(salaryPageVisible()){
   salaryAccountingUpdateNavigo(month);
   if(salaryProfileEmployeeId&&salaryProfileMonth===month){
    salaryRefreshPayrollTotals();
    window.ChambertinNavigoProfile?.refresh?.();
   }
  }
 }catch(e){salaryRateStatusCache.set(month,{error:frError(String(e?.message||e)),loading:false,at:Date.now()})}
 salaryRenderOfficialRateCheck(month);
}
const salaryMonthlyChecks=new Map();
async function salaryAccountingLoadMonthlyRate(month){
 const year=month?.slice(0,4);
 if(!/^\d{4}$/.test(year)||year==="2026")return;
 const state=salaryMonthlyChecks.get(year);
 if(state&&(state.loading||Date.now()-state.at<3600000))return;
 salaryMonthlyChecks.set(year,{loading:true,at:Date.now()});
 try{
  const payload=await call(ROOT+"/personnel-planning","legal-navigo-mois","GET",undefined,{year});
  if(payload?.rate?.status==="verified")window.ChambertinLegalPayroll?.setMonthlyRate(payload.rate);
  salaryMonthlyChecks.set(year,{loading:false,at:Date.now(),error:payload.reason||""});
 }catch(err){
  salaryMonthlyChecks.set(year,{loading:false,at:Date.now(),error:"Vérification officielle du tarif indisponible."});
 }
 if(salaryPageVisible()&&(salaryMonth||salaryCurrentMonth()).slice(0,4)===year){
  salaryAccountingUpdateNavigo(salaryMonth||salaryCurrentMonth());
  if(page==="salaires"&&salaryView==="staff")salaryRefreshStaffNavigoCells(salaryMonth||salaryCurrentMonth());
 }
 if(salaryProfileEmployeeId&&salaryProfileMonth?.slice(0,4)===year)
  window.ChambertinNavigoProfile?.refresh?.();
}
function salaryRefreshStaffNavigoCells(month){
 if(page!=="salaires"||salaryView!=="staff"||(salaryMonth||salaryCurrentMonth())!==month)return;
 for(const cell of document.querySelectorAll("[data-salary-staff-navigo]")){
  const staff=salaryStaff.find(p=>p.id===cell.dataset.salaryStaffNavigo);
  if(staff)cell.innerHTML=salaryStaffNavigoCell(staff,month);
 }
}
function salaryAccountingUpdateNavigo(month){
 if((salaryMonth||salaryCurrentMonth())!==month)return;
 const legal=window.ChambertinLegalPayroll;
 for(const cell of document.querySelectorAll("#salaryPrepPanel [data-salary-prep-navigo]")){
  const id=cell.dataset.salaryPrepNavigo,staff=salaryStaff.find(s=>s.id===id);
  const info=window.salaryOdLegalData?.(month,id);
  if(!info?.loaded||!legal){cell.textContent="Chargement…";continue}
  if(!staff||typeof staff.navigo_reimbursement!=="boolean"){cell.textContent="À vérifier";continue}
  const input=info.inputs||{};
  const data={...input,weeklyHours:String(input.weeklyHours??"").trim()||staff.navigo_contract_weekly_hours,
   fullTimeHours:String(input.fullTimeHours??"").trim()||staff.navigo_full_time_weekly_hours,
   employerRate:String(input.employerRate??"").trim()||"50",
   zone:staff.navigo_reimbursement?"1-5":"none"};
  const result=legal.navigo(month,data),base=result.amountCents??result.referenceAmountCents;
  cell.textContent=result.status==="excluded"?"0,00 € · non concerné":base==null?"Tarif non confirmé":legal.centsToString(base)+(result.status==="missing"?" · horaires à confirmer":"");
  const declared=String(info.declaredTransport||"").trim();
  const declaredCents=declared?legal.parseDecimal(declared):null;
  cell.title=result.message+(declaredCents!==null?" · Bulletin : "+legal.centsToString(declaredCents)+(result.status==="ok"&&declaredCents!==result.amountCents?" · écart à contrôler":""):"");
 }
 for(const cell of document.querySelectorAll("#salaryPrepPanel [data-salary-prep-meal]")){
  const id=cell.dataset.salaryPrepMeal,info=window.salaryOdLegalData?.(month,id);
  if(!info?.loaded||!legal){cell.textContent="Chargement…";continue}
  const result=legal.meal(month,info.inputs||{});
  cell.textContent=result.amountCents===null?"À renseigner":legal.centsToString(result.amountCents);
  cell.title=result.message;
 }
 const benefits=window.ChambertinVehicleHousing;
 if(benefits){
  for(const kind of ["vehicle","housing"]){
   for(const cell of document.querySelectorAll("#salaryPrepPanel [data-salary-prep-"+kind+"]")){
    const id=cell.dataset[kind==="vehicle"?"salaryPrepVehicle":"salaryPrepHousing"];
    const info=window.salaryOdLegalData?.(month,id);
    if(!info?.loaded){cell.textContent="Chargement…";continue}
    const calc=benefits[kind](month,{...(info.inputs||{}),housingGross:info.inputs?.housingGross||info.gross||""});
    cell.textContent=calc.amountCents===null?"À renseigner":legal.centsToString(calc.amountCents)+(calc.status==="review"?" · à vérifier":"");
    cell.title=calc.message;
   }
  }
 }
}
function salaryAccountingOpenRulesEditor(month,id){
 const panel=document.getElementById("salaryPrepDetails"),staff=salaryStaff.find(p=>p.id===id);
 const info=window.salaryOdLegalData?.(month,id),legal=window.ChambertinLegalPayroll;
 if(!panel||!staff||!info?.loaded||!legal)return;
 const v=info.inputs||{},excluded=staff.navigo_reimbursement===false;
 const txt=(key,label,value="",detail="")=>'<label>'+esc(label)+'<input type="text" inputmode="decimal" data-salary-legal="'+key+'" value="'+esc(String(v[key]??"").trim()?v[key]:value)+'" autocomplete="off">'+(detail?'<small class="muted">'+esc(detail)+'</small>':'')+'</label>';
 const option=(key,label,choices,value)=>'<label>'+esc(label)+'<select data-salary-legal="'+key+'">'+choices.map(([val,name])=>'<option value="'+esc(val)+'" '+((v[key]??value)===val?'selected':'')+'>'+esc(name)+'</option>').join("")+'</select></label>';
 panel.hidden=false;
 panel.innerHTML='<h3>Calculs réglementaires — '+esc(staff.name)+'</h3>'+
 '<p class="muted">Navigo Mois toutes zones (1–5) : tarif mensuel officiel, justificatif à contrôler. '+(excluded?'Aucun remboursement selon le paramétrage salarié.':'Le remboursement dépend du temps de travail contractuel et du justificatif.')+'</p>'+
 '<div class="salary-doc-fields">'+
 txt("weeklyHours","Heures contractuelles par semaine",staff.navigo_contract_weekly_hours??"","Ne pas reprendre le planning théorique comme contrat.")+
 txt("fullTimeHours","Horaire hebdomadaire de référence",staff.navigo_full_time_weekly_hours??"","Ne pas inventer la référence contractuelle.")+
 txt("employerRate","Part employeur (%)","50","Minimum légal 50 %")+
 txt("mealsCount","Repas effectivement fournis ce mois")+
 txt("employeePaidPerMeal","Participation salarié par repas (€)","0")+
 option("mealMode","Mode de repas",[["workplace","Repas fourni dans les locaux"],["canteen","Cantine / restaurant d’entreprise"]],"workplace")+
 option("dutyMeal","Repas pris avec les élèves par nécessité de service",[["no","Non"],["yes","Oui — à justifier"]],"no")+
 '</div>'+(window.ChambertinBenefitFields?.fields(txt,option,esc,{...v,housingGross:v.housingGross||info.gross||""})||"")+
 '<p class="muted" id="salaryLegalPreview" role="status"></p>'+
 '<div class="actions"><button type="button" class="btn primary" id="salaryLegalSave" '+(!info.editable?'disabled':'')+'>Enregistrer les paramètres du mois</button>'+
 '<button type="button" class="btn secondary" id="salaryLegalClose">Fermer</button></div>'+
 '<p class="muted">Les montants calculés préparent le TESE. Ils ne modifient ni les nets déjà validés ni le XML de la banque.</p>';
 const collect=()=>Object.fromEntries([...panel.querySelectorAll("[data-salary-legal]")].map(el=>[el.dataset.salaryLegal,el.value]));
 const update=()=>{
  const input={...collect(),zone:excluded?"none":"1-5"};
  const n=legal.navigo(month,input),m=legal.meal(month,input);
  const ntext=n.amountCents!==null?legal.centsToString(n.amountCents):n.referenceAmountCents!==undefined?legal.centsToString(n.referenceAmountCents)+" (base temps plein non validée)":n.message;
  const mtext=m.amountCents!==null?legal.centsToString(m.amountCents):m.message;
  const dest=panel.querySelector("#salaryLegalPreview");
  const extra=window.ChambertinBenefitFields?.evaluate(month,input,info.gross);
  const extraText=extra?" · Véhicule : "+(extra.vehicle.amountCents===null?extra.vehicle.message:legal.centsToString(extra.vehicle.amountCents))+
   " · Logement : "+(extra.housing.amountCents===null?extra.housing.message:legal.centsToString(extra.housing.amountCents)):"";
  if(dest)dest.textContent="Navigo Mois remboursable : "+ntext+" · Repas : "+mtext+extraText+".";
 };
 panel.querySelectorAll("[data-salary-legal]").forEach(el=>el.addEventListener("input",update));
 panel.querySelector("#salaryLegalClose")?.addEventListener("click",()=>{panel.hidden=true;panel.replaceChildren()});
 panel.querySelector("#salaryLegalSave")?.addEventListener("click",async()=>{
  const button=panel.querySelector("#salaryLegalSave"),message=panel.querySelector("#salaryLegalPreview");
  if(!button)return;
  button.disabled=true;
  try{
   await window.salaryOdSaveLegalData(month,id,{...collect(),zone:excluded?"none":"1-5"});
   salaryAccountingUpdateNavigo(month);
   if(message)message.textContent="Paramètres mensuels enregistrés. Les bulletins et virements existants restent inchangés.";
  }catch(error){if(message)message.textContent=String(error.message||"Échec de l’enregistrement.");}
  finally{if(panel.isConnected)button.disabled=!info.editable}
 });
 update();
 panel.scrollIntoView({block:"nearest",behavior:"smooth"});
}
function salaryAccountingShowTab(view){
 if(!["prep","pay"].includes(view))return;
 salaryAccountingView=view;
 const prep=document.getElementById("salaryPrepPanel"),bank=document.getElementById("salaryPayrollWorkArea");
 if(prep)prep.hidden=view!=="prep";
 if(bank)bank.hidden=view!=="pay";
 document.querySelectorAll("[data-salary-accounting-tab]").forEach(button=>{
  const selected=button.dataset.salaryAccountingTab===view;
  button.setAttribute("aria-pressed",String(selected));
  button.classList.toggle("primary",selected);
  button.classList.toggle("secondary",!selected);
 });
 if(view==="pay")window.salaryOdRefresh?.();
}
function salaryPageVisible(){return page==="salaires"||page==="comptaSalaires"}
function salarySwitchView(view){if(["staff","events","settings"].includes(view)){salaryView=view;salaryPage()}}
function salarySettingsPanel(){
 const month=salaryMonth||salaryCurrentMonth();
 return '<section class="card"><h2>Paramètres du personnel</h2><p class="muted">Les horaires et avantages en nature se modifient dans chaque fiche salarié.</p>'+
 '<div class="actions"><label for="salarySettingsMonth">Mois de référence</label><input id="salarySettingsMonth" type="month" value="'+esc(month)+'" style="max-width:200px"><button id="salarySettingsCalendarReload" type="button" class="btn secondary">Actualiser les calendriers</button></div>'+
 (salaryStaffLoading?'<p>Chargement…</p>':salaryStaffError?'<p class="err">'+esc(salaryStaffError)+'</p>':
 '<div class="table"><table><thead><tr><th>Salarié</th><th>Jours travaillés</th><th>Jours théoriques du mois</th><th>Horaires théoriques</th><th>Avantages / mois</th><th>Action</th></tr></thead><tbody>'+
 salaryStaff.filter(p=>!p.archived).map(p=>{
 const days=Array.isArray(p.working_weekdays)?p.working_weekdays:[1,2,3,4,5],benefits=Array.isArray(p.benefits_in_kind)?p.benefits_in_kind:[];
 return '<tr><td>'+esc(p.name)+'</td><td>'+esc(days.map(d=>salaryWeekdayNames[d]).join(", ")||"Aucun")+'</td><td>'+salaryCalendarResultHtml(p,month)+'</td><td>'+salaryHoursResultHtml(p,month)+'</td><td>'+esc(benefits.reduce((n,b)=>n+(Number(b.amount)||0),0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"}))+' ('+benefits.length+')</td><td><button type="button" class="btn secondary compact" data-salary-staff-profile="'+esc(p.id)+'">Configurer</button></td></tr>';
 }).join("")+'</tbody></table></div>')+
 '<div class="card"><h3>Plannings annuels et archives horaires</h3><p class="muted">Le planning 2026-2027 comporte des horaires différents pendant les vacances scolaires. Les archives 2022-2023 sont conservées à part.</p>'+salaryArchivePanel()+'</div>'+ '<p class="muted">Jours théoriques selon jours habituels, jours fériés et vacances scolaires de la zone C, suivant les options de chaque salarié. Les congés individuels ne sont pas déduits. Aucun calcul de paie automatique.</p><p><a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE</a></p></section>';
}
function salaryEventEmployeeSummary(name,events,month){
 const employeeId=events.find(e=>e.personnel_id)?.personnel_id;
 const staff=employeeId?salaryStaff.find(p=>p.id===employeeId):salaryStaff.find(p=>salaryStaffKey(p.name)===salaryStaffKey(name));
 const totals=salaryProfileTotals(events,month);
 const metrics='<span><b>'+salaryFormatLate(totals.totalMonthMinutes)+'</b> d’écarts horaires'+
  (totals.totalMonthMissing?' · '+totals.totalMonthMissing+' durée(s) non renseignée(s)':'')+'</span>'+
  '<span>'+totals.absenceMonthCount+' absence(s)</span>'+
  '<span>'+totals.monthCount+' retard(s)</span>'+
  '<span>'+totals.earlyMonthCount+' départ(s) anticipé(s)</span>'+
  '<span>'+totals.incidentMonthCount+' autre(s) incident(s)</span>';
 let workdays='<span>Calendrier salarié non disponible</span>';
 if(staff){
  const calculation=salaryCalendarBreakdown(staff,month);
  workdays=calculation.net===null?
   '<span>'+calculation.base+' jour(s) planifié(s) · calendrier à vérifier</span>':
   '<span><b>'+calculation.net+'</b> jour(s) théoriques travaillés</span>'+
    '<span>'+calculation.publicDays+' jour(s) férié(s) déduit(s)</span>'+
    (calculation.excludedSchool?'<span>'+calculation.schoolDays+' jour(s) de vacances déduit(s)</span>':'<span>Vacances scolaires non déduites</span>');
  workdays+='<span>'+salaryHoursResultHtml(staff,month)+'</span>';
 }
 return '<div class="muted" style="display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;margin:6px 0 12px">'+
 (staff?'<span>Rôle : <b>'+esc(salaryRoleLabel(staff.professional_role_id))+'</b></span>':'')+workdays+metrics+'</div>';
}

function salaryAccountingMatchesStaff(event,staff){
 if(event.personnel_id)return event.personnel_id===staff.id;
 return salaryStaffKey(event.personnel_name)===salaryStaffKey(staff.name);
}
function salaryAccountingMonthEvents(month=salaryMonth){
 return salaryEvents.filter(event=>String(event.event_date||"").slice(0,7)===month);
}
function salaryAccountingEventsFor(staff,month=salaryMonth){
 return salaryAccountingMonthEvents(month).filter(event=>salaryAccountingMatchesStaff(event,staff));
}
function salaryAccountingSelectedEvents(month=salaryMonth){
 const events=salaryAccountingMonthEvents(month);
 if(salaryAccountingEmployeeId==="all")return events;
 const staff=salaryStaff.find(s=>s.id===salaryAccountingEmployeeId);
 return staff?events.filter(event=>salaryAccountingMatchesStaff(event,staff)):[];
}
function salaryAccountingEventTimes(event){
 const departure=String(event.start_time||"").slice(0,5),returnTime=String(event.end_time||"").slice(0,5);
 if(!departure||!["absence","depart_anticipe"].includes(event.event_type))return "";
 return "Départ "+departure+" · "+(returnTime?"Retour "+returnTime:"Pas de retour dans la journée");
}
function salaryAccountingGroupedEvents(events){
 const groups=new Map();
 for(const event of events){
  const staff=salaryStaff.find(p=>salaryAccountingMatchesStaff(event,p));
  const name=String(staff?.name||event.personnel_name||"Salarié non renseigné").trim()||"Salarié non renseigné";
  const key=staff?"id:"+staff.id:"name:"+salaryStaffKey(name);
  if(!groups.has(key))groups.set(key,{key,name,items:[]});
  groups.get(key).items.push(event);
 }
 return [...groups.values()]
  .sort((a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"})||a.key.localeCompare(b.key))
  .map(group=>({...group,items:group.items.slice().sort((a,b)=>
    String(b.event_date||"").localeCompare(String(a.event_date||""))||
    String(a.id||"").localeCompare(String(b.id||"")))}));
}
function salaryAccountingSelectedGroups(){
 return salaryAccountingGroupedEvents(salaryAccountingSelectedEvents()).map(group=>[group.key,group]);
}
function salaryAccountingBenefits(staff){
 const entries=Array.isArray(staff.benefits_in_kind)?staff.benefits_in_kind:null;
 if(!entries)return {total:null,entries:[],invalid:1};
 let totalCents=0,invalid=0,valid=[];
 for(const b of entries){
  const amount=Number(b?.amount),label=String(b?.label||"").trim();
  if(!label||b?.amount===null||b?.amount===undefined||b?.amount===""||!Number.isFinite(amount)||amount<0){invalid++;continue}
  totalCents+=Math.round(amount*100);
  valid.push({label,amount:Math.round(amount*100)/100});
 }
 return {total:invalid?null:totalCents/100,entries:valid,invalid};
}
function salaryAccountingMetrics(staff,month){
 const calendar=salaryCalendarBreakdown(staff,month),currentEvents=salaryAccountingEventsFor(staff,month)
  .filter(e=>e.review_status!=="sans_suite");
 const entries=currentEvents.filter(e=>["absence","retard","depart_anticipe"].includes(e.event_type));
 const incidentEvents=currentEvents.filter(e=>e.event_type==="incident");
 const byType=Object.fromEntries(["absence","retard","depart_anticipe"].map(type=>[type,{minutes:0,missing:0,count:0}]));
 const dayTotals=new Map(),scheduleKnown=calendar.net!==null&&calendar.monthlyScheduledMinutes!==null;
 let knownMinutes=0,missingHours=0,unmatchedDays=0,pending=0,overbookedDays=0;
 for(const event of entries){
  if(event.review_status!=="valide")pending++;
  byType[event.event_type].count++;
  const date=String(event.event_date||""),planned=calendar.scheduledMinutesByDate?.[date];
  const dailyValid=scheduleKnown&&Number.isFinite(planned)&&planned>0;
  const recorded=event.all_day?(dailyValid?planned:null):salaryRecordedMinutes(event);
  if(recorded===null){missingHours++;byType[event.event_type].missing++;continue}
  knownMinutes+=recorded;
  byType[event.event_type].minutes+=recorded;
  if(dailyValid)dayTotals.set(date,(dayTotals.get(date)||0)+recorded);
  else unmatchedDays++;
 }
 for(const [date,minutes] of dayTotals){
  if(minutes>calendar.scheduledMinutesByDate[date])overbookedDays++;
 }
 const equivalentReady=calendar.net!==null&&(entries.length===0||scheduleKnown&&missingHours===0&&unmatchedDays===0&&overbookedDays===0);
 const absenceDays=equivalentReady?[...dayTotals].reduce((sum,[date,minutes])=>sum+minutes/calendar.scheduledMinutesByDate[date],0):null;
 const benefits=salaryAccountingBenefits(staff);
 const incidentMinutes=incidentEvents.reduce((n,e)=>n+(salaryRecordedMinutes(e)||0),0);
 return {
  staff,calendar,benefits,absences:entries.length,pending,missingHours,unmatchedDays,overbookedDays,byType,
  incidentCount:incidentEvents.length,incidentMinutes,incidentPending:incidentEvents.filter(e=>e.review_status!=="valide").length,
  plannedDays:calendar.net,plannedMinutes:calendar.monthlyScheduledMinutes,
  knownAbsenceMinutes:knownMinutes,absenceMinutes:missingHours?null:knownMinutes,
  absenceDays,estimatedWorkedDays:absenceDays===null?null:Math.max(0,calendar.net-absenceDays)
 };
}
function salaryAccountingMetricFormat(n){
 return Number(n).toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:2});
}
function salaryAccountingMoney(n){
 return Number(n).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
}
function salaryAccountingKpi(label,value,detail){
 return '<div class="salary-accounting-kpi"><span class="salary-accounting-kpi-label">'+esc(label)+'</span>'+
  '<strong class="salary-accounting-kpi-value">'+esc(value)+'</strong>'+
  '<small class="salary-accounting-kpi-detail">'+esc(detail)+'</small></div>';
}
function salaryAccountingTotal(rows,key){
 return rows.some(r=>r[key]===null)?null:rows.reduce((sum,r)=>sum+r[key],0);
}
function scheduleIncidentText(row){
 return row.incidentCount+" incident(s) · "+salaryFormatLate(row.incidentMinutes)+(row.incidentPending?" · à vérifier":"")+" · non déduit(s)";
}
function salaryAccountingBreakdownHtml(byType){
 const format=type=>byType[type].missing?'À vérifier':salaryFormatLate(byType[type].minutes);
 return '<small class="muted">Absences : '+esc(format("absence"))+' · Retards : '+esc(format("retard"))+' · Départs anticipés : '+esc(format("depart_anticipe"))+'</small>';
}
function salaryAccountingBenefitsDetail(benefits){
 if(!benefits.entries.length)return '<small class="muted">'+(benefits.invalid?'Valorisation à vérifier':'Aucun avantage enregistré')+'</small>';
 return '<small class="muted">'+benefits.entries.map(b=>esc(b.label)+' : '+esc(salaryAccountingMoney(b.amount))).join(' · ')+'</small>'+
  (benefits.invalid?'<small class="err">Montant ou désignation invalide à contrôler</small>':'');
}
function salaryAccountingPage(){
 const month=salaryMonth||salaryCurrentMonth();
 const staffAvailable=salaryStaffLoaded&&!salaryStaffLoading&&!salaryStaffError;
 const eventsAvailable=!salaryLoading&&!salaryError;
 const staffList=staffAvailable?salaryStaff.filter(staff=>!staff.archived||salaryAccountingEventsFor(staff,month).length>0)
  .sort((a,b)=>a.name.localeCompare(b.name,"fr")):[];
 if(salaryAccountingEmployeeId!=="all"&&staffAvailable&&!staffList.some(x=>x.id===salaryAccountingEmployeeId))salaryAccountingEmployeeId="all";
 const people=salaryAccountingEmployeeId==="all"?staffList:staffList.filter(s=>s.id===salaryAccountingEmployeeId);
 const ready=staffAvailable&&eventsAvailable;
 const rows=ready?people.map(staff=>salaryAccountingMetrics(staff,month)):[];
 const selectedEvents=ready?salaryAccountingSelectedEvents(month):[];
 const eventGroups=salaryAccountingGroupedEvents(selectedEvents);
 const pendingEvents=selectedEvents.filter(e=>e.review_status==="a_verifier").length;
 const incidentEvents=selectedEvents.filter(e=>e.event_type==="incident");
 const missingIncidentMinutes=incidentEvents.filter(e=>salaryRecordedMinutes(e)===null).length;
 const knownIncidentMinutes=incidentEvents.reduce((total,e)=>total+(salaryRecordedMinutes(e)||0),0);
 const aggregate=key=>{
  const known=rows.filter(r=>r[key]!==null);
  return {value:known.reduce((sum,r)=>sum+r[key],0),complete:known.length===rows.length,known:known.length,total:rows.length};
 };
 const days=aggregate("plannedDays"),absenceHours=aggregate("absenceMinutes"),
  absenceDays=aggregate("absenceDays"),workedDays=aggregate("estimatedWorkedDays");
 const benefitsKnown=rows.filter(r=>r.benefits.total!==null);
 const benefitsTotal={value:benefitsKnown.reduce((sum,r)=>sum+r.benefits.total,0),
  complete:benefitsKnown.length===rows.length,known:benefitsKnown.length,total:rows.length};
 const knownAbsenceMinutes=rows.reduce((sum,r)=>sum+r.knownAbsenceMinutes,0);
 const breakdown=rows.reduce((out,r)=>{
  for(const type of ["absence","retard","depart_anticipe"]){
   out[type].minutes+=r.byType[type].minutes;out[type].missing+=r.byType[type].missing;
  }
  return out;
 },{absence:{minutes:0,missing:0},retard:{minutes:0,missing:0},depart_anticipe:{minutes:0,missing:0}});
 const unfinished=rows.reduce((sum,r)=>sum+r.missingHours+r.unmatchedDays+r.overbookedDays,0);
 const incompleteCalendar=rows.filter(r=>r.plannedDays===null).length;
 const incompleteEquivalents=rows.filter(r=>r.estimatedWorkedDays===null).length;
 const incompleteBenefits=rows.filter(r=>r.benefits.total===null).length;
 const unmatched=ready&&salaryAccountingEmployeeId==="all"?selectedEvents.filter(e=>!salaryStaff.some(staff=>salaryAccountingMatchesStaff(e,staff))).length:0;
 const word=salaryAccountingEmployeeId==="all"?"jours-salariés":"jours";
 const noValue="—";
 const indicator=(stats,formatter)=>!ready||stats.total===0||stats.known===0?noValue:
  (stats.complete?"":"≥ ")+formatter(stats.value);
 const metricDetail=(stats,description)=>stats.complete?description:stats.known+"/"+stats.total+" salarié(s) calculable(s) · total incomplet";
 const cardHtml='<section class="salary-accounting-kpis" aria-label="Indicateurs de comptabilité salariale">'+
  salaryAccountingKpi("Jours programmés",indicator(days,salaryAccountingMetricFormat),
   metricDetail(days,"Jours théoriques du mois · "+word))+
  salaryAccountingKpi("Jours travaillés estimés",indicator(workedDays,salaryAccountingMetricFormat),
   metricDetail(workedDays,"Jours programmés moins temps non effectué · sans pointage"))+
  salaryAccountingKpi("Heures non effectuées",ready&&absenceHours.complete?salaryFormatLate(absenceHours.value):
   ready&&knownAbsenceMinutes>0?"≥ "+salaryFormatLate(knownAbsenceMinutes):noValue,
   metricDetail(absenceHours,"Absences + retards + départs anticipés ; incidents exclus"))+
  salaryAccountingKpi("Équivalent en jours",indicator(absenceDays,salaryAccountingMetricFormat),
   metricDetail(absenceDays,"Temps non effectué / durée prévue de chaque journée"))+
  salaryAccountingKpi("Avantages en nature",indicator(benefitsTotal,salaryAccountingMoney),
   metricDetail(benefitsTotal,"Valorisation mensuelle enregistrée · à vérifier pour la paie"))+
  salaryAccountingKpi("Incidents signalés",ready?String(incidentEvents.length):noValue,
   ready?(incidentEvents.length?
    "Durée relevée : "+(missingIncidentMinutes?"≥ ":"")+salaryFormatLate(knownIncidentMinutes)+
    (missingIncidentMinutes?" · "+missingIncidentMinutes+" durée(s) manquante(s)":"")+" · non déduits":
    "Aucun incident pour la sélection"):"En attente des événements")+
  '</section>';
 const options='<option value="all"'+(salaryAccountingEmployeeId==="all"?' selected':'')+'>Tous les salariés</option>'+
  staffList.map(staff=>'<option value="'+esc(staff.id)+'"'+(salaryAccountingEmployeeId===staff.id?' selected':'')+'>'+esc(staff.name)+'</option>').join("");
 const controls='<div class="card salary-accounting-toolbar"><div><h2>Compta salaire</h2><p class="muted">Éléments variables du mois · '+esc(salaryMonthLabel(month))+' · issus des fiches salariés et du planning</p></div>'+
  '<div class="salary-accounting-filters"><label for="salaryAccountingMonth">Mois <input id="salaryAccountingMonth" type="month" value="'+esc(month)+'"></label>'+
  '<label for="salaryAccountingEmployee">Salarié <select id="salaryAccountingEmployee"'+(!staffAvailable?' disabled':'')+'>'+options+'</select></label>'+
  '<button type="button" class="btn secondary" id="salaryAccountingRefresh">Actualiser</button>'+
  '<button type="button" class="btn secondary" id="salaryAccountingOpenList">Liste salariés</button></div></div>';
 const sourceStatus=salaryStaffError||salaryError||salaryScheduleHistoryError||salaryCalendars.get(month)?.error||"";
 const status=ready?
  (sourceStatus?'<p class="err">'+esc(sourceStatus)+'</p>':'')+
  (unfinished?'<p class="err">'+unfinished+' durée(s) ou équivalence(s) d’absence à vérifier : les indicateurs incomplets ne sont pas estimés arbitrairement.</p>':'')+
  (incompleteCalendar||incompleteEquivalents||incompleteBenefits?'<p class="muted">Calculs incomplets : '+incompleteCalendar+' planning(s) non vérifié(s), '+incompleteEquivalents+' équivalence(s) indisponible(s), '+incompleteBenefits+' valorisation(s) d’avantages à contrôler. Les totaux partiels sont signalés par « ≥ ».</p>':'')+
  (pendingEvents?'<p class="muted">'+pendingEvents+' événement(s) à vérifier sur les '+selectedEvents.length+' du tableau : résultats provisoires, sans retenue automatique.</p>':'')+
  '<p class="muted"><b>Répartition du temps non effectué :</b> '+esc(["absence","retard","depart_anticipe"].map(type=>(type==="absence"?"Absences":type==="retard"?"Retards":"Départs anticipés")+" : "+(breakdown[type].missing?"à vérifier":salaryFormatLate(breakdown[type].minutes))).join(" · "))+'</p>'+
  (unmatched?'<p class="err">'+unmatched+' événement(s) non rapproché(s) d’une fiche salarié : non inclus dans les indicateurs.</p>':'')+
  '<p class="muted"><b>'+selectedEvents.length+' événement(s) dans le détail ci-dessous.</b> Les heures non effectuées sont calculées à partir de ces mêmes événements (absences, retards et départs anticipés). Les jours programmés proviennent des plannings et les avantages en nature des fiches salariés. Les incidents ne sont pas déduits automatiquement. Les événements « Sans suite » sont exclus des calculs de temps, mais restent visibles.</p>':
  '<p class="muted">'+esc(salaryStaffError||salaryError||"Chargement des horaires, événements et calendriers officiels…")+'</p>';
 const rowHtml=rows.map(r=>{
  const statusText=r.missingHours||r.unmatchedDays||r.overbookedDays?
   'Écart à vérifier':r.plannedDays===null||r.estimatedWorkedDays===null?'Planning à compléter':
   r.benefits.total===null?'Avantages à vérifier':r.pending?'Provisoire':'Calcul disponible';
  return '<tr><th scope="row">'+esc(r.staff.name)+'</th>'+
   '<td class="salary-accounting-num">'+(r.plannedDays===null?noValue:esc(salaryAccountingMetricFormat(r.plannedDays)))+'</td>'+
   '<td class="salary-accounting-num">'+(r.estimatedWorkedDays===null?noValue:esc(salaryAccountingMetricFormat(r.estimatedWorkedDays)))+'</td>'+
   '<td class="salary-accounting-num">'+(r.absenceMinutes===null?noValue:esc(salaryFormatLate(r.absenceMinutes)))+salaryAccountingBreakdownHtml(r.byType)+'</td>'+
   '<td class="salary-accounting-num">'+(r.absenceDays===null?noValue:esc(salaryAccountingMetricFormat(r.absenceDays)))+'</td>'+
   '<td class="salary-accounting-benefits"><b>'+(r.benefits.total===null?noValue:esc(salaryAccountingMoney(r.benefits.total)))+'</b>'+salaryAccountingBenefitsDetail(r.benefits)+'</td>'+
   '<td>'+esc(r.incidentCount?scheduleIncidentText(r):"Aucun")+'</td>'+
   '<td>'+esc(statusText)+'</td><td><button class="btn secondary compact" type="button" data-accounting-staff="'+esc(r.staff.id)+'">Voir la fiche</button></td></tr>';
 }).join("");
 const table='<section class="card"><h3>Récapitulatif par salarié</h3><div class="table"><table class="salary-accounting-table"><thead><tr><th>Salarié</th><th>Jours prévus</th><th>Jours équiv. après écarts</th><th>Temps non effectué (h)</th><th>Équivalent (jours)</th><th>Avantages en nature / mois</th><th>Autres incidents</th><th>Vérification</th><th>Fiche</th></tr></thead><tbody>'+
  (ready?rowHtml||'<tr><td colspan="9">Aucun salarié pour cette sélection.</td></tr>':'<tr><td colspan="9">Chargement ou données indisponibles.</td></tr>')+
  '</tbody></table></div></section>';
 const eventsHtml=eventGroups.map(group=>{
  const pendingGroup=group.items.filter(e=>e.review_status==="a_verifier").length;
  const heading='<tr class="salary-accounting-event-group"><th colspan="7" scope="rowgroup">'+esc(group.name)+
   '<span>'+group.items.length+' événement(s)'+(pendingGroup?' · '+pendingGroup+' à vérifier':'')+'</span></th></tr>';
  const items=group.items.map(e=>
   '<tr><td>'+esc(e.event_date||"")+'</td><td>'+esc(e.personnel_name||"")+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td>'+
   '<td>'+esc(salaryDuration(e))+(salaryAccountingEventTimes(e)?'<small class="muted" style="display:block;margin-top:4px">'+esc(salaryAccountingEventTimes(e))+'</small>':'')+'</td><td>'+esc(["absence","retard","depart_anticipe"].includes(e.event_type)?e.review_status==="sans_suite"?"Exclu du calcul":e.review_status==="valide"?"Comptabilisé":"Provisoire":e.event_type==="incident"?"Incident · non déduit":"Hors calcul")+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td>'+
   '<td>'+(e.attachment_path?'<button type="button" class="btn secondary compact" data-accounting-pdf="'+esc(e.id)+'">Voir PDF</button>':'—')+'</td></tr>').join("");
  return '<tbody>'+heading+items+'</tbody>';
 }).join("");
 const detail='<details class="card salary-accounting-detail" open><summary>Détail des événements du mois ('+selectedEvents.length+') · classés par salarié</summary>'+
  '<div class="actions" style="margin:14px 0"><button class="btn secondary" id="salaryAccountingExport"'+(!ready||!selectedEvents.length?' disabled':'')+'>Exporter CSV</button>'+
  '<button class="btn secondary" id="salaryAccountingPrint"'+(!ready||!selectedEvents.length?' disabled':'')+'>Imprimer / PDF</button>'+
  '<a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE</a></div>'+
  '<div class="table"><table><thead><tr><th>Date</th><th>Salarié</th><th>Type</th><th>Durée renseignée</th><th>Prise en compte</th><th>Statut</th><th>Justificatif</th></tr></thead>'+
  (eventsHtml||'<tbody><tr><td colspan="7">Aucun événement enregistré pour la sélection.</td></tr></tbody>')+
  '</table></div></details>';
 const durationCell=part=>part.missing?"À vérifier"+(part.count?" ("+part.count+")":""):salaryFormatLate(part.minutes);
 const prepRows=rows.map(r=>{
  const planned=r.plannedDays===null||r.plannedMinutes===null?"À vérifier":
   salaryAccountingMetricFormat(r.plannedDays)+" j · "+salaryFormatLate(r.plannedMinutes);
  const state=r.missingHours||r.unmatchedDays||r.overbookedDays?"Durées à vérifier":
   r.plannedMinutes===null?"Planning incomplet":
   r.benefits.total===null?"Avantages à vérifier":
   r.pending?"Événements provisoires":"Prêt à contrôler";
  return '<tr><th scope="row">'+esc(r.staff.name)+'</th>'+
   '<td>'+esc(planned)+'</td>'+
   '<td>'+esc(durationCell(r.byType.retard))+'</td>'+
   '<td>'+esc(durationCell(r.byType.absence))+'</td>'+
   '<td>'+esc(durationCell(r.byType.depart_anticipe))+'</td>'+
   '<td class="salary-accounting-benefits"><b>'+(r.benefits.total===null?"À vérifier":esc(salaryAccountingMoney(r.benefits.total)))+'</b>'+salaryAccountingBenefitsDetail(r.benefits)+'</td>'+
   '<td data-salary-prep-navigo="'+esc(r.staff.id)+'">Chargement…</td>'+
   '<td data-salary-prep-meal="'+esc(r.staff.id)+'">Chargement…</td>'+
   '<td data-salary-prep-vehicle="'+esc(r.staff.id)+'">À renseigner</td>'+
   '<td data-salary-prep-housing="'+esc(r.staff.id)+'">À renseigner</td>'+
   '<td>'+esc(state)+'</td>'+
   '<td><button class="btn secondary compact" type="button" data-salary-legal-open="'+esc(r.staff.id)+'">Détails calculs</button> <button class="btn secondary compact" type="button" data-accounting-staff="'+esc(r.staff.id)+'">Fiche</button></td></tr>';
 }).join("");
 const preparation='<section class="card salary-od-section" id="salaryPrepPanel" '+(salaryAccountingView!=="prep"?"hidden":"")+'>'+
  '<div class="salary-od-heading"><div><h2>Préparation des fiches de paie</h2><p class="muted">Mois '+esc(salaryMonthLabel(month))+' · Données issues du planning, des événements et des fiches salariés</p></div>'+
  '<div class="actions"><button type="button" class="btn secondary" id="salaryAccountingRefresh">Actualiser</button>'+
  '<a class="btn primary" href="https://www.letese.urssaf.fr/" target="_blank" rel="noopener noreferrer">Accéder au TESE</a></div></div>'+
  '<p id="salaryRateVerification" role="status" class="muted" style="margin:12px 0">Chargement du contrôle des barèmes officiels…</p>'+
  '<div class="table"><table class="salary-accounting-table salary-prep-table"><thead><tr><th>Salarié</th><th>Temps prévu (planning)</th><th>Retards</th><th>Absences</th><th>Départs anticipés</th><th>Avantages en nature / mois</th><th>Navigo calculé (1–5)</th><th>Repas calculés</th><th>Véhicule</th><th>Logement</th><th>Contrôle</th><th>Action</th></tr></thead><tbody>'+
  (ready?prepRows||'<tr><td colspan="12">Aucun salarié disponible.</td></tr>':'<tr><td colspan="12">Chargement des salariés et événements…</td></tr>')+
  '</tbody></table></div><div id="salaryPrepDetails" class="card" hidden></div><div role="status">'+status+'</div>'+
  '<p class="muted">Le temps prévu n’est pas une base contractuelle ni un pointage réel. Les retards et absences non validés restent provisoires. Les avantages en nature proviennent de la fiche salarié et doivent être contrôlés pour chaque paie. Le Navigo toutes zones et les repas sont proposés depuis les barèmes datés. Les écarts avec le bulletin existant sont à vérifier, et aucun net bancaire n’est recalculé automatiquement.</p></section>';
 $('content').innerHTML='<div class="actions" style="margin-bottom:12px"><label for="salaryAccountingMonth">Mois <input id="salaryAccountingMonth" type="month" value="'+esc(month)+'"></label></div>'+
 '<nav class="card salary-od-nav" aria-label="Étapes de paie" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
 '<button type="button" class="btn '+(salaryAccountingView==="prep"?"primary":"secondary")+'" data-salary-accounting-tab="prep" aria-pressed="'+(salaryAccountingView==="prep")+'">1. Préparation des fiches de paie</button>'+
 '<button type="button" class="btn '+(salaryAccountingView==="pay"?"primary":"secondary")+'" data-salary-accounting-tab="pay" aria-pressed="'+(salaryAccountingView==="pay")+'">2. Virements de salaires (XML)</button></nav>'+
 preparation+ '<div id="salaryPayrollNavigation" hidden></div><div id="salaryPayrollWorkArea" '+(salaryAccountingView!=="pay"?"hidden":"")+'></div><div id="salaryVariableSection" hidden></div>';
 if(typeof salaryOdMount==="function"){
  const declarationStaff=ready?staffList.map(staff=>{
   const r=salaryAccountingMetrics(staff,month),role=salaryRoleLabel(staff.professional_role_id);
   const source=["Jours prévus : "+(r.plannedDays===null?"à vérifier":salaryAccountingMetricFormat(r.plannedDays)),
    "Heures théoriques : "+(r.plannedMinutes===null?"à vérifier":salaryFormatLate(r.plannedMinutes)),
    "Temps non effectué : "+(r.absenceMinutes===null?"à vérifier":salaryFormatLate(r.absenceMinutes)),
    "Avantages en nature : "+(r.benefits.total===null?"à vérifier":salaryAccountingMoney(r.benefits.total)),
    r.pending+" événement(s) de durée à vérifier"].join(" · ");
   const roleLabel=role==="Non attribué"?"":role;
   const known=window.ChambertinDeclarationKnown?.declarationKnown(staff,r,salaryAccountingEventsFor(staff,month),roleLabel);
   return {id:staff.id,name:staff.name,roleLabel,source,
    prefill:known?.prefill||{},evidence:known?.evidence||[],pending:known?.pending||0};
  }):[];
  salaryOdMount({month,staff:staffAvailable?salaryStaff:[],defaultStaff:staffList,ready,canWrite:ready&&salaryCanWrite,session:token,declarationStaff});
 }
 document.querySelectorAll("[data-salary-accounting-tab]").forEach(button=>button.addEventListener("click",()=>salaryAccountingShowTab(button.dataset.salaryAccountingTab)));
 salaryAccountingUpdateNavigo(month);
 void salaryAccountingLoadMonthlyRate(month);
 void salaryEnsureOfficialRateCheck(month);
 document.querySelectorAll("[data-salary-legal-open]").forEach(button=>button.addEventListener("click",()=>salaryAccountingOpenRulesEditor(month,button.dataset.salaryLegalOpen)));
 $('salaryAccountingMonth')?.addEventListener('change',e=>salarySelectMonth(e.target.value));
 $('salaryAccountingEmployee')?.addEventListener('change',e=>{salaryAccountingEmployeeId=e.target.value;salaryAccountingPage()});
 $('salaryAccountingRefresh')?.addEventListener('click',()=>{
  salaryStaffLoaded=false;salaryScheduleHistoryLoaded=false;salaryCalendars.delete(month);
   void salaryEnsureOfficialRateCheck(month,true);
  void salaryLoadStaff();void salaryCalendarEnsure(month,true);void salaryLoad();
 });
 $('salaryAccountingOpenList')?.addEventListener('click',()=>show('salaires'));
 document.querySelectorAll('[data-accounting-staff]').forEach(b=>b.addEventListener('click',()=>{show('salaires');void salaryOpenStaffProfile(b.dataset.accountingStaff)}));
 document.querySelectorAll('[data-accounting-pdf]').forEach(b=>b.addEventListener('click',()=>void salaryOpenIncidentPdf(b.dataset.accountingPdf)));
 $('salaryAccountingExport')?.addEventListener('click',salaryExportCsv);
 $('salaryAccountingPrint')?.addEventListener('click',salaryPrint);
 if(staffAvailable&&!salaryScheduleHistoryLoading&&!salaryScheduleHistoryLoaded&&!salaryScheduleHistoryError)void salaryLoadScheduleHistory();
 void salaryCalendarEnsure(month);
}
function salaryPage(){
 if(page==="comptaSalaires"){if(!salaryMonth)salaryMonth=salaryCurrentMonth();salaryAccountingPage();return}
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 const groups=salaryGroups(),shown=groups.filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 const total=shown.reduce((n,[,g])=>n+g.items.length,0);
 const option=(val,label)=>'<option value="'+esc(val)+'"'+(salaryPerson===val?' selected':'')+'>'+esc(label)+'</option>';
 const nav=page==="comptaSalaires"?
  '<section class="card"><h2>Compta salaire</h2><p class="muted">Préparation des éléments variables de paie : absences, retards, départs anticipés et incidents. Les montants du salaire et les bulletins ne sont pas calculés ici.</p><button type="button" class="btn secondary" onclick="show(\'salaires\')">Ouvrir la liste salariés</button></section>':
  '<nav class="card" aria-label="Rubriques du personnel" style="display:flex;gap:8px;flex-wrap:wrap">'+[['staff','Liste salariés'],['events','Événements'],['settings','Paramètres']].map(([key,label])=>'<button type="button" class="btn '+(salaryView===key?'primary':'secondary')+'" data-salary-view="'+key+'" aria-pressed="'+(salaryView===key)+'">'+label+'</button>').join('')+'</nav>';
 if(salaryView==="staff")$('content').innerHTML=nav+salaryStaffPanel()+salaryStaffProfilePanel();
 else if(salaryView==="settings")$('content').innerHTML=nav+salaryRolesPanel()+salarySettingsPanel()+salaryStaffProfilePanel();
 else{
 $('content').innerHTML=nav+salaryOverview()+'<div class="card" id="salaryMonthDetails"><h2>Éléments variables du mois : '+esc(salaryMonthLabel(salaryMonth))+'</h2><p class="muted">Absences, retards, départs anticipés et incidents déclarés par le secrétariat, regroupés par salarié. Ces données ne constituent pas un bulletin de salaire.</p><div class="actions" style="align-items:center;flex-wrap:wrap"><label for="salaryMonth">Mois</label><input id="salaryMonth" type="month" value="'+esc(salaryMonth)+'" style="max-width:180px"><label for="salaryPerson">Salarié</label><select id="salaryPerson" style="max-width:260px">'+option("all","Tous les salariés")+groups.map(([key,g])=>option(key,g.name)).join("")+'</select><button class="btn secondary" onclick="salaryLoad()">Actualiser</button><button class="btn primary" onclick="salaryExportCsv()" '+(!total?'disabled':'')+'>Exporter CSV</button><button class="btn secondary" onclick="salaryPrint()" '+(!total?'disabled':'')+'>Imprimer / PDF</button><a class="btn primary" href="https://www2.75.letese.urssaf.fr/cetpeweb/connectempl.jsp" target="_blank" rel="noopener noreferrer">Ouvrir le TESE (Urssaf)</a></div><p class="muted">Vérifiez les données avant toute déclaration sur le TESE. Aucun transfert automatique et aucune retenue sur salaire ne sont effectués.</p></div>'+
 (salaryLoading?'<div class="card">Chargement des événements…</div>':'')+
 (salaryError?'<div class="card" style="color:#a32929">'+esc(salaryError)+'</div>':'')+
 (!salaryLoading&&!salaryError?'<div class="card"><b>'+shown.length+' salarié(s) · '+total+' événement(s) · '+shown.reduce((n,[,g])=>n+g.items.filter(e=>e.event_type==="incident").length,0)+' incident(s)</b></div>':'')+
 (!salaryLoading&&!salaryError?(shown.length?shown.map(([,g])=>'<div class="card"><h3>'+esc(g.name)+' <span class="muted">('+g.items.length+' événement(s))</span></h3>'+salaryEventEmployeeSummary(g.name,g.items,salaryMonth)+'<div class="table"><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Justificatif</th><th>PDF</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+(e.attachment_path?'<button class="btn secondary compact" type="button" onclick="salaryOpenIncidentPdf(\''+esc(e.id)+'\')">Voir le PDF</button>':'—')+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td></tr>').join("")+'</tbody></table></div></div>').join(""):'<div class="card"><p>Aucun événement enregistré pour cette période.</p></div>'):'');
 }
 document.querySelectorAll('[data-salary-view]').forEach(button=>button.addEventListener('click',()=>salarySwitchView(button.dataset.salaryView)));
 $('salarySettingsMonth')?.addEventListener('change',e=>{if(/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(e.target.value)){salaryMonth=e.target.value;salaryPage()}});
 $('salarySettingsCalendarReload')?.addEventListener('click',()=>void salaryCalendarEnsure(salaryMonth,true));
 salaryWireStaff();
 if(salaryProfileEmployeeId&&window.ChambertinSalaryProfileDeclaration&&document.getElementById('salaryProfileDeclaration'))void window.ChambertinSalaryProfileDeclaration.mount(salaryProfileEmployeeId,salaryProfileMonth||salaryCurrentMonth(),token,salaryCanWrite);
 document.querySelectorAll('[data-salary-month]').forEach(button=>button.addEventListener('click',()=>salarySelectMonth(button.dataset.salaryMonth)));
 const month=$('salaryMonth');if(month)month.addEventListener('change',e=>salarySelectMonth(e.target.value));
 const person=$('salaryPerson');if(person)person.addEventListener('change',e=>{salaryPerson=e.target.value;salaryPage()});
 $('salaryStaffNavigoMonth')?.addEventListener('change',e=>{
  if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)){
   salaryMonth=e.target.value;
   salaryPage();
  }
 });
 if(salaryView==="staff"&&page==="salaires")void salaryAccountingLoadMonthlyRate(salaryMonth||salaryCurrentMonth());
 if(salaryStaffLoaded&&!salaryScheduleHistoryLoading&&!salaryScheduleHistoryLoaded&&!salaryScheduleHistoryError)void salaryLoadScheduleHistory();
 if(salaryView==="settings"||salaryView==="events"||salaryProfileEmployeeId){
  void salaryCalendarEnsure(salaryMonth);
  if(salaryProfileEmployeeId)void salaryCalendarEnsure(salaryProfileMonth||salaryCurrentMonth());
  if(salaryProfileEmployeeId)void salaryEnsureOfficialRateCheck(salaryProfileMonth||salaryCurrentMonth());
  if(salaryProfileEmployeeId)void salaryAccountingLoadMonthlyRate(salaryProfileMonth||salaryCurrentMonth());
 }

}
async function salaryLoad(){
 if(!salaryPageVisible()||!token)return;
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 if(page==="salaires"&&!salaryHistoryLoaded&&!salaryHistoryLoading)void salaryLoadHistory();
 if(!salaryStaffLoaded&&!salaryStaffLoading)void salaryLoadStaff();
 const request=++salaryRequestVersion,month=salaryMonth;
 salaryLoading=true;salaryError="";salaryPage();
 try{
  const r=await call(ROOT+'/personnel-planning','admin-list','GET',undefined,{month});
  if(request!==salaryRequestVersion)return;
  salaryEvents=r.events||[];
 }catch(e){if(request!==salaryRequestVersion)return;salaryEvents=[];salaryError=frError(e.message)}
 finally{if(request===salaryRequestVersion){salaryLoading=false;if(salaryPageVisible())salaryPage()}}
}
function salaryExportCsv(){
 if(salaryLoading||salaryError)return;
 const selected=(page==="comptaSalaires"?salaryAccountingGroupedEvents(salaryAccountingSelectedEvents()).flatMap(group=>group.items):salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key).flatMap(([,g])=>g.items));
 if(!selected.length)return;
 const rows=[["Date","Salarié","Type","Journée entière","Durée (minutes)","Durée affichée","Justificatif","PDF joint","Observation","Statut","Traitement paie","Note administrative"],...selected.map(e=>[e.event_date,e.personnel_name,salaryTypes[e.event_type]||e.event_type,e.all_day?"Oui":"Non",e.duration_minutes??"",salaryDuration(e),salaryJust[e.justification_status]||"",e.attachment_path?"Oui":"Non",e.details,salaryStatuses[e.review_status]||"",e.payroll_action||"",e.payroll_note||""])];
 const content="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="salaires-incidents-"+salaryMonth+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function salaryPrint(){
 if(salaryLoading||salaryError)return;
 const groups=page==="comptaSalaires"?salaryAccountingSelectedGroups():salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 if(!groups.length)return;
 const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Suivi salaires '+esc(salaryMonth)+'</title><style>body{font:12px Arial,sans-serif;color:#17202a;margin:16mm}h1{font-size:23px}h2{font-size:16px;margin-top:20px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px;border:1px solid #bbb;text-align:left;overflow-wrap:anywhere}th{background:#eee}tr{break-inside:avoid}p{line-height:1.5}@page{size:A4 landscape;margin:14mm}</style></head><body><h1>Éléments du personnel — '+esc(salaryMonth)+'</h1><p>Document de contrôle. Aucun calcul de retenue automatique. Vérifier avant saisie dans le TESE.</p>'+groups.map(([,g])=>'<h2>'+esc(g.name)+' — '+g.items.length+' événement(s)</h2><table><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Justificatif</th><th>PDF</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(salaryDuration(e))+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+esc(e.attachment_path?'PDF joint':'—')+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"")+'</td></tr>').join("")+'</tbody></table>').join("")+'</body></html>';
 const w=window.open("","_blank");if(!w){alert("Autorisez les fenêtres pop-up pour générer le PDF.");return}w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),250);
}
