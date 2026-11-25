/* Cours Chambertin — préparation des règlements et OD, à partir du modèle Chambertin fourni. */
(()=>{
"use strict";
const lines=Object.freeze([
 {key:"salary",account:"64110000",label:"Salaires",side:"D",group:"Rémunérations et charges"},
 {key:"benefits",account:"64115000",label:"Avantage en nature",side:"D"},
 {key:"tese",account:"64510000",label:"Sécurité sociale TESE",side:"D"},
 {key:"unemployment",account:"64510000",label:"Assurance chômage",side:"D"},
 {key:"apec",account:"64530000",label:"APEC",side:"D"},
 {key:"retirement",account:"64530000",label:"Retraite AGIRC-ARRCO",side:"D"},
 {key:"health",account:"64533000",label:"Mutuelle-Swisslife",side:"D"},
 {key:"insurance",account:"64532000",label:"UNIP - Prévoyance Cadres",side:"D"},
 {key:"training",account:"63330000",label:"Formation continue",side:"D"},
 {key:"transport",account:"64730000",label:"Carte de transport salarié",side:"D"},
 {key:"ppv",account:"64131000",label:"Prime de partage de la valeur",side:"D"},
 {key:"termination",account:"64143100",label:"Indemnité rupture",side:"D"},
 {key:"benefits_credit",account:"79100000",label:"Avantage en nature",side:"C",derived:"benefits",group:"Contreparties"},
 {key:"advances",account:"42500000",label:"Acomptes",side:"C"},
 {key:"withholding",account:"43100000",label:"Prélèvement à la source",side:"C"},
 {key:"payable",account:"42100000",label:"Rémunérations",side:"C"},
 {key:"salary_tax_credit",account:"44850000",label:"Taxe sur les salaires",side:"C",group:"Taxe sur les salaires"},
 {key:"salary_tax_debit",account:"63110000",label:"Taxe sur les salaires",side:"D"}
].map(Object.freeze));
const money=value=>Number(value/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const decimal=value=>(value/100).toFixed(2).replace(".",",");
function cents(value){
 const s=String(value??"").trim().replace(/[\u00a0\u202f ]/g,"");
 if(!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(s))return null;
 const parts=s.replace(",",".").split(".");
 return Number(parts[0])*100+Number((parts[1]||"").padEnd(2,"0"));
}
const validMonth=month=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month));
function monthEnd(month){
 if(!validMonth(month))throw Error("Mois invalide");
 const [year,m]=month.split("-").map(Number);
 return month.replace("-","")+String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,"0");
}
function journal(values){
 const entries=lines.map(line=>({...line,amount:cents(values[line.derived||line.key])}));
 let debit=0,credit=0,missing=0;
 for(const entry of entries){
  if(entry.amount===null){if(!entry.derived)missing++;continue}
  if(entry.side==="D")debit+=entry.amount;else credit+=entry.amount;
 }
 return {entries,debit,credit,missing,balance:debit-credit,ok:missing===0&&debit===credit&&debit>0};
}
function paymentTotals(payments){
 const amounts=[...payments.values()].map(cents),missing=amounts.filter(a=>a===null).length;
 const total=amounts.reduce((sum,a)=>sum+(a??0),0);
 return {total,missing,count:amounts.length,ok:amounts.length>0&&missing===0&&total>0};
}
function csvCell(value){
 let text=String(value??"");
 // Neutralize spreadsheet expressions in user-provided names and labels.
 if(/^\s*[=+\-@\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
function csv(rows){return "\ufeff"+rows.map(row=>row.map(csvCell).join(";")).join("\r\n")}
function journalCsv(month,values){
 const j=journal(values);
 if(!j.ok)throw Error("OD incomplète ou déséquilibrée");
 const monthLabel=month.slice(5)+"/"+month.slice(0,4);
 return csv([["Date","Journal","Compte","Libellé compte","Libellé écriture","Montant","D/C"],...j.entries.filter(e=>e.amount>0).map(e=>[monthEnd(month),"OD",e.account,e.label,"OD Salaires "+monthLabel+": "+e.label,decimal(e.amount),e.side])]);
}
const drafts=new Map();
let session="",activeView="variables",context=null;
function clear(){drafts.clear();session="";context=null;activeView="variables"}
function blankDraft(){return {values:Object.create(null),payments:new Map(),odConfirmed:false,payConfirmed:false,dirty:false}}
function draftFor(month){if(!drafts.has(month))drafts.set(month,blankDraft());return drafts.get(month)}
function download(filename,content,type){
 const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function permissionsValid(){return !!context?.canWrite&&!!context.session&&context.session===session&&document.getElementById("salaryPayrollWorkArea")!==null}
function updateDraft(d){d.dirty=true;d.odConfirmed=false;d.payConfirmed=false}
function staffName(id){return context.staff.find(s=>s.id===id)?.name||"Salarié introuvable"}
function getDraft(){return draftFor(context.month)}
function field(value,attrs,label){return '<input type="text" inputmode="decimal" autocomplete="off" maxlength="16" placeholder="0,00" aria-label="'+esc(label)+'" '+attrs+' value="'+esc(value??"")+'">'}
function draftTools(){
 return '<div class="salary-od-draft"><span>Brouillon de session · sauvegardez un fichier privé pour reprendre plus tard.</span><div class="actions"><button type="button" class="btn secondary compact" id="salaryOdBackup">Sauvegarder le brouillon</button><label class="btn secondary compact salary-od-file">Reprendre un brouillon<input type="file" id="salaryOdImport" accept=".json,application/json"></label></div><p class="muted">Ce fichier contient des données salariales confidentielles. Ne le partagez pas.</p></div>';
}
function odHtml(d){
 const rows=lines.map(line=>(line.group?'<tr class="salary-od-group"><th colspan="4">'+esc(line.group)+'</th></tr>':'')+
  '<tr><td><b>'+line.account+'</b></td><th scope="row">'+esc(line.label)+(line.derived?' <small class="muted">Reprise automatique</small>':'')+'</th>'+
  ["D","C"].map(side=>'<td>'+ (side!==line.side?'—':line.derived?'<strong id="salaryOdBenefitCredit">—</strong>':field(d.values[line.key],'data-od-key="'+line.key+'"',line.label+" "+(side==="D"?"débit":"crédit")))+'</td>').join("")+'</tr>').join("");
 return '<section class="card salary-od-section"><div class="salary-od-heading"><div><h2>3. OD de salaires</h2><p class="muted">Modèle Chambertin · journal OD · date '+monthEnd(context.month).replace(/(\d{4})(\d{2})(\d{2})/,"$3/$2/$1")+'. Renseignez les montants du journal de paie validé.</p></div><button class="btn secondary" type="button" id="salaryOdZero">Mettre les champs vides à zéro</button></div>'+
 '<div class="salary-od-totals"><div><span>Total débit</span><strong id="salaryOdDebit">—</strong></div><div><span>Total crédit</span><strong id="salaryOdCredit">—</strong></div><div><span>Écart</span><strong id="salaryOdBalance">—</strong></div></div>'+
 '<div class="table"><table class="salary-od-table"><thead><tr><th>Compte</th><th>Libellé</th><th>Débit (€)</th><th>Crédit (€)</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
 '<p class="muted">Les comptes et sens suivent le classeur fourni. Vérifiez leur validité avec la comptabilité avant import. Les cotisations, la taxe sur les salaires et le prélèvement à la source ne sont pas estimés.</p>'+
 '<p id="salaryOdReconcile" role="status" class="salary-od-status"></p><p id="salaryOdStatus" role="status" class="salary-od-status"></p>'+
 '<label class="salary-od-confirm"><input type="checkbox" id="salaryOdConfirm"> J’ai vérifié les montants et les comptes avec le journal de paie.</label><div class="actions"><button type="button" id="salaryOdExport" class="btn primary" disabled>Exporter les OD (CSV)</button></div><p class="muted">CSV de contrôle et de préparation : format d’injection du logiciel comptable à valider. Aucun enregistrement comptable automatique.</p></section>';
}
function payHtml(d){
 const people=[...d.payments].sort((a,b)=>staffName(a[0]).localeCompare(staffName(b[0]),"fr"));
 const rows=people.map(([id,value])=>'<tr><th scope="row">'+esc(staffName(id))+'</th><td>'+field(value,'data-pay-id="'+esc(id)+'"',"Net à virer : "+staffName(id))+'</td><td>'+(context.staff.some(s=>s.id===id&&!s.archived)?'<span class="muted">0 si aucun virement</span>':'<button type="button" class="btn secondary compact" data-pay-remove="'+esc(id)+'">Retirer</button>')+'</td></tr>').join("");
 const extra=context.staff.filter(s=>!d.payments.has(s.id)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
 return '<section class="card salary-od-section"><div class="salary-od-heading"><div><h2>2. Virements de salaires</h2><p class="muted">Reportez le montant net réellement à verser de chaque bulletin validé, après acomptes et prélèvement à la source. Ne les déduisez pas une deuxième fois.</p></div></div>'+
 '<div class="salary-od-totals"><div><span>Total à virer</span><strong id="salaryPayTotal">—</strong></div><div><span>Compte 42100000</span><strong id="salaryPayAccount">—</strong></div><div><span>Écart</span><strong id="salaryPayBalance">—</strong></div></div>'+
 '<div class="table"><table class="salary-od-table salary-pay-table"><thead><tr><th>Salarié</th><th>Net à virer (€)</th><th>Information</th></tr></thead><tbody>'+(rows||'<tr><td colspan="3">Aucun salarié disponible.</td></tr>')+'</tbody></table></div>'+
 (extra.length?'<div class="actions salary-od-extra"><label>Autre salarié du catalogue <select id="salaryPayExtra"><option value="">Choisir</option>'+extra.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select></label><button type="button" class="btn secondary" id="salaryPayAdd">Ajouter</button></div>':'')+
 '<p id="salaryPayStatus" role="status" class="salary-od-status"></p><label class="salary-od-confirm"><input type="checkbox" id="salaryPayConfirm"> J’ai contrôlé les montants nets sur les bulletins et la liste des bénéficiaires.</label>'+
 '<div class="actions"><button id="salaryPayExport" type="button" class="btn primary" disabled>Exporter la liste des virements (CSV)</button><button id="salaryPayToOD" type="button" class="btn secondary" disabled>Reporter le total dans le compte 421</button></div>'+
 '<p class="muted">Liste préparatoire sans IBAN ni ordre bancaire SEPA. Aucun paiement n’est émis depuis cette page.</p></section>';
}
function restoreDraft(raw,month,staffIds,defaultIds){
 if(!raw||raw.version!==1||raw.month!==month||!raw.values||typeof raw.values!=="object"||!Array.isArray(raw.payments)||raw.payments.length>1000)throw Error("Brouillon invalide ou mois différent.");
 const d=blankDraft();
 for(const line of lines.filter(l=>!l.derived)){
  if(!Object.hasOwn(raw.values,line.key))continue;
  const value=raw.values[line.key];if(typeof value!=="string"||value.length>16||(value.trim()&&cents(value)===null))throw Error("Montant invalide : "+line.label);
  d.values[line.key]=value;
 }
 for(const row of raw.payments){
  if(!Array.isArray(row)||row.length!==2||!staffIds.has(row[0])||d.payments.has(row[0])||typeof row[1]!=="string"||row[1].length>16||(row[1].trim()&&cents(row[1])===null))throw Error("Salarié ou montant invalide dans le brouillon.");
  d.payments.set(row[0],row[1]);
 }
 for(const id of defaultIds)if(!d.payments.has(id))d.payments.set(id,"");
 d.dirty=true;
 return d;
}
function render(){
 const host=document.getElementById("salaryPayrollWorkArea"),variables=document.getElementById("salaryVariableSection");
 if(!host||!variables||!context)return;
 variables.hidden=activeView!=="variables";host.hidden=activeView==="variables";
 const employee=document.getElementById("salaryAccountingEmployee");if(employee)employee.disabled=activeView!=="variables"||!context.ready;
 document.querySelectorAll("[data-salary-od-view]").forEach(b=>{const selected=b.dataset.salaryOdView===activeView;b.classList.toggle("primary",selected);b.classList.toggle("secondary",!selected);b.setAttribute("aria-pressed",String(selected))});
 if(activeView==="variables"){host.replaceChildren();return}
 if(!context.ready||!context.canWrite){host.innerHTML='<section class="card"><h3>Préparation des salaires</h3><p class="muted">La saisie des montants nécessite les droits de modification des salaires et le chargement des données.</p></section>';return}
 const d=getDraft();
 host.innerHTML=(activeView==="pay"?payHtml(d):odHtml(d))+draftTools();
 wire(host,d);refresh();
}
function refresh(){
 if(!permissionsValid())return;
 const d=getDraft(),j=journal(d.values),p=paymentTotals(d.payments),account=cents(d.values.payable);
 const el=id=>document.getElementById(id),set=(id,value)=>{const e=el(id);if(e)e.textContent=value};
 const reconcile=p.ok&&account!==null?p.total-account:null;
 const unknown=[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id));
 const mismatch=reconcile!==null&&reconcile!==0;
 set("salaryOdBenefitCredit",cents(d.values.benefits)===null?"—":money(cents(d.values.benefits)));
 set("salaryOdDebit",money(j.debit));set("salaryOdCredit",money(j.credit));set("salaryOdBalance",money(j.balance));
 set("salaryOdReconcile",p.ok?(account===null?"Liste des virements complète : "+money(p.total)+" · compte 421 à renseigner.":mismatch?"Écart avec les virements : "+money(reconcile):"Virements et compte 421 concordants."):"Rapprochement avec les virements : liste encore incomplète.");
 set("salaryOdStatus",j.missing?j.missing+" montant(s) à renseigner (0 si aucun).":j.balance!==0?"OD déséquilibrée : "+money(j.balance)+".":!j.ok?"Aucun montant à comptabiliser.":mismatch?"Écart entre les virements et le compte 421 à corriger.":"OD équilibrée. Contrôlez le journal avant export.");
 set("salaryPayTotal",money(p.total));set("salaryPayAccount",account===null?"Non renseigné":money(account));set("salaryPayBalance",reconcile===null?"—":money(reconcile));
 set("salaryPayStatus",unknown?"Un salarié du brouillon n’existe plus dans la liste.":p.missing?p.missing+" montant(s) à renseigner. Indiquez 0 si aucun virement.":!p.ok?"Aucun virement positif à préparer.":mismatch?"Le total diffère du compte 421. Vérifiez avant export.":account===null?"Liste complète : rapprochez-la du compte 421 avant export.":"Total des virements rapproché du compte 421.");
 const payReady=p.ok&&!unknown&&account!==null&&!mismatch,odReady=j.ok&&!mismatch&&!unknown;
 if(el("salaryOdConfirm")){el("salaryOdConfirm").checked=d.odConfirmed;el("salaryOdConfirm").disabled=!odReady}
 if(el("salaryPayConfirm")){el("salaryPayConfirm").checked=d.payConfirmed;el("salaryPayConfirm").disabled=!p.ok||unknown}
 if(el("salaryOdExport"))el("salaryOdExport").disabled=!odReady||!d.odConfirmed;
 if(el("salaryPayExport"))el("salaryPayExport").disabled=!payReady||!d.payConfirmed;
 if(el("salaryPayToOD"))el("salaryPayToOD").disabled=!p.ok||unknown||!d.payConfirmed;
}
function wire(host,d){
 const el=id=>document.getElementById(id);
 host.querySelectorAll("[data-od-key]").forEach(input=>input.addEventListener("input",()=>{if(!permissionsValid())return;d.values[input.dataset.odKey]=input.value;updateDraft(d);refresh()}));
 host.querySelectorAll("[data-pay-id]").forEach(input=>input.addEventListener("input",()=>{if(!permissionsValid())return;d.payments.set(input.dataset.payId,input.value);updateDraft(d);refresh()}));
 host.querySelectorAll("[data-pay-remove]").forEach(button=>button.addEventListener("click",()=>{if(!permissionsValid())return;d.payments.delete(button.dataset.payRemove);updateDraft(d);render()}));
 el("salaryPayAdd")?.addEventListener("click",()=>{const id=el("salaryPayExtra").value;if(!permissionsValid()||!context.staff.some(s=>s.id===id)||d.payments.has(id))return;d.payments.set(id,"");updateDraft(d);render()});
 el("salaryOdZero")?.addEventListener("click",()=>{if(!permissionsValid()||!confirm("Renseigner à zéro tous les montants OD laissés vides ? Vérifiez qu’aucun montant ne manque."))return;for(const line of lines)if(!line.derived&&!String(d.values[line.key]??"").trim())d.values[line.key]="0";updateDraft(d);render()});
 el("salaryOdConfirm")?.addEventListener("change",e=>{if(permissionsValid()){d.odConfirmed=e.target.checked;refresh()}});
 el("salaryPayConfirm")?.addEventListener("change",e=>{if(permissionsValid()){d.payConfirmed=e.target.checked;refresh()}});
 el("salaryPayToOD")?.addEventListener("click",()=>{
  if(!permissionsValid()||!d.payConfirmed)return;
  const p=paymentTotals(d.payments);if(!p.ok||[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
  const previous=cents(d.values.payable);
  if(!confirm("Reporter "+money(p.total)+" au crédit du compte 42100000 ?"+(previous!==null&&previous!==p.total?" Remplace le montant précédent de "+money(previous)+".":"")))return;
  d.values.payable=decimal(p.total);d.dirty=true;d.odConfirmed=false;refresh();
 });
 el("salaryOdExport")?.addEventListener("click",()=>{
  if(!permissionsValid()||!d.odConfirmed)return;
  const j=journal(d.values),p=paymentTotals(d.payments),account=cents(d.values.payable);
  if(!j.ok||(p.ok&&account!==p.total)||[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
  download("chambertin-od-salaires-"+context.month+".csv",journalCsv(context.month,d.values),"text/csv;charset=utf-8");
 });
 el("salaryPayExport")?.addEventListener("click",()=>{
  if(!permissionsValid()||!d.payConfirmed)return;
  const p=paymentTotals(d.payments);
  if(!p.ok||p.total!==cents(d.values.payable)||[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
  const rows=[...d.payments].filter(([,v])=>cents(v)>0).map(([id,v])=>[context.month,staffName(id),decimal(cents(v)),"Salaire "+context.month]);
  rows.sort((a,b)=>a[1].localeCompare(b[1],"fr"));
  download("chambertin-virements-preparation-"+context.month+".csv",csv([["Mois","Salarié","Montant EUR","Libellé"],...rows]),"text/csv;charset=utf-8");
 });
 el("salaryOdBackup")?.addEventListener("click",()=>{
  if(!permissionsValid())return;
  if(!confirm("Télécharger un fichier privé contenant les montants de salaires ? Conservez-le dans un espace sécurisé."))return;
  download("chambertin-salaires-brouillon-"+context.month+".json",JSON.stringify({version:1,month:context.month,values:d.values,payments:[...d.payments]},null,2),"application/json");
  d.dirty=false;
 });
 el("salaryOdImport")?.addEventListener("change",async e=>{
  const file=e.target.files?.[0],month=context.month,owner=session;if(!file||!permissionsValid())return;
  try{
   if(file.size>250000)throw Error("Brouillon trop volumineux.");
   const raw=JSON.parse(await file.text());
   if(!permissionsValid()||context.month!==month||session!==owner)return;
   const restored=restoreDraft(raw,month,new Set(context.staff.map(s=>s.id)),context.defaultStaff.map(s=>s.id));
   if(!confirm("Remplacer le brouillon de "+month+" ?"))return;
   drafts.set(month,restored);render();
  }catch(error){alert(error.message)}finally{e.target.value=""}
 });
}
function mount(config){
 if(session!==config.session){clear();session=config.session}
 context=config;
 const nav=document.getElementById("salaryPayrollNavigation");if(!nav)return;
 const tabs=[["variables","1. Éléments variables"],["pay","2. Virements de salaires"],["od","3. OD de salaires"]];
 nav.innerHTML='<nav class="card salary-od-nav" aria-label="Étapes de préparation des salaires">'+tabs.map(([key,label])=>'<button type="button" class="btn secondary" data-salary-od-view="'+key+'" aria-pressed="false">'+label+'</button>').join("")+'</nav>';
 if(config.ready&&config.canWrite&&validMonth(config.month)){
  const d=getDraft();
  for(const staff of config.defaultStaff)if(!d.payments.has(staff.id)){d.payments.set(staff.id,"");d.payConfirmed=false}
 }
 nav.querySelectorAll("[data-salary-od-view]").forEach(b=>b.addEventListener("click",()=>{activeView=b.dataset.salaryOdView;render()}));
 render();
}
window.salaryOdMount=mount;window.salaryOdClear=clear;
window.addEventListener("beforeunload",e=>{if([...drafts.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue=""}});
if(typeof module!=="undefined"&&module.exports)module.exports={lines,cents,monthEnd,journal,paymentTotals,journalCsv,restoreDraft,csv};
})();
