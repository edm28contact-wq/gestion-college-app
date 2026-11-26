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
 {key:"tese_credit",account:"43100000",label:"TESE",side:"C"},
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
function journalText(month,values){
 const j=journal(values);
 if(!j.ok)throw Error("OD incomplète ou déséquilibrée");
 const date=monthEnd(month),year=month.slice(0,4),monthNames=["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.","Août","Sept.","Oct.","Nov.","Déc."];
 const label="OD "+monthNames[Number(month.slice(5))-1]+" "+year+": ";
 const exactLabels={insurance:"UNIP - Prevoyance Cadres",withholding:"Prelevement à la source",unemployment:"Assurance chomage",ppv:"Prime Patage de la Valeur",termination:"Indemnité rupture"};
 const rows=[["Date","Journal","Compte","Libel Compte","","LibelEcriture","Montant","D/C","",""]];
 for(const e of j.entries.filter(e=>e.amount>0)){
  const name=exactLabels[e.key]||e.label;
  const formatted=decimal(e.amount).replace(/,00$/,"").replace(/(,\d)0$/,"$1");
  rows.push([date,"OD",e.account,name,"",label+name,formatted,e.side,"",""]);
 }
 return rows.map(row=>row.join("\t")).join("\r\n")+"\r\n";
}
function windows1252(text){
 const extra="€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
 return Uint8Array.from(Array.from(text,ch=>{
  const cp=ch.codePointAt(0);
  if(cp<128||(cp>=160&&cp<=255))return cp;
  const index=extra.indexOf(ch);
  if(index>=0)return 128+index;
  throw Error("Caractère incompatible avec le format d’injection Windows-1252.");
 }));
}
function reconcilePayments(d){
 const p=paymentTotals(d.payments),account=cents(d.values.payable);
 const difference=p.ok&&account!==null?account-p.total:null;
 const justified=difference!==null&&difference!==0&&d.reconciliation?.difference===difference&&String(d.reconciliation.reason||"").trim().length>=10;
 return {p,account,difference,justified,ok:difference!==null&&(difference===0||justified)};
}
const drafts=new Map(),remoteMonths=new Map();
let session="",activeView="pay",context=null,remoteMonthList=[],remoteListLoading=false,remoteListLoaded=false;
function clear(){drafts.clear();remoteMonths.clear();session="";context=null;activeView="pay";remoteMonthList=[];remoteListLoading=false;remoteListLoaded=false}
function remoteFor(month){
 if(!remoteMonths.has(month))remoteMonths.set(month,{tried:false,loaded:false,loading:false,saving:false,version:0,status:"draft",updated_at:"",updated_by:"",bank_reference:"",export_info:{},history:[],error:""});
 return remoteMonths.get(month);
}

