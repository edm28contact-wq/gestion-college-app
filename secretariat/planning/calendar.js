/* Planning mensuel des incidents — fonctions de présentation uniquement. */
function filteredPlanningEvents(){
 const type=document.getElementById("filter").value;
 const text=document.getElementById("personFilter").value.trim().toLocaleLowerCase("fr-FR");
 return events.filter(e=>(type==="all"||e.event_type===type)&&(!text||String(e.personnel_name||"").toLocaleLowerCase("fr-FR").includes(text)));
}
function shiftPlanningMonth(month,by){
 const m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
 if(!m)return currentDate().slice(0,7);
 return new Date(Date.UTC(Number(m[1]),Number(m[2])-1+by,1)).toISOString().slice(0,7);
}
function planningDays(month){
 const m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
 if(!m)return [];
 const year=Number(m[1]),index=Number(m[2])-1;
 const first=new Date(Date.UTC(year,index,1));
 const offset=(first.getUTCDay()+6)%7;
 const days=new Date(Date.UTC(year,index+1,0)).getUTCDate();
 return Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
  const d=new Date(Date.UTC(year,index,1-offset+i)),date=d.toISOString().slice(0,10);
  return {date,day:d.getUTCDate(),outside:date.slice(0,7)!==month};
 });
}
function planningDayLabel(date){
 const [year,month,day]=String(date||"").split("-").map(Number);
 if(!year||!month||!day)return date;
 return new Intl.DateTimeFormat("fr-FR",{timeZone:"UTC",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(Date.UTC(year,month-1,day)));
}
function planningHours(e){
 return formatIncidentDuration(e);
}
function renderPlanningCalendar(filtered){
 const month=document.getElementById("month").value,days=planningDays(month),today=currentDate();
 if(!days.length)return;
 document.getElementById("calendarMonth").textContent=new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-01T12:00:00Z"));
 if(!window.planningSelectedDay||window.planningSelectedDay.slice(0,7)!==month)
  window.planningSelectedDay=today.slice(0,7)===month?today:month+"-01";
 const groups=new Map();
 for(const e of filtered){if(!groups.has(e.event_date))groups.set(e.event_date,[]);groups.get(e.event_date).push(e)}
 document.getElementById("calendarDays").innerHTML=days.map(d=>{
  const list=groups.get(d.date)||[];
  const classes=["calendar-day",d.outside?"outside":"",d.date===today?"today":"",d.date===window.planningSelectedDay?"selected":""].filter(Boolean).join(" ");
  const chips=list.slice(0,3).map(e=>'<button class="calendar-chip cal-'+esc(e.event_type)+'" type="button" data-open="'+esc(e.id)+'" title="'+esc((labels[e.event_type]||"Incident")+" — "+e.personnel_name)+'">'+esc(e.personnel_name)+'</button>').join("");
  return '<div role="gridcell" class="'+classes+'" tabindex="'+(d.outside?"-1":"0")+'" data-day="'+d.date+'" aria-label="'+esc(planningDayLabel(d.date)+" : "+list.length+" incident(s)")+'"><span class="day-number">'+d.day+'</span>'+chips+(list.length>3?'<span class="calendar-more">+'+(list.length-3)+' autres</span>':"")+(list.length?'<span class="day-count">'+list.length+' incident(s)</span>':"")+"</div>";
 }).join("");
 renderPlanningDay(groups.get(window.planningSelectedDay)||[]);
}
function renderPlanningDay(list){
 const date=window.planningSelectedDay;
 document.getElementById("dayDetail").innerHTML='<div class="flex between"><h3>'+esc(planningDayLabel(date))+'</h3>'+
 (readonly?"":'<button class="btn" type="button" id="addForDay">+ Nouvel incident ce jour</button>')+'</div>'+
 (list.length?'<div class="day-detail-list">'+list.map(e=>{
  const editable=!readonly&&e.review_status==="a_verifier";
  return '<div class="day-detail-item cal-'+esc(e.event_type)+'"><div><strong>'+esc(e.personnel_name)+'</strong><small>'+esc(labels[e.event_type]||"Incident")+' · '+esc(planningHours(e))+'</small></div>'+(e.attachment_path?'<button type="button" data-pdf="'+esc(e.id)+'">PDF</button>':"")+(editable?'<button type="button" data-open="'+esc(e.id)+'">Modifier</button>':"")+"</div>";
 }).join("")+"</div>":'<p class="day-detail-empty">Aucun incident pour cette journée avec les filtres actuels.</p>');
 const create=document.getElementById("addForDay");if(create)create.addEventListener("click",()=>openForm(null,date));
}
function choosePlanningDay(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
 window.planningSelectedDay=date;
 if(date.slice(0,7)!==document.getElementById("month").value){
  document.getElementById("month").value=date.slice(0,7);load();return;
 }
 renderPlanningCalendar(filteredPlanningEvents());
}
function onPlanningCalendarClick(event){
 const pdf=event.target.closest("[data-pdf]");if(pdf){event.stopPropagation();openIncidentPdf(pdf.dataset.pdf);return}
 const edit=event.target.closest("[data-open]");
 if(edit){
  event.stopPropagation();
  const row=events.find(x=>String(x.id)===edit.dataset.open);
  if(row){
   choosePlanningDay(row.event_date);
   if(!readonly&&row.review_status==="a_verifier")openForm(row);
  }
  return;
 }
 const day=event.target.closest(".calendar-day[data-day]");
 if(day&&!day.classList.contains("outside"))choosePlanningDay(day.dataset.day);
}
function initPlanningCalendar(){
 document.getElementById("personFilter").addEventListener("input",render);
 const next=(n)=>{
  document.getElementById("month").value=n===0?currentDate().slice(0,7):shiftPlanningMonth(document.getElementById("month").value,n);
  window.planningSelectedDay=null;load();
 };
 document.getElementById("prevMonth").addEventListener("click",()=>next(-1));
 document.getElementById("nextMonth").addEventListener("click",()=>next(1));
 document.getElementById("todayMonth").addEventListener("click",()=>next(0));
 document.getElementById("calendarDays").addEventListener("click",onPlanningCalendarClick);
 document.getElementById("calendarDays").addEventListener("keydown",e=>{
  if(e.target.matches(".calendar-day")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();choosePlanningDay(e.target.dataset.day)}
 });
 document.getElementById("dayDetail").addEventListener("click",onPlanningCalendarClick);
}
