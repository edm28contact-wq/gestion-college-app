/* Fiche salarié : déclaration mensuelle alimentée par le dossier de paie sécurisé. */
(()=>{
"use strict";
const fields=[
 ["nir","N° SS",32],["contract","Contrat",100],["function","Fonction",160],["status","Statut",100],
 ["start","Date d’entrée",10],["end","Date de fin de contrat",10],["hours","Base horaire mensuelle",40],
 ["rate","Taux horaire brut",40],["gross","Salaire brut",40],["transport","Forfait Navigo",40],
 ["health","Mutuelle Swisslife",40],["adjustments","Retenue / prime / heures compl. ou sup.",1000],
 ["absence","Absences (maladie sans subrogation, congés payés, JNT)",1000],
 ["absencePay","Absences payées / non payées",1000],["comments","Commentaires pour le social",1000],
 ["internal","Commentaires internes — non transmis",1000]
];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const states=new Map();
let current="";
function html(staff,month){
 return '<section class="card" id="salaryProfileDeclaration" data-person="'+esc(staff.id)+'" data-month="'+esc(month)+'"><h3>Déclaration des salaires — Gérance</h3><p class="muted">Données du bulletin de paie et du dossier mensuel '+esc(month)+'. Les champs inconnus restent vides ; les heures du planning ne sont pas des heures contractuelles.</p><div id="salaryProfileDeclarationContent" role="status">Chargement de la déclaration…</div></section>';
}
function draw(key){
 const host=document.getElementById("salaryProfileDeclarationContent");
 if(!host||current!==key)return;
 const s=states.get(key);
 if(!s)return;
 if(s.loading){host.textContent="Chargement de la déclaration…";return}
 if(s.error){host.innerHTML='<p class="err" role="alert">'+esc(s.error)+'</p><button type="button" class="btn secondary" id="profileDeclarationRetry">Réessayer</button>';host.querySelector("button").addEventListener("click",()=>{states.delete(key);mount(s.id,s.month,s.session,s.writable)});return}
 const inputs=fields.map(([id,label,max])=>{
  const val=s.values[id]||"",long=max>200,date=id==="start"||id==="end";
  const attr='data-declaration-field="'+id+'" maxlength="'+max+'" autocomplete="off" '+(!s.writable||s.saving?'disabled':'');
  const input=long?'<textarea rows="2" '+attr+'>'+esc(val)+'</textarea>':'<input type="'+(date?'date':'text')+'" '+attr+' value="'+esc(val)+'">';
  return '<label class="'+(long?'salary-declaration-wide':'')+'">'+esc(label)+input+'</label>';
 }).join("");
 host.innerHTML='<p class="muted">Statut du dossier : '+esc(s.status)+'. Les données sont sauvegardées dans le dossier mensuel, pas dans le planning.</p><div class="salary-doc-fields">'+inputs+'</div>'+
 '<div class="actions"><button type="button" class="btn primary" id="profileDeclarationSave" '+(!s.writable||s.saving||s.status!=="draft"?'disabled':'')+'>Enregistrer cette déclaration</button><button type="button" class="btn secondary" id="profileDeclarationReload">Recharger</button></div><p id="profileDeclarationMessage" role="status">'+esc(s.message||"")+'</p>';
 host.querySelectorAll("[data-declaration-field]").forEach(input=>input.addEventListener("input",()=>{s.values[input.dataset.declarationField]=input.value;s.changed=true;s.message=""}));
 host.querySelector("#profileDeclarationSave").addEventListener("click",()=>void save(key));
 host.querySelector("#profileDeclarationReload").addEventListener("click",()=>{
  if(s.changed&&!confirm("Abandonner les modifications non enregistrées ?"))return;
  states.delete(key);mount(s.id,s.month,s.session,s.writable);
 });
}
async function mount(id,month,session,writable){
 const key=id+":"+month;current=key;
 const cached=states.get(key);
 if(cached){cached.writable=writable;draw(key);return}
 const state={id,month,session,writable,loading:true,status:"draft",values:{},base:{},changed:false,saving:false,message:""};
 states.set(key,state);draw(key);
 try{
  if(!window.ChambertinPayroll)throw Error("Service mensuel de paie indisponible.");
  const result=await window.ChambertinPayroll.load(month,session);
  if(!result.exists||!result.record?.draft)throw Error("Dossier mensuel absent : créez-le d’abord dans Compta salaire.");
  const rec=result.record;
  const row=(rec.draft.declarations||[]).find(x=>Array.isArray(x)&&x[0]===id);
  state.base={...(row?.[1]||{})};state.values={...state.base};
  state.status=rec.status;state.loading=false;
  draw(key);
 }catch(e){state.error=e?.message||"Chargement impossible.";state.loading=false;draw(key)}
}
async function save(key){
 const state=states.get(key);
 if(!state||state.saving||!state.writable||state.status!=="draft")return;
 state.saving=true;state.message="Enregistrement en cours…";draw(key);
 try{
  const api=window.ChambertinPayroll;
  const res=await api.load(state.month,state.session);
  if(!res.exists||res.record?.status!=="draft")throw Error("Dossier non modifiable : rechargez le mois.");
  const record=res.record;
  const declarations=Array.isArray(record.draft.declarations)?record.draft.declarations.map(x=>[x[0],{...x[1]}]):[];
  const i=declarations.findIndex(x=>x[0]===state.id);
  const remote=i<0?{}:declarations[i][1];
  if(JSON.stringify(remote)!==JSON.stringify(state.base))throw Error("Déclaration modifiée ailleurs : rechargez avant d’enregistrer.");
  const cleaned={...remote};
  for(const [name,,max] of fields){
   const value=String(state.values[name]??"");
   if(value.length>max)throw Error("Champ trop long : "+name);
   cleaned[name]=value;
  }
  if(i>=0)declarations[i]=[state.id,cleaned];else declarations.push([state.id,cleaned]);
  const draft={...record.draft,declarations};
  await api.save(state.month,state.session,record.version,draft);
  state.values={...cleaned};state.base={...cleaned};state.changed=false;
  state.message="Déclaration enregistrée dans le dossier mensuel.";state.status="draft";
 }catch(e){state.message="Échec : "+(e?.message||"erreur de sauvegarde")}
 finally{state.saving=false;draw(key)}
}
window.ChambertinSalaryProfileDeclaration=Object.freeze({html,mount});
})();