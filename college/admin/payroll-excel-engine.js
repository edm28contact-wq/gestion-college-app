/* Calcul Fiche Paye : reproduction technique des cellules du classeur Excel.
   Les constantes sont celles du fichier fourni, pas des taux légaux actualisés.
   Ce calcul n'ecrit jamais dans les virements, le dossier ou la base de donnees. */
(()=>{
"use strict";
const excelRates=Object.freeze({
 urssafSalariale:0.004,urssafPatronale:0.1488,
 urssafPlafonneeSalariale:0.069,urssafPlafonneePatronale:0.0855,
 chomagePatronale:0.0425,retraiteSalariale:0.0401,retraitePatronale:0.0601,
 agircTrancheBSalariale:0.0986,mutuelleC:0.0044,mutuelleF:0.01146,
 apecSalariale:0.00024,apecPatronale:0.00036,
 prevoyancePatronale:0.015,csgCoefficient:0.9975490196078431,
 csg:0.068,crds:0.029
});
const parse=value=>{
 const s=String(value??"").trim().replace(/[\u00a0\u202f ]/g,"").replace(",",".");
 if(!/^\d{1,9}(?:\.\d{1,4})?$/.test(s))return null;
 return Number(s);
};
const euro=value=>Number(value).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function calculateExcel(input){
 const required=["gross","plafond","csgBase","prevoyanceBase","transport","acompte","withholding"];
 const x={};
 for(const key of required){
  x[key]=parse(input?.[key]);
  if(x[key]===null)throw Error("Montant non valide : "+key);
 }
 const cadre=["o","oui"].includes(String(input.cadre||"").trim().toLowerCase());
 const mutuelle=String(input.mutuelle||"").toLowerCase();
 if(!["","c","f"].includes(mutuelle))throw Error("Mutuelle invalide : C, F ou vide.");
 const plafond=Math.min(x.gross,x.plafond),trancheB=Math.max(0,x.gross-x.plafond);
 const r=excelRates;
 const contributions=[
  {cell:"9",label:"URSSAF",base:x.gross,salaryRate:r.urssafSalariale,employerRate:r.urssafPatronale},
  {cell:"10",label:"URSSAF plafonnee",base:plafond,salaryRate:r.urssafPlafonneeSalariale,employerRate:r.urssafPlafonneePatronale},
  // La cellule C11 du classeur est vide : I11=C11*H11 donne zero.
  {cell:"11",label:"Assurance chomage",base:0,salaryRate:0,employerRate:r.chomagePatronale},
  {cell:"13",label:"Retraite",base:plafond,salaryRate:r.retraiteSalariale,employerRate:r.retraitePatronale},
  {cell:"14",label:"AGIRC ARRCO",base:trancheB,salaryRate:cadre?r.agircTrancheBSalariale:0,employerRate:0},
  {cell:"16",label:"Mutuelle",base:x.plafond,salaryRate:mutuelle==="c"?r.mutuelleC:mutuelle==="f"?r.mutuelleF:0,employerRate:0},
  // I18 du classeur n'est pas conditionne par la mention cadre.
  {cell:"18",label:"APEC Tranche A",base:plafond,salaryRate:cadre?r.apecSalariale:0,employerRate:r.apecPatronale},
  {cell:"19",label:"APEC Tranche B",base:trancheB,salaryRate:cadre?r.apecSalariale:0,employerRate:0},
  {cell:"20",label:"Prevoyance",base:x.prevoyanceBase,salaryRate:0,employerRate:r.prevoyancePatronale},
  {cell:"22",label:"CSG",base:x.csgBase*r.csgCoefficient,salaryRate:r.csg,employerRate:0},
  {cell:"23",label:"CSG RDS",base:x.csgBase*r.csgCoefficient,salaryRate:r.crds,employerRate:0}
 ].map(line=>({...line,salary:line.base*line.salaryRate,employer:line.base*line.employerRate}));
 const employeeDeductions=contributions.reduce((sum,x)=>sum+x.salary,0);
 const employerCharges=contributions.reduce((sum,x)=>sum+x.employer,0);
 const netBeforeTax=x.gross-employeeDeductions;
 const net=netBeforeTax+x.transport-x.acompte-x.withholding;
 return {contributions,employeeDeductions,employerCharges,netBeforeTax,net,parameters:x,rates:r};
}
const memory=new Map();
const fields=[
 ["gross","Salaire brut (C5)"],["plafond","Plafond SS (C3)"],
 ["csgBase","Base CSG (C22/C23)"],["prevoyanceBase","Base prevoyance (C20)"],
 ["transport","Transport (D29)"],["acompte","Acompte (D30)"],["withholding","PAS (F32)"]
];
function defaults(person,draft){
 const row=draft.declarations.get(person.id)||{};
 const gross=parse(row.gross);
 const transport=parse(row.transport);
 return {gross:gross===null?"600":gross.toFixed(2),plafond:"3925",csgBase:"600",prevoyanceBase:"600",
  transport:transport===null?"0":transport.toFixed(2),acompte:"0",withholding:"0",cadre:"o",mutuelle:""};
}
function mount(host,{month,people,draft}){
 let state=memory.get(month);
 if(!state){state={selected:"",entries:new Map()};memory.set(month,state)}
 if(!Array.isArray(people)||!people.length){host.innerHTML='<section class="card"><h3>Calcul Fiche Paye — Excel</h3><p>Aucun salarié disponible.</p></section>';return}
 if(!people.some(p=>p.id===state.selected))state.selected=people[0].id;
 const person=people.find(p=>p.id===state.selected);
 if(!state.entries.has(person.id))state.entries.set(person.id,defaults(person,draft));
 const input=state.entries.get(person.id);
 const options=people.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===person.id?'selected':'')+'>'+esc(p.name)+'</option>').join("");
 const fieldsHtml=fields.map(([key,label])=>'<label>'+esc(label)+'<input type="text" inputmode="decimal" data-excel-field="'+key+'" value="'+esc(input[key])+'"></label>').join("");
 host.innerHTML='<section class="card salary-od-section" id="salaryExcelCalculator"><h2>5. Calcul Fiche Paye — moteur du classeur Excel</h2>'+
 '<p class="muted">Reproduction des cellules du fichier .xlsm, dont les taux et bases fixes d origine. Les resultats peuvent differer des bulletins de paie. Ne genere pas de virements.</p>'+
 '<div class="salary-doc-fields"><label>Salarié<select id="excelPerson">'+options+'</select></label>'+
 '<label>Cadre (C6)<select id="excelCadre"><option value="o" '+(input.cadre==="o"?'selected':'')+'>Oui (o)</option><option value="n" '+(input.cadre==="n"?'selected':'')+'>Non (n)</option></select></label>'+
 '<label>Mutuelle (C7)<select id="excelMutuelle"><option value="" '+(!input.mutuelle?'selected':'')+'>Non renseignee</option><option value="c" '+(input.mutuelle==="c"?'selected':'')+'>Celibataire (C)</option><option value="f" '+(input.mutuelle==="f"?'selected':'')+'>Famille (F)</option></select></label>'+fieldsHtml+'</div>'+
 '<div id="excelPayrollResults" role="status"></div>'+
 '<p class="muted">Attention : plafonds et taux du classeur ne sont pas actualises. C11 (assurance chomage) est vide dans Excel ; I18 (APEC patronale) ne depend pas du statut cadre ; bases C20/C22/C23 sont fixes a 600 dans le modele. Ces particularites sont conservees pour une reproduction fidele. Les nets des bulletins officiels restent seuls utilisables pour la banque.</p></section>';
 const show=()=>{
  const result=host.querySelector("#excelPayrollResults");
  try{
   const data=calculateExcel(input);
   const rows=data.contributions.map(l=>'<tr><td>'+esc(l.cell)+'</td><th>'+esc(l.label)+'</th><td>'+euro(l.base)+'</td><td>'+String((l.salaryRate*100).toFixed(3))+' %</td><td>'+euro(l.salary)+'</td><td>'+String((l.employerRate*100).toFixed(3))+' %</td><td>'+euro(l.employer)+'</td></tr>').join("");
   const original=draft.payments.get(person.id),official=parse(original);
   const discrepancy=official===null?'<p class="muted">Net du bulletin non disponible pour comparaison.</p>':
    '<p class="muted">Net a virer saisi sur le bulletin : <strong>'+euro(official)+'</strong>. Ecart simulation - bulletin : <strong>'+euro(data.net-official)+'</strong>.</p>';
   result.innerHTML='<div class="salary-od-totals"><div><span>Retenues salariales (F25)</span><strong>'+euro(data.employeeDeductions)+'</strong></div><div><span>Charges patronales (I25)</span><strong>'+euro(data.employerCharges)+'</strong></div><div><span>Net avant IR (F27)</span><strong>'+euro(data.netBeforeTax)+'</strong></div><div><span>Net Excel (F34)</span><strong>'+euro(data.net)+'</strong></div></div>'+discrepancy+
    '<div class="table"><table><thead><tr><th>Ligne</th><th>Rubrique</th><th>Base</th><th>Taux salarial</th><th>Salarial</th><th>Taux patronal</th><th>Patronal</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }catch(e){result.innerHTML='<p class="err">'+esc(e.message)+'</p>'}
 };
 host.querySelector("#excelPerson").addEventListener("change",e=>{state.selected=e.target.value;mount(host,{month,people,draft})});
 host.querySelector("#excelCadre").addEventListener("change",e=>{input.cadre=e.target.value;show()});
 host.querySelector("#excelMutuelle").addEventListener("change",e=>{input.mutuelle=e.target.value;show()});
 host.querySelectorAll("[data-excel-field]").forEach(el=>el.addEventListener("input",()=>{input[el.dataset.excelField]=el.value;show()}));
 show();
}
const api=Object.freeze({calculateExcel,mount,excelRates});
if(typeof window!=="undefined")window.ChambertinExcelPayroll=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();