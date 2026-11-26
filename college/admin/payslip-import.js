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
  '<label class="salary-payslip-file" style="display:block;padding:14px;border:2px dashed #547084;border-radius:10px;cursor:pointer">Déposer les bulletins PDF ici ou cliquer pour les sélectionner <input id="salaryPayslipFiles" type="file" accept=".pdf,application/pdf" multiple></label>'+
  '<p class="muted">Lecture locale et confidentielle : les PDF ne sont pas envoyés au serveur. Maximum 30 bulletins et 12 Mo par fichier. Contrôlez le net après impôt avant de valider. Un PDF scanné sans texte nécessite une saisie manuelle.</p>'+
  '<p id="salaryPayslipStatus" class="salary-od-status" role="status" aria-live="polite"></p>'+
  '<button id="salaryPayslipApplyAll" type="button" class="btn primary" hidden>Renseigner tous les nets reconnus</button>'+
  '<div class="table" id="salaryPayslipTable" hidden><table class="salary-od-table salary-payslip-table"><thead><tr><th>Bulletin</th><th>Salarié</th><th>Période</th><th>Net à virer après impôt</th><th>Résultat</th><th>Contrôle</th></tr></thead><tbody id="salaryPayslipRows"></tbody></table></div>';
 const fileInput=root.querySelector("#salaryPayslipFiles");
 fileInput.disabled=!allowed||state.busy;
 fileInput.addEventListener("change",e=>{
  const files=Array.from(e.target.files||[]);
  e.target.value="";
  if(files.length)void processFiles(state,files);
 });
 const dropZone=root.querySelector(".salary-payslip-file");
 dropZone.addEventListener("dragover",e=>{e.preventDefault();if(allowed&&!state.busy)e.dataTransfer.dropEffect="copy"});
 dropZone.addEventListener("drop",e=>{e.preventDefault();if(allowed&&!state.busy){const files=Array.from(e.dataTransfer?.files||[]);if(files.length)void processFiles(state,files)}});
 const status=root.querySelector("#salaryPayslipStatus");
 status.textContent=state.busy?"Lecture des bulletins en cours…":state.message||(!allowed?"Ouvrez un dossier mensuel en brouillon avec les droits de modification.":"Sélectionnez les bulletins du mois "+state.opts.month+".");
 const tbody=root.querySelector("#salaryPayslipRows"),box=root.querySelector("#salaryPayslipTable");
 box.hidden=state.rows.length===0;
 const eligible=state.rows.filter(row=>row.status==="ready"&&row.ready===true&&
  row.employeeSource==="document"&&row.periodSource==="document"&&
  row.documentOk===true&&row.period===state.opts.month&&
  Number.isSafeInteger(row.amountCents)&&row.amountCents>=0&&
  ["after-tax","paid"].includes(row.netConfidence));
 const ids=eligible.map(row=>row.staffId);
 const unique=ids.length===new Set(ids).size;
 const bulk=root.querySelector("#salaryPayslipApplyAll");
 bulk.hidden=!eligible.length||!unique;bulk.disabled=!allowed||state.busy||!eligible.length||!unique;
 if(eligible.length&&unique){
  bulk.textContent="Remplir les "+eligible.length+" net(s) reconnus";
  bulk.addEventListener("click",async()=>{
   if(!valid(state)||!eligible.every(row=>row.status==="ready"&&state.opts.staff.some(p=>p.id===row.staffId)))return;
   const total=eligible.reduce((sum,row)=>sum+row.amountCents,0);
   if(!confirm("Importer les nets de "+eligible.length+" bulletins du mois "+state.opts.month+
    " pour "+euro(total)+" ?\n\nLes valeurs déjà différentes ne seront pas écrasées : elles resteront à vérifier individuellement. Aucun XML bancaire n'est généré."))return;
   state.busy=true;
   render(state);
   try{
    const outcome=await state.opts.apply(eligible.map(row=>({staffId:row.staffId,amountCents:row.amountCents})),false);
    let imported=0,conflict=0;
    eligible.forEach((row,i)=>{
     row.status=outcome?.[i]||"review";
     if(row.status==="imported")imported++;
     if(row.status==="conflict"){conflict++;row.reason="Montant différent déjà renseigné : validez individuellement si le bulletin fait foi."}
    });
    state.message=imported+" net(s) enregistré(s) ; "+conflict+" conflit(s) à vérifier. Aucun paiement déclenché.";
   }catch(e){state.message="Enregistrement impossible : "+String(e?.message||"réessayez.");}
   finally{state.busy=false;if(state===current&&state.opts.isCurrent()){state.opts.refresh();render(state)}}
  });
 }
 for(let i=0;i<state.rows.length;i++){
  const row=state.rows[i],tr=document.createElement("tr");
  const cells=[
   row.filename,
   row.staffName||"Non identifié",
   row.period?row.period+(row.periodSource==="filename"?" (nom du fichier)":""):"Non reconnue",
   euro(row.amountCents),
   row.status==="imported"?"Enregistré":row.status==="same"?"Déjà identique":row.status==="conflict"?"Montants déjà renseignés différents":row.status==="duplicate"?"Doublon du même salarié":row.status==="ready"?"Prêt à confirmer":row.status==="review"?"À vérifier":row.status==="error"?"Lecture impossible":"À traiter"
  ];
  for(const value of cells)tr.append(makeEl("td",value));
  const action=makeEl("td");
  if(row.reason){const p=makeEl("small",row.reason);action.append(p)}
  const canManual=allowed&&!state.busy&&(row.amountCents!==null||row.amountCandidates?.length>0)&&row.period===state.opts.month&&row.documentOk===true&&["ready","review","duplicate","conflict"].includes(row.status);
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
   const button=makeEl("button","Valider et enregistrer le bulletin",{type:"button",class:"btn secondary compact"});
   const check=()=>{button.disabled=!select.value||!choice.value};
   check();
   select.addEventListener("change",check);
   choice.addEventListener("change",check);
   button.addEventListener("click",async()=>{
    const verified=Number(choice.value);
    if(!valid(state)||!select.value||!choice.value||!Number.isSafeInteger(verified)||verified<0||
       !state.opts.staff.some(p=>p.id===select.value)||!options.some(x=>x.cents===verified))return;
    const person=state.opts.staff.find(p=>p.id===select.value);
    if(!confirm("Bulletin à valider : "+person.name+" — "+euro(verified)+" net à virer — mois "+state.opts.month+
      "\\n\\nRemplacer le net de ce salarié dans le dossier mensuel sécurisé ?"))return;
    state.busy=true;button.disabled=true;
    try{
     const payload={staffId:select.value,amountCents:verified};
     const outcome=(await state.opts.apply([payload],true))[0];
     row.status=outcome||"review";row.amountCents=verified;
     row.staffId=select.value;row.staffName=person.name;
     row.reason=outcome==="imported"?"Données enregistrées dans le dossier mensuel.":outcome==="same"?"Dossier déjà identique.":"Aucune modification confirmée : rechargez le dossier.";
     state.message=outcome==="imported"?"Bulletin de "+person.name+" enregistré.":"Contrôlez le résultat avant de poursuivre.";
    }catch(e){row.status="review";row.reason=String(e?.message||"Enregistrement impossible.");}
    finally{
     state.busy=false;
     if(state===current&&state.opts.isCurrent()){state.opts.refresh();render(state);}
    }
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
   const details=window.ChambertinPayslipDetails?.inspect(lines)||{};
   const reason=parsed.reasons.join(" ");
   results.push({...parsed,details,filename:file.name,status:parsed.ready?"ready":"review",reason,
    documentOk:!parsed.reasons.some(x=>x.includes("Nature « bulletin"))});
  }catch(e){
   results.push({filename:file.name,staffId:null,staffName:"",period:null,amountCents:null,status:"error",reason:String(e.message||"Extraction impossible."),documentOk:false});
  }
 }
 if(state!==current||serial!==state.serial||!state.opts.isCurrent())return;
 const ids=new Map();
 for(const row of results)if(row.staffId)ids.set(row.staffId,(ids.get(row.staffId)||0)+1);
 for(const row of results)if(row.status==="ready"&&ids.get(row.staffId)>1){
  row.status="duplicate";row.reason="Plusieurs bulletins pour le même salarié : choisissez le bon fichier avant d'enregistrer.";
 }
 // Aucun net ou salaire brut n'est appliqué sans confirmation humaine.

 state.rows=results;state.busy=false;
 state.message=results.filter(x=>x.status==="ready").length+" bulletin(s) prêts à valider sur "+results.length+" fichier(s). "+
  results.filter(x=>["review","error","duplicate"].includes(x.status)).length+" document(s) nécessitent une vérification. Aucun montant n'a été enregistré automatiquement.";
 state.opts.refresh();render(state);
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