function blankDraft(){return {values:Object.create(null),payments:new Map(),reconciliation:{reason:"",difference:null},bank:{issuer:{},beneficiaries:new Map()},declarations:new Map(),declarationConfirmed:false,odConfirmed:false,payConfirmed:false,bankConfirmed:false,bankSignature:"",bankLoading:false,bankError:"",dirty:false}}
function draftFor(month){
 if(!drafts.has(month)){
  const draft=blankDraft();
  if(validMonth(month)){
   draft.bank.issuer.name="COLLEGE PRIVE CHAMBERTIN SAS";
   draft.bank.issuer.filename="Salaires "+month.slice(5)+"-"+month.slice(0,4);
   const [year,m]=month.split("-").map(Number);
   draft.bank.issuer.label=window.ChambertinSEPA?.workbookLabel?.(month+"-01")||"Salaire "+new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,m-1,1)));
  }
  drafts.set(month,draft);
 }
 return drafts.get(month);
}
function download(filename,content,type){
 const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function permissionsValid(){return !!context?.canWrite&&!!context.session&&context.session===session&&document.getElementById("salaryPayrollWorkArea")!==null}
function updateDraft(d){d.dirty=true;d.odConfirmed=false;d.payConfirmed=false;d.bankConfirmed=false;d.reconciliation.difference=null}
function staffName(id){return context.staff.find(s=>s.id===id)?.name||"Salarié introuvable"}
function getDraft(){return draftFor(context.month)}
function field(value,attrs,label){return '<input type="text" inputmode="decimal" autocomplete="off" maxlength="16" placeholder="0,00" aria-label="'+esc(label)+'" '+attrs+' value="'+esc(value??"")+'">'}
function draftTools(){
 return '<div class="salary-od-draft"><span>Sauvegarde en ligne dans le dossier mensuel sécurisé · une copie locale reste possible.</span><div class="actions"><button type="button" class="btn secondary compact" id="salaryOdBackup">Sauvegarder le brouillon</button><label class="btn secondary compact salary-od-file">Reprendre un brouillon<input type="file" id="salaryOdImport" accept=".json,application/json"></label></div><p class="muted">Ce fichier privé non chiffré peut contenir salaires, coordonnées bancaires et N° SS. Conservez-le uniquement dans un espace sécurisé.</p></div>';
}
function odHtml(d){
 const rows=lines.map(line=>(line.group?'<tr class="salary-od-group"><th colspan="4">'+esc(line.group)+'</th></tr>':'')+
  '<tr><td><b>'+line.account+'</b></td><th scope="row">'+esc(line.label)+(line.derived?' <small class="muted">Reprise automatique</small>':'')+'</th>'+
  ["D","C"].map(side=>'<td>'+ (side!==line.side?'—':line.derived?'<strong id="salaryOdBenefitCredit">—</strong>':field(d.values[line.key],'data-od-key="'+line.key+'"',line.label+" "+(side==="D"?"débit":"crédit")))+'</td>').join("")+'</tr>').join("");
 return '<section class="card salary-od-section"><div class="salary-od-heading"><div><h2>4. OD de salaires</h2><p class="muted">Modèle Chambertin · journal OD · date '+monthEnd(context.month).replace(/(\d{4})(\d{2})(\d{2})/,"$3/$2/$1")+'. Renseignez les montants du journal de paie validé.</p></div><button class="btn secondary" type="button" id="salaryOdZero">Mettre les champs vides à zéro</button></div>'+
 '<div class="salary-od-totals"><div><span>Total débit</span><strong id="salaryOdDebit">—</strong></div><div><span>Total crédit</span><strong id="salaryOdCredit">—</strong></div><div><span>Écart</span><strong id="salaryOdBalance">—</strong></div></div>'+
 '<div class="table"><table class="salary-od-table"><thead><tr><th>Compte</th><th>Libellé</th><th>Débit (€)</th><th>Crédit (€)</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
 '<p class="muted">Les comptes et sens suivent le classeur fourni. Vérifiez leur validité avec la comptabilité avant import. Les cotisations, la taxe sur les salaires et le prélèvement à la source ne sont pas estimés.</p>'+
 '<p id="salaryOdReconcile" role="status" class="salary-od-status"></p><p id="salaryOdStatus" role="status" class="salary-od-status"></p>'+
 '<label class="salary-od-confirm"><input type="checkbox" id="salaryOdConfirm"> J’ai vérifié les montants et les comptes avec le journal de paie.</label><div class="actions"><button type="button" id="salaryOdExport" class="btn primary" disabled>Exporter le fichier OD (.txt)</button><button type="button" id="salaryOdCsv" class="btn secondary" disabled>CSV de contrôle</button></div><p class="muted">TXT : tabulations, 10 colonnes, décimales françaises, Windows-1252 et fins de ligne CRLF selon le modèle réel. Aucun enregistrement comptable automatique. Vérifier l’import dans le logiciel.</p></section>';
}
function payHtml(d){
 const people=[...d.payments].sort((a,b)=>staffName(a[0]).localeCompare(staffName(b[0]),"fr"));
 const rows=people.map(([id,value])=>'<tr><th scope="row">'+esc(staffName(id))+'</th><td>'+field(value,'data-pay-id="'+esc(id)+'"',"Net à virer : "+staffName(id))+'</td><td>'+(context.staff.some(s=>s.id===id&&!s.archived)?'<span class="muted">0 si aucun virement</span>':'<button type="button" class="btn secondary compact" data-pay-remove="'+esc(id)+'">Retirer</button>')+'</td></tr>').join("");
 const extra=context.staff.filter(s=>!d.payments.has(s.id)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
 return '<section class="card salary-od-section"><div class="salary-od-heading"><div><h2>3. Virements de salaires</h2><p class="muted">Reportez le montant net réellement à verser de chaque bulletin validé, après acomptes et prélèvement à la source. Ne les déduisez pas une deuxième fois.</p></div></div>'+
 '<section id="salaryPayslipImport" class="salary-payslip-import" aria-label="Import des bulletins de paie"></section>'+ 
 '<div class="salary-od-totals"><div><span>Total à virer</span><strong id="salaryPayTotal">—</strong></div><div><span>Compte 42100000</span><strong id="salaryPayAccount">—</strong></div><div><span>Écart</span><strong id="salaryPayBalance">—</strong></div></div>'+
 '<div class="table"><table class="salary-od-table salary-pay-table"><thead><tr><th>Salarié</th><th>Net à virer (€)</th><th>Information</th></tr></thead><tbody>'+(rows||'<tr><td colspan="3">Aucun salarié disponible.</td></tr>')+'</tbody></table></div>'+
 (extra.length?'<div class="actions salary-od-extra"><label>Autre salarié du catalogue <select id="salaryPayExtra"><option value="">Choisir</option>'+extra.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select></label><button type="button" class="btn secondary" id="salaryPayAdd">Ajouter</button></div>':'')+
 '<p id="salaryPayStatus" role="status" class="salary-od-status"></p><label class="salary-od-confirm"><input type="checkbox" id="salaryPayConfirm"> J’ai contrôlé les montants nets sur les bulletins et la liste des bénéficiaires.</label>'+
 '<div class="salary-od-reconcile-form"><label>Compte 42100000 selon le journal de paie (€) '+field(d.values.payable,'id="salaryPayLedger"',"Compte 42100000 selon le journal de paie")+'</label><label>Justification de l’écart (si nécessaire)<textarea id="salaryPayReason" maxlength="1000" rows="2" placeholder="Indiquer la cause vérifiée et la référence de la pièce justificative">'+esc(d.reconciliation.reason)+'</textarea></label><button type="button" class="btn secondary" id="salaryPayJustify" disabled>Confirmer l’écart justifié</button><p class="muted">Le montant comptable n’est jamais remplacé automatiquement par le total bancaire.</p></div>'+
 '<div class="actions"><button id="salaryPayExport" type="button" class="btn primary" disabled>Exporter la liste des virements (CSV)</button></div>'+
 '<p class="muted">Liste préparatoire. Aucun paiement n’est émis depuis cette page.</p></section>'+bankHtml(d);
}

const issuerFields=Object.freeze([["name","Nom émetteur",70],["iban","IBAN émetteur",42],["bic","BIC émetteur",11],["number","Num émetteur",35],["date","Date d’exécution",10],["filename","Nom du fichier de sortie",100],["label","Libellé écriture",140]]);
const beneficiaryFields=Object.freeze([["matricule","Matricule",35],["creditorName","Nom bénéficiaire SEPA",70],["rowOrder","Ordre classeur",4],["iban","IBAN",42],["bic","BIC",11],["country","Pays",2],["postcode","Code postal",16],["city","Ville",35],["address","Adresse",70],["comment","Commentaire",140]]);
function compactIban(value){return String(value??"").replace(/\s/g,"").toUpperCase()}
function validIban(value){
 const iban=compactIban(value);
 if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||iban.startsWith("FR")&&iban.length!==27)return false;
 let rem=0;
 for(const ch of iban.slice(4)+iban.slice(0,4)){
  const digits=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;
  for(const digit of digits)rem=(rem*10+Number(digit))%97;
 }
 return rem===1;
}
function validBic(value){return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(String(value??"").trim().toUpperCase())}
function validExecutionDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||""))return false;
 const date=new Date(value+"T00:00:00Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function bankProblem(d){
 const i=d.bank.issuer,rec=reconcilePayments(d);
 if(!rec.ok)return "Rapprochez les virements avec le compte 421 ou justifiez l’écart.";
 if(!String(i.name||"").trim()||!String(i.number||"").trim()||!String(i.filename||"").trim()||!String(i.label||"").trim())return "Complétez les informations de l’émetteur.";
 if(!validIban(i.iban)||!validBic(i.bic))return "Vérifiez l’IBAN et le BIC de l’émetteur.";
 if(!validExecutionDate(i.date))return "Indiquez une date d’exécution valide.";
 const matricules=new Set();
 for(const [id,value] of d.payments){
  if(!(cents(value)>0))continue;
  const b=d.bank.beneficiaries.get(id)||{},code=String(b.matricule||"").trim();
  if(!code||matricules.has(code)||!validIban(b.iban)||!validBic(b.bic)||!(/^[A-Z]{2}$/.test(String(b.country||"").toUpperCase()))||String(b.country||"").length!==2)return "Vérifiez les coordonnées et les matricules de tous les bénéficiaires à payer.";
  matricules.add(code);
 }
 return "";
}
function bankInput(value,key,label,max,id){
 return '<input autocomplete="off" '+(key==="date"?'type="date"':'type="text" maxlength="'+max+'"')+' aria-label="'+esc(label)+'" '+(id?'data-bank-person="'+esc(id)+'"':'data-bank-issuer="1"')+' data-bank-key="'+key+'" '+(id&&["iban","bic"].includes(key)?'readonly ':'')+'value="'+esc(value||"")+'">';
}
function bankHtml(d){
 const i=d.bank.issuer,people=[...d.payments].sort((a,b)=>staffName(a[0]).localeCompare(staffName(b[0]),"fr"));
 const fields=issuerFields.map(([key,label,max])=>'<label>'+esc(label)+bankInput(i[key],key,label,max)+'</label>').join("");
 const rows=people.map(([id,value])=>{
  const b=d.bank.beneficiaries.get(id)||{};
  return '<tr><th scope="row">'+esc(staffName(id))+'</th><td data-bank-amount="'+esc(id)+'">'+ (cents(value)===null?"—":esc(money(cents(value))))+'</td>'+beneficiaryFields.map(([key,label,max])=>'<td>'+bankInput(b[key],key,label+" — "+staffName(id),max,id)+'</td>').join("")+'</tr>';
 }).join("");
 return '<section class="card salary-od-section"><h3>Bordereau de virements</h3><p class="muted">IBAN et BIC récupérés depuis les fiches salariés. Modifiez-les dans Liste salariés ; les autres champs du bordereau restent dans le brouillon. Vérifiez les RIB sur un justificatif indépendant. Le numéro émetteur reprend le champ de votre modèle ; il ne constitue pas une validation bancaire.</p><button type="button" class="btn secondary" id="salaryBankReload">Actualiser les RIB des salariés</button><div class="salary-doc-fields">'+fields+'</div><div class="table"><table class="salary-bank-table"><thead><tr><th>Bénéficiaire</th><th>Montant</th>'+beneficiaryFields.map(([,label])=>'<th>'+esc(label)+'</th>').join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div><p id="salaryBankStatus" class="salary-od-status" role="status"></p><label class="salary-od-confirm"><input id="salaryBankConfirm" type="checkbox"> J’ai vérifié les coordonnées bancaires, les montants et la date d’exécution.</label><div class="actions"><button id="salaryBankPrint" type="button" class="btn secondary" disabled>Imprimer le bordereau PDF</button><button id="salaryBankXml" type="button" class="btn primary" disabled>Télécharger XML (format exact du classeur)</button></div><p class="muted">XML reproduit selon la macro VBA du classeur original (pain.001.001.03), avec les noms bancaires et l’ordre des lignes saisis. La banque doit confirmer qu’elle accepte encore ce format. Le fichier est généré uniquement dans le navigateur, jamais transmis automatiquement. Le virement nécessite une validation séparée dans la banque.</p></section>';
}
/* Vue bancaire unique : les informations complementaires restent dans le dossier securise. */
function simpleBankHtml(d,staff=context?.staff||[],month=context?.month||""){
 const nameFor=id=>staff.find(p=>p.id===id)?.name||"Salarié introuvable";
 const entries=[...d.payments].sort((a,b)=>nameFor(a[0]).localeCompare(nameFor(b[0]),"fr"));
 const rows=entries.map(([id,amount])=>{
  const b=d.bank.beneficiaries.get(id)||{};
  const total=cents(amount);
  return '<tr><th scope="row">'+esc(nameFor(id))+'</th>'+
   '<td>'+field(amount,'data-pay-id="'+esc(id)+'"',"Net à virer : "+nameFor(id))+'</td>'+
   '<td>'+esc(b.matricule||"—")+'</td><td>'+esc(b.creditorName||nameFor(id))+'</td>'+
   '<td style="overflow-wrap:anywhere">'+esc(b.iban||"À vérifier")+'</td>'+
   '<td>'+esc(b.bic||"À vérifier")+'</td></tr>';
 }).join("");
 return '<section class="card salary-od-section" id="salaryBankSimple">'+
  '<div class="salary-od-heading"><h2>Virements de salaires</h2><p class="muted">Mois '+esc(month)+' · Montants récupérés du dossier de paie, ajustables après vérification du bulletin</p></div>'+
  '<div class="table"><table class="salary-bank-table"><thead><tr><th>Salarié</th><th>Net à virer</th><th>Matricule</th><th>Bénéficiaire bancaire</th><th>IBAN</th><th>BIC</th></tr></thead><tbody>'+
  (rows||'<tr><td colspan="6">Aucun salarié enregistré pour ce mois.</td></tr>')+
  '</tbody><tfoot><tr><th>Total des virements</th><td><strong id="salaryPayTotal">—</strong></td><td colspan="4"></td></tr></tfoot></table></div>'+
  '<div class="actions" style="align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap"><label>Date d’exécution <input type="date" data-bank-issuer="1" data-bank-key="date" value="'+esc(d.bank.issuer.date||"")+'"></label>'+
  '<button id="salaryBankXml" type="button" class="btn primary" disabled>Exporter le fichier XML</button></div>'+
  '<p id="salaryBankStatus" role="status" class="salary-od-status"></p>'+
  '<p class="muted">Le fichier est téléchargé, jamais envoyé automatiquement à la banque. Vérifiez le nom, l’IBAN, le BIC, le montant et la date avant de confirmer.</p></section>';
}
function bankSignature(d){
 return JSON.stringify([...d.payments.keys()].sort().map(id=>[id,context.staff.find(s=>s.id===id)?.bank_summary?.version??0]));
}
function mergeSavedBanks(d,banks){
 const byId=new Map(banks.map(b=>[b.personnel_id,b]));
 let changed=false;
 for(const id of d.payments.keys()){
  const before=d.bank.beneficiaries.get(id)||{},record=byId.get(id);
  const after={...before,iban:record?.iban||"",bic:record?.bic||"",country:before.country||record?.iban?.slice(0,2)||""};
  if(["iban","bic","country"].some(k=>String(before[k]||"")!==after[k]))changed=true;
  d.bank.beneficiaries.set(id,after);
 }
 if(changed)d.bankConfirmed=false;
 return changed;
}
function bankDraftEntries(d){
 return [...d.bank.beneficiaries].map(([id,b])=>[id,{matricule:b.matricule||"",creditorName:b.creditorName||"",rowOrder:b.rowOrder||"",country:b.country||"",postcode:b.postcode||"",city:b.city||"",address:b.address||"",comment:b.comment||""}]);
}
async function loadSavedBanks(d,force=false){
 if(!permissionsValid()||activeView!=="pay"||d.bankLoading)return;
 const signature=bankSignature(d);
 if(!force&&(d.bankSignature===signature||d.bankFailedSignature===signature))return;
 const owner=session,month=context.month,ids=[...d.payments.keys()];
 d.bankLoading=true;d.bankError="";d.bankConfirmed=false;
 refresh();
 try{
  const r=await call(ROOT+"/personnel-planning","staff-bank-payroll","POST",{ids});
  if(!permissionsValid()||session!==owner||context.month!==month||getDraft()!==d||bankSignature(d)!==signature)return;
  if(r.ok!==true||!Array.isArray(r.banks)||r.banks.some(b=>!ids.includes(b.personnel_id)||!validIban(b.iban)||!validBic(b.bic)))throw Error("Réponse bancaire invalide.");
  mergeSavedBanks(d,r.banks);
  d.bankSignature=signature;d.bankFailedSignature="";
 }catch(e){
  if(session===owner){d.bankError=String(e.message||"RIB indisponibles.");d.bankFailedSignature=signature;d.bankSignature=""}
 }finally{
  d.bankLoading=false;
  if(permissionsValid()&&session===owner&&context.month===month&&getDraft()===d&&activeView==="pay")render();
 }
}
function invalidateBank(){
 for(const d of drafts.values()){d.bankSignature="";d.bankFailedSignature="";d.bankConfirmed=false}
}
function bankPrintHtml(month,d,nameFor){
 const problem=bankProblem(d);if(problem)throw Error(problem);
 const i=d.bank.issuer,p=paymentTotals(d.payments),rec=reconcilePayments(d);
 const active=[...d.payments].filter(([,v])=>cents(v)>0).sort((a,b)=>nameFor(a[0]).localeCompare(nameFor(b[0]),"fr"));
 const rows=active.map(([id,value])=>{
  const b=d.bank.beneficiaries.get(id);
  return "<tr>"+["",b.creditorName||nameFor(id),decimal(cents(value)),b.comment||i.label,b.matricule,i.date.slice(-2),String(b.bic).toUpperCase(),compactIban(b.iban),String(b.country).toUpperCase(),b.postcode||"",b.city||"",b.address||""].map(v=>"<td>"+esc(v)+"</td>").join("")+"</tr>";
 }).join("");
 return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bordereau salaires '+esc(month)+'</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#172b3d}h1{text-align:center;font-size:19px;margin:0 0 24px}.head{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #9babb8;padding:7px 6px;text-align:left;overflow-wrap:anywhere}th{background:#dbe8f4}tbody tr{break-inside:avoid}.summary{font-size:15px;font-weight:bold;margin:15px 0}.money{text-align:right}p{line-height:1.5}</style></head><body><h1>VIREMENT DES SALAIRES — '+esc(month)+'</h1><div class="head"><table><tr><th>IBAN émetteur</th><th>BIC émetteur</th></tr><tr><td>'+esc(compactIban(i.iban))+'</td><td>'+esc(i.bic.toUpperCase())+'</td></tr><tr><th>Nom émetteur</th><th>Num émetteur</th></tr><tr><td>'+esc(i.name)+'</td><td>'+esc(i.number)+'</td></tr></table><table><tr><th>Date d’exécution</th><td>'+esc(i.date.split("-").reverse().join("/"))+'</td></tr><tr><th>Nom du fichier de sortie</th><td>'+esc(i.filename)+'</td></tr><tr><th>Libellé écriture</th><td>'+esc(i.label)+'</td></tr></table></div><p class="summary">Total : '+esc(money(p.total))+' · Nombre de virements : '+active.length+'</p><table><thead><tr>'+["Inactif","Nom","Montant (€)","Commentaires","Matricule","Date","BIC","IBAN","Pays","Code postal","Ville","Adresse"].map(v=>"<th>"+esc(v)+"</th>").join("")+'</tr></thead><tbody>'+rows+'</tbody></table><p>Compte 421 : '+esc(money(rec.account))+' · Écart : '+esc(money(rec.difference))+(rec.justified?" · Justification : "+esc(d.reconciliation.reason):"")+'</p><p>Document confidentiel préparatoire. Ne constitue pas un ordre de virement SEPA.</p></body></html>';
}
async function printBank(d){
 if(!permissionsValid()||!d.payConfirmed||!d.bankConfirmed||d.bankLoading||d.bankSignature!==bankSignature(d))return;
 if([...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
 const signature=bankSignature(d),owner=session,month=context.month,ids=[...d.payments.keys()];
 const w=window.open("","_blank");if(!w)return alert("Autorisez les fenêtres pop-up pour imprimer le bordereau.");
 w.opener=null;w.document.write("<p>Vérification des coordonnées bancaires…</p>");w.document.close();
 d.bankLoading=true;refresh();
 const current=()=>permissionsValid()&&session===owner&&context.month===month&&getDraft()===d&&activeView==="pay"&&bankSignature(d)===signature;
 let printed=false;
 try{
  const r=await call(ROOT+"/personnel-planning","staff-bank-payroll","POST",{ids});
  if(!current()||!d.payConfirmed||!d.bankConfirmed)return;
  if(r.ok!==true||!Array.isArray(r.banks)||r.banks.some(b=>!ids.includes(b.personnel_id)||!validIban(b.iban)||!validBic(b.bic)))throw Error("Réponse bancaire invalide.");
  if(mergeSavedBanks(d,r.banks)){
   d.bankError="Un RIB a changé depuis le chargement. Actualisez et vérifiez de nouveau le bordereau.";
   d.bankSignature="";
   return;
  }
  if(w.closed)return;
  const html=bankPrintHtml(month,d,staffName);
  w.document.open();w.document.write(html);w.document.close();w.focus();printed=true;setTimeout(()=>{if(!w.closed)w.print()},250);
 }catch(e){if(current()){d.bankConfirmed=false;d.bankError="Vérification des RIB impossible. Actualisez avant impression.";d.bankSignature=""}}
 finally{if(!printed&&!w.closed)w.close();d.bankLoading=false;if(current())render()}
}

async function exportSepa(d){
 if(!workflowEditable()||!d.payConfirmed||!d.bankConfirmed||d.bankLoading||d.bankSignature!==bankSignature(d)||bankProblem(d))return;
 const owner=session,month=context.month,signature=bankSignature(d),ids=[...d.payments.keys()];
 const current=()=>permissionsValid()&&session===owner&&context.month===month&&getDraft()===d&&activeView==="pay"&&bankSignature(d)===signature;
 d.bankLoading=true;d.bankError="";refresh();
 try{
  const response=await call(ROOT+"/personnel-planning","staff-bank-payroll","POST",{ids});
  if(!current()||!d.payConfirmed||!d.bankConfirmed)return;
  if(response.ok!==true||!Array.isArray(response.banks)||response.banks.some(b=>!ids.includes(b.personnel_id)||!validIban(b.iban)||!validBic(b.bic)))
   throw Error("Les RIB enregistrés n’ont pas été vérifiés.");
  if(mergeSavedBanks(d,response.banks)){
   d.bankConfirmed=false;d.bankSignature="";
   throw Error("Un RIB a changé depuis la confirmation. Revérifiez le bordereau avant l’export XML.");
  }
  const problem=bankProblem(d);
  if(problem)throw Error(problem);
  const generator=window.ChambertinSEPA?.createWorkbookCreditTransfer||window.ChambertinSEPA?.createCreditTransfer;
  if(typeof generator!=="function")throw Error("Générateur SEPA indisponible. Actualisez la page.");
  const beneficiaries=[...d.payments].sort((a,b)=>Number(d.bank.beneficiaries.get(a[0])?.rowOrder||9999)-Number(d.bank.beneficiaries.get(b[0])?.rowOrder||9999)||staffName(a[0]).localeCompare(staffName(b[0]),"fr")).map(([id,value])=>{
   const bank=d.bank.beneficiaries.get(id)||{};
   return {name:staffName(id),amountCents:cents(value),...bank};
  });
  const snapshot=JSON.stringify([month,d.bank.issuer,beneficiaries]);
  const batchId=d.sepaExport?.snapshot===snapshot?d.sepaExport.batchId:crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
  const result=generator({month,issuer:d.bank.issuer,beneficiaries,batchId,now:new Date()});
  if(result.totalCents!==paymentTotals(d.payments).total)throw Error("Le total SEPA ne correspond pas aux montants confirmés.");
  if(!current()||!d.payConfirmed||!d.bankConfirmed)return;
  if(reconcilePayments(d).difference!==0)throw Error("Le fichier SEPA exige la concordance exacte avec le compte 421. Corrigez le rapprochement avant export.");
  const accepted=confirm("Télécharger "+result.filename+" ?\n\n"+result.count+" virement(s) — "+money(result.totalCents)+".\n\nLe format pain.001.001.03 de votre classeur doit être accepté par votre banque. L’import et l’autorisation des paiements se font uniquement sur le site bancaire. Ne déposez jamais deux fois le même lot.");
  if(!accepted)return;
  if(!current())return;
  if(!await workflowSave(d,true))throw Error("Le dossier doit être enregistré en ligne avant de générer le virement bancaire.");
  if(!current()||d.dirty)throw Error("Le dossier a changé pendant la sauvegarde. Revérifiez les montants.");
  const hashBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(result.xml)));
  const sha256=Array.from(hashBytes,b=>b.toString(16).padStart(2,"0")).join("");
  if(!current())return;
  d.sepaExport={snapshot,batchId};
  download(result.filename,result.xml,"application/xml;charset=utf-8");
  const done=await workflowStatus("exported",{exportInfo:{messageId:result.messageId,filename:result.filename,sha256,totalCents:result.totalCents,count:result.count}});
  if(!done)throw Error("Le fichier XML est généré, mais son suivi en ligne n’a pas été confirmé. Ne le réimportez pas avant de vérifier le dossier mensuel.");
 }catch(e){
  if(current()){d.bankError=String(e.message||"Export SEPA impossible.");d.bankConfirmed=false}
 }finally{
  d.bankLoading=false;
  if(current())refresh();
 }
}

