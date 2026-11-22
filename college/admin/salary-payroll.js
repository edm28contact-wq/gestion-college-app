/* Admin Collège: données mensuelles de suivi de rémunération, sans génération automatique de paie. */
let salaryPayrollRecords=[],salaryPayrollMonth="",salaryPayrollListLoading=false,salaryPayrollListError="",salaryPayrollRequest=0;
let salaryPayrollEmployeeId="",salaryPayrollProfileMonth="",salaryPayrollRecord=null,salaryPayrollDraft=null;
let salaryPayrollLoading=false,salaryPayrollSaving=false,salaryPayrollError="",salaryPayrollMessage="",salaryPayrollRequestVersion=0;

const salaryPayrollEuro=v=>Number(v).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const salaryPayrollDecimal=v=>{
 if(typeof v!=="string"&&typeof v!=="number")return null;
 const normalized=String(v).trim().replace(",",".");
 if(!normalized||!/^\d+(?:\.\d{1,4})?$/.test(normalized))return null;
 const n=Number(normalized);
 return Number.isFinite(n)?n:null;
};
function salaryPayrollDefault(staff,previous){
 return {
  base_salary_gross:previous?.base_salary_gross??"",
  bonus_gross:0,
  weekly_hours:previous?.weekly_hours??"",
  actual_hours:"",
  working_days:Array.isArray(previous?.working_days)&&CollegeSalaryCalc.validWeekdays(previous.working_days)
   ?[...previous.working_days]:CollegeSalaryCalc.defaultWeekdays(staff?.name),
  benefits_in_kind:[],
 };
}
function salaryPayrollPrepare(staff,record,previous){
 if(record)return {
  base_salary_gross:String(record.base_salary_gross),bonus_gross:String(record.bonus_gross),
  weekly_hours:String(record.weekly_hours),actual_hours:record.actual_hours===null?"":String(record.actual_hours),
  working_days:CollegeSalaryCalc.validWeekdays(record.working_days)?[...record.working_days]:CollegeSalaryCalc.defaultWeekdays(staff?.name),
  benefits_in_kind:Array.isArray(record.benefits_in_kind)?record.benefits_in_kind.map(x=>({label:String(x.label),amount:String(x.amount)})):[],
 };
 const draft=salaryPayrollDefault(staff,previous);
 if(CollegeSalaryCalc.defaultWeekdays(staff?.name).length===4)
  draft.working_days=[1,2,4,5];
 return {...draft,base_salary_gross:String(draft.base_salary_gross),weekly_hours:String(draft.weekly_hours),bonus_gross:"0"};
}
function salaryPayrollValidate(draft){
 if(!draft)throw Error("Fiche de rémunération absente.");
 const base=salaryPayrollDecimal(draft.base_salary_gross),
  bonus=salaryPayrollDecimal(draft.bonus_gross),
  weekly=salaryPayrollDecimal(draft.weekly_hours),
  actual=String(draft.actual_hours).trim()===""?null:salaryPayrollDecimal(draft.actual_hours);
 if(base===null||base>1000000||bonus===null||bonus>1000000||weekly===null||weekly<=0||weekly>60||
   (actual!==null&&(actual<0||actual>744)))
  throw Error("Vérifiez le salaire, la prime et les heures (hebdomadaires et réellement effectuées).");
 if(String(draft.actual_hours).trim()!==""&&actual===null)throw Error("Heures réellement effectuées invalides.");
 if(!CollegeSalaryCalc.validWeekdays(draft.working_days))throw Error("Choisissez au moins un jour travaillé du lundi au vendredi.");
 const extras=[];
 for(const item of draft.benefits_in_kind||[]){
  const label=String(item.label||"").trim(),amount=salaryPayrollDecimal(item.amount);
  if(label.length<2||label.length>100||amount===null||amount>100000)
   throw Error("Chaque avantage en nature doit avoir un nom et une valeur positive ou nulle.");
  extras.push({label,amount});
 }
 if(extras.length>20)throw Error("Maximum 20 avantages en nature par mois.");
 return {base_salary_gross:base,bonus_gross:bonus,weekly_hours:weekly,actual_hours:actual,
  working_days:[...draft.working_days].sort((a,b)=>a-b),benefits_in_kind:extras};
}
async function salaryPayrollLoadMonth(month){
 if(page!=="salaires"||!token)return;
 const version=++salaryPayrollRequest;
 salaryPayrollMonth=month;salaryPayrollListLoading=true;salaryPayrollListError="";
 if(page==="salaires")salaryPage();
 try{
  const data=await call(ROOT+"/college-salary-profiles","month-list","GET",undefined,{month});
  if(version!==salaryPayrollRequest)return;
  salaryPayrollRecords=Array.isArray(data.records)?data.records:[];
 }catch(e){
  if(version!==salaryPayrollRequest)return;
  salaryPayrollRecords=[];salaryPayrollListError=frError(e.message);
 }finally{
  if(version===salaryPayrollRequest){salaryPayrollListLoading=false;if(page==="salaires")salaryPage()}
 }
}
async function salaryPayrollOpen(id,month){
 const staff=salaryStaff.find(s=>s.id===id);
 if(!staff||salaryPayrollSaving)return;
 const version=++salaryPayrollRequestVersion;
 salaryPayrollEmployeeId=id;salaryPayrollProfileMonth=month;
 salaryPayrollLoading=true;salaryPayrollRecord=null;salaryPayrollDraft=null;
 salaryPayrollError="";salaryPayrollMessage="";
 if(page==="salaires"){
  salaryPage();$("salaryPayrollPanel")?.scrollIntoView({behavior:"smooth",block:"start"});
 }
 try{
  const data=await call(ROOT+"/college-salary-profiles","employee-month","GET",undefined,{employee_id:id,month});
  if(version!==salaryPayrollRequestVersion)return;
  salaryPayrollRecord=data.record;
  salaryPayrollDraft=salaryPayrollPrepare(staff,data.record,data.previous);
  if(!data.record&&data.previous)salaryPayrollMessage="Valeurs contractuelles proposées depuis "+data.previous.month+" : à vérifier puis enregistrer pour ce mois.";
 }catch(e){if(version===salaryPayrollRequestVersion)salaryPayrollError=frError(e.message)}
 finally{if(version===salaryPayrollRequestVersion){salaryPayrollLoading=false;if(page==="salaires")salaryPage()}}
}
function salaryPayrollClose(){
 ++salaryPayrollRequestVersion;
 salaryPayrollEmployeeId="";salaryPayrollRecord=null;salaryPayrollDraft=null;
 salaryPayrollLoading=false;salaryPayrollSaving=false;salaryPayrollError="";salaryPayrollMessage="";
 if(page==="salaires")salaryPage();
}
async function salaryPayrollSave(event){
 event.preventDefault();
 if(salaryPayrollSaving||salaryPayrollLoading||!salaryPayrollDraft||!salaryPayrollEmployeeId)return;
 let data;
 try{data=salaryPayrollValidate(salaryPayrollDraft)}catch(e){salaryPayrollError=e.message;salaryPage();return}
 salaryPayrollSaving=true;salaryPayrollError="";salaryPayrollMessage="";salaryPage();
 try{
  const r=await call(ROOT+"/college-salary-profiles","save-month","POST",{
   employee_id:salaryPayrollEmployeeId,month:salaryPayrollProfileMonth,
   version:salaryPayrollRecord?.version??null,...data
  });
  salaryPayrollRecord=r.record;
  salaryPayrollDraft=salaryPayrollPrepare(salaryStaff.find(s=>s.id===salaryPayrollEmployeeId),r.record,null);
  salaryPayrollMessage="Données mensuelles enregistrées. Aucun bulletin ni paiement généré.";
  await salaryPayrollLoadMonth(salaryPayrollProfileMonth);
 }catch(e){salaryPayrollError=frError(e.message)}
 finally{salaryPayrollSaving=false;if(page==="salaires")salaryPage()}
}
function salaryPayrollOverview(){
 const month=salaryMonth||salaryCurrentMonth();
 const saved=new Map(salaryPayrollRecords.map(r=>[r.employee_id,r]));
 const active=salaryStaff.filter(s=>!s.archived);
 const totalBase=salaryPayrollRecords.reduce((sum,r)=>sum+Number(r.base_salary_gross||0),0);
 const totalBonus=salaryPayrollRecords.reduce((sum,r)=>sum+Number(r.bonus_gross||0),0);
 const num=salaryPayrollRecords.length;
 return '<section class="card salary-dashboard"><div class="salary-section-head"><div><h2>Tableau de bord des rémunérations</h2><p class="muted">Mois : '+esc(salaryMonthLabel(month))+' · données enregistrées uniquement · montants bruts</p></div><button type="button" class="btn secondary" id="salaryPayrollOverviewRefresh">Actualiser les fiches</button></div>'+
  (salaryPayrollListError?'<p class="err" role="alert">'+esc(salaryPayrollListError)+'</p>':'')+
  (salaryPayrollListLoading?'<p class="muted">Chargement des données mensuelles…</p>':
  '<div class="salary-dashboard-kpis"><div><small>Fiches enregistrées</small><strong>'+num+' / '+active.length+'</strong></div>'+
  '<div><small>Salaires bruts de base saisis</small><strong>'+salaryPayrollEuro(totalBase)+'</strong></div>'+
  '<div><small>Primes brutes saisies</small><strong>'+salaryPayrollEuro(totalBonus)+'</strong></div></div>')+
  '<p class="muted">Totaux partiels : un salarié sans fiche mensuelle n’est pas pris en compte. Les avantages en nature sont détaillés dans chaque fiche et ne correspondent pas à une somme versée.</p>'+
  '<div class="salary-dashboard-staff">'+active.map(staff=>{
   const rec=saved.get(staff.id);
   return '<button type="button" class="salary-dashboard-person" data-salary-payroll-open="'+esc(staff.id)+'"><strong>'+esc(staff.name)+'</strong><span>'+(rec?'Saisie disponible · '+salaryPayrollEuro(rec.base_salary_gross):'Mois à renseigner')+'</span></button>';
  }).join("")+'</div></section>';
}
function salaryPayrollPanel(){
 if(!salaryPayrollEmployeeId)return "";
 const staff=salaryStaff.find(s=>s.id===salaryPayrollEmployeeId);
 if(!staff)return "";
 const month=salaryPayrollProfileMonth,draft=salaryPayrollDraft;
 const message=salaryPayrollError?'<p class="err" role="alert">'+esc(salaryPayrollError)+'</p>':
  salaryPayrollMessage?'<p class="ok" role="status">'+esc(salaryPayrollMessage)+'</p>':'';
 let body=salaryPayrollLoading?'<p class="muted">Chargement des informations confidentielles…</p>':
  !draft?'<p class="err">Les données mensuelles ne sont pas accessibles.</p>':salaryPayrollEditor(draft,month);
 return '<section class="card salary-payroll" id="salaryPayrollPanel"><div class="salary-section-head"><div><h2>Rémunération — '+esc(staff.name)+'</h2><p class="muted">'+esc(salaryMonthLabel(month))+' · accès administrateur uniquement</p></div><button type="button" id="salaryPayrollClose" class="btn secondary">Fermer</button></div>'+message+body+'</section>';
}
function salaryPayrollEditor(draft,month){
 const staff=salaryStaff.find(s=>s.id===salaryPayrollEmployeeId);
 const noWednesday=CollegeSalaryCalc.defaultWeekdays(staff?.name).length===4;
 const weekdays=[["Lun",1],["Mar",2],["Mer",3],["Jeu",4],["Ven",5]];
 const normalized={
  base_salary_gross:salaryPayrollDecimal(draft.base_salary_gross),
  bonus_gross:salaryPayrollDecimal(draft.bonus_gross),
  weekly_hours:salaryPayrollDecimal(draft.weekly_hours),
  actual_hours:draft.actual_hours===""?null:salaryPayrollDecimal(draft.actual_hours),
  working_days:draft.working_days,
  benefits_in_kind:draft.benefits_in_kind.map(x=>({label:x.label,amount:salaryPayrollDecimal(x.amount)??0}))
 };
 const calc=CollegeSalaryCalc.calculate(normalized,month);
 const cash=calc?.valid?salaryPayrollEuro(calc.estimated_gross):"À renseigner";
 const hourly=calc?.valid?salaryPayrollEuro(calc.hourly_gross):"À renseigner";
 const benefits=calc?.valid?salaryPayrollEuro(calc.benefits_total):"—";
 const worked=calc?.actual_confirmed?Number(calc.actual_hours).toLocaleString("fr-FR")+" h":"Non renseignées";
 const figures='<div class="salary-payroll-figures"><div><small>Taux horaire brut de référence</small><strong>'+hourly+'</strong></div>'+
  '<div><small>Heures théoriques du mois</small><strong>'+(calc?.valid?calc.theoretical_work_hours+" h":"—")+'</strong></div>'+
  '<div><small>Heures effectuées (déclarées)</small><strong>'+worked+'</strong></div>'+
  '<div><small>Jours ouvrés du mois (planning)</small><strong>'+(calc?.working_days??"—")+'</strong></div>'+
  '<div><small>Salaire de base + primes (brut)</small><strong>'+cash+'</strong></div>'+
  '<div><small>Avantages en nature valorisés</small><strong>'+benefits+'</strong></div></div>';
 const benefitRows=draft.benefits_in_kind.map((b,index)=>
  '<div class="salary-benefit-row"><label>Avantage '+(index+1)+'<input data-salary-benefit-label="'+index+'" type="text" maxlength="100" placeholder="Ex. logement, repas" value="'+esc(b.label)+'"></label>'+
  '<label>Valeur mensuelle (€)<input data-salary-benefit-amount="'+index+'" inputmode="decimal" placeholder="0,00" value="'+esc(b.amount)+'"></label>'+
  '<button type="button" class="btn secondary compact" data-salary-benefit-remove="'+index+'">Supprimer</button></div>').join("");
 return '<form id="salaryPayrollForm">'+
  '<div class="salary-payroll-fields"><label>Salaire mensuel brut de base (€)<input name="base_salary_gross" inputmode="decimal" required placeholder="Ex. 2000,00" value="'+esc(draft.base_salary_gross)+'"></label>'+
  '<label>Primes brutes du mois (€)<input name="bonus_gross" inputmode="decimal" required value="'+esc(draft.bonus_gross)+'"></label>'+
  '<label>Heures contractuelles / semaine<input name="weekly_hours" inputmode="decimal" required placeholder="Ex. 35" value="'+esc(draft.weekly_hours)+'"></label>'+
  '<label>Heures réellement travaillées ce mois (saisie manuelle)<input name="actual_hours" inputmode="decimal" placeholder="Vide si non pointées" value="'+esc(draft.actual_hours)+'"></label></div>'+
  '<fieldset class="salary-workdays"><legend>Jours habituels de travail</legend><div class="salary-workdays-buttons">'+weekdays.map(([label,n])=>
   '<label><input type="checkbox" data-salary-workday="'+n+'" '+(draft.working_days.includes(n)?"checked":"")+(noWednesday&&n===3?" disabled":"")+'><span>'+label+'</span></label>').join("")+'</div>'+
   '<p class="muted">'+(noWednesday?'<b>Mercredi non travaillé pour ce salarié.</b> ':'')+'Jours ouvrés = jours cochés hors jours fériés nationaux. Les vacances scolaires et fermetures exceptionnelles ne sont pas déduites automatiquement.</p></fieldset>'+
  '<div class="salary-benefits"><div class="salary-section-head"><h3>Avantages en nature</h3><button type="button" id="salaryBenefitAdd" class="btn secondary" '+(draft.benefits_in_kind.length>=20?"disabled":"")+'>Ajouter un avantage</button></div>'+
  (benefitRows||'<p class="muted">Aucun avantage en nature déclaré pour ce mois.</p>')+
  '<p class="muted">Plusieurs avantages possibles. Leur valorisation est présentée séparément du salaire versé ; les règles sociales de paie restent à vérifier.</p></div>'+
  figures+
  '<p class="muted">Taux horaire de référence = salaire de base ÷ (heures contractuelles hebdomadaires × 52 ÷ 12). Les heures théoriques ne constituent pas un relevé de présence. Aucun calcul automatique de retenues, cotisations ou paiement.</p>'+
  '<div class="actions"><button type="submit" class="btn primary" '+(salaryPayrollSaving?"disabled":"")+'>Enregistrer ce mois</button></div></form>';
}
function salaryPayrollWire(){
 const refresh=$("salaryPayrollOverviewRefresh");
 if(refresh)refresh.addEventListener("click",()=>void salaryPayrollLoadMonth(salaryMonth));
 document.querySelectorAll("[data-salary-payroll-open]").forEach(button=>button.addEventListener("click",()=>
  void salaryPayrollOpen(button.dataset.salaryPayrollOpen,salaryMonth)));
 const close=$("salaryPayrollClose");if(close)close.addEventListener("click",salaryPayrollClose);
 const add=$("salaryBenefitAdd");if(add)add.addEventListener("click",()=>{
  if(!salaryPayrollDraft||salaryPayrollDraft.benefits_in_kind.length>=20)return;
  salaryPayrollDraft.benefits_in_kind.push({label:"",amount:""});salaryPage();
 });
 const form=$("salaryPayrollForm");
 if(!form)return;
 form.addEventListener("submit",event=>void salaryPayrollSave(event));
 form.querySelectorAll("[name]").forEach(input=>input.addEventListener("input",()=>{
  if(salaryPayrollDraft)salaryPayrollDraft[input.name]=input.value;
  salaryPayrollUpdatePreview();
 }));
 form.querySelectorAll("[data-salary-workday]").forEach(input=>input.addEventListener("change",()=>{
  const day=Number(input.dataset.salaryWorkday),days=salaryPayrollDraft?.working_days;
  if(!days)return;
  if(input.checked&&!days.includes(day))days.push(day);
  if(!input.checked&&days.includes(day))days.splice(days.indexOf(day),1);
  salaryPayrollUpdatePreview();
 }));
 form.querySelectorAll("[data-salary-benefit-label],[data-salary-benefit-amount]").forEach(input=>input.addEventListener("input",()=>{
  const isLabel=input.dataset.salaryBenefitLabel!==undefined;
  const i=Number(isLabel?input.dataset.salaryBenefitLabel:input.dataset.salaryBenefitAmount);
  const benefit=salaryPayrollDraft?.benefits_in_kind?.[i];
  if(benefit)benefit[isLabel?"label":"amount"]=input.value;
  salaryPayrollUpdatePreview();
 }));
 form.querySelectorAll("[data-salary-benefit-remove]").forEach(button=>button.addEventListener("click",()=>{
  salaryPayrollDraft?.benefits_in_kind?.splice(Number(button.dataset.salaryBenefitRemove),1);
  salaryPage();
 }));
}
function salaryPayrollUpdatePreview(){
 // Update the summary without rebuilding the form and losing the current input focus.
 const form=$("salaryPayrollForm");if(!form||!salaryPayrollDraft)return;
 const draft=salaryPayrollDraft,calc=CollegeSalaryCalc.calculate({
  base_salary_gross:salaryPayrollDecimal(draft.base_salary_gross),
  bonus_gross:salaryPayrollDecimal(draft.bonus_gross),
  weekly_hours:salaryPayrollDecimal(draft.weekly_hours),
  actual_hours:salaryPayrollDecimal(draft.actual_hours),
  working_days:draft.working_days,
  benefits_in_kind:draft.benefits_in_kind.map(x=>({amount:salaryPayrollDecimal(x.amount)??0}))
 },salaryPayrollProfileMonth);
 const el=form.querySelector(".salary-payroll-figures");
 if(!el)return;
 const boxes=el.querySelectorAll("strong");
 if(boxes.length!==6)return;
 boxes[0].textContent=calc?.valid?salaryPayrollEuro(calc.hourly_gross):"À renseigner";
 boxes[1].textContent=calc?.valid?calc.theoretical_work_hours+" h":"—";
 boxes[2].textContent=calc?.actual_confirmed?calc.actual_hours+" h":"Non renseignées";
 boxes[3].textContent=calc?.working_days??"—";
 boxes[4].textContent=calc?.valid?salaryPayrollEuro(calc.estimated_gross):"À renseigner";
 boxes[5].textContent=salaryPayrollEuro(calc?.benefits_total??0);
}
