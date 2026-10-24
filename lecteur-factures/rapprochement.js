(()=>{
"use strict";
const $=id=>document.getElementById(id);
const CORE=window.InvoiceClassify;
const CATALOG_API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
const NUMERIC_API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-numeric-reader";
const EXCEL_LIB="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const CACHE_KEY="college_invoice_catalog_v1";
const state={catalog:null,rows:[],excluded:[],pages:[],fileName:"",catalogStamp:"",online:false,dirty:false,busy:false,requestSeq:0,savedId:""};
const say=(message,type="")=>{const el=$("matchStatus");el.textContent=message;el.className="status "+type};
window.InvoiceManualCatalog=()=>state.catalog;
const tokenList=()=>[localStorage.getItem("college_accounting_token"),localStorage.getItem("college_secretariat_token"),localStorage.getItem("edm_admin_token"),localStorage.getItem("holding_admin_token")].filter(Boolean);
const validCatalog=c=>c&&c.read_only===true&&["products","accounts","keywords","supplier_rules","supplier_charges","learned_products"].every(k=>Array.isArray(c[k]));
function currency(n){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(n)}
function activate(c,stamp,online) {
 if(!validCatalog(c))throw Error("Catalogue incomplet.");
 state.catalog=c;state.online=online;state.catalogStamp=stamp;
 const text=(online?"Administration centrale synchronisée":"Catalogue local (hors connexion)")+" · "+c.products.length+" produits · "+c.accounts.length+" comptes · "+(c.supplier_product_catalog||[]).length+" lignes fournisseur/produit";
 $("catalogState").textContent=text;
 $("backupCatalog").disabled=false;
 buildSuggestions();renderCatalog();
 if(state.pages.length&&!state.dirty)classify(false);
}
async function connect(){
 const tokens=tokenList();let lastError="Connexion indisponible";
 for(const token of tokens){
  try{
   const res=await fetch(CATALOG_API,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)});
   if(!res.ok){lastError="HTTP "+res.status;continue}
   const data=await res.json();
   if(!validCatalog(data))throw Error("Réponse catalogue incorrecte");
   const stamp=new Date().toISOString();
   try{localStorage.setItem(CACHE_KEY,JSON.stringify({catalog:data,stamp}))}catch{}
   activate(data,stamp,true);
   return true;
  }catch(err){lastError=err.message||String(err)}
 }
 try{
  const copy=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
  if(copy?.catalog){activate(copy.catalog,copy.stamp||"date inconnue",false);say("Mode hors connexion : "+lastError+". Les propositions utilisent le catalogue sauvegardé.","warn");return true;}
 }catch{}
 $("catalogState").textContent="Catalogue indisponible";
 say("Impossible de charger la base : "+lastError+". Reconnectez-vous ou importez une fiche catalogue JSON.","err");
 return false;
}
function buildSuggestions(){
 const data=$("productSuggestions");data.replaceChildren();
 for(const p of state.catalog?.products||[]){
  const opt=document.createElement("option");
  opt.value=displayProduct(p);
  data.appendChild(opt);
 }
}
function displayProduct(p){return String(p.code||"")+" — "+String(p.name||"")}
function lookupProduct(text){
 const key=CORE.norm(text);
 if(!key)return null;
 const matches=(state.catalog?.products||[]).filter(p=>CORE.norm(displayProduct(p))===key || CORE.norm(p.code)===key);
 if(matches.length===1)return matches[0];
 const products=state.catalog?.products||[];
 const prefix=products.filter(p=>CORE.norm(p.code)===key||CORE.norm(p.name)===key);
 if(prefix.length===1)return prefix[0];
 const partial=products.filter(p=>CORE.norm(p.code).startsWith(key)&&key.length>=3||CORE.norm(p.name).includes(key)&&key.length>=5);
 return partial.length===1?partial[0]:null;
}
function renderCatalog(){
 const body=$("centralCatalogBody");if(!body)return;body.replaceChildren();
 const filter=CORE.norm($("centralCatalogFilter")?.value||"");
 const lines=(state.catalog?.supplier_product_catalog||[]).filter(p=>!filter||CORE.norm([p.product_code,p.product_name,p.supplier_name,p.supplier_reference,p.account].join(" ")).includes(filter));
 for(const p of lines.slice(0,500)){
  const tr=document.createElement("tr");
  for(const v of [p.product_code,p.product_name,p.supplier_name||"À identifier",p.supplier_reference||"",p.last_unit_price_ht??"",p.other_unit_price??p.catalog_unit_price??"",p.account||"À vérifier",p.account_source||"",p.stock_quantity??0]){
   const td=document.createElement("td");td.textContent=String(v);tr.append(td);
  }body.append(tr);
 }
 $("centralCatalogCount").textContent=lines.length+" lignes trouvées"+(lines.length>500?" · 500 affichées":"")+" · synchronisé : "+(state.catalog?.generated_at||state.catalogStamp);
}
function saveBackup(){
 if(!state.catalog)return;
 const data=JSON.stringify({stamp:state.catalogStamp,catalog:state.catalog},null,2);
 const url=URL.createObjectURL(new Blob([data],{type:"application/json"}));
 const a=document.createElement("a");a.href=url;a.download="catalogue_college_"+new Date().toISOString().slice(0,10)+".json";
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function loadBackup(file){
 if(!file)return;
 try{
  if(file.size>4*1024*1024)throw Error("Fiche trop volumineuse (4 Mo maximum).");
  const data=JSON.parse(await file.text());
  if(!validCatalog(data.catalog))throw Error("Fichier non conforme.");
  activate(data.catalog,String(data.stamp||"date inconnue"),false);
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({catalog:data.catalog,stamp:String(data.stamp||"")}))}catch{}
  say("Catalogue local importé. Vous pouvez classer la facture sans Supabase.","ok");
 }catch(err){say("Impossible de lire la fiche : "+err.message,"err")}
}
function getInputLines(pages){
 const result=[];
 for(const page of pages){
  const lines=String(page.text||"").split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
   const raw=lines[i].trim();
   if(raw)result.push({page:page.number,line:i+1,raw});
  }
 }
 return result;
}
function classify(confirmReplace=true){
 if(!state.catalog)return say("Catalogue manquant : connectez Supabase ou importez une fiche.","warn");
 if(!state.pages.length)return say("Chargez un PDF pour afficher ses produits.","warn");
 if(confirmReplace&&state.dirty&&!window.confirm("Reclasser depuis la transcription ? Les corrections manuelles du tableau seront remplacées."))return;
 const input=getInputLines(state.pages);
 const result=CORE.classify(input,state.catalog,$("supplierMatch").value);
 const queue=new Map();
 for(const row of input){
  const key=row.page+"\u0000"+row.raw;
  if(!queue.has(key))queue.set(key,[]);
  queue.get(key).push(row.line);
 }
 const assign=(row,prefix,i)=>{
  const key=row.page+"\u0000"+row.raw,line=(queue.get(key)||[]).shift()||0;
  return {...row,id:prefix+String(i+1),line,checked:false};
 };
 // Match and excluded lists are independent: source line numbers are best-effort only.
 state.rows=result.matched.map((r,i)=>({...r,id:"row"+String(i+1),checked:false}));
 state.excluded=result.excluded.map((r,i)=>({...r,id:"excluded"+String(i+1)}));
 state.dirty=false;render();

 switchView("products");
 say(state.rows.length+" produit(s) rapproché(s) · "+state.excluded.length+" ligne(s) à examiner. Vérifiez quantités et prix.","ok");
}
function focusPage(n){
 if(window.InvoiceReader?.focusPage)window.InvoiceReader.focusPage(n);
}
function input(label,key,row,type="text"){
 const holder=document.createElement("label");holder.className="field";
 const span=document.createElement("span");span.textContent=label;holder.append(span);
 const el=document.createElement("input");el.type=type;el.value=row[key]??"";
 if(type==="number"){el.step="any";el.inputMode="decimal";}
 if(type==="text"&&["qty","unit","ht","ttc","vat"].includes(key))el.inputMode="decimal";
 el.addEventListener("change",()=>{
  row[key]=el.value.trim();row.checked=false;state.dirty=true;render();
 });
 holder.append(el);return holder;
}
function makeSelectAccount(row){
 const label=document.createElement("label");label.className="field";const caption=document.createElement("span");caption.textContent="Compte de charge";label.append(caption);
 const select=document.createElement("select");
 const empty=document.createElement("option");empty.value="";empty.textContent="À choisir";select.append(empty);
 for(const a of state.catalog?.accounts||[]){
  if(!String(a.account).startsWith("6"))continue;
  const option=document.createElement("option");option.value=String(a.account);option.textContent=a.account+" — "+a.label;select.append(option);
 }
 select.value=row.account||"";
 select.addEventListener("change",()=>{row.account=select.value;row.checked=false;state.dirty=true;render()});
 label.append(select);return label;
}
function productPicker(row){
 const label=document.createElement("label");label.className="field product-field";
 const caption=document.createElement("span");caption.textContent="Produit (recherche par code ou nom)";label.append(caption);
 const el=document.createElement("input");el.type="search";el.setAttribute("list","productSuggestions");el.placeholder="Ex. RV40 ou Hygiwash";
 const p=(state.catalog?.products||[]).find(x=>x.id===row.product_id);
 el.value=p?displayProduct(p):(row.search_text||"");
 const choose=()=>{
  const hit=lookupProduct(el.value);
  row.search_text=el.value;
  row.product_id=hit?.id||"";row.reference=hit?.code||"";
  row.account=hit?CORE.charge(row.raw,hit,state.catalog,$("supplierMatch").value):"";
  row.checked=false;state.dirty=true;
  render();
  if(!hit)say("Plusieurs produits possibles ou aucune correspondance : précisez le nom ou la référence.","warn");
 };
 el.addEventListener("change",choose);
 el.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();choose();}});
 label.append(el);return label;
}
function makeCard(row){
 const article=document.createElement("article");article.className="match-card";
 const product=state.catalog?.products?.find(p=>p.id===row.product_id);
 const review=CORE.check(row,state.catalog);
 const heading=document.createElement("div");heading.className="card-heading";
 const title=document.createElement("strong");title.textContent=product?product.name:"Produit à rapprocher";
 heading.append(title);
 const page=document.createElement("button");page.type="button";page.className="btn small";page.textContent="Voir page "+row.page;page.addEventListener("click",()=>focusPage(row.page));heading.append(page);article.append(heading);
 const quote=document.createElement("div");quote.className="source-line";quote.textContent=row.raw;
 article.append(quote);
 const productRow=document.createElement("div");productRow.className="match-fields";
 productRow.append(productPicker(row),makeSelectAccount(row));
 article.append(productRow);
 const numeric=document.createElement("div");numeric.className="match-fields five";
 for(const [label,key] of [["Quantité facturée"+(row.unit_label?" ("+row.unit_label+")":""),"qty"],["Qté tarifée / stock"+(row.priced_unit_label?" ("+row.priced_unit_label+")":""),"stock_qty"],["Prix unitaire HT","unit"],["Total HT","ht"],["TVA % (facultatif)","vat"],["Total TTC (facultatif)","ttc"]]){
  if(key==="stock_qty"&&row.stock_qty===undefined)continue;
  numeric.append(input(label,key,row));
 }
 article.append(numeric);
 const notes=document.createElement("div");notes.className="match-notes";
 if(review.errors.length)notes.textContent="À corriger : "+review.errors.join(" · ");
 else notes.textContent="Montants cohérents. Vérifiez les valeurs sur la facture.";
 if(review.warnings.length)notes.textContent+=" · "+review.warnings.join(" · ");
 const stockLabel=product?.stock_count_mode==="litre"?"L":product?.unit||"u";
 if(review.stockQty!==null)notes.textContent+=" · "+(row.stock_qty?"Quantité tarifée selon facture : ":"Conversion stock estimée : ")+review.stockQty.toLocaleString("fr-FR")+" "+stockLabel+(row.stock_factor?" (×"+row.stock_factor+" par colis).":"");
 notes.className+=" "+(review.errors.length?"warn":"ok");article.append(notes);
 const actions=document.createElement("div");actions.className="card-actions";
 const verified=document.createElement("label");verified.className="check-label";
 const check=document.createElement("input");check.type="checkbox";check.checked=!!row.checked;check.disabled=!review.ready;
 check.addEventListener("change",()=>{row.checked=check.checked;state.dirty=true;render();if(row.checked&&row.product_id)document.dispatchEvent(new CustomEvent("invoice-learning:confirm",{detail:{product_ids:[row.product_id]}}));});
 verified.append(check,document.createTextNode(" Vérifié sur le PDF"));actions.append(verified);
 const remove=document.createElement("button");remove.type="button";remove.className="btn small";remove.textContent="Mettre à contrôler";
 remove.addEventListener("click",()=>{
  state.rows=state.rows.filter(x=>x!==row);
  state.excluded.push({id:"excludedManual"+Date.now(),page:row.page,raw:row.raw,reason:"Écartée manuellement"});
  state.dirty=true;render();
 });actions.append(remove);article.append(actions);
 if(row.checked)article.classList.add("confirmed");
 return article;
}
function excludedCard(line){
 const item=document.createElement("div");item.className="excluded-item";
 const text=document.createElement("div");text.textContent="Page "+line.page+" — "+line.raw;item.append(text);
 const why=document.createElement("small");why.textContent=line.reason||"Non reconnu";item.append(why);
 const buttons=document.createElement("div");buttons.className="card-actions";
 const view=document.createElement("button");view.className="btn small";view.type="button";view.textContent="Voir page";view.onclick=()=>focusPage(line.page);
 const include=document.createElement("button");include.className="btn small primary";include.type="button";include.textContent="Associer à un produit";
 include.onclick=()=>{
  const entry={...CORE.empty(line.page,line.raw),id:"manual"+Date.now()+Math.random().toString(36).slice(2),match_source:"Rapprochement manuel"};
  state.rows.push(entry);state.excluded=state.excluded.filter(x=>x!==line);
  state.dirty=true;render();
  $("productsPanel").scrollIntoView({behavior:"smooth",block:"nearest"});
 };
 buttons.append(view,include);item.append(buttons);
 return item;
}
function render(){
 const list=$("matchedRows");list.replaceChildren();
 const exclusions=$("excludedRows");exclusions.replaceChildren();
 state.rows.forEach(r=>list.append(makeCard(r)));
 state.excluded.forEach(r=>exclusions.append(excludedCard(r)));
 const verified=state.rows.filter(r=>r.checked&&CORE.check(r,state.catalog).ready);
 const pending=state.rows.length-verified.length;
 $("matchCount").textContent=state.rows.length+" produit(s)";
 $("excludedCount").textContent=state.excluded.length+" ligne(s) non reconnue(s)";
 $("verifiedCount").textContent=verified.length+" vérifié(s) · "+pending+" à contrôler";
 const ht=state.rows.reduce((n,r)=>n+(CORE.decimal(r.ht)||0),0);
 $("matchedAmount").textContent="HT saisi : "+currency(ht)+" (lignes incomplètes exclues)";
 if($("exportMatched"))$("exportMatched").disabled=!state.rows.length;
 $("readNumbers").disabled=!state.rows.some(r=>!!r.product_id)||state.busy;
 $("excludedBox").open=state.excluded.length>0&&state.rows.length===0;
 if(!state.rows.length)list.textContent=state.excluded.length?"Aucun produit reconnu automatiquement. Utilisez « Associer à un produit » ci-dessous.":"Aucun produit à afficher : importez une facture.";
}
function switchView(view){
 const showProducts=view==="products";
 $("productsPanel").hidden=!showProducts;
 $("transcriptPanel").hidden=showProducts;
 $("tabProducts").classList.toggle("primary",showProducts);
 $("tabTranscript").classList.toggle("primary",!showProducts);
 $("tabProducts").setAttribute("aria-selected",String(showProducts));
 $("tabTranscript").setAttribute("aria-selected",String(!showProducts));
}
async function readNumbers(){
 if(state.busy||!state.rows.length)return;
 const work=state.rows.filter(r=>r.product_id);
 if(!work.length)return say("Aucun produit identifié pour la lecture IA.","warn");
 if(!state.online)return say("La lecture IA nécessite une connexion et une session valide. Le classement manuel reste disponible.","warn");
 const tokens=tokenList();
 if(!tokens.length)return say("Connectez-vous au Secrétariat ou à la Comptabilité pour utiliser l'IA.","warn");
 state.busy=true;$("readNumbers").disabled=true;
 const currentSeq=state.requestSeq;
 let updates=0,failures=0,alerts=0;
 try{
  for(let i=0;i<work.length;i+=8){
   const group=work.slice(i,i+8);
   const payload={rows:group.map((r,j)=>({id:"r"+j,product_id:r.product_id,raw:r.raw.slice(0,700)}))};
   let response=null,lastError="Erreur réseau";
   for(const token of tokens){
    try{
     const res=await fetch(NUMERIC_API,{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
     const data=await res.json().catch(()=>({}));
     if(res.ok){response=data;break;}
     lastError=data.error||"HTTP "+res.status;
     if(res.status!==401&&res.status!==403)break;
    }catch(err){lastError=err.message||String(err)}
   }
   if(currentSeq!==state.requestSeq)return;
   if(!response){failures+=group.length;say("Lecture IA indisponible : "+lastError+". Saisie manuelle possible.","warn");continue;}
   for(const result of response.results||[]){
    const index=Number(String(result.id||"").slice(1));
    const row=group[index];
    if(!row||!state.rows.includes(row)||row.product_id!==result.product_id)continue;
    const values=result.values||{};
    for(const key of ["qty","unit","ht","vat","ttc"]){
     if(key==="qty"&&row.stock_qty!==undefined)continue;
     if(values[key]!==null&&values[key]!==undefined&&String(row[key]??"").trim()==="")row[key]=String(values[key]);
    }
    row.checked=false;
    row.read_status=(result.issues||[]).filter(x=>row.stock_qty===undefined||!/Quantité × prix HT différent/.test(x)).filter(x=>!/Total TTC absent ou à contrôler/.test(x)).join(" · ");
    updates++;if(result.issues?.length)alerts++;
   }
   say("Lecture des montants : "+Math.min(i+8,work.length)+"/"+work.length+" ligne(s)…");
  }
  render();say("IA : "+updates+" ligne(s) traitée(s), "+alerts+" à contrôler, "+failures+" en échec. Vérifiez toujours le PDF.","ok");
 }finally{state.busy=false;render()}
}
let excelPromise=null;
async function excelLib(){
 if(window.XLSX)return window.XLSX;
 if(!excelPromise)excelPromise=new Promise((resolve,reject)=>{
  const s=document.createElement("script");s.src=EXCEL_LIB;
  s.onload=()=>window.XLSX?resolve(window.XLSX):reject(Error("Excel non disponible"));
  s.onerror=()=>reject(Error("Téléchargement Excel impossible"));
  document.head.append(s);
 });
 return excelPromise;
}
async function exportFinal(){
 if(!state.rows.length)return;
 try{
  const XLSX=await excelLib(),book=XLSX.utils.book_new();
  const head=["Page","Référence","Produit","Quantité achetée","PU HT","HT","TVA %","TTC","Compte de charge","Validé humainement","Contrôle","Source"];
  const data=[head];
  for(const r of state.rows){
   const product=state.catalog?.products?.find(p=>p.id===r.product_id);
   const validation=CORE.check(r,state.catalog);
   const safeSource=/^[=+@-]/.test(r.raw)?"'"+r.raw:r.raw;
   data.push([r.page,r.reference,product?.name||"",CORE.decimal(r.qty)??"",CORE.decimal(r.unit)??"",CORE.decimal(r.ht)??"",CORE.decimal(r.vat)??"",CORE.decimal(r.ttc)??"",r.account,r.checked?"Oui":"Non",validation.errors.concat(validation.warnings).join(" ; "),safeSource]);
  }
  const sheet=XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"]=[{wch:8},{wch:17},{wch:43},{wch:17},{wch:15},{wch:15},{wch:12},{wch:15},{wch:20},{wch:18},{wch:60},{wch:90}];
  XLSX.utils.book_append_sheet(book,sheet,"Produits");
  const extra=XLSX.utils.aoa_to_sheet([["Page","Texte original","Motif"],...state.excluded.map(r=>[r.page,r.raw,r.reason])]);
  XLSX.utils.book_append_sheet(book,extra,"À examiner");
  XLSX.writeFile(book,"facture_produits_controles.xlsx");
  say("Tableau téléchargé. Export de préparation uniquement, pas un import Charlemagne.","ok");
 }catch(err){say("Export impossible : "+err.message,"err")}
}
const SAVE_API="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-reader-save";
function invoiceTotal(key){
 const vals=state.rows.map(r=>CORE.decimal(r[key]));
 return vals.length&&vals.every(v=>v!==null)?Math.round(vals.reduce((a,b)=>a+b,0)*100)/100:null;
}
async function saveInvoice(){
 const file=window.InvoiceReader?.file?.();
 if(!file)return say("Le PDF original n'est pas disponible.","err");
 if(state.savedId)return say("Facture déjà enregistrée sous l'identifiant "+state.savedId+".","warn");
 const supplier=$("supplierMatch").value.trim(),number=$("supplierInvoiceNo").value.trim(),date=$("supplierInvoiceDate").value;
 if(!supplier||!number)return say("Renseignez le fournisseur et le numéro de facture.","warn");
 if(!state.rows.length)return say("Ajoutez au moins une ligne de produit.","warn");
 const token=localStorage.getItem("college_accounting_token")||localStorage.getItem("edm_admin_token")||localStorage.getItem("holding_admin_token");
 if(!token)return say("Connectez-vous à la Comptabilité pour enregistrer la facture.","warn");
 const btn=$("saveInvoice");btn.disabled=true;
 try{
  const fd=new FormData();fd.append("file",file);fd.append("supplier",supplier);fd.append("invoice_number",number);fd.append("invoice_date",date);
  const ht=invoiceTotal("ht"),ttc=invoiceTotal("ttc");
  if(ht!==null)fd.append("amount_ht",String(ht));
  if(ttc!==null)fd.append("amount_ttc",String(ttc));
  if(ht!==null&&ttc!==null)fd.append("amount_vat",String(Math.round((ttc-ht)*100)/100));
  fd.append("raw_text",state.pages.map(p=>p.text).join("\n"));
  fd.append("items",JSON.stringify(state.rows.map(r=>({...r,issues:CORE.check(r,state.catalog).errors.concat(CORE.check(r,state.catalog).warnings)}))));
  const res=await fetch(SAVE_API,{method:"POST",headers:{authorization:"Bearer "+token},body:fd,signal:AbortSignal.timeout(45000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    if(data.invoice_id)state.savedId=data.invoice_id;
    throw Error(data.error||"Enregistrement refusé ("+res.status+")");
  }
  state.savedId=data.invoice_id;
  say("Facture enregistrée dans « Factures fournisseurs » : "+state.rows.length+" ligne(s), sans mouvement de stock.","ok");
 }catch(err){say("Enregistrement : "+err.message,"err")}
 finally{btn.disabled=!!state.savedId}
}
function fillInvoiceMetadata(pages){
 const header=pages.slice(0,2).map(p=>String(p.text||"").split(/\r?\n/).slice(0,65).join("\n")).join("\n");
 const invoiceMatch=header.match(/(?:facture|invoice)\s*(?:n(?:[°ºo.]|um[eé]ro)?\s*)?[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i);
 if(invoiceMatch&&!/^(?:du|de|des|date|total|ht|ttc)$/i.test(invoiceMatch[1])&&!$("supplierInvoiceNo").value)$("supplierInvoiceNo").value=invoiceMatch[1];
 const dateLine=header.split("\n").find(line=>/\b(?:date\s*(?:de\s*)?(?:facture|document|[eé]mission)|factur[eé]\s+le)\b/i.test(line))||"";
 const dateMatch=dateLine.match(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2}|\d{2})\b/);
 if(dateMatch&&!$("supplierInvoiceDate").value){const year=Number(dateMatch[1]||((dateMatch[6].length===2?"20":"")+dateMatch[6]));const month=Number(dateMatch[2]||dateMatch[5]),day=Number(dateMatch[3]||dateMatch[4]);const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)$("supplierInvoiceDate").value=[year,String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");}
}
function importPastedRows(event){
 const entries=event.detail?.rows||[];
 if(!state.catalog)return say("Catalogue indisponible : actualisez la base avant import.","warn");
 if(!Array.isArray(entries)||!entries.length)return;
 let added=0,updated=0;
 for(const entry of entries){
  if(!entry?.product_id)continue;
  const key=String(entry.source_reference||"").toUpperCase();
  const existing=state.rows.find(r=>r.import_source==="tableur"&&r.supplier_reference===key);
  const row={...CORE.empty(1,entry.raw||""),id:existing?.id||"tableur"+Date.now()+"_"+added,product_id:entry.product_id,reference:entry.product_code,account:CORE.charge(entry.raw||"",state.catalog.products.find(p=>p.id===entry.product_id),state.catalog,$("supplierMatch").value),qty:String(entry.qty),unit:String(entry.unit),ht:String(entry.ht),vat:String(entry.vat),unit_label:entry.unit_label||"",supplier_reference:key,import_source:"tableur",match_source:entry.match_source||"Saisie manuelle",checked:false,read_status:entry.note||""};
  if(existing){Object.assign(existing,row);updated++}else{state.rows.push(row);added++}
 }
 state.dirty=true;render();switchView("products");
 say(added+" ligne(s) importée(s), "+updated+" mise(s) à jour. Les montants et associations nécessitent une vérification humaine. Aucun stock modifié.","ok");
}
function onReaderReady(event){
 state.savedId="";$("saveInvoice").disabled=false;
 state.requestSeq++;
 state.pages=event.detail?.pages||[];
 fillInvoiceMetadata(state.pages);
 state.fileName=event.detail?.fileName||"";
 state.dirty=false;state.rows=[];state.excluded=[];
 render();switchView("products");
 if(state.catalog)classify(false);
 else connect().then(ok=>{if(ok&&state.pages.length)classify(false)});
}
function boot(){
 if(!CORE){say("Le module de rapprochement n'a pas été chargé.","err");return;}
 $("refreshMatch").onclick=()=>classify(true);
 $("refreshCatalog").onclick=()=>connect();
 $("backupCatalog").onclick=saveBackup;
 $("centralCatalogFilter")?.addEventListener("input",renderCatalog);
 $("importCatalog").onchange=e=>loadBackup(e.target.files?.[0]);
 $("readNumbers").onclick=()=>readNumbers().catch(e=>say("Erreur de lecture IA : "+e.message,"err"));
 $("saveInvoice").onclick=saveInvoice;
 $("tabProducts").onclick=()=>switchView("products");
 $("tabTranscript").onclick=()=>switchView("transcript");
 $("supplierMatch").addEventListener("change",()=>{if(state.pages.length)classify(true)});
 $("addManualRow").onclick=()=>{
  state.rows.push({...CORE.empty(1,""),id:"manual"+Date.now(),match_source:"Ajout manuel"});
  state.dirty=true;render();
 };
 document.addEventListener("invoice-reader:ready",onReaderReady);
 document.addEventListener("invoice-tableur:import",importPastedRows);
 document.addEventListener("invoice-reader:reset",()=>{
  state.savedId="";$("supplierMatch").value="";$("supplierInvoiceNo").value="";$("supplierInvoiceDate").value="";$("saveInvoice").disabled=false;state.requestSeq++;state.pages=[];state.fileName="";state.rows=[];state.excluded=[];state.dirty=false;render();say("Facture précédente effacée. Lecture en attente.");
 });
 document.addEventListener("invoice-reader:edited",()=>{
  state.pages=window.InvoiceReader?.pages?.()||state.pages;
  if(state.rows.length)say("Transcription modifiée. Cliquez sur « Reclasser » pour mettre à jour les produits sans export.","warn");
 });
 render();switchView("products");connect();
 document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.online&&!state.dirty)void connect()});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
else boot();
})();