function restoreBank(raw,staffIds){
 const bank={issuer:{},beneficiaries:new Map()};
 if(raw===undefined)return bank;
 if(!raw||!raw.issuer||typeof raw.issuer!=="object"||!Array.isArray(raw.beneficiaries)||raw.beneficiaries.length>1000)throw Error("Coordonnées du brouillon invalides.");
 const copy=(src,fields)=>{
  if(!src||typeof src!=="object")throw Error("Coordonnées du brouillon invalides.");
  const out={};
  for(const [key,,max] of fields)if(Object.hasOwn(src,key)){
   if(typeof src[key]!=="string"||src[key].length>max)throw Error("Champ bancaire invalide : "+key);
   out[key]=src[key];
  }
  return out;
 };
 bank.issuer=copy(raw.issuer,issuerFields);
 for(const row of raw.beneficiaries){
  if(!Array.isArray(row)||row.length!==2||!staffIds.has(row[0])||bank.beneficiaries.has(row[0]))throw Error("Bénéficiaire du brouillon invalide.");
  bank.beneficiaries.set(row[0],copy(row[1],beneficiaryFields.filter(([key])=>["matricule","creditorName","rowOrder","country","postcode","city","address","comment"].includes(key))));
 }
 return bank;
}

const declarationFields=Object.freeze([
 ["nir","N° SS",32],["contract","Contrat",100],["function","Fonction",160],["status","Statut",100],
 ["start","Date d’entrée",10],["end","Date de fin de contrat",10],["hours","Base horaire mensuelle",40],["rate","Taux horaire brut",40],
 ["gross","Salaire brut",40],["transport","Forfait Navigo",40],["health","Mutuelle Swisslife",40],
 ["adjustments","Retenue / prime / heures compl. ou sup.",1000],["absence","Absences (maladie sans subrogation, congés payés, JNT)",1000],
 ["absencePay","Absences payées / non payées",1000],["comments","Commentaires pour le social",1000],["internal","Commentaires internes — non transmis",1000]
].map(Object.freeze));
function declarationValues(d,staff){
 const row=d.declarations.get(staff.id)||{},known=staff.prefill||{};
 return {...known,...row,function:Object.hasOwn(row,"function")?row.function:known.function||staff.roleLabel||""};
}
function materializeKnownDeclaration(d,staff){
 let changed=false;
 for(const person of staff||[]){
  const known=person.prefill||{},row={...(d.declarations.get(person.id)||{})};
  let added=false;
  for(const [key,,max] of declarationFields){
   const value=known[key];
   if(Object.hasOwn(row,key)||typeof value!=="string"||!value.trim()||value.length>max)continue;
   row[key]=value;added=true;
  }
  if(added){d.declarations.set(person.id,row);changed=true}
 }
 if(changed){d.declarationConfirmed=false;d.dirty=true}
 return changed;
}
function declarationData(d,staff){
 const rows=staff.map(s=>{
  const row=declarationValues(d,s);
  return [s.name,...declarationFields.filter(([key])=>key!=="internal").map(([key])=>row[key]||"")];
 });
 return [["NOM",...declarationFields.filter(([key])=>key!=="internal").map(([,label])=>label)],...rows];
}
function declarationProblem(d,staff){
 if(!staff.length)return "Aucun salarié à déclarer pour ce mois.";
 for(const s of staff){
  const row=declarationValues(d,s);
  if(!String(row.contract||"").trim()||!String(row.function||"").trim()||!String(row.status||"").trim()||!validExecutionDate(row.start))return "Complétez le contrat, la fonction, le statut et la date d’entrée de chaque salarié.";
  if(row.end&&(!validExecutionDate(row.end)||row.end<row.start))return "Vérifiez les dates de contrat.";
  for(const key of ["hours","rate","gross","transport","health"]){
   const v=String(row[key]||"").trim();
   // Zero is explicit; an empty field is not silently interpreted as zero.
   // Some contracts have no applicable hourly rate; allow the explicit marker N/A.
   if(key==="rate"&&v.toUpperCase()==="N/A")continue;
   if(cents(v)===null)return "Renseignez les montants et la base horaire (0 si aucun ; N/A pour un taux horaire non applicable).";
  }
 }
 return "";
}
function declarationHtml(d){
 const staff=context.declarationStaff||[];
 const cards=staff.map(s=>{
  const row=declarationValues(d,s);
  const evidence=(Array.isArray(s.evidence)?s.evidence:[]).filter(note=>typeof note?.label==="string"&&typeof note?.value==="string");
  const knownHtml=evidence.map(note=>'<li><strong>'+esc(note.label)+'</strong> : '+esc(note.value)+'</li>').join("");
  const missing=declarationFields.filter(([key])=>key!=="internal"&&!String(row[key]||"").trim()).length;
  const fields=declarationFields.map(([key,label,max])=>{
   const long=max>200,type=key==="start"||key==="end"?"date":"text";
   const attrs='data-declaration-person="'+esc(s.id)+'" data-declaration-key="'+key+'" autocomplete="off" aria-label="'+esc(label+" — "+s.name)+'" maxlength="'+max+'"';
   const input=long?'<textarea '+attrs+' rows="2">'+esc(row[key]||"")+'</textarea>':'<input '+attrs+' type="'+type+'" value="'+esc(row[key]||"")+'">';
   return '<label class="'+(long?"salary-declaration-wide":"")+'">'+esc(label)+input+'</label>';
  }).join("");
  return '<details class="salary-declaration-person"><summary>'+esc(s.name)+' <span class="muted">'+esc(row.gross?row.gross+" € brut":"À renseigner")+'</span></summary><p class="muted salary-declaration-source">'+esc(s.source||"Éléments du planning indisponibles")+'</p>'+
  '<div class="salary-declaration-known"><strong>Informations récupérées de la fiche salarié et du planning</strong>'+
  (knownHtml?'<ul>'+knownHtml+'</ul>':'<p>Aucune information supplémentaire disponible.</p>')+'</div>'+
  '<p class="muted">'+missing+' champ(s) encore à renseigner ou à confirmer. Les horaires calculés ne sont pas une base contractuelle ; les événements non validés ne créent aucune retenue.</p>'+
  '<div class="salary-doc-fields">'+fields+'</div></details>';
 }).join("");
 return '<section class="card salary-od-section"><h2>2. Déclaration des salaires — Gérance</h2><p class="muted">Données connues préremplies depuis les fiches salariés et le planning. Les valeurs déjà saisies sont conservées. Les contrats, salaires bruts, taux et cotisations absents du système ne sont pas inventés ; les heures théoriques ne constituent pas une base horaire contractuelle.</p><p class="muted">N° SS et commentaires internes : saisie confidentielle dans cette session. Ne renseignez le N° SS que si nécessaire au destinataire. Les commentaires internes ne figurent dans aucun export social.</p>'+cards+'<p class="salary-od-status" id="salaryDeclarationStatus" role="status"></p><label class="salary-od-confirm"><input id="salaryDeclarationConfirm" type="checkbox"> J’ai vérifié les données de déclaration et les éléments transmis au social.</label><div class="actions"><button id="salaryDeclarationCsv" class="btn primary" type="button" disabled>Exporter le tableau pour Excel (CSV)</button><button id="salaryDeclarationPrint" class="btn secondary" type="button" disabled>Imprimer / enregistrer en PDF</button></div><p class="muted">Export de préparation, non-déclaration automatique. Les informations non connues doivent être contrôlées sur les contrats et bulletins.</p></section>';
}
function declarationPrintHtml(month,data){
 const [header,...rows]=data;
 const blocks=rows.map(row=>'<section><h2>'+esc(row[0])+'</h2><table><tbody>'+header.slice(1).map((label,index)=>'<tr><th>'+esc(label)+'</th><td>'+esc(row[index+1])+'</td></tr>').join("")+'</tbody></table></section>').join("");
 return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Déclaration salaires '+esc(month)+'</title><style>@page{size:A4;margin:12mm}body{font:11px Arial,sans-serif;color:#172b3d}h1{font-size:19px}h2{font-size:14px}section{break-inside:avoid;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #b8c5d0;padding:4px 6px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{width:36%;background:#e8f0f7}</style></head><body><h1>Tableau récapitulatif pour la réalisation des bulletins de salaires</h1><p>Cours Chambertin — '+esc(month)+' · Confidentiel, destiné au social</p>'+blocks+'</body></html>';
}
function restoreDeclarations(raw,staffIds){
 const result=new Map();
 if(raw===undefined)return result;
 if(!Array.isArray(raw)||raw.length>1000)throw Error("Déclarations du brouillon invalides.");
 for(const item of raw){
  if(!Array.isArray(item)||item.length!==2||!staffIds.has(item[0])||result.has(item[0])||!item[1]||typeof item[1]!=="object")throw Error("Salarié de la déclaration invalide.");
  const row={};
  for(const [key,,max] of declarationFields)if(Object.hasOwn(item[1],key)){
   const value=item[1][key];if(typeof value!=="string"||value.length>max)throw Error("Champ de déclaration invalide.");
   row[key]=value;
  }
  result.set(item[0],row);
 }
 return result;
}
function restoreDraft(raw,month,staffIds,defaultIds){
 if(!raw||![1,2].includes(raw.version)||raw.month!==month||!raw.values||typeof raw.values!=="object"||!Array.isArray(raw.payments)||raw.payments.length>1000)throw Error("Brouillon invalide ou mois différent.");
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
 d.bank=restoreBank(raw.bank,staffIds);
 d.declarations=restoreDeclarations(raw.declarations,staffIds);
 if(raw.reconciliation&&typeof raw.reconciliation.reason==="string"&&raw.reconciliation.reason.length<=1000)d.reconciliation.reason=raw.reconciliation.reason;
 // A restored draft must be checked again, including any previously justified discrepancy.
 d.dirty=true;
 return d;
}

const workflowNames={draft:"Brouillon",exported:"XML généré",submitted:"Remis à la banque",paid:"Virement confirmé",rejected:"Refusé par la banque"};
function workflowEditable(){return permissionsValid()&&remoteFor(context.month).loaded&&remoteFor(context.month).status==="draft"&&!remoteFor(context.month).saving&&!remoteFor(context.month).loading}
function workflowDraft(d){
 if(context?.ready&&remoteFor(context.month).status==="draft")materializeKnownDeclaration(d,context.declarationStaff||[]);
 return {version:2,month:context.month,values:d.values,payments:[...d.payments],reconciliation:d.reconciliation,
  bank:{issuer:d.bank.issuer,beneficiaries:bankDraftEntries(d)},declarations:[...d.declarations]};
}
async function workflowList(force=false){
 if(!window.ChambertinPayroll||!session||remoteListLoading||remoteListLoaded&&!force)return;
 const owner=session;remoteListLoading=true;
 try{
  const response=await window.ChambertinPayroll.list(owner);
  if(owner!==session)return;
  remoteMonthList=response.months||[];remoteListLoaded=true;
 }catch{if(owner===session)remoteListLoaded=false}
 finally{remoteListLoading=false;if(owner===session&&salaryPageVisible())render()}
}
async function workflowLoad(month,force=false){
 const state=remoteFor(month),service=window.ChambertinPayroll;
 if(!service||!session||state.loading||state.saving||!validMonth(month))return;
 if(!force&&state.tried)return;
 const owner=session,staff=context?.staff||[],defaults=context?.defaultStaff||[],local=draftFor(month);
 state.tried=true;state.loading=true;state.error="";
 if(context?.month===month)render();
 try{
  const reply=await service.load(month,owner);
  if(owner!==session)return;
  if(local.dirty&&!force){
   state.error="Une saisie locale non enregistrée existe. Sauvegardez-la en fichier privé, puis utilisez « Recharger » pour reprendre le dossier en ligne.";
   return;
  }
  const row=reply.record;
  if(row){
   const restored=restoreDraft(row.draft,month,new Set(staff.map(x=>x.id)),defaults.map(x=>x.id));
   restored.dirty=false;
   drafts.set(month,restored);
  }else if(!local.dirty){
   const defaultBank=reply.defaults||{};
   const d=draftFor(month);
   d.bank.issuer={...d.bank.issuer,...(defaultBank.issuer||{}),date:""};
   for(const [id,details] of defaultBank.beneficiaries||[])
    if(staff.some(x=>x.id===id))d.bank.beneficiaries.set(id,{...details,comment:""});
   d.bankConfirmed=false;
  }
  state.version=row?.version||0;state.status=row?.status||"draft";state.updated_at=row?.updated_at||"";
  state.updated_by=row?.updated_by||"";state.bank_reference=row?.bank_reference||"";state.export_info=row?.export_info||{};
  state.history=reply.history||[];state.loaded=true;
 }catch(e){if(owner===session)state.error=String(e.message||"Chargement indisponible.")}
 finally{state.loading=false;if(owner===session&&context?.month===month&&salaryPageVisible())render()}
}
async function workflowSave(d,quiet=false){
 if(!permissionsValid()||!d||getDraft()!==d||!workflowEditable())return false;
 const state=remoteFor(context.month),owner=session,month=context.month;
 const payload=workflowDraft(d),snapshot=JSON.stringify(payload);
 state.saving=true;state.error="";
 if(!quiet)render();
 try{
  const reply=await window.ChambertinPayroll.save(month,owner,state.version,payload);
  if(owner!==session)return false;
  state.version=reply.record.version;state.status=reply.record.status;
  state.updated_at=reply.record.updated_at;state.updated_by=reply.record.updated_by;
  if(JSON.stringify(workflowDraft(d))===snapshot)d.dirty=false;
  void workflowList(true);
  return true;
 }catch(e){if(owner===session)state.error=String(e.message||"Enregistrement non confirmé.");return false}
 finally{state.saving=false;if(owner===session&&context?.month===month&&salaryPageVisible())render()}
}
async function workflowStatus(action,details={}){
 const month=context?.month,owner=session,state=month?remoteFor(month):null;
 if(!state?.loaded||state.loading||state.saving||!permissionsValid())return false;
 state.saving=true;state.error="";render();
 try{
  const response=await window.ChambertinPayroll.status(month,owner,state.version,action,details);
  if(owner!==session||context?.month!==month)return false;
  state.version=response.record.version;state.status=response.record.status;
  state.updated_at=response.record.updated_at;state.updated_by=response.record.updated_by;
  state.bank_reference=response.record.bank_reference||"";state.export_info=response.record.export_info||{};state.history=response.history||[];
  if(action==="draft"){
   const d=getDraft();d.payConfirmed=false;d.odConfirmed=false;d.bankConfirmed=false;d.sepaExport=null;d.bankSignature="";
  }else getDraft().dirty=false;
  void workflowList(true);
  return true;
 }catch(e){if(owner===session)state.error=String(e.message||"Changement de statut non confirmé.");return false}
 finally{state.saving=false;if(owner===session&&context?.month===month&&salaryPageVisible())render()}
}
function workflowPanel(){
 if(!context?.ready||!context?.canWrite)return '<p class="muted">Le dossier de paie en ligne nécessite les droits de modification Salaires.</p>';
 const month=context.month,state=remoteFor(month),busy=state.loading||state.saving;
 const options=remoteMonthList.map(x=>'<option value="'+esc(x.month)+'">'+esc(x.month)+" — "+esc(workflowNames[x.status]||x.status)+'</option>').join("");
 const summary=state.loaded?'<strong>'+esc(workflowNames[state.status]||state.status)+'</strong> · version '+state.version+
  (state.updated_at?' · Enregistré le '+esc(new Date(state.updated_at).toLocaleString("fr-FR")):'')+
  (state.updated_by?' par '+esc(state.updated_by):'')+
  (state.bank_reference?' · Référence banque : '+esc(state.bank_reference):'')+
  (state.export_info?.filename?' · XML : '+esc(state.export_info.filename):''):
  state.loading?'Chargement du dossier serveur…':'Dossier non chargé depuis le serveur.';
 const entries=(state.history||[]).map(x=>'<li>'+esc(new Date(x.created_at).toLocaleString("fr-FR"))+' · '+esc(x.actor)+' · '+esc(workflowNames[x.new_status]||x.new_status)+
  (x.note?' · '+esc(x.note):'')+'</li>').join("");
 return '<div class="salary-od-heading"><div><h3>Dossier mensuel en ligne</h3><p class="muted">Mois '+esc(month)+' · Enregistrement sécurisé et historique des étapes bancaires</p></div></div>'+
  '<p role="status">'+summary+'</p>'+
  (state.error?'<p class="err" role="alert">'+esc(state.error)+'</p>':'')+
  '<div class="actions">'+
  '<button type="button" class="btn primary" id="salaryWorkflowSave" '+(!state.loaded||busy||state.status!=="draft"?'disabled':'')+'>Enregistrer le mois</button>'+
  '<button type="button" class="btn secondary" id="salaryWorkflowReload" '+(busy?'disabled':'')+'>Recharger le dossier</button>'+
  (state.status==="exported"?'<button type="button" class="btn secondary" id="salaryWorkflowSubmit" '+(busy?'disabled':'')+'>Marquer remis à la banque</button>':'')+
  (state.status==="submitted"?'<button type="button" class="btn primary" id="salaryWorkflowPaid" '+(busy?'disabled':'')+'>Confirmer le virement exécuté</button>':'')+
  (["submitted","exported"].includes(state.status)?'<button type="button" class="btn secondary" id="salaryWorkflowReject" '+(busy?'disabled':'')+'>Signaler un rejet</button>':'')+
  (["exported","rejected"].includes(state.status)?'<button type="button" class="btn secondary" id="salaryWorkflowReopen" '+(busy?'disabled':'')+'>Corriger le dossier</button>':'')+
  '</div>'+
  (options?'<label class="salary-od-inline">Dossiers précédents <select id="salaryWorkflowMonths"><option value="">Choisir un mois</option>'+options+'</select></label>':'')+
  '<details><summary>Historique des modifications et des validations ('+state.history.length+')</summary><ul>'+(entries||'<li>Aucune activité enregistrée</li>')+'</ul></details>'+
  '<p class="muted">Les RIB du tableau sont ceux actuellement enregistrés : ils peuvent avoir changé depuis un export antérieur. L’empreinte du XML est conservée dans le suivi mais aucun ordre n’est transmis à la banque. La remise et l’exécution doivent être confirmées séparément.</p>';
}
function workflowWire(){
 const scope=document.getElementById("salaryWorkflowPanel");
 if(!scope)return;
 scope.querySelector("#salaryWorkflowSave")?.addEventListener("click",()=>void workflowSave(getDraft()));
 scope.querySelector("#salaryWorkflowReload")?.addEventListener("click",()=>{
  const d=getDraft();
  if(d.dirty&&!confirm("Des modifications locales ne sont pas enregistrées. Les écraser par le dossier en ligne ?"))return;
  const state=remoteFor(context.month);state.tried=false;void workflowLoad(context.month,true);
 });
 scope.querySelector("#salaryWorkflowMonths")?.addEventListener("change",e=>{
  if(validMonth(e.target.value)&&!getDraft().dirty)salarySelectMonth(e.target.value);
  else if(e.target.value)alert("Enregistrez ou sauvegardez le brouillon avant de changer de mois.");
 });
 scope.querySelector("#salaryWorkflowSubmit")?.addEventListener("click",()=>{
  const reference=prompt("Référence du dépôt bancaire (obligatoire) :");
  if(reference&&reference.trim().length>=4&&confirm("Confirmer que le fichier SEPA a réellement été déposé sur le portail bancaire ?"))
   void workflowStatus("submitted",{reference:reference.trim()});
 });
 scope.querySelector("#salaryWorkflowPaid")?.addEventListener("click",()=>{
  const note=prompt("Inscrivez la date et le justificatif bancaire d’exécution (10 caractères minimum) :");
  if(note&&note.trim().length>=10&&confirm("Le virement est-il effectivement exécuté et confirmé par la banque ?"))
   void workflowStatus("paid",{note:note.trim()});
 });
 scope.querySelector("#salaryWorkflowReject")?.addEventListener("click",()=>{
  const note=prompt("Motif du rejet bancaire (10 caractères minimum) :");
  if(note&&note.trim().length>=10&&confirm("Confirmer le rejet signalé par la banque ?"))void workflowStatus("rejected",{note:note.trim()});
 });
 scope.querySelector("#salaryWorkflowReopen")?.addEventListener("click",()=>{
  const note=prompt("Justifiez la réouverture du dossier (10 caractères minimum) :");
  if(note&&note.trim().length>=10&&confirm("Attention : l’ancien fichier SEPA ne doit pas être réimporté. Rouvrir le dossier ?"))
   void workflowStatus("draft",{note:note.trim()});
 });
}
function workflowReadOnly(){
 if(!context?.month)return;
 const state=remoteFor(context.month);
 if(state.status==="draft"&&state.loaded&&!state.loading&&!state.saving&&!getDraft().bankLoading)return;
 const host=document.getElementById("salaryPayrollWorkArea");
 if(!host||host.hidden)return;
 for(const input of host.querySelectorAll("input,textarea,select,button"))input.disabled=true;
}

function render(){
 const host=document.getElementById("salaryPayrollWorkArea"),variables=document.getElementById("salaryVariableSection");
 if(!host||!variables||!context)return;
 const workflow=document.getElementById("salaryWorkflowPanel");
 if(workflow){workflow.innerHTML=workflowPanel();workflowWire()}
 variables.hidden=activeView!=="variables";host.hidden=activeView==="variables";
 const employee=document.getElementById("salaryAccountingEmployee");if(employee)employee.disabled=activeView!=="variables"||!context.ready;
 document.querySelectorAll("[data-salary-od-view]").forEach(b=>{const selected=b.dataset.salaryOdView===activeView;b.classList.toggle("primary",selected);b.classList.toggle("secondary",!selected);b.setAttribute("aria-pressed",String(selected))});
 if(activeView==="variables"){host.replaceChildren();return}
 if(!context.ready||!context.canWrite){host.innerHTML='<section class="card"><h3>Préparation des salaires</h3><p class="muted">La saisie des montants nécessite les droits de modification des salaires et le chargement des données.</p></section>';return}
 const d=getDraft();
 if(activeView==="calculator"){
  const engine=window.ChambertinExcelPayroll;
  if(!engine){host.innerHTML='<p class="err">Calculateur Excel indisponible. Rechargez la page.</p>';return}
  engine.mount(host,{month:context.month,people:context.declarationStaff||[],draft:d});
  workflowReadOnly();return;
 }
 host.innerHTML=activeView==="pay"?simpleBankHtml(d):(activeView==="declaration"?declarationHtml(d):odHtml(d))+draftTools();
 wire(host,d);refresh();
 if(activeView==="pay"){
  const capturedSession=session,capturedMonth=context.month,staff=context.staff.map(p=>({id:p.id,name:p.name}));
  window.ChambertinPayslipImporter?.mount({
   root:document.getElementById("salaryPayslipImport"),
   month:capturedMonth,session:capturedSession,staff,
   editable:()=>workflowEditable()&&!d.bankLoading,
   isCurrent:()=>permissionsValid()&&session===capturedSession&&context.month===capturedMonth&&getDraft()===d&&activeView==="pay",
   apply:(amounts,overwrite)=>{
    const output=[];let changed=false;
    if(!permissionsValid()||!workflowEditable()||session!==capturedSession||context.month!==capturedMonth||getDraft()!==d)
     return amounts.map(()=>"review");
    for(const entry of amounts){
     if(!staff.some(p=>p.id===entry.staffId)||!Number.isSafeInteger(entry.amountCents)||entry.amountCents<0||entry.amountCents>999999999){
      output.push("review");continue;
     }
     const previous=d.payments.get(entry.staffId),existing=String(previous??"").trim();
     const next=(entry.amountCents/100).toFixed(2).replace(".",",");
     if(existing&&cents(previous)===entry.amountCents){output.push("same");continue}
     if(existing&&!overwrite){output.push("conflict");continue}
     d.payments.set(entry.staffId,next);changed=true;output.push("imported");
    }
    if(changed)updateDraft(d);
    return output;
   },
   refresh:()=>render()
  });
  void loadSavedBanks(d);
 }
 workflowReadOnly();
}
function refresh(){
 if(!permissionsValid())return;
 const d=getDraft(),j=journal(d.values),rec=reconcilePayments(d),{p,account,difference:reconcile}=rec;
 const el=id=>document.getElementById(id),set=(id,value)=>{const e=el(id);if(e)e.textContent=value};
 const unknown=[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id));
 const mismatch=reconcile!==null&&reconcile!==0&&!rec.justified;
 set("salaryOdBenefitCredit",cents(d.values.benefits)===null?"—":money(cents(d.values.benefits)));
 set("salaryOdDebit",money(j.debit));set("salaryOdCredit",money(j.credit));set("salaryOdBalance",money(j.balance));
 set("salaryOdReconcile",p.ok?(account===null?"Liste des virements complète : "+money(p.total)+" · compte 421 à renseigner.":rec.justified?"Écart justifié : "+money(reconcile):mismatch?"Écart avec les virements : "+money(reconcile):"Virements et compte 421 concordants."):"Rapprochement avec les virements : liste encore incomplète.");
 set("salaryOdStatus",j.missing?j.missing+" montant(s) à renseigner (0 si aucun).":j.balance!==0?"OD déséquilibrée : "+money(j.balance)+".":!j.ok?"Aucun montant à comptabiliser.":mismatch?"Écart entre les virements et le compte 421 à corriger.":"OD équilibrée. Contrôlez le journal avant export.");
 set("salaryPayTotal",money(p.total));set("salaryPayAccount",account===null?"Non renseigné":money(account));set("salaryPayBalance",reconcile===null?"—":money(reconcile));
 set("salaryPayStatus",unknown?"Un salarié du brouillon n’existe plus dans la liste.":p.missing?p.missing+" montant(s) à renseigner. Indiquez 0 si aucun virement.":!p.ok?"Aucun virement positif à préparer.":mismatch?"Le total diffère du compte 421. Vérifiez avant export.":account===null?"Liste complète : rapprochez-la du compte 421 avant export.":rec.justified?"Écart justifié : "+money(reconcile):"Total des virements rapproché du compte 421.");
 const payReady=p.ok&&!unknown&&rec.ok,odReady=j.ok&&!mismatch&&!unknown;
 if(el("salaryOdConfirm")){el("salaryOdConfirm").checked=d.odConfirmed;el("salaryOdConfirm").disabled=!odReady}
 if(el("salaryPayConfirm")){el("salaryPayConfirm").checked=d.payConfirmed;el("salaryPayConfirm").disabled=!p.ok||unknown}
 if(el("salaryOdExport"))el("salaryOdExport").disabled=!odReady||!d.odConfirmed;
 if(el("salaryPayExport"))el("salaryPayExport").disabled=!payReady||!d.payConfirmed;
 if(el("salaryOdCsv"))el("salaryOdCsv").disabled=!odReady||!d.odConfirmed;
 if(el("salaryPayJustify"))el("salaryPayJustify").disabled=unknown||reconcile===null||reconcile===0||d.reconciliation.reason.trim().length<10;
 for(const cell of document.querySelectorAll("[data-bank-amount]")){const value=cents(d.payments.get(cell.dataset.bankAmount));cell.textContent=value===null?"—":money(value)}
 const declarationError=declarationProblem(d,context.declarationStaff||[]);
 set("salaryDeclarationStatus",declarationError||"Déclaration prête à vérifier.");
 if(el("salaryDeclarationConfirm")){el("salaryDeclarationConfirm").checked=d.declarationConfirmed;el("salaryDeclarationConfirm").disabled=!!declarationError}
 for(const id of ["salaryDeclarationCsv","salaryDeclarationPrint"])if(el(id))el(id).disabled=!!declarationError||!d.declarationConfirmed;
 const bankError=d.bankLoading?"Chargement des RIB enregistrés…":d.bankError|| (d.bankSignature!==bankSignature(d)?"Actualisez les RIB enregistrés.":bankProblem(d));
 set("salaryBankStatus",remoteFor(context.month).status!=="draft"?"XML déjà généré pour ce mois. Vérifiez le suivi bancaire avant toute nouvelle opération.":bankError||"Prêt à exporter après confirmation des bénéficiaires.");
 if(el("salaryBankReload"))el("salaryBankReload").disabled=d.bankLoading;
 if(el("salaryBankConfirm")){el("salaryBankConfirm").checked=d.bankConfirmed;el("salaryBankConfirm").disabled=!!bankError||!d.payConfirmed||unknown}
 if(el("salaryBankPrint"))el("salaryBankPrint").disabled=!!bankError||!d.payConfirmed||!d.bankConfirmed||unknown;
 if(el("salaryBankXml"))el("salaryBankXml").disabled=!!bankError||d.bankLoading||unknown||!payReady||reconcile!==0||!workflowEditable();
 workflowReadOnly();
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
 el("salaryPayLedger")?.addEventListener("input",e=>{if(!permissionsValid())return;d.values.payable=e.target.value;updateDraft(d);refresh()});
 el("salaryPayReason")?.addEventListener("input",e=>{if(!permissionsValid())return;d.reconciliation.reason=e.target.value;updateDraft(d);refresh()});
 el("salaryPayJustify")?.addEventListener("click",()=>{
  if(!permissionsValid())return;
  const rec=reconcilePayments(d);
  if(rec.difference===null||rec.difference===0||d.reconciliation.reason.trim().length<10)return;
  if(!confirm("Confirmez-vous avoir vérifié et documenté l’écart de "+money(rec.difference)+" entre le journal de paie et les virements ?"))return;
  d.reconciliation.difference=rec.difference;d.dirty=true;d.odConfirmed=false;d.payConfirmed=false;d.bankConfirmed=false;refresh();
 });
 const exportOD=txt=>{
  if(!permissionsValid()||!d.odConfirmed)return;
  const j=journal(d.values),rec=reconcilePayments(d);
  if(!j.ok||(rec.difference!==null&&!rec.ok)||[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
  if(txt)download(context.month+" OD Salaires.txt",windows1252(journalText(context.month,d.values)),"text/plain;charset=windows-1252");
  else download("chambertin-od-salaires-"+context.month+".csv",journalCsv(context.month,d.values),"text/csv;charset=utf-8");
 };
 el("salaryOdExport")?.addEventListener("click",()=>exportOD(true));
 el("salaryOdCsv")?.addEventListener("click",()=>exportOD(false));
 host.querySelectorAll("[data-bank-key]").forEach(input=>input.addEventListener("input",()=>{
  if(!permissionsValid())return;
  const id=input.dataset.bankPerson,key=input.dataset.bankKey;
  if(id){if(["iban","bic"].includes(key))return;const b=d.bank.beneficiaries.get(id)||{};b[key]=input.value;d.bank.beneficiaries.set(id,b)}
  else d.bank.issuer[key]=input.value;
  d.bankConfirmed=false;d.bankError="";d.dirty=true;refresh();
 }));
 el("salaryBankReload")?.addEventListener("click",()=>void loadSavedBanks(d,true));
 el("salaryBankConfirm")?.addEventListener("change",e=>{if(permissionsValid()){d.bankConfirmed=e.target.checked;refresh()}});
 el("salaryBankPrint")?.addEventListener("click",()=>void printBank(d));
 el("salaryBankXml")?.addEventListener("click",()=>{if(!workflowEditable()||d.bankLoading||bankProblem(d)||reconcilePayments(d).difference!==0||d.bankSignature!==bankSignature(d))return;d.payConfirmed=true;d.bankConfirmed=true;void exportSepa(d)});
 host.querySelectorAll("[data-declaration-key]").forEach(input=>input.addEventListener("input",()=>{
  if(!permissionsValid())return;
  const id=input.dataset.declarationPerson,key=input.dataset.declarationKey;
  if(!context.declarationStaff?.some(s=>s.id===id)||!declarationFields.some(([k])=>k===key))return;
  const row=d.declarations.get(id)||{};row[key]=input.value;d.declarations.set(id,row);
  d.declarationConfirmed=false;d.dirty=true;refresh();
 }));
 el("salaryDeclarationConfirm")?.addEventListener("change",e=>{if(permissionsValid()){d.declarationConfirmed=e.target.checked;refresh()}});
 const exportDeclaration=print=>{
  if(!permissionsValid()||!d.declarationConfirmed||declarationProblem(d,context.declarationStaff||[]))return;
  if(!confirm("Créer un document confidentiel destiné au social ? Vérifiez le destinataire et conservez-le dans un espace sécurisé."))return;
  const data=declarationData(d,context.declarationStaff);
  if(!print)return download("chambertin-declaration-salaires-"+context.month+".csv",csv(data),"text/csv;charset=utf-8");
  const html=declarationPrintHtml(context.month,data),w=window.open("","_blank");if(!w)return alert("Autorisez les fenêtres pop-up pour imprimer la déclaration.");
  w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),250);
 };
 el("salaryDeclarationCsv")?.addEventListener("click",()=>exportDeclaration(false));
 el("salaryDeclarationPrint")?.addEventListener("click",()=>exportDeclaration(true));
 el("salaryPayExport")?.addEventListener("click",()=>{
  if(!permissionsValid()||!d.payConfirmed)return;
  const p=paymentTotals(d.payments);
  if(!p.ok||!reconcilePayments(d).ok||[...d.payments.keys()].some(id=>!context.staff.some(s=>s.id===id)))return;
  const rows=[...d.payments].filter(([,v])=>cents(v)>0).map(([id,v])=>[context.month,staffName(id),decimal(cents(v)),"Salaire "+context.month]);
  rows.sort((a,b)=>a[1].localeCompare(b[1],"fr"));
  download("chambertin-virements-preparation-"+context.month+".csv",csv([["Mois","Salarié","Montant EUR","Libellé"],...rows]),"text/csv;charset=utf-8");
 });
 el("salaryOdBackup")?.addEventListener("click",()=>{
  if(!permissionsValid())return;
  if(!confirm("Télécharger un fichier privé non chiffré pouvant contenir salaires, coordonnées bancaires et N° SS ? Conservez-le dans un espace sécurisé."))return;
  download("chambertin-salaires-brouillon-"+context.month+".json",JSON.stringify({version:2,month:context.month,values:d.values,payments:[...d.payments],reconciliation:d.reconciliation,bank:{issuer:d.bank.issuer,beneficiaries:bankDraftEntries(d)},declarations:[...d.declarations]},null,2),"application/json");
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
 const previous=context;
 context=config;
 if(previous?.month===config.month&&config.ready&&config.canWrite){
  const signature=value=>JSON.stringify((value.declarationStaff||[]).map(s=>[s.id,s.name,s.roleLabel,s.source]));
  if(signature(previous)!==signature(config))getDraft().declarationConfirmed=false;
 }
 const nav=document.getElementById("salaryPayrollNavigation");if(!nav)return;
 activeView="pay";
 nav.replaceChildren();
 if(config.ready&&config.canWrite&&validMonth(config.month)){
  const d=getDraft();
  for(const staff of config.defaultStaff)if(!d.payments.has(staff.id)){d.payments.set(staff.id,"");d.payConfirmed=false;d.bankConfirmed=false;d.odConfirmed=false;d.declarationConfirmed=false;d.reconciliation.difference=null}
 }
 nav.querySelectorAll("[data-salary-od-view]").forEach(b=>b.addEventListener("click",()=>{activeView=b.dataset.salaryOdView;render()}));
 render();
 if(config.ready&&config.canWrite&&validMonth(config.month)){
  if(!remoteFor(config.month).tried)void workflowLoad(config.month);
  if(!remoteListLoaded&&!remoteListLoading)void workflowList();
 }
}
window.salaryOdMount=mount;window.salaryOdClear=clear;window.salaryOdInvalidateBank=invalidateBank;
window.addEventListener("beforeunload",e=>{if([...drafts.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue=""}});
if(typeof module!=="undefined"&&module.exports)module.exports={simpleBankHtml,lines,cents,monthEnd,journal,paymentTotals,journalCsv,journalText,windows1252,reconcilePayments,validIban,validBic,validExecutionDate,bankProblem,bankPrintHtml,mergeSavedBanks,bankDraftEntries,declarationData,declarationProblem,declarationPrintHtml,restoreDraft,materializeKnownDeclaration,csv};
})();
