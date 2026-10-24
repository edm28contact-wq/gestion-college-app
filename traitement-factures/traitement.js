(()=>{
"use strict";
const $=id=>document.getElementById(id);
const API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-classification-catalog";
let catalog=null,rows=[];
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const num=s=>{if(s===null||s===undefined||String(s).trim()==="")return null;const n=Number(String(s).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null};
function note(s){$("status").textContent=s}
function match(line){
 const tokens=norm(line).split(" "),hits=(catalog?.products||[]).filter(p=>tokens.includes(norm(p.code))&&norm(p.code).length>=3);
 return hits.length===1?hits[0]:null;
}
function account(line){
 const keywords=(catalog?.keywords||[]).filter(k=>k.keyword&&norm(line).includes(norm(k.keyword))&&(!k.supplier_key||norm(k.supplier_key)===norm($("supplier").value)));
 const matches=[...new Set(keywords.map(x=>x.expense_account))];return matches.length===1?matches[0]:"";
}
function classify(){
 if(!catalog)return note("Connectez d'abord la base.");
 rows=rows.map(r=>{const p=match(r.raw);const amounts=[...r.raw.matchAll(/-?\d[\d ]*[,.]\d{2}/g)].map(v=>num(v[0])).filter(v=>v!==null);
 return {...r,product_id:p?.id||"",reference:p?.code||"",account:account(r.raw),ht:amounts.length>1?String(amounts[amounts.length-2]):"",ttc:amounts.length?String(amounts[amounts.length-1]):"",checked:false}});
 render();note("Classement proposé. Vérifiez chaque montant et chaque ligne.");
}
async function connect(){
 const token=localStorage.getItem("college_accounting_token")||localStorage.getItem("college_secretariat_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token");
 if(!token)return note("Connectez-vous au site Comptabilité ou Secrétariat.");
 try{const r=await fetch(API,{headers:{Authorization:"Bearer "+token},cache:"no-store"});const j=await r.json();if(!r.ok)throw Error(j.error||"Accès refusé");catalog=j;$("classify").disabled=false;render();note(j.products.length+" produits et "+j.accounts.length+" comptes chargés.");}
 catch(e){note(e.message)}
}
function render(){
 const body=$("rows");body.replaceChildren();let ht=0,ttc=0,pending=0;
 rows.forEach((r,i)=>{
 const tr=document.createElement("tr");if(!r.checked)tr.style.background="#fff8ec";
 const cell=el=>{const td=document.createElement("td");if(typeof el==="string")td.textContent=el;else td.appendChild(el);tr.appendChild(td)};
 const input=(key,type="text")=>{const el=document.createElement("input");el.type=type;el.value=r[key]||"";if(type==="number")el.step="any";el.onchange=()=>{r[key]=el.value;r.checked=false;render()};return el};
 cell(String(r.page));cell(input("raw"));cell(input("reference"));
 const sel=document.createElement("select");sel.add(new Option("À identifier",""));(catalog?.products||[]).forEach(p=>sel.add(new Option(p.code+" - "+p.name,p.id)));
 sel.value=r.product_id||"";sel.onchange=()=>{r.product_id=sel.value;r.reference=catalog.products.find(p=>p.id===sel.value)?.code||"";r.checked=false;render()};cell(sel);
 ["qty","unit","vat","ht","ttc"].forEach(k=>cell(input(k,"number")));
 const ac=document.createElement("select");ac.add(new Option("Compte à définir",""));(catalog?.accounts||[]).filter(a=>a.account.startsWith("6")).forEach(a=>ac.add(new Option(a.account+" - "+a.label,a.account)));
 ac.value=r.account||"";ac.onchange=()=>{r.account=ac.value;r.checked=false;render()};cell(ac);
 const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=!!r.checked;checkbox.onchange=()=>{r.checked=checkbox.checked;render()};cell(checkbox);
 const remove=document.createElement("button");remove.textContent="Retirer";remove.onclick=()=>{rows.splice(i,1);render()};cell(remove);body.append(tr);
 ht+=num(r.ht)||0;ttc+=num(r.ttc)||0;
 if(!r.checked||!r.product_id||!r.account||num(r.qty)===null||num(r.ht)===null||num(r.ttc)===null)pending++;
 });
 $("nLines").textContent=rows.length;$("nReview").textContent=pending;$("sumHT").textContent=ht.toFixed(2)+" €";$("sumTTC").textContent=ttc.toFixed(2)+" €";$("export").disabled=!rows.length;
}
function importTxt(text){rows=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^===== PAGE/.test(x)).map(raw=>({page:1,raw,reference:"",product_id:"",qty:"",unit:"",vat:"",ht:"",ttc:"",account:"",checked:false}));render();note(rows.length+" lignes chargées.");}
let xlsxPromise=null;
async function XLSXLib(){if(window.XLSX)return window.XLSX;if(!xlsxPromise)xlsxPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(Error("Excel indisponible"));document.head.append(s)});return xlsxPromise}
async function importFile(file){if(!file)return;try{if(file.name.toLowerCase().endsWith(".txt"))return importTxt(await file.text());const XLSX=await XLSXLib();const w=XLSX.read(await file.arrayBuffer(),{type:"array"}),data=XLSX.utils.sheet_to_json(w.Sheets.Lignes||w.Sheets[w.SheetNames[0]],{header:1,defval:""});rows=data.slice(1).filter(a=>a[2]).map(a=>({page:Number(a[0])||1,raw:String(a[2]),reference:"",product_id:"",qty:"",unit:"",vat:"",ht:"",ttc:"",account:"",checked:false}));render();note(rows.length+" lignes Excel chargées.");}catch(e){note("Import impossible : "+e.message)}}
async function exportFile(){
 try{const XLSX=await XLSXLib();const wb=XLSX.utils.book_new(),data=[["Page","Source","Référence","Produit","Quantité","Prix unitaire HT","TVA %","Total HT","Total TTC","Compte charge","Vérifié","Alerte"]];
 for(const r of rows){const p=catalog?.products?.find(x=>x.id===r.product_id);const q=num(r.qty),pu=num(r.unit),ht=num(r.ht),ttc=num(r.ttc);
 const issues=[];if(!r.checked)issues.push("NON VALIDÉ");if(!p)issues.push("Produit manquant");if(!r.account)issues.push("Compte manquant");if(q===null||q<=0)issues.push("Quantité manquante");if(ht===null||ttc===null)issues.push("Montant manquant");if(q!==null&&pu!==null&&ht!==null&&Math.abs(q*pu-ht)>.02)issues.push("Total HT incohérent");
 data.push([r.page,r.raw,r.reference,p?.name||"",q??"",pu??"",num(r.vat)??"",ht??"",ttc??"",r.account,r.checked?"OUI":"NON",issues.join("; ")]);
 }
 const sheet=XLSX.utils.aoa_to_sheet(data);sheet["!cols"]=[{wch:8},{wch:65},{wch:15},{wch:45},{wch:12},{wch:18},{wch:12},{wch:15},{wch:15},{wch:18},{wch:12},{wch:44}];XLSX.utils.book_append_sheet(wb,sheet,"Traitement");
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Fournisseur",$("supplier").value],["Numéro",$("invoiceNo").value],["Date",$("invoiceDate").value],["Compte fournisseur",$("supplierAccount").value],["État","BROUILLON - pas un import Charlemagne"]]),"Facture");
 XLSX.writeFile(wb,"traitement_facture.xlsx");note("Excel exporté. Aucune écriture ni stock modifié.");}
 catch(e){note("Export impossible : "+e.message)}
}
function boot(){
 $("connect").onclick=connect;$("classify").onclick=classify;$("sourceFile").onchange=e=>importFile(e.target.files?.[0]);
 $("addRow").onclick=()=>{rows.push({page:1,raw:"",reference:"",product_id:"",qty:"",unit:"",vat:"",ht:"",ttc:"",account:"",checked:false});render()};
 $("export").onclick=exportFile;$("supplier").onchange=()=>{const r=catalog?.supplier_rules?.find(x=>norm(x.supplier_name)===norm($("supplier").value));if(r)$("supplierAccount").value=r.supplier_account||""};
 render();
}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot):boot();
})();