(()=>{
"use strict";
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/veryfi-training-api";
const $=id=>document.getElementById(id);
const keys=["college_admin_token","edm_admin_token","holding_admin_token"];
const tokens=()=>keys.map(k=>localStorage.getItem(k)).filter(Boolean);
const state={docs:[],files:[],selected:null,busy:false,lines:[]};
function status(s,error=false,id="status"){const x=$(id);if(x){x.textContent=s;x.className="status "+(error?"err":"ok")}}
async function request(action,payload=null){
 let last;
 for(const token of tokens()){
  const response=await fetch(API,{method:action==="list"?"GET":"POST",headers:{"x-admin-session":token,"content-type":"application/json"},body:action==="list"?undefined:JSON.stringify({action,...payload}),cache:"no-store",signal:AbortSignal.timeout(90000)});
  const data=await response.json().catch(()=>({error:"Réponse serveur invalide"}));
  if(response.status===401||response.status===403){last=data.error||"Session non autorisée";continue}
  if(!response.ok||!data.ok)throw Error(data.error||"Erreur du dépôt Veryfi");
  return data;
 }
 throw Error(last||"Connectez-vous à l'Administration Collège dans le même navigateur.");
}
const str=(s)=>String(s??"");
const money=x=>x===null||x===undefined?"":str(x);
const num=x=>{if(x===null||x===undefined||str(x).trim()==="")return null;const n=Number(str(x).replace(",","."));return Number.isFinite(n)?n:null};
const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x};
function setFiles(files){state.files=[...files].filter(f=>/\.pdf$/i.test(f.name));$("queue").textContent=state.files.length?state.files.map(f=>f.name+" ("+(f.size/1024/1024).toFixed(2)+" Mo)").join(" · "):"Aucun PDF valide sélectionné."}
const drop=$("drop"),files=$("files");drop.addEventListener("click",e=>{if(e.target!==files)files.click()});
drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();files.click()}});
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag")});
drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");setFiles(e.dataTransfer.files)});
files.onchange=()=>setFiles(files.files);
function encode(bytes){let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary)}
async function upload(){
 if(state.busy||!state.files.length)return status("Sélectionnez au moins un PDF.",true);
 if(!tokens().length)return status("Ouvrez l’Administration Collège et connectez-vous avant de déposer.",true);
 state.busy=true;$("upload").disabled=true;
 let done=0,errors=[];
 try{
  for(const file of state.files){
   if(file.size>6*1024*1024||file.size<5){errors.push(file.name+" : format ou taille invalide");continue}
   status("Dépôt : "+(done+1)+"/"+state.files.length+" — "+file.name);
   try{const data=await request("upload",{file_name:file.name,file_data:encode(new Uint8Array(await file.arrayBuffer())),supplier_name:$("supplier").value.trim()});done++;if(data.duplicate)errors.push(file.name+" : déjà déposé")}
   catch(e){errors.push(file.name+" : "+e.message)}
  }
  setFiles([]);files.value="";
  status(done+" document(s) traité(s)."+(errors.length?"\n"+errors.join("\n"):""),errors.length>0);
  await load();
 }finally{state.busy=false;$("upload").disabled=false}
}
function button(name,onClick,cls=""){const b=el("button","btn "+cls,name);b.type="button";b.onclick=onClick;return b}
function fmt(x){const d=new Date(x);return Number.isNaN(d.valueOf())?"":d.toLocaleString("fr-FR")}
function renderDocs(){
 const body=$("docs");body.replaceChildren();
 if(!state.docs.length){const tr=el("tr");const td=el("td","", "Aucune facture déposée.");td.colSpan=5;tr.append(td);body.append(tr);return}
 for(const d of state.docs){
  const tr=el("tr");
  for(const value of [d.file_name,d.supplier_name||d.extracted?.vendor||"",fmt(d.created_at),d.status]){
   tr.append(el("td","",value))
  }
  const actions=el("td","rowbuttons");
  actions.append(button(d.extracted?.item_count?"Relire avec Veryfi":"Analyser avec Veryfi",()=>analyze(d)));
  if(d.extracted?.line_items?.length||d.corrected?.line_items?.length)actions.append(button("Corriger / vérifier",()=>openReview(d)));
  actions.append(button("Supprimer",()=>remove(d),"danger"));
  tr.append(actions);body.append(tr)
 }
}
async function load(){try{const x=await request("list");state.docs=x.documents||[];renderDocs();if(!state.busy)status(state.docs.length+" document(s) dans le dépôt privé.")}catch(e){status(e.message,true);$("docs").textContent=""}}
async function analyze(d){
 if(state.busy)return;
 if(!confirm("Envoyer « "+d.file_name+" » à Veryfi pour lecture ? Le service externe peut facturer cette requête. Le PDF reste dans le stockage privé du collège."))return;
 state.busy=true;status("Analyse en cours : "+d.file_name);
 try{await request("analyze",{id:d.id});await load();status("Analyse terminée. Ouvrez « Corriger / vérifier » pour contrôler les lignes.")}
 catch(e){status(e.message,true);await load()}finally{state.busy=false}
}
function bindField(name,value){$("review").querySelector('[data-field="'+name+'"]').value=money(value)}
function addLine(item={}){
 const line={reference:str(item.reference),description:str(item.description),quantity:money(item.quantity),unit:str(item.unit),unit_price:money(item.unit_price),total:money(item.total),tax_rate:money(item.tax_rate)};
 state.lines.push(line);drawLines();
}
function drawLines(){
 const body=$("lines");body.replaceChildren();
 state.lines.forEach((line,index)=>{
  const tr=el("tr");
  for(const key of ["reference","description","quantity","unit","unit_price","total","tax_rate"]){
   const td=el("td"),field=el("input");field.value=line[key];field.dataset.k=key;
   field.setAttribute("aria-label",key+" ligne "+(index+1));
   field.onchange=()=>{state.lines[index][key]=field.value};
   td.append(field);tr.append(td)
  }
  const action=el("td");action.append(button("Retirer",()=>{state.lines.splice(index,1);drawLines()},"danger"));tr.append(action);body.append(tr)
 })
}
function openReview(doc){
 state.selected=doc;
 $("review").classList.add("active");
 $("reviewName").textContent=doc.file_name+(doc.reviewed_at?" · Dernière validation : "+fmt(doc.reviewed_at):"");
 const data=doc.corrected||doc.extracted||{};
 for(const field of ["vendor","invoice_number","date","subtotal","tax","total"])bindField(field,data[field]);
 state.lines=(data.line_items||[]).map(x=>({reference:str(x.reference),description:str(x.description),quantity:money(x.quantity),unit:str(x.unit),unit_price:money(x.unit_price),total:money(x.total),tax_rate:money(x.tax_rate)}));
 drawLines();$("reviewStatus").textContent="";$("review").scrollIntoView({behavior:"smooth",block:"start"})
}
async function save(){
 if(!state.selected||state.busy)return;
 const names=["vendor","invoice_number","date","subtotal","tax","total"];
 const corrected={};for(const field of names)corrected[field]=$("review").querySelector('[data-field="'+field+'"]').value.trim();
 corrected.line_items=state.lines.map(x=>({reference:x.reference,description:x.description,quantity:num(x.quantity),unit:x.unit,unit_price:num(x.unit_price),total:num(x.total),tax_rate:num(x.tax_rate)}));
 if(!corrected.line_items.length)return status("Ajoutez les lignes produits vérifiées.",true,"reviewStatus");
 if(corrected.line_items.some(x=>!x.description||x.quantity===null||x.quantity<=0||x.unit_price===null||x.total===null||Math.abs(x.quantity*x.unit_price-x.total)>.03))return status("Une ligne contient un prix, une quantité ou un total HT incohérent.",true,"reviewStatus");
 if(!confirm("Enregistrer les corrections vérifiées comme exemple interne ? Aucun stock ou écriture comptable ne sera modifié."))return;
 state.busy=true;$("save").disabled=true;
 try{await request("validate",{id:state.selected.id,corrected});status("Corrections enregistrées dans le référentiel privé.",false,"reviewStatus");await load()}
 catch(e){status(e.message,true,"reviewStatus")}
 finally{state.busy=false;$("save").disabled=false}
}
async function remove(doc){
 if(state.busy||!confirm("Supprimer définitivement « "+doc.file_name+" » et toutes ses données d'apprentissage ?"))return;
 state.busy=true;
 try{await request("delete",{id:doc.id});if(state.selected?.id===doc.id){$("review").classList.remove("active");state.selected=null}await load();status("Document supprimé.")}
 catch(e){status(e.message,true)}finally{state.busy=false}
}
$("upload").onclick=upload;$("refresh").onclick=load;$("addRow").onclick=()=>addLine();$("save").onclick=save;
$("close").onclick=()=>{$("review").classList.remove("active");state.selected=null};
void load();
})();