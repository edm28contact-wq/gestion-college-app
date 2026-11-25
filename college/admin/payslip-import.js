/* Import PDF de bulletins : PDF.js exécuté uniquement dans le navigateur.
 * Aucun fichier ni texte intégral de bulletin n'est envoyé aux serveurs. */
(()=>{
"use strict";
const PDFJS_URL="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.min.mjs";
const WORKER_URL="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.worker.min.mjs";
const MAX_FILES=30,MAX_BYTES=12*1024*1024,MAX_TOTAL_BYTES=60*1024*1024;
let pdfLoader=null,current=null;
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function euro(cents){return Number.isSafeInteger(cents)?(cents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"}):"—"}
async function pdfLibrary(){
 if(!pdfLoader){
  pdfLoader=import(PDFJS_URL).then(module=>{module.GlobalWorkerOptions.workerSrc=WORKER_URL;return module}).catch(e=>{pdfLoader=null;throw e});
 }
 return pdfLoader;
}
function pageLines(content){
 const items=(content?.items||[]).filter(item=>typeof item.str==="string"&&item.str.trim()&&Array.isArray(item.transform)&&item.transform.length>=6);
 const rows=[];
 for(const item of items){
  const x=Number(item.transform[4]),y=Number(item.transform[5]);
  if(!Number.isFinite(x)||!Number.isFinite(y))continue;
  let row=rows.find(line=>Math.abs(line.y-y)<=2);
  if(!row){row={y,parts:[]};rows.push(row)}
  row.parts.push({x,text:item.str.trim()});
 }
 rows.sort((a,b)=>b.y-a.y);
 return rows.map(line=>line.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(" ").replace(/\s+/g," ").trim()).filter(Boolean);
}
async function readFile(file){
 if(file.size<100||file.size>MAX_BYTES)throw Error("Fichier PDF trop volumineux ou vide (maximum 12 Mo par bulletin).");
 if(!/\.pdf$/i.test(file.name)||file.type&&!["application/pdf","application/x-pdf",""].includes(file.type))
  throw Error("Le fichier doit être un bulletin PDF.");
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.length<5||new TextDecoder("ascii").decode(bytes.subarray(0,5))!=="%PDF-")throw Error("Le contenu n'est pas un PDF valide.");
 const lib=await pdfLibrary(),task=lib.getDocument({data:bytes,isEvalSupported:false,enableXfa:false});
 try{
  const pdf=await task.promise;
  if(pdf.numPages>4)throw Error("PDF de plus de 4 pages : séparez les bulletins par salarié.");
  const lines=[];
  for(let p=1;p<=pdf.numPages;p++){
   const page=await pdf.getPage(p);
   const text=await page.getTextContent();
   lines.push(...pageLines(text));
   page.cleanup();
  }
  if(lines.join(" ").length<100)throw Error("PDF scanné sans texte exploitable : saisie manuelle requise (OCR non activé).");
  return lines;
 }finally{await task.destroy().catch(()=>{})}
}
function stateFor(opts){
 const key=opts.session+"|"+opts.month;
 if(!current||current.key!==key)current={key,rows:[],busy:false,serial:0,message:"",opts};
 current.opts=opts;
 return current;
}
function valid(state){
 const opts=state.opts;
 return state===current&&opts.isCurrent()&&opts.editable()&&!state.busy;
}
function makeEl(tag,text,attrs={}){
 const node=document.createElement(tag);
 if(text!==undefined&&text!==null)node.textContent=String(text);
 for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);
 return node;
}
function render(state){
 const root=state.opts.root;
 if(!root?.isConnected)return;
 const allowed=state.opts.editable();
 root.innerHTML='<div class="salary-od-heading"><div><h3>Importer les bulletins de paie (PDF)</h3><p class="muted">Le net à payer après prélèvement à la source est proposé pour chaque bulletin. Un montant certain est reporté seulement si le mois et le salarié sont confirmés dans le PDF ; sinon, choisissez et confirmez la proposition après lecture du bulletin.</p></div></div>'+
  '<label class="salary-payslip-file">Déposer plusieurs bulletins PDF <input id="salaryPayslipFiles" type="file" accept=".pdf,application/pdf" multiple></label>'+
  '<p class="muted">Lecture uniquement dans ce navigateur, sans transmission des PDF. Maximum 30 fichiers, 12 Mo chacun. Le nom 2026-11 renseigne le mois provisoirement, mais ne remplace pas une vérification sur le bulletin. Si plusieurs nets sont détectés, sélectionnez celui après prélèvement à la source.</p>'+
  '<p id="salaryPayslipStatus" class="salary-od-status" role="status" aria-live="polite"></p>'+
  '<div class="table" id="salaryPayslipTable" hidden><table class="salary-od-table salary-payslip-table"><thead><tr><th>Bulletin</th><th>Salarié</th><th>Période</th><th>Net à payer</th><th>Résultat</th><th>Action</th></tr></thead><tbody id="salaryPayslipRows"></tbody></table></div>';
 const fileInput=root.querySelector("#salaryPayslipFiles");
 fileInput.disabled=!allowed||state.busy;
 fileInput.addEventListener("change",e=>{
  const files=Array.from(e.target.files||[]);
  e.target.value="";
  if(files.length)void processFiles(state,files);
 });
 const status=root.querySelector("#salaryPayslipStatus");
 status.textContent=state.busy?"Lecture des bulletins en cours…":state.message||(!allowed?"Ouvrez un dossier mensuel en brouillon avec les droits de modification.":"Sélectionnez les bulletins du mois "+state.opts.month+".");
 const tbody=root.querySelector("#salaryPayslipRows"),box=root.querySelector("#salaryPayslipTable");
 box.hidden=state.rows.length===0;
 for(let i=0;i<state.rows.length;i++){
  const row=state.rows[i],tr=document.createElement("tr");
  const cells=[
   row.filename,
   row.staffName||"Non identifié",
   row.period?row.period+(row.periodSource==="filename"?" (nom du fichier)":""):"Non reconnue",
   euro(row.amountCents),
   row.status==="imported"?"Net prérempli":row.status==="same"?"Déjà identique":row.status==="conflict"?"Montant différent déjà saisi":row.status==="duplicate"?"Doublon du même salarié":row.status==="review"?"À vérifier":row.status==="error"?"Lecture impossible":"À traiter"
  ];
  for(const value of cells)tr.append(makeEl("td",value));
  const action=makeEl("td");
  if(row.reason){const p=makeEl("small",row.reason);action.append(p)}
  const canManual=allowed&&!state.busy&&(row.amountCents!==null||row.amountCandidates?.length>0)&&row.period===state.opts.month&&row.documentOk===true&&["review","duplicate","conflict"].includes(row.status);
  if(canManual){
   const select=makeEl("select",null,{"aria-label":"Salarié pour "+row.filename});
   select.append(makeEl("option","Choisir le salarié",{value:""}));
   for(const person of state.opts.staff){
    const option=makeEl("option",person.name,{value:person.id});
    if(row.staffId===person.id)option.selected=true;
    select.append(option);
   }
   action.append(select);
   const choice=makeEl("select",null,{"aria-label":"Montant net vérifié pour "+row.filename});
   choice.append(makeEl("option","Choisir le net après impôt",{value:""}));
   const options=[...(row.amountCandidates||[])];
   if(row.amountCents!==null&&!options.some(v=>v.cents===row.amountCents))options.unshift({cents:row.amountCents,label:row.label||"Net extrait"});
   options.filter(v=>Number.isSafeInteger(v.cents)&&v.cents>=0).forEach(entry=>{
    const label=euro(entry.cents)+" — "+String(entry.label||"Montant extrait").replace(/\s+/g," ").slice(0,85);
    const option=makeEl("option",label,{value:String(entry.cents)});
    if(row.amountCents===entry.cents)option.selected=true;
    choice.append(option);
   });
   if(options.length){action.append(choice)}
   const button=makeEl("button","Reporter après vérification",{type:"button",class:"btn secondary compact"});
   const check=()=>{button.disabled=!select.value||!choice.value};
   check();
   select.addEventListener("change",check);
   choice.addEventListener("change",check);
   button.addEventListener("click",()=>{
    const verified=Number(choice.value);
    if(!valid(state)||!select.value||!choice.value||!Number.isSafeInteger(verified)||verified<0||
       !state.opts.staff.some(p=>p.id===select.value)||!options.some(x=>x.cents===verified))return;
    if(!confirm("Après contrôle du bulletin PDF, confirmer : "+state.opts.staff.find(p=>p.id===select.value).name+
      " — "+euro(verified)+" — mois "+state.opts.month+" ?\nCe montant remplacera le net à payer éventuellement présent."))return;
    const outcome=state.opts.apply([{staffId:select.value,amountCents:verified}],true)[0];
    row.status=outcome||"review";
    row.amountCents=verified;
    row.staffId=select.value;row.staffName=state.opts.staff.find(p=>p.id===select.value)?.name||"";
    row.reason=outcome==="imported"?"Confirmation manuelle enregistrée.":"Opération non appliquée.";
    state.opts.refresh();
   });
   action.append(button);
  }
  tr.append(action);tbody.append(tr);
 }
}
async function processFiles(state,files){
 if(!valid(state))return;
 if(files.length>MAX_FILES||files.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_BYTES){
  state.message="Maximum 30 bulletins ou 60 Mo par import.";render(state);return;
 }
 state.busy=true;state.rows=[];state.message="Lecture en cours…";render(state);
 const results=[];
 const serial=++state.serial;
 for(const file of files){
  if(state!==current||serial!==state.serial||!state.opts.isCurrent())return;
  try{
   const lines=await readFile(file);
   const parsed=window.ChambertinPayslipNet.inspectPayslip(lines,state.opts.staff,state.opts.month,file.name);
   const reason=parsed.reasons.join(" ");
   results.push({...parsed,filename:file.name,status:parsed.ready?"ready":"review",reason,
    documentOk:!parsed.reasons.some(x=>x.includes("Nature « bulletin"))});
  }catch(e){
   results.push({filename:file.name,staffId:null,staffName:"",period:null,amountCents:null,status:"error",reason:String(e.message||"Extraction impossible."),documentOk:false});
  }
 }
 if(state!==current||serial!==state.serial||!state.opts.isCurrent())return;
 const ids=new Map();
 for(const row of results)if(row.staffId)ids.set(row.staffId,(ids.get(row.staffId)||0)+1);
 const proposals=[];
 for(const row of results){
  if(row.status!=="ready")continue;
  if(ids.get(row.staffId)>1){row.status="duplicate";row.reason="Plusieurs bulletins désignent le même salarié : vérification obligatoire.";continue}
  proposals.push({staffId:row.staffId,amountCents:row.amountCents,row});
 }
 // Les fichiers sont lus avant toute modification, afin de détecter les doublons.
 if(state.opts.editable()&&proposals.length){
  const outcomes=state.opts.apply(proposals.map(({staffId,amountCents})=>({staffId,amountCents})),false);
  for(let i=0;i<proposals.length;i++){
   const row=proposals[i].row;
   row.status=outcomes[i]||"review";
   row.reason=row.status==="conflict"?"Montant différent déjà saisi : intervention requise.":row.status==="imported"?"À contrôler avant la validation bancaire.":"";
  }
 }
 state.rows=results;state.busy=false;
 state.message=results.filter(x=>x.status==="imported").length+" net(s) prérempli(s) sur "+results.length+" bulletin(s). "+
  results.filter(x=>["review","error","conflict","duplicate"].includes(x.status)).length+" document(s) nécessitent une vérification.";
 state.opts.refresh();
}
function mount(opts){
 if(!opts||!opts.root||!opts.month||!opts.session)return;
 const state=stateFor(opts);
 render(state);
}
const api=Object.freeze({mount,pageLines});
if(typeof window!=="undefined")window.ChambertinPayslipImporter=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
