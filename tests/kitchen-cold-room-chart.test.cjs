"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=path=>fs.readFileSync(path,"utf8");
const frontend=read("cuisine/cold-room-chart.js");
const admin=read("college/admin/cuisine-admin.js");
const kitchenUI=read("cuisine/kitchen-ui.js");
const kitchenAPI=read("supabase/functions/kitchen-api/index.ts");
const adminHtml=read("college/admin/index.html");
const sql=read("supabase/migrations/20261127124200_kitchen_cold_room_history_chart.sql");
const scope={window:{},Intl,Date};
vm.runInNewContext(frontend,scope);
const ui=scope.window.KitchenColdRoomChart;
const room={id:"928fd371-662b-4a0c-b54b-ad99f8ca935b",label:"Chambre froide négative 1",room_type:"negative",min_c:null,max_c:-18};
const series={
 room,period:"day",date:"2026-11-27",start_at:"2026-11-26T23:00:00Z",end_at:"2026-11-27T23:00:00Z",
 summary:{readings:9,alerts:2,min_c:-22.5,mean_c:-19.8,max_c:-16.2},
 points:[
  {at:"2026-11-27T07:00:00Z",min_c:-22.5,mean_c:-20.3,max_c:-18.5,count:5,alerts:0},
  {at:"2026-11-27T07:10:00Z",min_c:-21,mean_c:-19.4,max_c:-16.2,count:4,alerts:2}
 ]
};
test("Fiche chambre froide : bouton Voir fiche sur chaque carte de relevés",()=>{
 const match=(kitchenUI.match(/data-kitchen-cold-profile/g)||[]).length;
 assert.equal(match,2,"Le suivi direct et le récapitulatif doivent avoir un accès à la fiche");
 assert.match(kitchenUI,/aria-label="Voir la fiche de/);
 assert.match(admin,/fetchColdRoomChart/);
 assert.match(admin,/KitchenColdRoomChart\.open\(\{room,fetchChart:fetchColdRoomChart\}\)/);
 assert.match(admin,/data-kitchen-cold-profile/);
 assert.match(adminHtml,/cold-room-chart\.js\?v=/);
 assert.match(adminHtml,/cold-room-chart\.css\?v=/);
});
test("Le graphique utilise toutes les mesures enregistrées, sans compter les points agrégés comme des relevés",()=>{
 const markup=ui.renderChart(series);
 assert.match(markup,/Relevés enregistrés/);
 assert.match(markup,/>9<\/strong>/);
 assert.match(markup,/>2<\/strong>/);
 assert.match(markup,/>-22,5 °C<\/strong>/);
 assert.match(markup,/Moyenne/);
 assert.match(markup,/Minimum/);
 assert.match(markup,/Maximum/);
 assert.match(markup,/cold-profile-curve cold-profile-mean/);
 assert.match(markup,/cold-profile-curve cold-profile-min/);
 assert.match(markup,/cold-profile-curve cold-profile-max/);
 assert.match(markup,/5 relevé\(s\)/);
 assert.match(markup,/4 relevé\(s\)/);
 assert.match(markup,/Les interruptions de courbe représentent des périodes sans données/);
 assert.match(markup,/Seuil max. actuel/);
});
test("Périodes sans relevé : message explicite, sans température fictive",()=>{
 const out=ui.renderChart({...series,points:[],summary:{readings:0,alerts:0,min_c:null,mean_c:null,max_c:null}});
 assert.match(out,/Aucun relevé enregistré pour cette période/);
 assert.doesNotMatch(out,/0,0 °C/);
 assert.doesNotMatch(out,/cold-profile-curve/);
});
test("Les lacunes historiques ne sont pas reliées par interpolation",()=>{
 const history={...series,points:[...series.points,
  {at:"2026-11-27T13:10:00Z",min_c:-19,mean_c:-18.5,max_c:-18,count:1,alerts:0}]};
 const markup=ui.renderChart(history);
 const mean=markup.match(/<path class="cold-profile-curve cold-profile-mean" d="([^"]+)"/);
 assert.ok(mean);
 assert.equal((mean[1].match(/M/g)||[]).length,2);
 assert.equal((mean[1].match(/L/g)||[]).length,1);
});
test("Périodes : jour, semaine, mois et année ; navigation du calendrier sûre",()=>{
 assert.equal(ui.shift("2026-11-27","day",-1),"2026-11-26");
 assert.equal(ui.shift("2026-11-27","week",-1),"2026-11-20");
 assert.equal(ui.shift("2026-01-31","month",1),"2026-02-01");
 assert.equal(ui.shift("2024-02-29","year",1),"2025-01-01");
 for(const period of ["day","week","month","year"])assert.match(frontend,new RegExp(period));
 assert.match(frontend,/timeZone:TZ/);
 assert.match(frontend,/dialog\.showModal\(\)/);
 assert.match(frontend,/version!==epoch/);
});
test("L'API n'expose le graphique qu'aux sessions Cuisine valides et à une chambre réelle",()=>{
 const auth=kitchenAPI.indexOf("const u=await user(c,req)");
 const endpoint=kitchenAPI.indexOf('if(action==="cold-room-chart"&&req.method==="GET")');
 const old=kitchenAPI.indexOf('if(action==="cold-history"&&req.method==="GET")');
 assert.ok(auth>0&&endpoint>auth&&old>endpoint);
 const section=kitchenAPI.slice(endpoint,old);
 assert.match(section,/uuid\(roomId\)/);
 assert.match(section,/new Date\(day\+"T12:00:00Z"\)\.toISOString\(\)/);
 assert.match(section,/\.is\("deleted_at",null\)\.maybeSingle\(\)/);
 assert.match(section,/c\.rpc\("kitchen_cold_room_history_chart"/);
 assert.match(section,/count\+=samples/);
 assert.match(section,/totalC\+=Number\(r\.sum_c\)/);
 assert.doesNotMatch(section,/\.limit\(50\)|\.range\(offset/);
});
test("Les périodes sont calculées côté base au fuseau Paris, sans pagination ni mesures invalidées",()=>{
 assert.match(sql,/date_bin\('5 minutes'/);
 assert.match(sql,/when 'week' then date_trunc\('hour'/);
 assert.match(sql,/when 'month' then date_trunc\('day',r\.measured_at,'Europe\/Paris'\)/);
 assert.match(sql,/when 'year' then date_trunc\('month',r\.measured_at,'Europe\/Paris'\)/);
 assert.match(sql,/r\.invalidated_at is null/);
 assert.match(sql,/r\.measured_at>=b\.start_at and r\.measured_at<b\.end_at/);
 assert.match(sql,/count\(\*\) filter \(where r\.is_alert\)/);
 assert.match(sql,/security invoker/);
 assert.match(sql,/revoke all on function public\.kitchen_cold_room_history_chart.*from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.kitchen_cold_room_history_chart.*to service_role/);
 assert.doesNotMatch(sql,/security definer/);
});
