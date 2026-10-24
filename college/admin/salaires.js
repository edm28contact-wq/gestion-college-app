/* Administration Collège : journal mensuel des éléments du personnel */
let salaryMonth=null,salaryEvents=[],salaryError="",salaryLoading=false,salaryPerson="all";
const salaryTypes={absence:"Absence",retard:"Retard",depart_anticipe:"Départ anticipé",incident:"Incident"};
const salaryStatuses={a_verifier:"À vérifier",valide:"Validé",sans_suite:"Sans suite"};
const salaryJust={non_requis:"Non requis",a_fournir:"À fournir",recu:"Reçu"};
function salaryCurrentMonth(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).format(new Date())}
function salaryGroups(){const groups=new Map();for(const e of salaryEvents){const name=String(e.personnel_name||"").trim(),key=name.normalize("NFKC").replace(/\s+/g," ").toLocaleLowerCase("fr");if(!groups.has(key))groups.set(key,{name,items:[]});groups.get(key).items.push(e)}return [...groups.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,"fr"))}
function salaryPage(){
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 const groups=salaryGroups(),shown=groups.filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 const total=shown.reduce((n,[,g])=>n+g.items.length,0);
 const option=(val,label)=>'<option value="'+esc(val)+'"'+(salaryPerson===val?' selected':'')+'>'+esc(label)+'</option>';
 $('content').innerHTML='<div class="card"><h2>Salaires – Éléments variables du mois</h2><p class="muted">Absences, retards, départs anticipés et incidents déclarés par le secrétariat, regroupés par salarié. Ces données ne constituent pas un bulletin de salaire.</p><div class="actions" style="align-items:center;flex-wrap:wrap"><label for="salaryMonth">Mois</label><input id="salaryMonth" type="month" value="'+esc(salaryMonth)+'" style="max-width:180px"><label for="salaryPerson">Salarié</label><select id="salaryPerson" style="max-width:260px">'+option("all","Tous les salariés")+groups.map(([key,g])=>option(key,g.name)).join("")+'</select><button class="btn secondary" onclick="salaryLoad()">Actualiser</button><button class="btn primary" onclick="salaryExportCsv()" '+(!total?'disabled':'')+'>Exporter CSV</button><button class="btn secondary" onclick="salaryPrint()" '+(!total?'disabled':'')+'>Imprimer / PDF</button><a class="btn primary" href="https://www.letese.urssaf.fr/" target="_blank" rel="noopener noreferrer">Ouvrir le TESE (Urssaf)</a></div><p class="muted">Vérifiez les données avant toute déclaration sur le TESE. Aucun transfert automatique et aucune retenue sur salaire ne sont effectués.</p></div>'+
 (salaryLoading?'<div class="card">Chargement des événements…</div>':'')+
 (salaryError?'<div class="card" style="color:#a32929">'+esc(salaryError)+'</div>':'')+
 (!salaryLoading&&!salaryError?'<div class="card"><b>'+shown.length+' salarié(s) · '+total+' événement(s) · '+shown.reduce((n,[,g])=>n+g.items.filter(e=>e.event_type==="incident").length,0)+' incident(s)</b></div>':'')+
 (!salaryLoading&&!salaryError?(shown.length?shown.map(([,g])=>'<div class="card"><h3>'+esc(g.name)+' <span class="muted">('+g.items.length+' événement(s), '+g.items.filter(e=>e.event_type==="incident").length+' incident(s))</span></h3><div class="table"><table><thead><tr><th>Date</th><th>Type</th><th>Durée / horaires</th><th>Justificatif</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(e.all_day?"Journée entière":[e.start_time?.slice(0,5),e.end_time?.slice(0,5)].filter(Boolean).join(" – ")||"Non indiqué")+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"À vérifier")+'</td></tr>').join("")+'</tbody></table></div></div>').join(""):'<div class="card"><p>Aucun événement enregistré pour cette période.</p></div>'):'');
 const month=$('salaryMonth');if(month)month.addEventListener('change',e=>{salaryMonth=e.target.value;salaryPerson="all";salaryLoad()});
 const person=$('salaryPerson');if(person)person.addEventListener('change',e=>{salaryPerson=e.target.value;salaryPage()});
}
async function salaryLoad(){
 if(page!=="salaires"||!token||salaryLoading)return;
 if(!salaryMonth)salaryMonth=salaryCurrentMonth();
 salaryLoading=true;salaryError="";salaryPage();
 try{
  const r=await call(ROOT+'/personnel-planning','admin-list','GET',undefined,{month:salaryMonth});
  salaryEvents=r.events||[];
 }catch(e){salaryEvents=[];salaryError=frError(e.message)}
 finally{salaryLoading=false;if(page==="salaires")salaryPage()}
}
function salaryExportCsv(){
 if(salaryLoading||salaryError)return;
 const selected=salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key).flatMap(([,g])=>g.items);
 if(!selected.length)return;
 const rows=[["Date","Salarié","Type","Journée entière","Début","Fin","Justificatif","Observation","Statut","Traitement paie","Note administrative"],...selected.map(e=>[e.event_date,e.personnel_name,salaryTypes[e.event_type]||e.event_type,e.all_day?"Oui":"Non",e.start_time||"",e.end_time||"",salaryJust[e.justification_status]||"",e.details,salaryStatuses[e.review_status]||"",e.payroll_action||"",e.payroll_note||""])];
 const content="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="salaires-incidents-"+salaryMonth+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function salaryPrint(){
 if(salaryLoading||salaryError)return;
 const groups=salaryGroups().filter(([key])=>salaryPerson==="all"||salaryPerson===key);
 if(!groups.length)return;
 const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Suivi salaires '+esc(salaryMonth)+'</title><style>body{font:12px Arial,sans-serif;color:#17202a;margin:16mm}h1{font-size:23px}h2{font-size:16px;margin-top:20px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:6px;border:1px solid #bbb;text-align:left;overflow-wrap:anywhere}th{background:#eee}tr{break-inside:avoid}p{line-height:1.5}@page{size:A4 landscape;margin:14mm}</style></head><body><h1>Éléments du personnel — '+esc(salaryMonth)+'</h1><p>Document de contrôle. Aucun calcul de retenue automatique. Vérifier avant saisie dans le TESE.</p>'+groups.map(([,g])=>'<h2>'+esc(g.name)+' — '+g.items.length+' événement(s)</h2><table><thead><tr><th>Date</th><th>Type</th><th>Horaires</th><th>Justificatif</th><th>Observation</th><th>Statut</th></tr></thead><tbody>'+g.items.map(e=>'<tr><td>'+esc(e.event_date)+'</td><td>'+esc(salaryTypes[e.event_type]||e.event_type)+'</td><td>'+esc(e.all_day?"Journée entière":[e.start_time?.slice(0,5),e.end_time?.slice(0,5)].filter(Boolean).join(" – ")||"Non indiqué")+'</td><td>'+esc(salaryJust[e.justification_status]||"")+'</td><td>'+esc(e.details)+'</td><td>'+esc(salaryStatuses[e.review_status]||"")+'</td></tr>').join("")+'</tbody></table>').join("")+'</body></html>';
 const w=window.open("","_blank");if(!w){alert("Autorisez les fenêtres pop-up pour générer le PDF.");return}w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),250);
}
