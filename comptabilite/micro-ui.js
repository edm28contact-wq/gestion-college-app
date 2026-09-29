(()=>{
const legacyAccountingReview=review;
const legacyImportPage=importPage;
const microPaymentLabels={virement:'Virement',carte:'Carte',cheque:'Chèque',especes:'Espèces',prelevement:'Prélèvement',autre:'Autre'};
const microCategoryLabels={marchandises:'Marchandises',fournitures:'Fournitures',services:'Services',frais:'Frais',autre:'Autre'};
const microActivityLabels={vente:'Vente',service:'Prestation de services',autre:'Autre'};
const microToday=()=>new Date().toISOString().slice(0,10);
const microYear=()=>new Date().getFullYear();
const microCanWrite=()=>db?.current_user?.can_write!==false;
const microActiveRevenues=()=>((db?.micro_revenues)||[]).filter(x=>!x.cancelled_at);
const microRevenueYears=()=>[...new Set([microYear(),...((db?.micro_revenues)||[]).map(x=>Number(String(x.receipt_date||'').slice(0,4))).filter(Number.isFinite),...(db?.invoices||[]).map(x=>Number(String(x.invoice_date||'').slice(0,4))).filter(Number.isFinite)])].sort((a,b)=>b-a);
const microPurchaseMetaMap=()=>new Map((db?.micro_purchase_meta||[]).map(x=>[x.invoice_id,x]));
const microInvoiceState=i=>['validee_humain','exportee_charlemagne'].includes(String(i?.workflow_stage||''))?'Validée':String(i?.workflow_stage||'')==='traitee_agent'?'À valider':'À contrôler';
const microCsvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
const microNum=v=>Number(v||0);
function microDownload(name,text,type='text/csv;charset=utf-8'){
  const blob=new Blob(['\ufeff'+text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200)
}
function microSelectYear(id,onchange){
  const years=microRevenueYears(),current=Number(sessionStorage.getItem('micro_accounting_year')||microYear()),value=years.includes(current)?current:years[0];
  return '<select id="'+id+'" onchange="'+onchange+'">'+years.map(y=>'<option value="'+y+'" '+(y===value?'selected':'')+'>'+y+'</option>').join('')+'</select>'
}
function microSelectedYear(id){const y=Number($(id)?.value||sessionStorage.getItem('micro_accounting_year')||microYear());sessionStorage.setItem('micro_accounting_year',String(y));return y}
const microCaPeriodicity=()=>db?.micro_settings?.ca_periodicity==='quarterly'?'quarterly':'monthly';
function microDateParts(v){const [y,m,d]=String(v||microToday()).split('-').map(Number);return {y,m,d}}
function microPeriodAt(dateValue=microToday(),periodicity=microCaPeriodicity()){
  const {y,m}=microDateParts(dateValue),startMonth=periodicity==='quarterly'?Math.floor((m-1)/3)*3+1:m,start=new Date(Date.UTC(y,startMonth-1,1)),end=new Date(Date.UTC(y,startMonth-1+(periodicity==='quarterly'?3:1),0));
  const startIso=start.toISOString().slice(0,10),endIso=end.toISOString().slice(0,10),label=periodicity==='quarterly'?'T'+(Math.floor((startMonth-1)/3)+1)+' '+y:new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(start);
  return {start:startIso,end:endIso,label,periodicity}
}
function microShiftPeriod(period,delta){
  const {y,m}=microDateParts(period.start),step=period.periodicity==='quarterly'?3:1,d=new Date(Date.UTC(y,m-1+delta*step,1));
  return microPeriodAt(d.toISOString().slice(0,10),period.periodicity)
}
function microPeriodRows(count=8){const current=microPeriodAt(),rows=[];for(let i=0;i<count;i++)rows.push(microShiftPeriod(current,-i));return rows}
function microPeriodTotal(period){return microActiveRevenues().filter(x=>String(x.receipt_date||'')>=period.start&&String(x.receipt_date||'')<=period.end).reduce((s,x)=>s+microNum(x.amount),0)}
function microPeriodPublication(period){return (db?.micro_ca_publications||[]).find(x=>x.periodicity===period.periodicity&&x.period_start===period.start&&x.period_end===period.end)}
function microStatusBadge(i){
  const s=microInvoiceState(i);
  return s==='Validée'?'<span class="badge okb">Validée</span>':s==='À valider'?'<span class="badge warn">À valider</span>':'<span class="badge warn">À contrôler</span>'
}
function microPaymentOptions(selected=''){
  return '<option value="">À renseigner</option>'+Object.entries(microPaymentLabels).map(([k,v])=>'<option value="'+k+'" '+(k===selected?'selected':'')+'>'+v+'</option>').join('')
}
function microCategoryOptions(selected=''){
  return '<option value="">À renseigner</option>'+Object.entries(microCategoryLabels).map(([k,v])=>'<option value="'+k+'" '+(k===selected?'selected':'')+'>'+v+'</option>').join('')
}
show=function(p){page=p;render()};
render=function(){
  if(!db)return;
  const adv=['advanced','od','export','rules','settings'].includes(page);
  [['td','dashboard'],['trc','revenues'],['tde','expenses'],['ti','import'],['tdoc','documents']].forEach(([id,p])=>{if($(id))$(id).className='btn '+(page===p?'active':'secondary')});
  if($('tadv'))$('tadv').className='btn '+(adv?'active':'secondary');
  const routes={dashboard:microDashboard,revenues:microRevenuesPage,expenses:microExpensesPage,import:microImportPage,documents:microDocumentsPage,advanced:microAdvancedPage,od:odPage,export:exportPage,rules:rulesPage,settings:settingsPage};
  (routes[page]||microDashboard)()
};
dashboard=function(){microDashboard()};
importPage=function(){microImportPage()};
review=async function(id){return microReview(id)};

function microDashboard(){
  const y=microYear(),annualRevenues=microActiveRevenues().filter(x=>Number(String(x.receipt_date||'').slice(0,4))===y),
        annualTotal=annualRevenues.reduce((s,x)=>s+microNum(x.amount),0),
        period=microPeriodAt(),periodTotal=microPeriodTotal(period),
        previous=microShiftPeriod(period,-1),previousPublication=microPeriodPublication(previous),previousTotal=microPeriodTotal(previous),
        meta=microPurchaseMetaMap(),
        paid=(db.invoices||[]).filter(i=>{const m=meta.get(i.id);return m?.payment_date&&Number(String(m.payment_date).slice(0,4))===y}),
        paidTotal=paid.reduce((s,i)=>s+microNum(i.amount_ttc),0),
        pending=(db.invoices||[]).filter(i=>!['validee_humain','exportee_charlemagne'].includes(String(i.workflow_stage||''))),
        completeMissing=(db.invoices||[]).filter(i=>['validee_humain','exportee_charlemagne'].includes(String(i.workflow_stage||''))&&(!meta.get(i.id)?.payment_date||!meta.get(i.id)?.payment_method)),
        lastRevenues=annualRevenues.slice(0,6),
        cadence=microCaPeriodicity()==='quarterly'?'Trimestrielle':'Mensuelle';
  $('content').innerHTML=
    '<div class="micro-hero"><div><h2 style="margin:0">Vue simple · '+y+'</h2><p class="muted" style="margin:5px 0 0">Période de déclaration CA : <b>'+cadence+'</b>. Le compteur repart automatiquement à zéro au début de chaque nouvelle période.</p></div><div class="actions">'+
    (microCanWrite()?'<button class="btn primary" onclick="show(\'revenues\')">+ Recette</button><button class="btn secondary" onclick="show(\'import\')">+ Facture fournisseur</button>':'')+
    '</div></div>'+
    '<div class="grid"><div class="card"><div class="muted">CA période en cours · '+esc(period.label)+'</div><div class="kpi">'+money(periodTotal)+'</div><div class="muted">'+period.start+' → '+period.end+'</div></div>'+
    '<div class="card"><div class="muted">CA annuel '+y+'</div><div class="kpi">'+money(annualTotal)+'</div><div class="muted">'+annualRevenues.length+' recette(s)</div></div>'+
    '<div class="card"><div class="muted">Dépenses réglées '+y+'</div><div class="kpi">'+money(paidTotal)+'</div><div class="muted">'+paid.length+' règlement(s)</div></div>'+
    '<div class="card"><div class="muted">Factures à contrôler</div><div class="kpi">'+pending.length+'</div><div class="muted">Validation humaine quand nécessaire</div></div></div>'+
    '<div class="card"><div class="actions" style="justify-content:space-between"><div><b>À faire</b><div class="muted">Seulement les actions utiles au quotidien.</div></div><div class="actions"><button class="btn secondary" onclick="show(\'expenses\')">Voir les dépenses</button><button class="btn secondary" onclick="show(\'documents\')">CA & documents</button></div></div>'+
    '<div style="margin-top:12px">'+
    (!previousPublication?'<div class="micro-task"><div><b>CA '+esc(previous.label)+' à publier</b><div class="muted">'+money(previousTotal)+' · période terminée</div></div><button class="btn primary" onclick="show(\'documents\')">Ouvrir</button></div>':'')+
    (pending.length?'<div class="micro-task"><b>'+pending.length+' facture(s) fournisseur à contrôler</b><button class="btn primary" onclick="show(\'expenses\')">Ouvrir</button></div>':'<div class="micro-task ok"><b>Aucune facture urgente à contrôler</b></div>')+
    (completeMissing.length?'<div class="micro-task"><b>'+completeMissing.length+' facture(s) validée(s) sans règlement complet</b><button class="btn secondary" onclick="show(\'expenses\')">Compléter</button></div>':'')+
    '</div></div>'+
    '<div class="card"><b>Dernières recettes</b><div class="table" style="margin-top:8px"><table><thead><tr><th>N°</th><th>Date</th><th>Origine</th><th>Libellé</th><th>Montant</th><th>Règlement</th></tr></thead><tbody>'+
    (lastRevenues.length?lastRevenues.map(x=>'<tr><td>R-'+String(x.entry_no).padStart(6,'0')+'</td><td>'+esc(x.receipt_date)+'</td><td>'+esc(x.origin)+'</td><td>'+esc(x.description)+'</td><td><b>'+money(x.amount)+'</b></td><td>'+esc(microPaymentLabels[x.payment_method]||x.payment_method)+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">Aucune recette saisie pour '+y+'.</td></tr>')+
    '</tbody></table></div></div>'+
    '<div class="card micro-note"><b>Fonctionnement de la remise à zéro</b><div class="muted" style="margin-top:5px">Aucune écriture n’est effacée. Le compteur de CA affiché repart à zéro à chaque nouveau mois ou trimestre selon ton choix, tandis que le total annuel et les anciens livres restent conservés.</div></div>'
}

function microRevenuesPage(){
  const y=Number(sessionStorage.getItem('micro_accounting_year')||microYear()),
        rows=(db.micro_revenues||[]).filter(x=>Number(String(x.receipt_date||'').slice(0,4))===y),
        total=rows.filter(x=>!x.cancelled_at).reduce((s,x)=>s+microNum(x.amount),0);
  $('content').innerHTML=
    '<div class="card"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Livre des recettes</h2><div class="muted">Une ligne par encaissement. Une recette enregistrée n’est pas supprimée : elle peut seulement être annulée avec un motif.</div></div><div style="width:130px">'+microSelectYear('microRevenueYear','microRefreshRevenueYear()')+'</div></div></div>'+
    (microCanWrite()?'<div class="card"><h3 style="margin-top:0">Ajouter une recette encaissée</h3><div class="fields"><div><label>Date d’encaissement</label><input id="mrDate" type="date" value="'+microToday()+'"></div><div><label>Origine / client</label><input id="mrOrigin" maxlength="200" placeholder="Client ou origine"></div><div><label>Activité</label><select id="mrActivity"><option value="service">Prestation de services</option><option value="vente">Vente</option><option value="autre">Autre</option></select></div><div><label>Montant encaissé</label><input id="mrAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></div><div><label>Mode de règlement</label><select id="mrPayment">'+Object.entries(microPaymentLabels).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></div><div><label>N° facture</label><input id="mrInvoice" maxlength="120" placeholder="Facultatif"></div><div class="full"><label>Description</label><input id="mrDescription" maxlength="500" placeholder="Objet de la vente ou de la prestation"></div><div><label>Référence justificatif</label><input id="mrRef" maxlength="200" placeholder="Facture, reçu, relevé…"></div><div class="full"><label>Note</label><input id="mrNotes" maxlength="1000" placeholder="Facultatif"></div></div><div class="actions" style="margin-top:12px"><button id="mrSave" class="btn primary" onclick="microSaveRevenue()">Enregistrer la recette</button></div><div id="mrMsg" class="status"></div></div>':'')+
    '<div class="card"><div class="actions" style="justify-content:space-between"><div><b>Recettes '+y+'</b><div class="muted">'+rows.filter(x=>!x.cancelled_at).length+' ligne(s) active(s)</div></div><div class="kpi">'+money(total)+'</div></div><div class="table" style="margin-top:10px"><table><thead><tr><th>N°</th><th>Date</th><th>Origine</th><th>Description</th><th>Activité</th><th>Montant</th><th>Règlement</th><th>Justificatif</th><th></th></tr></thead><tbody>'+
    (rows.length?rows.map(x=>'<tr style="'+(x.cancelled_at?'opacity:.55':'')+'"><td><b>R-'+String(x.entry_no).padStart(6,'0')+'</b></td><td>'+esc(x.receipt_date)+'</td><td>'+esc(x.origin)+'</td><td>'+esc(x.description)+'</td><td>'+esc(microActivityLabels[x.activity_type]||x.activity_type)+'</td><td><b>'+money(x.amount)+'</b></td><td>'+esc(microPaymentLabels[x.payment_method]||x.payment_method)+'</td><td>'+esc(x.invoice_number||x.document_ref||'—')+'</td><td>'+(x.cancelled_at?'<span class="badge errb">Annulée</span>':(microCanWrite()?'<button class="btn secondary compact" onclick="microCancelRevenue(\''+x.id+'\')">Annuler</button>':''))+'</td></tr>').join(''):'<tr><td colspan="9" class="muted">Aucune recette.</td></tr>')+
    '</tbody></table></div></div>'
}
window.microRefreshRevenueYear=()=>{sessionStorage.setItem('micro_accounting_year',$('microRevenueYear').value);microRevenuesPage()};
window.microSaveRevenue=async()=>{
  const btn=$('mrSave'),msg=$('mrMsg');
  try{
    btn.disabled=true;msg.className='status';msg.textContent='Enregistrement…';
    const body={receipt_date:$('mrDate').value,origin:$('mrOrigin').value,activity_type:$('mrActivity').value,amount:$('mrAmount').value,payment_method:$('mrPayment').value,invoice_number:$('mrInvoice').value,description:$('mrDescription').value,document_ref:$('mrRef').value,notes:$('mrNotes').value};
    await api('micro-revenue-add','POST',body);await refresh();page='revenues';render()
  }catch(e){msg.className='status err';msg.textContent=e.message}finally{if(btn)btn.disabled=false}
};
window.microCancelRevenue=async id=>{
  const reason=prompt('Motif de l’annulation de cette recette :');if(reason===null)return;
  if(String(reason).trim().length<3)return alert('Indique un motif d’annulation.');
  try{await api('micro-revenue-cancel','POST',{id,reason});await refresh();page='revenues';render()}catch(e){alert(e.message)}
};

function microExpensesPage(){
  const y=Number(sessionStorage.getItem('micro_accounting_year')||microYear()),meta=microPurchaseMetaMap(),
        rows=(db.invoices||[]).filter(i=>Number(String((meta.get(i.id)?.payment_date||i.invoice_date||'')).slice(0,4))===y),
        paidTotal=rows.filter(i=>meta.get(i.id)?.payment_date).reduce((s,i)=>s+microNum(i.amount_ttc),0),
        missing=rows.filter(i=>['validee_humain','exportee_charlemagne'].includes(String(i.workflow_stage||''))&&(!meta.get(i.id)?.payment_date||!meta.get(i.id)?.payment_method)).length;
  $('content').innerHTML=
    '<div class="card"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Dépenses & factures fournisseurs</h2><div class="muted">Le PDF original reste conservé. Après validation, complète simplement la date et le mode de règlement.</div></div><div class="actions"><div style="width:130px">'+microSelectYear('microExpenseYear','microRefreshExpenseYear()')+'</div>'+(microCanWrite()?'<button class="btn primary" onclick="show(\'import\')">Importer une facture</button>':'')+'</div></div></div>'+
    '<div class="grid"><div class="card"><div class="muted">Dépenses réglées '+y+'</div><div class="kpi">'+money(paidTotal)+'</div></div><div class="card"><div class="muted">Règlements incomplets</div><div class="kpi">'+missing+'</div></div><div class="card"><div class="muted">Factures affichées</div><div class="kpi">'+rows.length+'</div></div></div>'+
    '<div class="card table"><table><thead><tr><th>État</th><th>Date facture</th><th>Fournisseur</th><th>N° facture</th><th>TTC</th><th>Date règlement</th><th>Mode</th><th>Catégorie</th><th></th></tr></thead><tbody>'+
    (rows.length?rows.map(i=>{const m=meta.get(i.id)||{};return '<tr><td>'+microStatusBadge(i)+'</td><td>'+esc(i.invoice_date||'—')+'</td><td><b>'+esc(i.supplier||'À identifier')+'</b></td><td>'+esc(i.invoice_number||'—')+'</td><td><b>'+money(i.amount_ttc)+'</b></td><td>'+esc(m.payment_date||'—')+'</td><td>'+esc(microPaymentLabels[m.payment_method]||'—')+'</td><td>'+esc(microCategoryLabels[m.purchase_category]||'—')+'</td><td class="nowrap"><button class="btn secondary compact" onclick="review(\''+i.id+'\')">Voir</button> '+(microCanWrite()?'<button class="btn secondary compact" onclick="microEditPurchase(\''+i.id+'\')">Règlement</button>':'')+'</td></tr>'}).join(''):'<tr><td colspan="9" class="muted">Aucune facture sur cette période.</td></tr>')+
    '</tbody></table></div></div>'
}
window.microRefreshExpenseYear=()=>{sessionStorage.setItem('micro_accounting_year',$('microExpenseYear').value);microExpensesPage()};
window.microEditPurchase=id=>{
  const i=(db.invoices||[]).find(x=>x.id===id),m=microPurchaseMetaMap().get(id)||{};if(!i)return;
  $('modal').innerHTML='<div class="modal"><div class="card" style="max-width:650px;margin:auto"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Règlement fournisseur</h2><div class="muted">'+esc(i.supplier||'')+' · '+esc(i.invoice_number||'')+' · '+money(i.amount_ttc)+'</div></div><button class="btn secondary" onclick="closeModal()">Fermer</button></div><div class="fields" style="margin-top:14px"><div><label>Date de règlement</label><input id="mpDate" type="date" value="'+esc(m.payment_date||'')+'"></div><div><label>Mode de règlement</label><select id="mpPayment">'+microPaymentOptions(m.payment_method||'')+'</select></div><div><label>Catégorie</label><select id="mpCategory">'+microCategoryOptions(m.purchase_category||'')+'</select></div><div class="full"><label>Note</label><input id="mpNotes" maxlength="1000" value="'+esc(m.notes||'')+'"></div></div><div class="actions" style="margin-top:14px"><button id="mpSave" class="btn primary" onclick="microSavePurchase(\''+id+'\')">Enregistrer</button></div><div id="mpMsg" class="status"></div></div></div>'
};
window.microSavePurchase=async id=>{
  const btn=$('mpSave'),msg=$('mpMsg');try{btn.disabled=true;msg.textContent='Enregistrement…';await api('micro-purchase-meta-save','POST',{invoice_id:id,payment_date:$('mpDate').value,payment_method:$('mpPayment').value,purchase_category:$('mpCategory').value,notes:$('mpNotes').value});await refresh();closeModal();page='expenses';render()}catch(e){msg.className='status err';msg.textContent=e.message}finally{if(btn)btn.disabled=false}
};

async function microReview(id){
  const i=(db.invoices||[]).find(x=>x.id===id);if(!i)return;let pdf='';
  try{pdf=(await api('file','GET',null,false,{id})).url}catch{}
  const ready=i.workflow_stage==='traitee_agent',validated=['validee_humain','exportee_charlemagne'].includes(String(i.workflow_stage||''));
  $('modal').dataset.invoiceId=id;
  $('modal').innerHTML='<div class="modal"><div class="card"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Facture fournisseur</h2><div class="muted">'+microInvoiceState(i)+'</div></div><button class="btn secondary" onclick="closeModal()">Fermer</button></div><div class="review" style="margin-top:12px"><div>'+(pdf?'<iframe class="pdf" src="'+esc(pdf)+'"></iframe>':'<div class="card muted">PDF indisponible.</div>')+'</div><div><div class="simple-summary"><div><span>Fournisseur</span><b>'+esc(i.supplier||'À identifier')+'</b></div><div><span>N° facture</span><b>'+esc(i.invoice_number||'—')+'</b></div><div><span>Date</span><b>'+esc(i.invoice_date||'—')+'</b></div><div><span>HT</span><b>'+money(i.amount_ht)+'</b></div><div><span>TVA</span><b>'+money(i.amount_vat)+'</b></div><div><span>TTC</span><b>'+money(i.amount_ttc)+'</b></div></div>'+
  '<div class="card micro-note" style="margin-top:12px"><b>Ce que tu dois vérifier</b><div class="muted" style="margin-top:5px">Le fournisseur, le numéro, la date et les montants. Les comptes techniques restent gérés par le moteur comptable.</div></div>'+
  '<div class="actions">'+(ready&&!validated&&microCanWrite()?'<button id="simpleValidateBtn" class="btn primary" onclick="microSimpleValidate(\''+id+'\')">Valider cette facture</button>':'')+
  '<button class="btn secondary" onclick="microOpenAccountingDetails(\''+id+'\')">Détails comptables</button></div>'+
  '<div id="simpleReviewMsg" class="status">'+(validated?'<span class="ok">Facture déjà validée.</span>':ready?'Prête pour ta validation.':'Le traitement automatique est encore en cours ou nécessite un contrôle.')+'</div></div></div></div></div>'
}
window.microOpenAccountingDetails=id=>legacyAccountingReview(id);
window.microSimpleValidate=async id=>{
  const i=(db.invoices||[]).find(x=>x.id===id),btn=$('simpleValidateBtn'),msg=$('simpleReviewMsg');if(!i)return;
  try{
    btn.disabled=true;msg.className='status';msg.textContent='Contrôle final…';
    const lines=(await api('lines','GET',null,false,{id})).lines||[];
    let expenseLines=lines.filter(x=>x.side==='D'&&String(x.account)!==String(i.vat_account)).map(x=>({account:x.account,account_label:x.account_label||'',amount:x.amount}));
    if(!expenseLines.length&&i.expense_account)expenseLines=[{account:i.expense_account,account_label:i.expense_label||'',amount:i.amount_ttc}];
    if(!expenseLines.length)throw new Error('La ventilation comptable automatique est incomplète. Ouvre « Détails comptables ».');
    if(!confirm('Confirmer cette facture fournisseur ?'))return;
    await api('validate','POST',{id,supplier:i.supplier,invoice_number:i.invoice_number,invoice_date:i.invoice_date,amount_ht:i.amount_ht,amount_vat:i.amount_vat,amount_ttc:i.amount_ttc,vat_rate:i.vat_rate,journal:i.journal,supplier_account:i.supplier_account,entry_label:i.entry_label,expense_lines:expenseLines});
    await refresh();msg.className='status ok';msg.textContent='Facture validée.';setTimeout(()=>{closeModal();page='expenses';render()},500)
  }catch(e){msg.className='status err';msg.textContent=e.message}finally{if(btn)btn.disabled=false}
};

function microImportPage(){
  $('content').innerHTML='<div class="card"><h2>Importer des factures fournisseurs</h2><p class="muted">Dépose simplement les PDF. Le lecteur vérifie les informations et garde l’original. Tu ne règles les détails techniques que si une facture est incertaine.</p><div id="drop" class="drop"><b>Déposer les factures PDF ici</b><br><span class="muted">Sélection multiple · 20 Mo maximum par fichier</span><input id="file" class="hide" type="file" accept="application/pdf" multiple></div><br><progress id="prog" class="hide" max="100" value="0" style="width:100%"></progress><div id="imsg" class="status"></div></div>';
  const d=$('drop'),f=$('file');d.onclick=()=>f.click();
  const run=files=>{if(typeof processAccountingFiles==='function')processAccountingFiles(files);else if(files?.[0])processFile(files[0])};
  f.onchange=()=>run(f.files);d.ondragover=e=>{e.preventDefault();d.classList.add('drag')};d.ondragleave=()=>d.classList.remove('drag');d.ondrop=e=>{e.preventDefault();d.classList.remove('drag');run(e.dataTransfer.files)}
}

function microDocumentsPage(){
  const y=Number(sessionStorage.getItem('micro_accounting_year')||microYear()),periodicity=microCaPeriodicity(),rows=microPeriodRows(8),today=microToday();
  const periodRows=rows.map(p=>{
    const pub=microPeriodPublication(p),total=microPeriodTotal(p),current=p.start<=today&&p.end>=today,finished=p.end<today;
    return '<tr><td><b>'+esc(p.label)+'</b><div class="muted">'+p.start+' → '+p.end+'</div></td><td>'+money(total)+'</td><td>'+(pub?'<span class="badge okb">Publiée le '+esc(pub.publication_date)+'</span>':current?'<span class="badge warn">En cours</span>':'<span class="badge warn">À publier</span>')+'</td><td>'+(pub?esc(pub.reference||'—'):(finished&&microCanWrite()?'<button class="btn primary compact" onclick="microPublishCa(\''+p.start+'\')">Marquer publiée</button>':'—'))+'</td></tr>'
  }).join('');
  $('content').innerHTML=
  '<div class="card"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Déclaration du chiffre d’affaires</h2><div class="muted">Choisis la même périodicité que ta déclaration. Chaque nouvelle période repart automatiquement à zéro à l’écran, sans supprimer l’historique.</div></div><div style="min-width:210px"><label>Périodicité du CA</label><select id="microCaPeriod" onchange="microSaveCaPeriodicity(this.value)" '+(microCanWrite()?'':'disabled')+'><option value="monthly" '+(periodicity==='monthly'?'selected':'')+'>Mensuelle</option><option value="quarterly" '+(periodicity==='quarterly'?'selected':'')+'>Trimestrielle</option></select></div></div><div class="table" style="margin-top:12px"><table><thead><tr><th>Période</th><th>CA encaissé</th><th>État</th><th>Référence</th></tr></thead><tbody>'+periodRows+'</tbody></table></div><div id="microCaMsg" class="status"></div></div>'+
  '<div class="card"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">Livres & documents</h2><div class="muted">Exports lisibles pour contrôle, sauvegarde ou transmission.</div></div><div style="width:130px">'+microSelectYear('microDocYear','microRefreshDocYear()')+'</div></div></div>'+
  '<div class="grid"><div class="card"><h3>Livre des recettes</h3><p class="muted">Ordre chronologique, origine, montant, mode de règlement et référence du justificatif.</p><button class="btn primary" onclick="microExportRevenues()">Exporter CSV '+y+'</button></div>'+
  '<div class="card"><h3>Registre des achats</h3><p class="muted">Factures fournisseurs avec montant TTC et informations de règlement.</p><button class="btn primary" onclick="microExportPurchases()">Exporter CSV '+y+'</button></div>'+
  '<div class="card"><h3>Factures originales</h3><p class="muted">Les PDF fournisseurs importés restent consultables depuis Dépenses.</p><button class="btn secondary" onclick="show(\'expenses\')">Ouvrir</button></div>'+
  '<div class="card"><h3>Outils comptables</h3><p class="muted">OD salaires, export Charlemagne et réglages techniques sont rangés à part.</p><button class="btn secondary" onclick="show(\'advanced\')">Outils avancés</button></div></div>'+
  '<div class="card micro-note"><b>Conservation</b><div class="muted" style="margin-top:5px">Les factures et pièces justificatives comptables doivent être conservées pendant 10 ans. Le système garde les anciennes périodes même lorsque le compteur de la nouvelle période revient à zéro.</div></div>'
}
window.microSaveCaPeriodicity=async value=>{
  const msg=$('microCaMsg');
  try{
    if(msg){msg.className='status';msg.textContent='Enregistrement…'}
    await api('micro-settings-save','POST',{ca_periodicity:value});
    await refresh();page='documents';render()
  }catch(e){if(msg){msg.className='status err';msg.textContent=e.message}else alert(e.message)}
};
window.microPublishCa=async start=>{
  const p=microPeriodAt(start,microCaPeriodicity()),reference=prompt('Référence de la déclaration '+p.label+' (facultatif) :');
  if(reference===null)return;
  if(!confirm('Confirmer que le chiffre d’affaires de '+p.label+' a été publié / déclaré ?\n\nLa période sera clôturée dans le back-office mais aucune recette ne sera supprimée.'))return;
  try{await api('micro-ca-publish','POST',{period_start:start,reference});await refresh();page='documents';render()}catch(e){alert(e.message)}
};

window.microRefreshDocYear=()=>{sessionStorage.setItem('micro_accounting_year',$('microDocYear').value);microDocumentsPage()};
window.microExportRevenues=()=>{
  const y=microSelectedYear('microDocYear'),rows=(db.micro_revenues||[]).filter(x=>Number(String(x.receipt_date||'').slice(0,4))===y),
        head=['N°','Date encaissement','Origine','Description','Activité','Montant','Mode règlement','N° facture','Référence justificatif','Statut','Motif annulation'],
        csv=[head,...rows.map(x=>['R-'+String(x.entry_no).padStart(6,'0'),x.receipt_date,x.origin,x.description,microActivityLabels[x.activity_type]||x.activity_type,Number(x.amount||0).toFixed(2),microPaymentLabels[x.payment_method]||x.payment_method,x.invoice_number||'',x.document_ref||'',x.cancelled_at?'Annulée':'Active',x.cancellation_reason||''])].map(r=>r.map(microCsvCell).join(';')).join('\r\n');
  microDownload('livre-recettes-'+y+'.csv',csv)
};
window.microExportPurchases=()=>{
  const y=microSelectedYear('microDocYear'),meta=microPurchaseMetaMap(),rows=(db.invoices||[]).filter(i=>Number(String((meta.get(i.id)?.payment_date||i.invoice_date||'')).slice(0,4))===y),
        head=['Date facture','Fournisseur','N° facture','TTC','Date règlement','Mode règlement','Catégorie','État','Fichier'],
        csv=[head,...rows.map(i=>{const m=meta.get(i.id)||{};return [i.invoice_date||'',i.supplier||'',i.invoice_number||'',Number(i.amount_ttc||0).toFixed(2),m.payment_date||'',microPaymentLabels[m.payment_method]||'',microCategoryLabels[m.purchase_category]||'',microInvoiceState(i),i.file_name||'']})].map(r=>r.map(microCsvCell).join(';')).join('\r\n');
  microDownload('registre-achats-'+y+'.csv',csv)
};

function microAdvancedPage(){
  $('content').innerHTML='<div class="card"><h2>Outils avancés</h2><p class="muted">Ces fonctions restent disponibles mais ne sont plus dans le parcours quotidien.</p></div><div class="grid">'+
  '<div class="card"><h3>OD Salaires</h3><p class="muted">Moteur existant conservé sans modification.</p><button class="btn secondary" onclick="show(\'od\')">Ouvrir</button></div>'+
  '<div class="card"><h3>Export Charlemagne</h3><p class="muted">Exports comptables historiques.</p><button class="btn secondary" onclick="show(\'export\')">Ouvrir</button></div>'+
  '<div class="card"><h3>Règles fournisseurs</h3><p class="muted">Comptes et règles utilisés automatiquement en arrière-plan.</p><button class="btn secondary" onclick="show(\'rules\')">Ouvrir</button></div>'+
  '<div class="card"><h3>Réglages techniques</h3><p class="muted">IA et paramètres de contrôle.</p><button class="btn secondary" onclick="show(\'settings\')">Ouvrir</button></div></div>'
}

if(db)render();
})();