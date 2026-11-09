(()=>{
"use strict";
const ROOT="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/";
const API={veryfi:ROOT+"invoice-veryfi-reader",catalog:ROOT+"invoice-central-catalog",finalize:ROOT+"secretariat-tableur-finalize",accounting:ROOT+"accounting-api",aliases:ROOT+"product-alias-keywords"};
const $=id=>document.getElementById(id);
const parameters=new URLSearchParams(location.search);
const accounting=parameters.get("origine")==="comptabilite";
const authKeys=accounting?["college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"]:["college_secretariat_token","college_admin_token","edm_admin_token","holding_admin_token"];
let file=null,objectUrl=null,authToken="",catalog=null,documentData=null,rows=[],removedRows=[],aliases=[],loading=false,saved=false,revision=0,serverReady=false,usageRefreshPending=false,headerEdited=false,headerAutoCorrection=null;
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"").trim();
const amount=x=>{if(x==null||String(x).trim()==="")return null;const t=String(x).replace(/[\u00a0\u202f\s€]/g,"").replace(",",".");return /^-?\d+(?:\.\d+)?$/.test(t)&&Number.isFinite(Number(t))?Number(t):null};
const fmt=x=>x==null?"—":Number(x).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
const timestamp=()=>new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
const AUTO_APPROVE_SCORE=0.90;
// Factures fournisseurs vérifiées : ne jamais accepter une modification de facteur par simple correspondance de nom.
const verifiedConversions=Object.freeze({
 RV40:20,TH49:10,VN19:4,VW27:4,VX38:8,XV90:5
});
const canonicalUnit=x=>{
 const u=norm(x);
 const groups={
  piece:["piece","pieces","pce","pces","pc","pcs","pu","unite","unites","u","unit","units"],
  kg:["kg","kgs","kilogramme","kilogrammes"],
  litre:["l","lt","ltr","litre","litres"],
  pot:["pot","pots"],
  bouteille:["bouteille","bouteilles","bt","btl","bteille"],
  barquette:["barquette","barquettes","bqt","bqts"],
  seau:["seau","seaux","sea"],
  carton:["carton","cartons","col","colis","ctn","ctns"],
  boite:["boite","boites","bte","btes"],
  rouleau:["rouleau","rouleaux","roul"],
  sachet:["sachet","sachets","sac"],
  ramette:["ramette","ramettes"]
 };
 for(const [key,aliases] of Object.entries(groups))if(aliases.includes(u))return key;
 return u;
};
function supplierRule(){
 const value=norm($("vendor").value);
 const matches=(catalog?.supplier_rules||[]).filter(r=>{const k=norm(r.supplier_name||r.supplier_key);return k&&(value===k||value===k+k)});
 return matches.length===1?matches[0]:null;
}
function supplierNorm(){
 const r=supplierRule(),raw=norm(r?.supplier_name||r?.supplier_key||$("vendor").value);
 if(!raw||!catalog)return raw;
 const known=new Set([
  ...(catalog.supplier_rules||[]).map(x=>norm(x.supplier_key||x.supplier_name)),
  ...(catalog.verified_mappings||[]).filter(x=>Number(x.verification_count||0)>0).map(x=>norm(x.supplier_key||x.supplier_name))
 ]);
 if(known.has(raw))return raw;
 const base=raw.replace(/(?:parisnord|parissud|iledefrance|idf)$/,"");
 return base!==raw&&known.has(base)?base:raw;
}
function canonicalSupplier(raw){
 const value=String(raw||"").trim().replace(/\s+/g," "),key=norm(value);
 const matches=(catalog?.supplier_rules||[]).filter(r=>{const k=norm(r.supplier_name||r.supplier_key);return k&&key===k+k});
 return matches.length===1?String(matches[0].supplier_name||matches[0].supplier_key):value;
}
function accountFor(row){
 const supplier=supplierNorm(),ref=norm(row.reference),name=norm(row.description);
 const valid=new Set((catalog?.accounts||[]).map(a=>String(a.account||"")));
 const hits=(catalog?.keywords||[]).filter(k=>{
  const word=norm(k.keyword),key=norm(k.supplier_key);
  return valid.has(String(k.expense_account))&&(!key||key===supplier)&&word&&(word===ref||(word.length>=7&&name.includes(word)));
 }).sort((a,b)=>Number(b.weight||0)-Number(a.weight||0));
 if(hits.length){
  const top=hits.filter(h=>Number(h.weight||0)===Number(hits[0].weight||0));
  if(new Set(top.map(h=>h.expense_account)).size===1)return {account:String(top[0].expense_account),source:"Règle de charge par référence : à confirmer"};
 }
 const r=supplierRule();
 return r&&valid.has(String(r.expense_account||""))?{account:String(r.expense_account),source:"Compte fournisseur par défaut : à confirmer"}:{account:"",source:"Compte à identifier"};
}
function stockUnitKind(label){
 const unit=canonicalUnit(label);
 const words=String(label||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 const prefix=words.replace(/^\d+\s*/,"").match(/^(rouleau|sachet|lot|bidon|boite|carton|paquet|pot|seau|bouteille|barquette|ramette|flacon|bobine)s?(?:\b|\s)/);
 if(!prefix)return unit;
 return prefix[1]==="bobine"?"rouleau":prefix[1];
}
function invoiceSaleUnit(row,product){
 const invoice=canonicalUnit(row.unit),sale=canonicalUnit(product.unit),stock=stockUnitKind(product.stock_count_mode==="litre"?"litre":product.inventory_unit_label||product.unit);
 if(invoice===sale)return {ok:true,why:"unités identiques"};
 const factor=amount(product.purchase_to_stock_factor);
 const discrete=new Set(["pot","bouteille","barquette","sachet","dosette","portion","repas","seau","boite","rouleau","bidon","paquet","flacon"]);
 if(invoice==="piece"&&factor===1&&discrete.has(sale)&&sale===stock)
  return {ok:true,why:"Pièce / Unité sur la facture = "+product.unit+" du catalogue"};
 const packaging=String(product.conditionnement||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 const trustedMultiplier=factor>1&&Object.hasOwn(verifiedConversions,String(product.code))&&verifiedConversions[String(product.code)]===factor;
 if(sale==="piece"&&invoice==="carton"&&/^carton\b/.test(packaging)&&trustedMultiplier)
  return {ok:true,why:"Carton fournisseur et coefficient de stock vérifié"};
 if(sale==="piece"&&invoice==="lot"&&/^lot\b/.test(packaging)&&trustedMultiplier)
  return {ok:true,why:"Lot fournisseur et coefficient de stock vérifié"};
 return {ok:false,why:"Unité fournisseur « "+row.unit+" » différente de l'unité d'achat « "+product.unit+" »"};
}
function stockSuggestion(row,product){
 const quantity=amount(row.quantity),factor=amount(product?.purchase_to_stock_factor);
 if(!product||product.active===false||!(quantity>0))return {quantity:"",note:"Produit ou quantité à contrôler",needsReview:true};
 const invoice=canonicalUnit(row.unit),purchase=canonicalUnit(product.unit);
 const stock=stockUnitKind(product.stock_count_mode==="litre"?"litre":product.inventory_unit_label||product.unit);
 const stockLabel=product.stock_count_mode==="litre"?"litres":product.inventory_unit_label||product.unit||"unités";
 if(!invoice)return {quantity:"",note:"Unité absente sur la facture : vérifier l'unité de vente du catalogue",needsReview:true};
 if(!(factor>0))return {quantity:"",note:"Coefficient achat → stock invalide",needsReview:true};
 const documented=documentedCartonContents(row,product);
 if(documented)return {quantity:documented.quantity,note:row.unit_label_pair.outerQty+" colis × "+documented.ratio+" = "+documented.quantity+" "+stockLabel+" ; "+(documented.mode==="carton"?"prix HT cohérent":"prix à l'unité, quantité facturée à vérifier"),needsReview:documented.mode!=="carton"||row.manualMatchRequired===true};
 if(invoice===stock&&invoice!==purchase)return {quantity,note:"Facture déjà exprimée en "+stockLabel+" : pas de conversion",needsReview:false};
 const compatible=invoiceSaleUnit(row,product);
 if(!compatible.ok)return {quantity:"",note:compatible.why,needsReview:true};
 if(factor===1){
  // Do not treat one individual unit as one carton when the catalogue's stock unit is larger.
  if(purchase!=="piece"&&purchase!==stock)
   return {quantity:"",note:"Conversion incohérente : 1 "+product.unit+" facturée ne correspond pas automatiquement à 1 "+stockLabel+". Vérifiez la fiche produit.",needsReview:true};
  return {quantity,note:compatible.why==="unités identiques"?"1 unité achetée = 1 "+stockLabel+" en stock":compatible.why+" ; quantité "+quantity+" "+stockLabel,needsReview:false};
 }
 const sale=String(product.conditionnement||"").trim(),stockLabelRaw=String(product.inventory_unit_label||"").trim();
 if(!sale||!stockLabelRaw||/à confirmer/i.test(sale)||/à confirmer/i.test(stockLabelRaw))
  return {quantity:"",note:"Conversion ×"+factor+" à confirmer dans la fiche produit",needsReview:true};
 const converted=Math.round(quantity*factor*1000)/1000;
 const verified=Object.hasOwn(verifiedConversions,String(product.code))&&verifiedConversions[String(product.code)]===factor;
 return {quantity:converted,note:(verified?"Conversion fournisseur vérifiée : ":"Conversion proposée à confirmer : ")+quantity+" × "+factor+" = "+converted+" "+stockLabel,needsReview:!verified};
}
function showUsage(u){
 const title=$("usageMonth"),used=$("usageUsed"),limit=$("usageLimit"),left=$("usageRemaining");
 const bar=$("usageBar"),track=$("usageTrack"),hint=$("usageExplanation"),settings=$("quotaSettings");
 if(!u||u.kind!=="internal"){
  title.textContent="Mois en cours";used.textContent="—";limit.textContent="Indisponible";left.textContent="—";
  track.className="usage-track";track.setAttribute("aria-valuenow","0");bar.style.width="0%";
  hint.textContent="Suivi interne indisponible. Consultez le tableau de bord Veryfi pour le quota officiel.";
  settings.hidden=true;return;
 }
 const quota=Number.isInteger(u.monthly_quota)&&u.monthly_quota>0?u.monthly_quota:null;
 const count=Math.max(0,Number(u.used)||0);
 const percent=quota===null?0:Math.min(100,Math.round(count/quota*100));
 title.textContent=new Date(u.month+"-01T12:00:00Z").toLocaleDateString("fr-FR",{month:"long",year:"numeric",timeZone:"Europe/Paris"});
 used.textContent=String(count);limit.textContent=quota===null?"Non renseigné":String(quota);
 left.textContent=quota===null?"—":String(Math.max(0,quota-count));
 bar.style.width=percent+"%";track.setAttribute("aria-valuenow",String(percent));
 track.className="usage-track"+(quota!==null&&count>=quota?" exceeded":quota!==null&&count>=quota*.8?" warning":"");
 hint.textContent="Suivi interne depuis le "+new Date(u.tracking_started_at).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"})+
  ". "+(quota===null?"Configurez le quota local pour estimer le restant.":count>=quota?"Quota local atteint ou dépassé. Vérifiez le quota officiel avant de poursuivre.":"Reste estimé sur le quota local.")+
  " Le compteur repart automatiquement au début de chaque mois (heure de Paris), tout en conservant les mois précédents. Ne comprend pas les lectures effectuées hors de cette application et ne remplace pas le relevé officiel Veryfi.";
 settings.hidden=!u.can_manage;
 if(u.can_manage){$("quotaInput").value=quota??""}
}
async function refreshUsage(){
 if(!authToken||!serverReady||loading||document.hidden||usageRefreshPending)return;
 usageRefreshPending=true;
 try{
  const data=await request(API.veryfi,{token:authToken,timeout:15000});
  if(data?.usage)showUsage(data.usage);
  else showUsage(null);
 }catch(error){
  if(error.code===401||error.code===403){
   authToken="";serverReady=false;showUsage(null);
   $("sessionDot").className="dot bad";
   $("sessionState").textContent="Session expirée — reconnectez-vous";
   $("loginLink").hidden=false;$("analyze").disabled=true;
  }
 }finally{usageRefreshPending=false}
}
async function configureQuota(q){
 const buttons=[$("quotaSave"),$("quotaClear")];buttons.forEach(b=>b.disabled=true);
 try{
  const v=await request(API.veryfi,{method:"POST",payload:{action:"configure_quota",monthly_quota:q},timeout:15000});
  showUsage(v.usage);notice("Quota local enregistré. Le contrat Veryfi n'a pas été modifié.","success");
 }catch(e){notice("Échec de l'enregistrement du quota : "+e.message,"error")}
 finally{buttons.forEach(b=>b.disabled=false)}
}
function notice(message,type=""){const e=$("notice");e.textContent=message;e.className="notice"+(type?" "+type:"")}
function setScope(){
 $("scope").textContent=accounting?"Comptabilité":"Secrétariat";
 $("backLink").href=accounting?"../comptabilite/":"../secretariat/";
 $("loginLink").href=accounting?"../comptabilite/?return=veryfi&reauth=1&reader=dedicated":"../secretariat/?return=veryfi&reauth=1&reader=dedicated";
 $("save").textContent=accounting?"Envoyer en Comptabilité — à contrôler":"Valider vers Commandes + Achats + Stocks";
}
function isUnexpired(token){
 try{
  const parts=String(token).split(".");if(parts.length!==2)return false;
  const v=parts[0].replace(/-/g,"+").replace(/_/g,"/"),b=atob(v+"=".repeat((4-v.length%4)%4));
  const obj=JSON.parse(new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0))));
  return !!obj.u&&Number.isFinite(Number(obj.exp))&&Number(obj.exp)>Date.now()+30000;
 }catch{return false}
}
function availableTokens(){return [...new Set(authKeys.map(k=>localStorage.getItem(k)).filter(isUnexpired))]}
async function request(url,{method="GET",payload,token,timeout=20000}={}){
 const writes=method==="POST"||method==="DELETE";
 const headers=writes?{"content-type":"application/json",authorization:"Bearer "+(token||authToken)}:{"x-admin-session":token||authToken};
 const r=await fetch(url,{method,headers,body:writes?JSON.stringify(payload):undefined,cache:"no-store",signal:AbortSignal.timeout(timeout)});
 const data=await r.json().catch(()=>({error:"Réponse serveur invalide"}));
 if(!r.ok)throw Object.assign(new Error(data.error||"Erreur HTTP "+r.status),{code:r.status});
 return data;
}
async function resolveSession(){
 $("refreshSession").disabled=true;
 try{
  const candidates=availableTokens();
  if(!candidates.length)throw Object.assign(new Error("Session expirée. Reconnectez-vous à l’application."),{code:401});
  let last=null;
  for(const token of candidates){
   try{
    const config=await request(API.veryfi,{token,timeout:15000});
    if(!config.ok)throw new Error("Le lecteur Veryfi ne répond pas correctement.");
    authToken=token;serverReady=!!config.configured;
    showUsage(config.usage);
    $("sessionDot").className="dot "+(serverReady?"ok":"bad");
    $("sessionState").textContent=serverReady?"Veryfi prêt · "+timestamp():"Veryfi non configuré dans Supabase";
    $("loginLink").hidden=true;
    $("analyze").disabled=!file||loading||!serverReady;
    if(!serverReady)notice("Identifiants Veryfi non configurés sur le serveur.","error");
    await loadCatalog();
    return;
   }catch(e){last=e;if(e.code!==401&&e.code!==403)throw e}
  }
  throw last||new Error("Aucune session autorisée.");
 }catch(e){
  serverReady=false;authToken="";showUsage(null);$("sessionDot").className="dot bad";
  $("sessionState").textContent=e.message;$("loginLink").hidden=false;$("analyze").disabled=true;
  $("catalogState").textContent="";notice(e.message,"error");
 }finally{$("refreshSession").disabled=false}
}
async function loadCatalog(){
 if(!authToken)return;
 try{
  const v=await request(API.catalog,{token:authToken,timeout:20000});
  if(!Array.isArray(v.products))throw new Error("Réponse catalogue incompatible");
  catalog=v;$("catalogState").textContent=v.products.length+" produits actifs · "+(v.inactive_products||[]).length+" inactifs";
  await loadAliases();populateDatalists();if(rows.length){refreshMatches();autoVerifyGreenRows();renderRows()}
 }catch(e){
  catalog=null;$("catalogState").textContent="Catalogue indisponible";
  notice("Veryfi est accessible, mais le catalogue collège est indisponible : "+e.message,"error");
 }
}
async function loadAliases(){
 try{
  const data=await request(API.aliases,{token:authToken,timeout:18000});
  if(!data.ok||!Array.isArray(data.aliases))throw Error("Réponse du carnet invalide");
  aliases=data.aliases;populateDatalists();
 }catch(error){
  aliases=[];
  notice("Carnet des mots-clés indisponible : "+error.message,"error");
 }
}
async function saveKeyword(row,keyword,global=false){
 const product=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 if(!product)throw Error("Sélectionnez un produit actif.");
 if(norm(keyword).length<3)throw Error("Mot-clé trop court.");
 const result=await request(API.aliases,{method:"POST",token:authToken,payload:{product_id:product.id,keyword,supplier_key:global?"":supplierNorm(),alias_kind:"designation"},timeout:20000});
 if(!result.ok)throw Error(result.error||"Enregistrement refusé");
 await loadAliases();
 return result.alias;
}
async function deleteKeyword(id){
 const result=await request(API.aliases,{method:"DELETE",token:authToken,payload:{id},timeout:20000});
 if(!result.ok)throw Error(result.error||"Suppression refusée");
 await loadAliases();
}
function populateDatalists(){
 const p=$("productOptions");p.replaceChildren();
 const active=(catalog?.products||[]).filter(z=>z.active!==false);
 const byId=new Map(active.map(x=>[x.id,x]));
 const supplier=supplierNorm();
 const entries=new Map();
 const add=(text,id)=>{
  if(!text||!byId.has(id))return;
  if(!entries.has(text))entries.set(text,new Set());
  entries.get(text).add(id);
 };
 for(const x of active)add(x.code+" — "+x.name,x.id);
 for(const x of aliases){
  if(x.supplier_key&&norm(x.supplier_key)!==supplier)continue;
  const product=byId.get(x.product_id);
  if(!product)continue;
  const prefix=x.alias_kind==="reference"?"Réf. fournisseur ":"Désignation facture ";
  add(prefix+x.keyword+" — "+product.code+" — "+product.name,product.id);
 }
 for(const x of catalog?.verified_mappings||[]){
  if(Number(x.verification_count||0)<1||norm(x.supplier_key||x.supplier_name)!==supplier)continue;
  const product=byId.get(x.product_id);
  if(!product)continue;
  if(x.supplier_reference)add("Réf. fournisseur "+x.supplier_reference+" — "+product.code+" — "+product.name,product.id);
  if(x.supplier_label)add("Désignation facture "+x.supplier_label+" — "+product.code+" — "+product.name,product.id);
 }
 for(const [value,ids] of entries){
  if(ids.size!==1)continue;
  const option=document.createElement("option");
  option.value=value;option.dataset.productId=[...ids][0];p.append(option);
 }
 const a=$("accountOptions");a.replaceChildren();
 for(const x of catalog?.accounts||[]){const o=document.createElement("option");o.value=String(x.account||"");o.label=String(x.label||x.name||"");a.append(o)}
}
function setFile(newFile){
 if(loading)return;
 clearPdf();
 const valid=newFile&&/\.pdf$/i.test(newFile.name)&&newFile.size>=5&&newFile.size<=6*1024*1024;
 if(newFile&&!valid){$("file").value="";notice("PDF invalide ou supérieur à 6 Mo. La lecture Veryfi n’a pas été lancée.","error");return}
 file=newFile||null;saved=false;documentData=null;rows=[];removedRows=[];headerEdited=false;headerAutoCorrection=null;revision++;
 $("results").hidden=true;$("resultsEmpty").hidden=false;$("readingState").textContent="En attente du document";
 $("saveResult").textContent="";$("confirmReview").checked=false;$("fileName").textContent=file?file.name+" · "+(file.size/1048576).toFixed(2)+" Mo":"Aucun document sélectionné";
 $("clearFile").disabled=!file;$("analyze").disabled=!file||!serverReady;
 if(!file){$("viewerEmpty").hidden=false;notice("Déposez une facture PDF pour commencer.");return}
 objectUrl=URL.createObjectURL(file);$("viewer").src=objectUrl;$("viewer").hidden=false;$("viewerEmpty").hidden=true;
 $("openPdf").href=objectUrl;$("openPdf").hidden=false;
 notice("Document prêt. Cliquez sur « Lire avec Veryfi » pour analyser les lignes.");
}
function clearPdf(){
 if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
 $("viewer").removeAttribute("src");$("viewer").hidden=true;$("viewerEmpty").hidden=false;
 $("openPdf").removeAttribute("href");$("openPdf").hidden=true;file=null;
}
function encode(bytes){
 const chunks=[];for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
 return btoa(chunks.join(""));
}
async function analyze(){
 if(loading||!file)return;
 if(!serverReady)return notice("Une session Veryfi valide est requise.","error");
 if(!confirm("Envoyer « "+file.name+" » à Veryfi pour lecture ? Il s’agit d’un service externe pouvant être facturé. Aucune donnée comptable ni aucun stock ne sera modifié par cette lecture."))return;
 const version=++revision,source=file;loading=true;$("analyze").disabled=true;$("clearFile").disabled=true;
 $("readingState").textContent="Analyse en cours";notice("Lecture Veryfi en cours…");
 try{
  const result=await request(API.veryfi,{method:"POST",payload:{file_name:file.name,file_data:encode(new Uint8Array(await file.arrayBuffer()))},timeout:75000});
  if(source!==file||version!==revision)return;
  if(!result.ok||!result.result||!Array.isArray(result.result.line_items))throw Error("Résultat Veryfi inexploitable.");
  showUsage(result.usage);
  if(result.usage_warning)notice(result.usage_warning,"error");
  documentData=result.result;saved=false;removedRows=[];rows=documentData.line_items.map((x,i)=>makeRow(x,i));
  bindDocument();refreshMatches();autoVerifyGreenRows();renderRows();
  $("resultsEmpty").hidden=true;$("results").hidden=false;
  $("readingState").textContent="Lecture terminée";notice("Veryfi a identifié "+rows.length+" ligne(s). Vérifiez les données avant validation.","success");
 }catch(e){
  if(e.code===401||e.code===403){serverReady=false;authToken="";$("loginLink").hidden=false;$("sessionDot").className="dot bad";$("sessionState").textContent="Session non autorisée";}
  $("readingState").textContent="Lecture interrompue";
  notice("Échec de la lecture : "+e.message,"error");
 }finally{loading=false;$("analyze").disabled=!serverReady||!file;$("clearFile").disabled=!file}
}
function invoicePackPair(label){
 const m=String(label||"").match(/(?:^|\s)(\d{1,8}(?:[.,]\d{1,3})?)\s+(COL|COLIS|CARTONS?|CTNS?)\.?\s+(\d{1,8}(?:[.,]\d{1,3})?)\s+(POTS?|BT|BOUTEILLES?|PU|PCE|PCS|PIÈCES?|PIECES?|BARQUETTES?|KG|KGS|LITRES?|LTR)\.?\s*$/i);
 if(!m)return null;
 const outerQty=amount(m[1]),innerQty=amount(m[3]);
 return outerQty>0&&innerQty>outerQty?{outerQty,outerUnit:canonicalUnit(m[2]),outerRaw:m[2],innerQty,innerUnit:canonicalUnit(m[4]),innerRaw:m[4]}:null;
}
function documentedCartonContents(row,product){
 const pair=row.unit_label_pair;
 if(!pair||!product||pair.outerUnit!=="carton"||canonicalUnit(row.unit)!=="carton"||Math.abs((amount(row.quantity)||0)-pair.outerQty)>0.001)return null;
 const stock=stockUnitKind(product.stock_count_mode==="litre"?"litre":product.inventory_unit_label||product.unit);
 if(pair.innerUnit!==stock||pair.innerUnit!==canonicalUnit(product.unit))return null;
 const condition=String(product.conditionnement||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const m=condition.match(/\bcartons?\s+de\s+(\d+(?:[.,]\d{1,3})?)\s+(pots?|bouteilles?|pieces?|barquettes?|kg|litres?)\b/);
 if(!m||canonicalUnit(m[2])!==pair.innerUnit||Math.abs(pair.outerQty*amount(m[1])-pair.innerQty)>0.001)return null;
 const price=amount(row.unit_price),total=amount(row.total);
 if(!(price>0)||total===null)return null;
 const carton=Math.abs(round(price*pair.outerQty)-total)<=0.02,piece=Math.abs(round(price*pair.innerQty)-total)<=0.02;
 if(carton===piece)return null;
 return {quantity:pair.innerQty,unit:pair.innerRaw,ratio:amount(m[1]),mode:piece?"piece":"carton"};
}
function explicitInvoiceUnit(row){
 const pair=invoicePackPair(row.description);
 if(pair){
  const q=amount(row.quantity),u=canonicalUnit(row.unit);
  if(q!==null&&Math.abs(q-pair.outerQty)<=0.001&&["",pair.outerUnit,"piece"].includes(u))
   return {unit:u===pair.outerUnit?row.unit:pair.outerRaw,note:pair.outerQty+" colis contenant "+pair.innerQty+" "+pair.innerRaw+" selon la facture.",fromLabel:true,conflict:false,pair};
  if(q!==null&&Math.abs(q-pair.innerQty)<=0.001&&["",pair.innerUnit,"piece"].includes(u))
   return {unit:u===pair.innerUnit?row.unit:pair.innerRaw,note:pair.innerQty+" "+pair.innerRaw+" pour "+pair.outerQty+" colis selon la facture.",fromLabel:true,conflict:false,pair};
  return {unit:row.unit||"",note:"Incohérence des quantités ou unités avec "+pair.outerQty+" colis / "+pair.innerQty+" "+pair.innerRaw+" : vérifier le PDF.",fromLabel:false,conflict:true,pair:null};
 }

 const original=String(row.unit||"").trim(),label=String(row.description||"");
 // The final number + unit is a supplier's priced quantity, not a package multiplier.
 const match=label.match(/(?:^|\s)(\d{1,8}(?:[.,]\d{1,3})?)\s*(POTS?|SEA(?:U|UX)?|BT|BOUTEILLES?|PU|PCE|PCS|PIECES?|PIÈCES?|KG|KGS|LITRES?|LTR)\.?\s*$/i);
 if(!match)return {unit:original,note:"",fromLabel:false,conflict:false};
 const observed=amount(match[1]),invoiced=amount(row.quantity),unit=canonicalUnit(match[2]);
 if(!(observed>0)||!(invoiced>0))return {unit:original,note:"Unité "+match[2]+" détectée dans le libellé, mais quantité facturée à vérifier.",fromLabel:false,conflict:true};
 if(Math.abs(observed-invoiced)>0.001)return {unit:original,note:"Le libellé indique "+observed+" "+match[2]+" mais Veryfi a lu "+invoiced+" en quantité facturée. Ne pas convertir automatiquement : vérifier le PDF.",fromLabel:false,conflict:true};
 const current=canonicalUnit(original);
 const generic=new Set(["","carton","piece"]);
 if(current&&!generic.has(current)&&current!==unit)return {unit:original,note:"Unité OCR « "+original+" » et unité finale « "+match[2]+" » contradictoires : vérifier le PDF.",fromLabel:false,conflict:true};
 return {unit:match[2],note:"Unité facturée "+match[2]+" lue dans le libellé fournisseur pour "+observed+" unité(s).",fromLabel:true,conflict:false};
}
function makeRow(x,index){
 const evidence=explicitInvoiceUnit(x);
 return {id:index,reference:String(x.reference||""),description:String(x.description||""),
  quantity:x.quantity??"",unit:evidence.unit,unit_price:x.unit_price??"",total:x.total??"",unit_label_note:evidence.note,unit_label_conflict:evidence.conflict,unit_label_source:evidence.fromLabel,unit_label_pair:evidence.pair||null,autoQuantityReconciled:false,
  tax_rate:x.tax_rate??"",boxes:x.boxes||{},sourceBox:Array.isArray(x.box)?x.box:null,score:lineOcrConfidence(x).score,confidenceMissing:lineOcrConfidence(x).missing,
  product_id:"",product_label:"",stock_quantity:"",account:"",account_source:"",
  matched:false,verified:false,autoVerified:false,manualVerified:false,confirmedOnPdf:false,manualMatchRequired:false,stock_needs_review:false,stock_confirmed:false,unit_inferred:false,excluded:false,changed:false,reason:"",stock_note:"",stock_manual:false,account_manual:false,product_manual:false};
}
function bindDocument(){
 headerEdited=false;headerAutoCorrection=null;
 const d=documentData;
 d.vendor=canonicalSupplier(d.vendor);
 for(const [id,k] of [["vendor","vendor"],["invoiceNumber","invoice_number"],["invoiceDate","date"],["subtotal","subtotal"],["tax","tax"],["total","total"]]){
  $(id).value=d[k]??"";
 }
 const scores=Object.entries(d.fields||{}).filter(([k,v])=>v&&typeof v.score==="number");
 $("fieldScores").textContent=scores.length?"Confiance fournie par Veryfi : "+scores.map(([k,v])=>k+" "+Math.round(v.score*100)+" %").join(" · "):"Scores détaillés non fournis par Veryfi pour ces champs.";
 $("confirmReview").checked=false;populateDatalists();
}
function lineOcrConfidence(item){
 const fields=item?.boxes||{},required=["description","quantity","unit_price","total"],scores=[],missing=[];
 for(const key of required){
  const m=fields[key],values=[m?.score,m?.ocr_score].filter(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1);
  if(values.length)scores.push(Math.min(...values));else missing.push(key);
 }
 return {score:scores.length?Math.min(...scores):null,missing};
}
function verifiedSupplierReference(row){
 const supplier=supplierNorm(),reference=norm(row.reference);
 if(!catalog||!supplier||!reference)return null;
 const verified=(catalog.verified_mappings||[]).filter(x=>
  norm(x.supplier_key||x.supplier_name)===supplier&&
  norm(x.supplier_reference_norm||x.supplier_reference)===reference&&
  x.product_id&&Number(x.verification_count||0)>0);
 if(!verified.length)return null;
 const ids=[...new Set(verified.map(x=>x.product_id))];
 if(ids.length!==1)return {product:null,source:"Référence fournisseur vérifiée contradictoire : vérification manuelle",manualMatchRequired:true};
 const product=(catalog.products||[]).find(p=>p.id===ids[0]&&p.active!==false);
 return product?{product,record:verified.find(x=>x.product_id===product.id),source:"Référence fournisseur vérifiée"}:{product:null,source:"Référence fournisseur liée à un produit inactif",manualMatchRequired:true};
}
function invoiceDesignationKey(value){
 // Remove only invoice quantity suffixes. Keep packaging in the product name.
 let name=String(value??"").replace(/\s+/g," ").trim();
 const qty="\\d{1,8}(?:[.,]\\d{1,3})?";
 const unit="(?:COL|COLIS|CARTONS?|CTNS?|SACS?|SEA(?:U|UX)?|POTS?|BT|BOUTEILLES?|PU|PCE|PCS|PIÈCES?|KG|KGS|LITRES?|LTR|BIDONS?|PAQ(?:UETS?)?|LOTS?)";
 const double=new RegExp("\\s+"+qty+"\\s+"+unit+"\\.?\\s+"+qty+"\\s+"+unit+"\\.?$","i");
 const trailingNumber=new RegExp("\\s+"+qty+"\\s+"+unit+"\\.?\\s+"+qty+"$","i");
 const single=new RegExp("\\s+\\d{1,8}[.,]\\d{1,3}\\s+"+unit+"\\.?$","i");
 name=name.replace(double,"").replace(trailingNumber,"").replace(single,"");
 return norm(name);
}
function findProduct(row){
 if(!catalog||(!row.reference&&!row.description))return null;
 const supplier=supplierNorm(),ref=norm(row.reference),label=norm(row.description);
 const active=(catalog.products||[]).filter(p=>p.active!==false);
 const designation=invoiceDesignationKey(row.description);
 const strict=supplier&&designation.length>=8?aliases.filter(a=>a.alias_kind!=="reference"&&a.supplier_key&&norm(a.supplier_key)===supplier&&invoiceDesignationKey(a.keyword)===designation):[];
 const strictIds=[...new Set(strict.map(a=>a.product_id).filter(Boolean))];
 const referenceAliases=supplier&&ref?aliases.filter(a=>a.alias_kind==="reference"&&a.supplier_key&&norm(a.supplier_key)===supplier&&norm(a.keyword_norm||a.keyword)===ref):[];
 const referenceIds=[...new Set(referenceAliases.map(a=>a.product_id).filter(Boolean))];
 const confirmedLabels=supplier&&designation.length>=8?(catalog.verified_mappings||[]).filter(x=>
  Number(x.verification_count||0)>0&&norm(x.supplier_key||x.supplier_name)===supplier&&
  x.supplier_label&&invoiceDesignationKey(x.supplier_label)===designation):[];
 const labelIds=[...new Set(confirmedLabels.map(x=>x.product_id).filter(Boolean))];
 if(strict.length&&confirmedLabels.length&&(strictIds.length!==1||labelIds.length!==1||strictIds[0]!==labelIds[0]))
  return {product:null,source:"Désignations fournisseur vérifiées contradictoires : sélection manuelle obligatoire",manualMatchRequired:true};
 const checkConflict=match=>{
  if(!match?.product)return match;
  if(strict.length&&(strictIds.length!==1||strictIds[0]!==match.product.id))
   return {product:null,source:"Référence fournisseur et désignation exacte contradictoires : vérification manuelle obligatoire",manualMatchRequired:true};
  if(referenceAliases.length&&(referenceIds.length!==1||referenceIds[0]!==match.product.id))
   return {product:null,source:"Référence fournisseur enregistrée contradictoire : sélection manuelle obligatoire",manualMatchRequired:true};
  if(confirmedLabels.length&&(labelIds.length!==1||labelIds[0]!==match.product.id))
   return {product:null,source:"Référence et libellé fournisseur vérifiés pour deux produits différents : sélection manuelle obligatoire",manualMatchRequired:true};
  return match;
 };
 const verified=verifiedSupplierReference(row);
 if(verified){
  const candidate=checkConflict(verified);
  const sameLabel=labelIds.length===1&&labelIds[0]===candidate?.product?.id;
  const sameAlias=strictIds.length===1&&strictIds[0]===candidate?.product?.id;
  if(candidate?.product&&verified.record?.supplier_label&&!sameLabel&&!sameAlias)
   return {...candidate,source:"Référence vérifiée mais désignation différente du libellé fournisseur connu : vérifier le PDF",manualMatchRequired:true};
  return candidate;
 }
 if(referenceAliases.length){
  if(referenceIds.length!==1)return {product:null,source:"Référence fournisseur enregistrée ambiguë : sélection manuelle obligatoire",manualMatchRequired:true};
  const product=active.find(p=>p.id===referenceIds[0]);
  if(!product)return {product:null,source:"Référence fournisseur enregistrée liée à un produit inactif",manualMatchRequired:true};
  const labelAgrees=(strictIds.length===1&&strictIds[0]===product.id)||(labelIds.length===1&&labelIds[0]===product.id);
  return checkConflict({product,source:"Référence fournisseur enregistrée"+(labelAgrees?" et désignation confirmée":" : vérifier le PDF"),manualMatchRequired:!labelAgrees});
 }
 if(confirmedLabels.length){
  if(labelIds.length!==1)return {product:null,source:"Libellé fournisseur vérifié ambigu : sélectionner le produit manuellement",manualMatchRequired:true};
  const product=active.find(p=>p.id===labelIds[0]);
  if(!product)return {product:null,source:"Libellé fournisseur vérifié lié à un produit absent ou inactif",manualMatchRequired:true};
  const codeMatches=ref?active.filter(p=>norm(p.code)===ref):[];
  if(codeMatches.length&&(codeMatches.length!==1||codeMatches[0].id!==product.id))
   return {product:null,source:"Référence OCR et libellé fournisseur vérifié contradictoires : sélection manuelle obligatoire",manualMatchRequired:true};
  return checkConflict({product,source:ref?"Désignation fournisseur vérifiée ; référence OCR à contrôler":"Désignation fournisseur vérifiée",manualMatchRequired:!!ref});
 }
 const links=(catalog.supplier_product_catalog||[]).filter(x=>norm(x.supplier_key||x.supplier_name)===supplier&&ref&&norm(x.supplier_reference)===ref);
 const ids=[...new Set(links.map(x=>x.product_id).filter(Boolean))];
 if(ids.length>1)return {product:null,source:"Référence fournisseur ambiguë"};
 if(ids.length===1){
  const p=active.find(x=>x.id===ids[0]);
  if(p)return checkConflict({product:p,record:links.find(x=>x.product_id===p.id),source:"Association fournisseur apprise : vérification requise",manualMatchRequired:true});
 }
 if(ref){
  const exact=active.filter(x=>norm(x.code)===ref);
  if(exact.length===1)return checkConflict({product:exact[0],source:"Référence exacte du catalogue"});
  if(exact.length>1)return {product:null,source:"Référence catalogue ambiguë"};
  const inactive=(catalog.inactive_products||[]).filter(x=>norm(x.code)===ref);
  if(inactive.length===1)return {product:null,source:"Produit DÉSACTIVÉ : "+inactive[0].code+" — "+inactive[0].name};
  if(inactive.length>1)return {product:null,source:"Plusieurs produits désactivés correspondent"};
 }
 // Exact supplier designation, stripping only invoice quantities and priced units.
 if(strict.length){
   const found=strictIds;
   if(found.length!==1)return {product:null,source:"Plusieurs produits pour cette désignation fournisseur : vérification manuelle obligatoire",manualMatchRequired:true};
   const p=active.find(x=>x.id===found[0]);
   if(!p)return {product:null,source:"Désignation fournisseur liée à un produit inactif ou absent",manualMatchRequired:true};
   return {product:p,source:"Désignation exacte de la facture fournisseur"};
 }
 const matches=aliases.filter(a=>a.alias_kind!=="reference"&&(!a.supplier_key||norm(a.supplier_key)===supplier)&&
  ((ref&&norm(a.keyword_norm)===ref)||(label&&norm(a.keyword_norm)===label)));
 if(matches.length){
  const ids=[...new Set(matches.map(x=>x.product_id))];
  if(ids.length>1)return {product:null,source:"Mot-clé ambigu : sélection manuelle nécessaire"};
  const p=active.find(x=>x.id===ids[0]);
  if(p)return {product:p,source:"Appellation confirmée dans le carnet"};
 }
 const partial=aliases.filter(a=>a.alias_kind!=="reference"&&(!a.supplier_key||norm(a.supplier_key)===supplier)&&
  norm(a.keyword_norm).length>=7&&label.includes(norm(a.keyword_norm)));
 if(partial.length){
  const ids=[...new Set(partial.map(a=>a.product_id))];
  if(ids.length===1){
   const p=active.find(x=>x.id===ids[0]);
   if(p)return {product:p,source:"Mot-clé partiel : valider manuellement",manualMatchRequired:true};
  }else return {product:null,source:"Mots-clés partiels ambigus"};
 }
 if(label.length>=7){
  const exact=active.filter(x=>norm(x.name)===label);
  if(exact.length===1)return {product:exact[0],source:"Désignation catalogue exacte"};
 }
 return {product:null,source:"Produit ABSENT du catalogue actif — à ajouter ou rapprocher"};
}
function applyMatch(row,match,keepManual=false){
 const product=match?.product;
 if(row.product_id&&row.product_id!==product?.id){
  row.verified=false;row.autoVerified=false;row.manualVerified=false;row.confirmedOnPdf=false;row.changed=true;
  if(row.unit_inferred){row.unit="";row.unit_inferred=false}
  row.stock_manual=false;row.stock_confirmed=false;
 }
 row.matched=!!product;row.reason=match?.source||"Catalogue indisponible";row.manualMatchRequired=match?.manualMatchRequired===true;
 row.product_id=product?.id||"";row.product_label=product?product.code+" — "+product.name:"";
 if(product&&!row.changed&&!row.product_manual&&!row.manualMatchRequired&&!row.autoQuantityReconciled){
  const evidence=documentedCartonContents(row,product);
  if(evidence?.mode==="piece"){
   row.quantity=evidence.quantity;row.unit=evidence.unit;row.autoQuantityReconciled=true;
   row.unit_label_note="Quantité corrigée : "+evidence.quantity+" "+evidence.unit+" d'après le conditionnement et le total HT.";
   row.unit_label_source=true;row.unit_label_pair=null;
  }
 }
 if(product&&!row.unit_label_conflict&&!String(row.unit||"").trim()&&canonicalUnit(product.unit)){row.unit=product.unit;row.unit_inferred=true}
 const stock=stockSuggestion(row,product);
 if(!keepManual||!row.stock_manual)row.stock_quantity=stock.quantity;
 row.stock_note=stock.note;
 row.stock_needs_review=stock.needsReview===true;
 if(stock.needsReview&&!row.stock_manual)row.stock_confirmed=false;
 const specific=match?.record?.account&&(catalog.accounts||[]).some(a=>String(a.account)===String(match.record.account))?
  {account:String(match.record.account),source:"Compte du lien fournisseur à vérifier"}:null;
 const charge=specific||accountFor(row);
 if(!keepManual||!row.account_manual)row.account=charge.account;
 row.account_source=charge.source;
}
function refreshMatches(){
 for(const row of rows)if(!row.product_manual)applyMatch(row,findProduct(row),true);
}
function productColor(row){
 if(!catalog)return "warn";
 const product=(catalog.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 if(!product)return "bad";
 const confidenceOk=typeof row.score==="number"&&Number.isFinite(row.score)&&row.score>=AUTO_APPROVE_SCORE&&(!Array.isArray(row.confidenceMissing)||row.confidenceMissing.length===0);
 const amountsOk=eligible(row),stockOk=accounting||(amount(row.stock_quantity)>0&&!!String(row.unit||"").trim()&&(!row.stock_needs_review||row.stock_confirmed));
 const manuallyApproved=row.manualVerified===true&&row.verified===true;
 return amountsOk&&stockOk&&!row.excluded&&!row.unit_label_conflict&&
  (manuallyApproved||(confidenceOk&&!row.changed&&!row.manualMatchRequired&&!row.unit_inferred&&!row.autoQuantityReconciled))?"good":"warn";
}
function invoiceArithmetic(row){
 const q=amount(row.quantity),price=amount(row.unit_price),total=amount(row.total);
 if(q==null||!(q>0)||price==null||price<0||total==null||total<0)return {valid:false,incomplete:true};
 const calculated=round(q*price);
 return {valid:Math.abs(calculated-total)<=.02,incomplete:false,calculated,total};
}
function reviewReason(row){
 if(!catalog)return "Catalogue non chargé.";
 if(!row.product_id)return row.reason||"Aucun produit actif trouvé.";
 if(row.excluded)return "Ligne écartée de la réception.";
 const problems=[],arithmetic=invoiceArithmetic(row);
 if(arithmetic.incomplete)problems.push("Quantité, prix unitaire ou total HT incomplet.");
 else if(!arithmetic.valid)problems.push("Écart HT : quantité × prix = "+fmt(arithmetic.calculated)+" ; montant de la ligne = "+fmt(arithmetic.total)+". Vérifiez le PDF.");
 if(!accounting&&!(amount(row.stock_quantity)>0))problems.push("Quantité de stock absente : confirmez le conditionnement ou renseignez la quantité exacte.");
 else if(!accounting&&row.stock_needs_review&&!row.stock_confirmed)problems.push("Conversion du stock à confirmer.");
 if(row.unit_inferred)problems.push("Unité proposée depuis la fiche produit : vérifier sur le PDF.");
 if(row.unit_label_conflict)problems.push(row.unit_label_note||"Quantité fournisseur et unité discordantes.");
 if(!String(row.unit||"").trim())problems.push("Unité facturée manquante.");
 if(row.manualMatchRequired)problems.push("Correspondance fournisseur à confirmer sur le PDF.");
 if(row.autoQuantityReconciled&&!row.manualVerified)problems.push("Quantité modifiée à partir du conditionnement et du total HT : contrôler le PDF original.");
 if(row.confidenceMissing?.length)problems.push("Score OCR manquant pour : "+row.confidenceMissing.join(", ")+". Vérification du PDF requise.");
 if(!(typeof row.score==="number"&&Number.isFinite(row.score)&&row.score>=AUTO_APPROVE_SCORE))problems.push("Confiance minimale des champs critiques inférieure à 90 % : vérifier sur le PDF.");
 if(row.changed&&!row.verified)problems.push("Modification manuelle non confirmée.");
 if(row.confirmedOnPdf)problems.unshift("Lecture vérifiée, correction de montant encore requise.");
 return problems.join(" ")||"Contrôle complémentaire nécessaire.";
}
function stockProposal(row){
 const product=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 const q=amount(row.quantity),factor=amount(product?.purchase_to_stock_factor);
 if(!product||!(q>0)||q>1000000||!(factor>0))return null;
 const invoiceUnit=canonicalUnit(row.unit),saleUnit=canonicalUnit(product.unit);
 const stockUnit=stockUnitKind(product.stock_count_mode==="litre"?"litre":product.inventory_unit_label||product.unit);
 if(!invoiceUnit)return null;
 const label=product.stock_count_mode==="litre"?"litres":product.inventory_unit_label||product.unit||"unités";
 if(invoiceUnit===stockUnit&&invoiceUnit!==saleUnit)
  return {quantity:q,unit:label,note:"Facture déjà exprimée en unités de stock",fromCatalog:true};
 if(!invoiceSaleUnit(row,product).ok)return null;
 const inferred=/à confirmer/i.test(String(product.conditionnement||""))||/à confirmer/i.test(String(product.inventory_unit_label||""));
 if(factor!==1&&inferred)return null;
 const suggested=stockSuggestion(row,product);
 if(!(amount(suggested.quantity)>0))return null;
 return {quantity:amount(suggested.quantity),unit:label,note:factor===1?"Conversion 1 pour 1":"Coefficient ×"+factor+" du catalogue",fromCatalog:factor===1};
}
function confirmStockProposal(row){
 const suggested=stockProposal(row);
 if(!suggested)return false;
 const question="La facture indique "+row.quantity+" "+(row.unit||"unité(s)")+". "+
  "La fiche propose "+suggested.quantity+" "+suggested.unit+" en stock ("+suggested.note+"). "+
  "Confirmez cette réception après vérification sur le PDF et le conditionnement physique ?";
 if(!confirm(question))return false;
 row.stock_quantity=suggested.quantity;row.stock_manual=true;row.stock_confirmed=true;
 row.stock_note="Conversion confirmée par l'utilisateur : "+suggested.quantity+" "+suggested.unit;
 row.changed=true;row.verified=false;row.autoVerified=false;row.manualVerified=false;
 row.confirmedOnPdf=false;return true;
}
function quickFixOptions(row){
 const fixes=[],arithmetic=invoiceArithmetic(row);
 if(!accounting&&(!(amount(row.stock_quantity)>0)||(row.stock_needs_review&&!row.stock_confirmed))&&stockProposal(row))
  fixes.push({kind:"stock",label:"Confirmer le conditionnement"});
 if(!arithmetic.incomplete&&!arithmetic.valid)
  fixes.push({kind:"amount",label:"Corriger le total HT"});
 if(eligible(row)&&(accounting||(amount(row.stock_quantity)>0&&(!row.stock_needs_review||row.stock_confirmed)))&&productColor(row)==="warn")
  fixes.push({kind:"approve",label:"Vérifier et passer au vert"});
 return fixes;
}
function applyQuickFix(row,kind){
 if(saved||loading||row.excluded||!row.product_id)return {ok:false,message:"Cette ligne n'est pas modifiable."};
 if(kind==="stock"){
  if(!stockProposal(row))return {ok:false,message:"Aucune conversion vérifiable disponible."};
  if(!confirmStockProposal(row))return {ok:false,quiet:true};
  return {ok:true,message:"Quantité de stock confirmée. Vous pouvez maintenant vérifier et valider la ligne."};
 }
 if(kind==="amount"){
  const calculation=invoiceArithmetic(row);
  if(calculation.incomplete||calculation.valid)return {ok:false,message:"Aucune correction de montant nécessaire."};
  if(!confirm("Le lecteur propose "+fmt(calculation.calculated)+" à la place de "+fmt(calculation.total)+". Vérifiez le montant de la ligne sur le PDF ORIGINAL avant de confirmer. Appliquer cette correction ?"))
   return {ok:false,quiet:true};
  row.total=calculation.calculated;row.verified=false;row.autoVerified=false;
  row.manualVerified=false;row.confirmedOnPdf=false;row.changed=true;
  return {ok:true,message:"Total HT corrigé. Confirmez la ligne après vérification sur la facture."};
 }
 if(kind==="approve")return confirmRowManually(row);
 return {ok:false,message:"Action inconnue."};
}
function confirmRowManually(row){
 const product=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 if(!product||row.excluded)return {ok:false,message:"Choisissez un produit actif et non écarté avant de confirmer la ligne."};
 if(row.unit_label_conflict)return {ok:false,message:row.unit_label_note+" Corrigez la quantité ou l’unité d’après le PDF avant validation."};
 if(!accounting&&(!(amount(row.stock_quantity)>0)||(row.stock_needs_review&&!row.stock_confirmed))&&!row.stock_manual&&!confirmStockProposal(row))
  return {ok:false,message:stockProposal(row)?
   "Quantité en stock non confirmée. Vérifiez le conditionnement ou indiquez le nombre réel à réceptionner.":
   "Renseignez l'entrée en stock manuellement : impossible de déduire une conversion fiable de cette facture."};
 if(!accounting&&row.stock_manual&&row.stock_needs_review&&!row.stock_confirmed){
  if(!(amount(row.stock_quantity)>0))return {ok:false,message:"Renseignez une quantité de stock positive."};
  if(!confirm("Confirmer la quantité de stock saisie manuellement : "+row.stock_quantity+" pour "+row.product_label+" après vérification du conditionnement ?"))
   return {ok:false,quiet:true};
  row.stock_confirmed=true;
 }
 const a=invoiceArithmetic(row);
 if(a.incomplete||!String(row.description||"").trim()||!String(row.unit||"").trim())
  return {ok:false,message:"Désignation, unité, quantité, prix unitaire et total HT doivent être renseignés."};
 if(!a.valid){
  if(!confirm("Écart de montant : "+fmt(a.calculated)+" calculés pour "+fmt(a.total)+" facturés. Confirmez uniquement la lecture du PDF ? Cette ligne restera orange et la validation finale sera bloquée jusqu'à correction."))
   return {ok:false,quiet:true};
  row.verified=true;row.autoVerified=false;row.manualVerified=false;row.confirmedOnPdf=true;
  return {ok:true,partial:true,message:"Lecture du PDF confirmée. Corrigez l'écart de montant avant l'enregistrement de la facture."};
 }
 row.verified=true;row.autoVerified=false;row.manualVerified=true;row.confirmedOnPdf=false;row.changed=false;
 return {ok:true,partial:false,message:"Ligne validée manuellement. Elle passe au vert."};
}
function autoVerifyGreenRows(){
 for(const row of rows){
  const green=productColor(row)==="good";
  if(row.autoVerified&&!green){row.autoVerified=false;row.verified=false}
  if(green&&!row.verified){row.verified=true;row.autoVerified=true}
 }
}
function keywordNotebook(row,index){
 const wrap=document.createElement("details");wrap.className="keyword-notebook";
 const product=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 const title=document.createElement("summary");
 title.textContent="Carnet de mots-clés"+(product?" — "+product.code:" — sélectionnez d'abord un produit");
 wrap.append(title);
 if(!product){
  const hint=document.createElement("p");hint.textContent="Associez cette ligne à un produit actif pour enregistrer une nouvelle appellation.";wrap.append(hint);return wrap;
 }
 const known=aliases.filter(a=>a.product_id===product.id);
 const list=document.createElement("div");list.className="keyword-list";
 if(!known.length){const empty=document.createElement("span");empty.textContent="Aucun mot-clé enregistré pour ce produit.";empty.className="subtle";list.append(empty)}
 for(const alias of known){
  const item=document.createElement("div");item.className="keyword-entry";
  const label=document.createElement("span");label.textContent=(alias.alias_kind==="reference"?"Référence fournisseur : ":"Désignation : ")+alias.keyword+(alias.supplier_key?" · fournisseur":" · global");
  const remove=document.createElement("button");remove.type="button";remove.className="btn secondary small";remove.textContent="Supprimer";
  remove.disabled=saved;
  remove.addEventListener("click",async()=>{
   if(!confirm("Supprimer définitivement ce mot-clé du carnet ?"))return;
   remove.disabled=true;
   try{await deleteKeyword(alias.id);notice("Mot-clé supprimé.","success");renderRows()}
   catch(e){notice("Suppression impossible : "+e.message,"error");remove.disabled=false}
  });
  item.append(label,remove);list.append(item);
 }
 wrap.append(list);
 const form=document.createElement("div");form.className="keyword-form";
 const input=document.createElement("input");input.type="text";input.maxLength=160;input.value=row.description||"";
 input.placeholder="Nouvelle appellation ou mot-clé";input.setAttribute("aria-label","Mot-clé du produit");
 const button=document.createElement("button");button.type="button";button.className="btn secondary small";button.textContent="Mémoriser";
 button.disabled=saved;
 button.addEventListener("click",async()=>{
  if(!input.value.trim())return notice("Renseignez le mot-clé à mémoriser.","error");
  button.disabled=true;
  try{await saveKeyword(row,input.value.trim());notice("Nouvelle appellation mémorisée pour "+product.code+".","success");renderRows()}
  catch(e){notice("Mot-clé non enregistré : "+e.message,"error");button.disabled=false}
 });
 form.append(input,button);wrap.append(form);
 const note=document.createElement("p");note.className="subtle";note.textContent="Par défaut, mot-clé lié au fournisseur de cette facture. Une correspondance complète sera réutilisée sur les prochaines factures.";wrap.append(note);
 return wrap;
}
function pdfPageForRow(row){
 const candidates=[row.sourceBox,row.boxes?.description?.box,row.boxes?.reference?.box,row.boxes?.quantity?.box,row.boxes?.unit_price?.box,row.boxes?.total?.box];
 const found=candidates.find(box=>Array.isArray(box)&&box.length===5&&Number.isInteger(Number(box[0]))&&Number(box[0])>=0);
 if(!found)return null;
 const raw=Number(found[0]),page=raw===0?1:raw;
 const count=Number(documentData?.page_count);
 return page>=1&&(!Number.isInteger(count)||count<=0||page<=count)?page:null;
}
function viewPdfLine(row,index){
 if(!objectUrl||!file)return notice("Le PDF original n’est plus disponible.","error");
 const dialog=$("pdfCompare");
 if(!dialog||typeof dialog.showModal!=="function")return notice("La fenêtre de comparaison n’est pas disponible sur ce navigateur.","error");
 const page=pdfPageForRow(row);
 $("pdfCompareTitle").textContent="Comparer la ligne "+(index+1)+" avec la facture";
 $("pdfComparePage").textContent=page?"Page "+page+" suggérée par Veryfi (si le lecteur PDF le permet)":"Page non localisée automatiquement : recherchez la ligne dans le PDF.";
 const fields=$("pdfCompareFields");fields.replaceChildren();
 const values=[
  ["Désignation",row.description],
  ["Référence fournisseur",row.reference],
  ["Quantité facturée",row.quantity],
  ["Unité facturée",row.unit],
  ["Prix unitaire HT",row.unit_price],
  ["Total HT",row.total],
  ["Produit associé",row.product_label],
  ["État de la ligne","Orange — vérification requise"]
 ];
 for(const [name,value] of values){
  const pair=document.createElement("div");pair.className="pdf-compare-field";
  const key=document.createElement("dt");key.textContent=name;
  const val=document.createElement("dd");val.textContent=String(value??"")||"Non renseigné";
  pair.append(key,val);fields.append(pair);
 }
 $("pdfCompareReason").textContent=reviewReason(row);
 $("pdfCompareViewer").src=objectUrl+(page?"#page="+page:"");
 dialog.showModal();
}
function buildLine(row,index){
 const card=document.createElement("article");card.className="row";card.dataset.index=String(index);
 const heading=document.createElement("div");heading.className="row-head";
 const score=typeof row.score==="number"&&Number.isFinite(row.score)?Math.floor(row.score*100+1e-8):null;
 const color=productColor(row);
 const label=color==="bad"?"Hors catalogue":color==="good"?(row.manualVerified?"Validée manuellement":"Validée automatiquement"):"À contrôler";
 heading.innerHTML='<div class="row-headline"><span class="row-number">LIGNE '+(index+1)+'</span><strong>'+esc(row.description||"Désignation manquante")+'</strong></div><span class="score '+color+'">'+(score==null?"Confiance inconnue":score+" %")+' · '+label+'</span>';
 card.append(heading);
 const fields=document.createElement("div");fields.className="row-grid";
 const productForUnit=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 const storageLabel=productForUnit?(productForUnit.stock_count_mode==="litre"?"litres":productForUnit.inventory_unit_label||productForUnit.unit):"unité non définie";
 const definitions=[["reference","Référence fournisseur","text"],["description","Désignation","text","wide"],["quantity","Quantité facturée","number"],["unit","Unité facturée","text"],["unit_price","Prix unitaire HT","number"],["total","Total HT","number"],["tax_rate","TVA (%)","number"],["product_label","Produit du catalogue","text","wide"],["stock_quantity","Entrée en stock ("+storageLabel+")","number"],["account","Compte de charge proposé","text"]];
 for(const [key,title,type,wide] of definitions){
  const label=document.createElement("label");label.className="field"+(wide?" "+wide:"");
  const span=document.createElement("span");span.textContent=title;label.append(span);
  const input=document.createElement("input");input.dataset.key=key;input.type=type;input.autocomplete="off";
  input.value=row[key]??"";
  if(type==="number"){input.type="text";input.inputMode="decimal"}
  if(key==="product_label")input.setAttribute("list","productOptions");
  if(key==="account")input.setAttribute("list","accountOptions");
  input.addEventListener("change",()=>changeRow(index,key,input.value));
  label.append(input);fields.append(label);
 }
 card.append(fields);
 const meta=document.createElement("div");meta.className="mapping";
 meta.textContent=color==="bad"?(row.stock_note||"Aucune réception automatique autorisée"):(row.reason+(row.stock_note?" · "+row.stock_note:"")+(row.account_source?" · Charge : "+row.account_source:""));
 if((row.unit_label_source||row.unit_label_conflict)&&row.unit_label_note)meta.textContent+=" · "+row.unit_label_note;
 card.append(meta);
 const matchedProduct=(catalog?.products||[]).find(p=>p.id===row.product_id&&p.active!==false);
 if(matchedProduct){
  const packaging=document.createElement("div");packaging.className="product-packaging";
  const sale=String(matchedProduct.conditionnement||"").trim();
  const stock=String(matchedProduct.inventory_unit_label||(matchedProduct.stock_count_mode==="litre"?"litre":matchedProduct.unit)||"").trim();
  const info=document.createElement("span");
  info.textContent="Vente : "+(sale||"non renseigné")+" · Stock : "+(stock||"non renseigné")+" · 1 acheté = "+(matchedProduct.purchase_to_stock_factor||1)+" en stock";
  const link=document.createElement("a");
  link.href="../college/admin/?page=products&product="+encodeURIComponent(matchedProduct.id);
  link.target="_blank";link.rel="noopener noreferrer";link.textContent="Modifier les conditionnements";
  packaging.append(info,link);
  card.append(packaging);
 }
 if(color==="bad"){
  const reason=document.createElement("div");
  reason.className="row-error";
  reason.textContent="Cause du blocage : "+reviewReason(row);
  card.append(reason);
  const open=document.createElement("a");open.className="btn secondary small";open.href="../college/admin/?page=products";open.target="_blank";open.rel="noopener noreferrer";open.textContent="Ouvrir le catalogue pour créer ou retrouver le produit";card.append(open);
 }
 if(color==="warn"){
  const reason=document.createElement("div");
  reason.className="row-warning";
  reason.textContent="À contrôler : "+reviewReason(row);
  card.append(reason);
  const view=document.createElement("button");view.type="button";view.className="btn secondary small pdf-line-button";
  view.dataset.action="view-pdf";view.textContent="Voir PDF";
  view.setAttribute("aria-label","Voir le PDF original pour comparer la ligne "+(index+1));
  view.addEventListener("click",()=>viewPdfLine(row,index));
  card.append(view);
 }
 if(color==="good"){
  const approved=document.createElement("div");
  approved.className="row-approved";
  approved.textContent=row.manualVerified?"Produit et quantités confirmés manuellement. Cette ligne est validée.":"Ligne contrôlée automatiquement (confiance des champs critiques ≥ 90 %, produit actif et montants cohérents).";
  card.append(approved);
 }
 if(color==="warn"&&!row.excluded&&!saved){
  const actions=quickFixOptions(row);
  if(actions.length){
   const fixes=document.createElement("div");fixes.className="quick-fixes";
   for(const action of actions){
    const btn=document.createElement("button");btn.type="button";
    btn.className="btn secondary small";btn.textContent=action.label;
    btn.addEventListener("click",()=>{
     const result=applyQuickFix(row,action.kind);
     if(!result.quiet)notice(result.message,result.ok&&!result.partial?"success":result.ok?"":"error");
     if(result.ok)$("confirmReview").checked=false;
     renderRows();
    });
    fixes.append(btn);
   }
   card.append(fixes);
  }
 }
 const foot=document.createElement("div");foot.className="row-foot";
 foot.innerHTML='<label><input type="checkbox" data-choice="verified" '+(row.verified?"checked":"")+'> '+(row.autoVerified?"Validée automatiquement":row.manualVerified?"Validée manuellement":row.confirmedOnPdf?"Lecture confirmée — corriger l’écart":"Confirmer après vérification du PDF")+'</label><label><input type="checkbox" data-choice="excluded" '+(row.excluded?"checked":"")+'> Écarter de la réception</label><button class="btn secondary" type="button" data-choice="remove">Supprimer la ligne</button>';
 foot.querySelector('[data-choice="verified"]').addEventListener("change",e=>{
  if(e.target.checked){
   const result=confirmRowManually(row);
   if(!result.quiet)notice(result.message,result.ok&&!result.partial?"success":result.ok?"":"error");
  }else{
   row.verified=false;row.autoVerified=false;row.manualVerified=false;row.confirmedOnPdf=false;row.changed=true;
  }
  $("confirmReview").checked=false;renderRows();
 });
 foot.querySelector('[data-choice="excluded"]').addEventListener("change",e=>{row.excluded=e.target.checked;row.verified=false;row.autoVerified=false;row.manualVerified=false;row.confirmedOnPdf=false;row.changed=true;$("confirmReview").checked=false;renderRows()});
 foot.querySelector('[data-choice="remove"]').addEventListener("click",()=>{if(!confirm("Retirer cette ligne de la réception ? Le montant reste compté dans le rapprochement avec le PDF original."))return;if(!row.userAdded)removedRows.push({total:row.total,tax_rate:row.tax_rate});rows.splice(index,1);$("confirmReview").checked=false;renderRows()});
 card.append(foot);card.append(keywordNotebook(row,index));card.classList.toggle("excluded",row.excluded);
 card.classList.add(productColor(row));
 return card;
}
function changeRow(index,key,value){
 const row=rows[index];if(!row||saved)return;
 row[key]=value;if(["quantity","unit","description","unit_price","total"].includes(key))row.autoQuantityReconciled=false;row.changed=true;row.verified=false;row.autoVerified=false;row.manualVerified=false;row.confirmedOnPdf=false;$("confirmReview").checked=false;
 if(key==="reference"||key==="description"){
  if(key==="description"&&row.unit_label_source)row.unit="";
  if(key==="description"){const e=explicitInvoiceUnit(row);row.unit=e.unit;row.unit_label_note=e.note;row.unit_label_conflict=e.conflict;row.unit_label_source=e.fromLabel;row.unit_label_pair=e.pair||null}
  row.product_manual=false;row.stock_manual=false;row.account_manual=false;
  applyMatch(row,findProduct(row));
 }else if(key==="product_label"){
  const options=[...$("productOptions").options].filter(o=>o.value===value);
  const id=options.length===1?options[0].dataset.productId:null;
  const p=id?(catalog?.products||[]).find(x=>x.id===id&&x.active!==false):null;
  row.product_manual=!!p;row.stock_manual=false;
  applyMatch(row,p?{product:p,source:"Produit actif choisi manuellement"}:{product:null,source:"Produit absent ou désactivé : validation du stock bloquée"});
 }else if(key==="quantity"||key==="unit"){
  row.stock_manual=false;row.stock_confirmed=false;
  if(key==="quantity"&&row.unit_label_source)row.unit="";
  if(key==="quantity"){const e=explicitInvoiceUnit(row);row.unit=e.unit;row.unit_label_note=e.note;row.unit_label_conflict=e.conflict;row.unit_label_source=e.fromLabel;row.unit_label_pair=e.pair||null}
  if(key==="unit"){row.unit_inferred=false;row.unit_label_source=false;row.unit_label_conflict=false;row.unit_label_note="";row.unit_label_pair=null}
  const proposed=stockSuggestion(row,(catalog?.products||[]).find(p=>p.id===row.product_id));
  row.stock_quantity=proposed.quantity;row.stock_note=proposed.note;row.stock_needs_review=proposed.needsReview===true;
 }else if(key==="stock_quantity"){
  row.stock_manual=true;row.stock_needs_review=true;row.stock_confirmed=false;
  row.stock_note="Quantité renseignée manuellement : confirmer la ligne après vérification du conditionnement";
 }
 else if(key==="account"){row.account_manual=true;row.account_source="Compte saisi manuellement : à vérifier"}
 renderRows();
}
function groupedRows(){
 const groups=[
  {status:"bad",label:"Produits rouges — À traiter",items:[]},
  {status:"warn",label:"Produits orange — À vérifier",items:[]},
  {status:"good",label:"Produits verts — comptés dans la réception",items:[]}
 ];
 rows.forEach((row,index)=>{
  const group=groups.find(g=>g.status===productColor(row));
  if(group)group.items.push({row,index});
 });
 return groups;
}
function renderRows(){
 const box=$("lines");box.replaceChildren();
 for(const group of groupedRows()){
  if(!group.items.length)continue;
  const section=document.createElement("section");section.className="status-group "+group.status;
  const header=document.createElement("div");header.className="status-group-header";
  const title=document.createElement("h4");title.textContent=group.label;
  const count=document.createElement("span");count.className="status-group-count";
  count.textContent=group.items.length+" produit"+(group.items.length>1?"s":"");
  header.append(title,count);section.append(header);
  const cards=document.createElement("div");cards.className="status-group-rows";
  group.items.forEach(({row,index})=>cards.append(buildLine(row,index)));
  section.append(cards);box.append(section);
 }
 updateTotals();
}
function addLine(){
 if(!documentData||saved)return;
 rows.push({...makeRow({},rows.length),userAdded:true});$("confirmReview").checked=false;renderRows();
}
function eligible(row){
 if(row.excluded)return false;
 const q=amount(row.quantity),p=amount(row.unit_price),t=amount(row.total);
 return !!row.description&&q!=null&&q>0&&p!=null&&p>=0&&t!=null&&t>=0&&Math.abs(round(q*p)-t)<=.02;
}
function isRetainedGreen(row){
 return !row.excluded&&row.verified===true&&productColor(row)==="good";
}
function detectHeaderHtCorrection(ocrHt,vat,ttc,totals){
 if(ocrHt===null||vat===null||ttc===null||vat<0||ttc<=0||!totals.length)return null;
 const values=totals.map(amount);
 if(values.some(v=>v===null||v<0))return null;
 const fromGross=round(ttc-vat),fromLines=round(values.reduce((sum,value)=>sum+value,0));
 if(fromGross<=0||Math.abs(fromGross-fromLines)>.02||Math.abs(ocrHt-fromGross)<=.02)return null;
 return {before:ocrHt,after:fromGross,fromLines};
}
function repairHeaderFromTotals(){
 if(accounting||saved||headerEdited||headerAutoCorrection||!documentData)return;
 const correction=detectHeaderHtCorrection(
  amount($("subtotal").value),amount($("tax").value),amount($("total").value),
  [...rows,...removedRows].map(row=>row.total)
 );
 if(!correction)return;
 $("subtotal").value=String(correction.after);
 headerAutoCorrection=correction;
 $("confirmReview").checked=false;
}
function calc(){
 const included=rows.filter(r=>!r.excluded&&(accounting||isRetainedGreen(r)));
 const pending=accounting?[]:rows.filter(r=>!r.excluded&&!isRetainedGreen(r));
 const excluded=rows.filter(r=>r.excluded);
 const sum=round(included.reduce((n,r)=>n+(amount(r.total)||0),0));
 const discardedRows=[...excluded,...removedRows,...pending];
 const discarded=round(discardedRows.reduce((n,r)=>n+(amount(r.total)||0),0));
 const discardedInvalid=discardedRows.some(r=>amount(r.total)===null||amount(r.total)<0);
 const reconciledSum=round(sum+discarded);
 const adjusted=!accounting&&discardedRows.length>0;
 const ht=amount($("subtotal").value),vat=amount($("tax").value),ttc=amount($("total").value);
 const missing=included.filter(r=>!eligible(r));
 const unmatched=accounting?[]:included.filter(r=>!r.product_id||!(amount(r.stock_quantity)>0)||(r.stock_needs_review&&!r.stock_confirmed));
 const unverified=included.filter(r=>!r.verified);
 const discrepancy=ht==null||(!accounting&&discardedInvalid)||Math.abs((accounting?sum:reconciledSum)-ht)>.02;
 const grossMismatch=ht!=null&&vat!=null&&ttc!=null&&Math.abs(round(ht+vat)-ttc)>.02;
 const taxFor=r=>{const net=amount(r.total),rate=amount(r.tax_rate);return net===null||rate===null||rate<0||rate>100?null:round(net*rate/100)};
 const vatKnown=included.length>0&&included.every(r=>taxFor(r)!==null);
 const selectedVat=vatKnown?round(included.reduce((n,r)=>n+taxFor(r),0)):null;
 const selectedTtc=selectedVat===null?null:round(sum+selectedVat);
 const ok=!!documentData&&!!file&&!saved&&included.length>0&&(accounting||pending.length===0)&&!missing.length&&!unmatched.length&&!unverified.length&&!discrepancy&&!grossMismatch&&ht!=null&&vat!=null&&ttc!=null&&!!$("vendor").value.trim()&&!!$("invoiceNumber").value.trim()&&/^\d{4}-\d{2}-\d{2}$/.test($("invoiceDate").value);
 return {ok,included,pending,sum,ht,vat,ttc,discrepancy,grossMismatch,missing,unmatched,unverified,adjusted,discarded,discardedInvalid,reconciledSum,selectedVat,selectedTtc,excludedCount:excluded.length,removedCount:removedRows.length};
}
function updateTotals(){
 if(!documentData)return;
 repairHeaderFromTotals();
 const correctionNote=$("headerRepairNote");
 correctionNote.hidden=!headerAutoCorrection||accounting;
 if(headerAutoCorrection&&!accounting){
  correctionNote.textContent="Correction de lecture HT : Veryfi a détecté "+fmt(headerAutoCorrection.before)+", mais le total des lignes et le calcul TTC − TVA donnent tous deux "+fmt(headerAutoCorrection.after)+". Le HT a été rectifié automatiquement ; vérifiez ce montant sur le PDF original avant de valider.";
 }
 const c=calc();
 const autoApproved=rows.filter(r=>r.autoVerified&&r.verified&&!r.excluded).length;
 $("metrics").innerHTML=accounting?
   '<div class="metric"><span>Validées automatiquement</span><strong>'+autoApproved+' / '+rows.length+'</strong></div><div class="metric"><span>À vérifier</span><strong>'+new Set([...c.unverified,...c.missing,...c.unmatched]).size+'</strong></div><div class="metric"><span>Écart HT du PDF</span><strong>'+(c.ht==null?"—":fmt(round(c.sum-c.ht)))+'</strong></div>':
   '<div class="metric"><span>Lignes vertes retenues</span><strong>'+c.included.length+'</strong></div><div class="metric"><span>Rouges / orange en attente</span><strong>'+c.pending.length+'</strong></div><div class="metric"><span>Total HT vert</span><strong>'+fmt(c.sum)+'</strong></div>';
  const retained=$("retainedAmounts");retained.hidden=accounting;
  if(!accounting){
    retained.className="reconciliation good";
    retained.textContent="Lignes vertes uniquement : HT "+fmt(c.sum)+" · TVA calculée "+fmt(c.selectedVat)+" · TTC calculé "+fmt(c.selectedTtc)+(c.selectedVat===null?" (taux de TVA d’une ligne verte à vérifier)":"")+" · "+c.pending.length+" ligne(s) rouge(s)/orange(s) non comptée(s). Chaque ligne passée au vert s’ajoute immédiatement. Les montants du PDF original restent inchangés.";
  }
 const errors=[];
 if(!c.included.length)errors.push(accounting?"Aucune ligne retenue":"Aucune ligne verte validée pour la réception");
 if(c.discardedInvalid&&!accounting)errors.push("Montant d’une ligne en attente, écartée ou supprimée illisible : le PDF reste à rapprocher");
  if(c.discrepancy)errors.push("Le total de toutes les lignes lues ne correspond pas au HT du PDF original");
 if(c.grossMismatch)errors.push("HT + TVA différent du TTC");
 if(c.missing.length)errors.push(c.missing.length+" ligne(s) incompletes ou incohérentes");
 if(c.unmatched.length)errors.push(c.unmatched.length+" ligne(s) sans produit actif ou quantité de stock confirmée");
 if(c.unverified.length)errors.push(c.unverified.length+" ligne(s) non vérifiées");
 if(c.pending.length&&!accounting)errors.push(c.pending.length+" ligne(s) rouge(s)/orange(s) encore à traiter avant validation finale.");
 // Les lignes écartées ou supprimées sont informatives si le total original est reconstitué.
 $("reconciliation").className="reconciliation "+(!accounting&&c.pending.length?"":errors.length?"bad":"good");
 const explanation=c.adjusted?" Réception partielle : "+c.pending.length+" ligne(s) encore à vérifier, "+c.removedCount+" supprimée(s), "+c.excludedCount+" écartée(s).":"";
  $("reconciliation").textContent="HT du PDF : "+fmt(c.ht)+" · HT retenu : "+fmt(c.sum)+" · HT écarté : "+fmt(c.discarded)+" · HT rapproché : "+fmt(c.reconciledSum)+"."+explanation+(errors.length?" Contrôles : "+errors.join(" ; "):" Totaux rapprochés. Contrôle des lignes terminé.");
 $("save").disabled=!c.ok||!$("confirmReview").checked||loading;
 $("saveHelp").textContent=saved?"Facture enregistrée.":c.pending.length&&!accounting?"Total vert actualisé. Passez les autres lignes au vert ou écartez-les avant validation définitive (anti-doublon PDF).":c.ok?(c.adjusted?"Réception partielle : seuls les produits verts seront ajoutés au stock.":"Cochez la confirmation pour autoriser la validation."):"Vérifiez les lignes vertes et rapprochez le PDF avant l’enregistrement.";
}
async function digest(bytes){
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}
async function save(){
 const c=calc();
 if(!c.ok||!$("confirmReview").checked)return notice("La facture n’est pas prête : contrôles incomplets.","error");
 if(!confirm(accounting?"Enregistrer cette facture en Comptabilité pour contrôle, sans la valider définitivement ?":c.pending.length?"Il reste "+c.pending.length+" ligne(s) rouge(s)/orange(s). Elles ne seront PAS ajoutées au stock. Après validation, elles ne pourront pas être ajoutées depuis le même PDF (protection anti-doublon). Si vous souhaitez les ajouter plus tard, annulez et passez-les au vert d’abord. Confirmer la réception partielle ?":c.adjusted?"Valider cette réception partielle ? Seuls les produits verts seront ajoutés au stock. Les montants et le PDF d’origine restent conservés.":"Valider cette facture ? Les produits verts seront ajoutés au stock et transmis à Commandes et Achats."))return;
 const bytes=new Uint8Array(await file.arrayBuffer());loading=true;$("save").disabled=true;notice("Enregistrement sécurisé en cours…");
 try{
  if(accounting){
   const fd=new FormData();
   fd.append("file",file);fd.append("supplier",$("vendor").value.trim());
   fd.append("invoice_number",$("invoiceNumber").value.trim());fd.append("invoice_date",$("invoiceDate").value);
   fd.append("amount_ht",String(c.ht));fd.append("amount_vat",String(c.vat));fd.append("amount_ttc",String(c.ttc));
   fd.append("vat_rate","");fd.append("raw_text",JSON.stringify({provider:"veryfi",document_id:documentData.id,lines:c.included.map(r=>({reference:r.reference,description:r.description,quantity:amount(r.quantity),unit:r.unit,unit_price:amount(r.unit_price),total:amount(r.total),account:r.account}))}));
   const response=await fetch(API.accounting+"?action=upload",{method:"POST",headers:{authorization:"Bearer "+authToken},body:fd,cache:"no-store",signal:AbortSignal.timeout(80000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Import comptable refusé : HTTP "+response.status);
   saved=true;notice("Facture enregistrée en Comptabilité. Statut : à contrôler. Aucune écriture comptable validée automatiquement.","success");
   $("saveResult").textContent="Document "+(data.item?.id||"")+" · Vérification comptable requise avant validation.";
  }else{
   if(!catalog)throw Error("Catalogue central indisponible.");
   const items=c.included.map(r=>{
    const product=catalog.products.find(p=>p.id===r.product_id);
    return {product_id:product?.id,stock_quantity:amount(r.stock_quantity),
      invoice_quantity:amount(r.quantity),delivered_quantity:amount(r.quantity),
      invoice_unit:r.unit,delivered_unit:r.unit,detected_label:r.description,detected_reference:r.reference,
      unit_price_ht:amount(r.unit_price),line_total_ht:amount(r.total),vat_rate:amount(r.tax_rate),verified:true};
   });
   if(items.some(x=>!x.product_id||!(x.stock_quantity>0)))throw Error("Une ou plusieurs quantités de stock sont manquantes.");
   const data=await request(API.finalize,{method:"POST",payload:{file_hash:await digest(bytes),file_name:file.name,pdf_base64:encode(bytes),supplier:$("vendor").value.trim(),
    supplier_key:supplierNorm(),invoice_number:$("invoiceNumber").value.trim(),invoice_date:$("invoiceDate").value,expected_ht:c.sum,
    raw_text:JSON.stringify({provider:"veryfi",document_id:documentData.id,original_invoice:{ht:c.ht,vat:c.vat,ttc:c.ttc},ocr_subtotal:amount(documentData.subtotal),auto_corrected_subtotal:headerAutoCorrection!==null,retained_ht:c.sum,discarded_ht:c.discarded,removed_lines:c.removedCount,excluded_lines:c.excludedCount,pending_lines:c.pending.length,partial_reception:c.adjusted}),items},timeout:80000});
   if(data.ok!==true)throw Error(data.error||"Validation rejetée");
   saved=true;notice(c.adjusted?"Réception partielle enregistrée. Seuls les produits verts ont été ajoutés au stock ; PDF original archivé.":"Facture validée. Commandes, achats et stocks synchronisés.","success");
   $("saveResult").textContent="Commande CMD-"+String(data.order_no||"").padStart(6,"0")+" · "+(data.stock_products||0)+" produit(s) enregistré(s) · HT retenu "+fmt(c.sum)+(c.adjusted?" (réception partielle)":"")+".";
  }
  lockFields();$("newDocument").hidden=false;
 }catch(e){notice("Enregistrement refusé : "+e.message,"error");$("saveResult").textContent=e.message}
 finally{loading=false;updateTotals()}
}
function lockFields(){
 $("results").querySelectorAll("input,button").forEach(el=>{if(el.id!=="newDocument"&&el.dataset.action!=="view-pdf")el.disabled=true});
}
function setup(){
 setScope();
 $("pdfCompareClose").addEventListener("click",()=>$("pdfCompare").close());
 $("pdfCompare").addEventListener("close",()=>$("pdfCompareViewer").removeAttribute("src"));
 const drop=$("drop"),input=$("file");
 drop.addEventListener("click",()=>{if(!loading)input.click()});
 drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!loading)input.click()}});
 drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag")});
 drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
 drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");if(!loading)setFile(e.dataTransfer.files?.[0])});
 input.addEventListener("change",()=>setFile(input.files?.[0]));
 $("clearFile").addEventListener("click",()=>{input.value="";setFile(null)});
 $("analyze").addEventListener("click",analyze);
 $("refreshSession").addEventListener("click",resolveSession);
 $("reloadCatalog").addEventListener("click",async()=>{
  const button=$("reloadCatalog");button.disabled=true;
  try{
   if(!authToken)throw Error("Session expirée : reconnectez-vous avant d'actualiser les conditionnements.");
   await loadCatalog();
   if(!catalog)throw Error("Impossible de récupérer le catalogue.");
   notice("Conditionnements actualisés depuis l'administration. Aucune lecture Veryfi supplémentaire.","success");
  }catch(e){notice(e.message,"error")}
  finally{button.disabled=false}
 });
 $("quotaSave").addEventListener("click",()=>{
  const raw=$("quotaInput").value.trim(),q=Number(raw);
  if(!raw||!Number.isInteger(q)||q<1||q>1000000)return notice("Saisissez un quota mensuel entier positif.","error");
  if(confirm("Enregistrer "+q+" lectures comme quota mensuel local ? Cela ne change pas l’abonnement Veryfi."))configureQuota(q);
 });
 $("quotaClear").addEventListener("click",()=>{
  if(confirm("Effacer le quota mensuel local ? Le compteur d'utilisation sera conservé."))configureQuota(null);
 });
 $("addLine").addEventListener("click",addLine);
 $("save").addEventListener("click",save);
 $("confirmReview").addEventListener("change",updateTotals);
 for(const key of ["vendor","invoiceNumber","invoiceDate","subtotal","tax","total"])
  $(key).addEventListener("change",()=>{if(key==="subtotal"){headerEdited=true;headerAutoCorrection=null}if(key==="vendor"){populateDatalists();rows.forEach(r=>{r.product_manual=false;r.account_manual=false;r.stock_manual=false;r.product_id="";r.verified=false;r.autoVerified=false;r.manualVerified=false;r.confirmedOnPdf=false;r.changed=true});refreshMatches()}renderRows();$("confirmReview").checked=false;updateTotals()});
 $("newDocument").addEventListener("click",()=>{location.reload()});
 $("loginLink").addEventListener("click",e=>{if(file&&!confirm("La reconnexion rechargera la page. Le PDF devra être sélectionné de nouveau. Continuer ?"))e.preventDefault()});
 window.addEventListener("focus",()=>{
  if(!loading&&!saved&&file)resolveSession();
  else refreshUsage();
 });
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshUsage()});
 setInterval(refreshUsage,300000);
 window.addEventListener("pagehide",()=>{if(objectUrl)URL.revokeObjectURL(objectUrl)});
 resolveSession();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();