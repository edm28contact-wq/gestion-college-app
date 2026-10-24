(()=>{
"use strict";
const $=id=>document.getElementById(id),URL_CATALOG="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
let catalog=null,lastText="",chosenSupplierKey="";
const norm=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens=()=>["college_accounting_token","college_admin_token","edm_admin_token","holding_admin_token"].map(x=>localStorage.getItem(x)).filter(Boolean);
function msg(text,bad=false){$("status").textContent=text;$("status").className="status"+(bad?" err":"")}
function cleanAmount(s){if(!s)return null;const value=String(s).replace(/[\u00a0\u202f\s€]/g,"").replace(",",".");if(!/^-?\d+(?:\.\d{1,4})?$/.test(value))return null;return Number(value)}
function euro(x){return Number(x).toFixed(2).replace(".",",")}
async function loadCatalog(){
 $("catalogStatus").textContent="Lecture des profils comptables…";
 for(const token of tokens()){
  try{const r=await fetch(URL_CATALOG,{headers:{authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(14000)});
   if(!r.ok)continue;const data=await r.json();
   if(Array.isArray(data.accounting_layouts)){
    catalog=data;$("profileCount").textContent=data.accounting_layouts.length+" fournisseurs historiques";
    $("catalogStatus").textContent="Profils historiques chargés. La suggestion de compte est indicative.";
    fillAccounts();populateSuppliers();showProfiles();if(lastText)analyze();return;
   }
  }catch{}
 }
 $("catalogStatus").textContent="Profils indisponibles : connectez-vous d'abord à la Comptabilité. La transcription reste utilisable.";
}
function fillAccounts(){
 const select=$("chargeAccount"),previous=select.value;select.replaceChildren(new Option("À vérifier",""));
 for(const x of catalog?.accounts||[]){const code=x.account||"";if(!code.startsWith("6"))continue;select.add(new Option(code+" — "+x.label,code))}
 select.value=previous;
}
function identify(text){
 const header=String(text||"").split(/\n/).slice(0,32).join(" ");
 const t=norm(header),all=(catalog?.accounting_layouts||[]);
 const exact=[["henrijulien",/henri\s*julien|henrijulien/i],["passionfroid",/passion\s*froid|passionfroid/i],["lanormande",/la\s*normande/i],["freemobile",/free\s*mobile/i],["freepro",/free\s*pro|freebox\s*pro/i]];
 for(const [key,re] of exact)if(re.test(header)){const found=all.find(x=>x.supplier_key===key);if(found)return found}
 const hits=all.map(p=>{const names=[p.supplier_name,...(p.detection_tokens||[])].filter(Boolean);return {p,score:names.reduce((v,name)=>{const n=norm(name);if(n.length<5)return v;const pattern=new RegExp("(^|\\\\s)"+n.replace(/[.*+?^${}()|[\\]\\]/g,"\\\\$&").replace(/\\s+/g,"\\\\s+")+"(?=\\\\s|$)","i");return pattern.test(t)?Math.max(v,n.length):v},0)}}).filter(x=>x.score).sort((a,b)=>b.score-a.score);
 return hits[0]?.score>=5?hits[0].p:null;
}
function chooseSupplier(){
 const v=$("supplierSelect").value;
 const p=(catalog?.accounting_layouts||[]).find(x=>x.supplier_key===v);
 chosenSupplierKey=v;
 if(p){$("supplierMatch").value=p.supplier_name;showProfiles(p);$("layoutInfo").textContent="Modèle chargé : "+p.supplier_name+" · "+p.layout_type+" · "+p.documents_observed+" documents historiques. Après import, vérifiez les montants.";suggestAccount(p);if($("sourceText").value.trim())analyze();}
}
function populateSuppliers(){
 const control=$("supplierSelect"),old=control.value;control.replaceChildren(new Option("Détection depuis la facture",""));
 for(const p of (catalog?.accounting_layouts||[]).slice().sort((a,b)=>a.supplier_name.localeCompare(b.supplier_name,"fr")))control.add(new Option(p.supplier_name+" ("+p.documents_observed+")",p.supplier_key));
 if(old&&[...control.options].some(x=>x.value===old))control.value=old;
}
function findMoney(text,patterns){
 for(const pattern of patterns){const m=text.match(pattern);if(m){const amount=cleanAmount(m[1]);if(amount!==null)return amount}}
 return null;
}
function setAmount(id,val){if(val!==null)$(id).value=euro(val)}
function parseDate(d){
 const m=d.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(!m)return "";
 const year=m[3].length===2?"20"+m[3]:m[3],month=m[2].padStart(2,"0"),day=m[1].padStart(2,"0");
 const iso=year+"-"+month+"-"+day,x=new Date(iso+"T12:00:00Z");
 return Number.isFinite(x.getTime())&&x.toISOString().slice(0,10)===iso?iso:"";
}
function classify(text,filename=""){
 const t=norm(text+" "+filename);
 if(/\bavoir\b|note de credit|facture rectificative en credit/.test(t))return "avoir";
 if(/recapitulatif multilignes|recapitulatif de factures|synthese de plusieurs factures/.test(t))return "recapitulatif";
 if(/votre echeancier|echeancier de cotisations|avis d echeance/.test(t)&&!/facture\s*(n|no|numero)/.test(t))return "echeancier";
 return "facture";
}
function guessInvoiceNumber(text){
 const m=text.match(/(?:num[eé]ro\s+de\s+(?:la\s+)?facture|facture\s*(?:n[°ºo.]|num[eé]ro)?|n[°ºo]\s*de\s*facture)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{3,})/i);
 return m&&!/^(?:du|de|date|total)$/i.test(m[1])?m[1]:"";
}
function guessInvoiceDate(text){
 const match=text.match(/(?:date\s*(?:de\s*(?:la\s*)?facture)?|facture\s*(?:n[°ºo.]|num[eé]ro)?\s*[A-Z0-9./-]+\s*du)\s*[: ]\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
 return match?parseDate(match[1]):"";
}
function showProfiles(active=null){
 const el=$("profileList");el.replaceChildren();
 const list=(catalog?.accounting_layouts||[]);
 if(!list.length){el.textContent="Aucun profil chargé.";return}
 if(active){const p=document.createElement("p");p.textContent="Format : "+active.layout_type+" · "+active.documents_observed+" documents historiques · "+active.readable_text_count+" textuels · "+active.scan_count+" scans. Apprentissage indicatif, à contrôler.";el.append(p)}
 const matching=active?[active]:list.slice().sort((a,b)=>b.documents_observed-a.documents_observed).slice(0,12);
 const table=document.createElement("table"),head=document.createElement("tr");
 for(const label of ["Fournisseur","Modèle","PDF historiques","Scans"]){const th=document.createElement("th");th.textContent=label;head.append(th)}table.append(head);
 for(const p of matching){const tr=document.createElement("tr");for(const value of [p.supplier_name,p.layout_type,p.documents_observed,p.scan_count]){const td=document.createElement("td");td.textContent=value;tr.append(td)}table.append(tr)}el.append(table);
}
function suggestAccount(profile){
 if(!profile||!catalog)return;
 const rules=(catalog.supplier_rules||[]).filter(r=>norm(r.supplier_key||r.supplier_name).replace(/\s/g,"")===norm(profile.supplier_key).replace(/\s/g,"")||norm(r.supplier_name)===norm(profile.supplier_name));
 if(rules.length!==1)return;
 const r=rules[0];if(r.supplier_account)$("supplierAccount").value=r.supplier_account;
 const accounts=(catalog.supplier_charges||[]).filter(x=>x.supplier_rule_id===r.id&&x.active!==false);
 const account=accounts.length===1?accounts[0].expense_account:(accounts.filter(x=>x.is_default).length===1?accounts.find(x=>x.is_default).expense_account:r.expense_account);
 if(account&&[...$("chargeAccount").options].some(o=>o.value===account))$("chargeAccount").value=account;
}
function analyze(){
 const text=$("sourceText").value;if(!text.trim())return msg("Aucun texte : importez un PDF ou collez la transcription.",true);
 lastText=text;
 const detected=identify(text);
 const selected=(catalog?.accounting_layouts||[]).find(x=>x.supplier_key===chosenSupplierKey);
 const profile=selected||detected;
 if(selected&&detected&&selected.supplier_key!==detected.supplier_key)msg("Le fournisseur choisi diffère du nom détecté : vérifiez la facture.",true);
 if(profile){
  $("supplierMatch").value=profile.supplier_name;
  $("supplierSelect").value=profile.supplier_key;
  suggestAccount(profile);
 }
 showProfiles(profile);
 const engine=window.AccountingModelCore;
 const extraction=engine?.extract(text,profile)||null;
 if(extraction){
  $("invoiceNumber").value=extraction.number?.value||"";
  $("invoiceDate").value=extraction.date?.value||"";
  for(const [key,id] of [["ht","totalHT"],["vat","totalVAT"],["ttc","totalTTC"]]){
   $(id).value=extraction[key]?.value==null?"":euro(extraction[key].value);
  }
  const docTypes=["facture","avoir","recapitulatif","echeancier","non_facture","a_verifier"];
  $("docType").value=docTypes.includes(extraction.type)?extraction.type:"a_verifier";
  $("layoutInfo").textContent="Modèle : "+(profile?.supplier_name||"non reconnu")+" · "+(extraction.variant?.label||profile?.layout_type||"générique")+" · "+(extraction.issues.length?"à vérifier : "+extraction.issues.join(", "):"lecture cohérente, contrôle humain requis");
 }else{
  $("layoutInfo").textContent="Moteur de modèles indisponible. Saisissez les champs manuellement.";
  msg("Moteur de modèles indisponible. Aucune donnée extraite.",true);return;
 }
 verify();
 msg("Lecture effectuée selon "+(profile?.supplier_name||"un modèle générique")+" : "+(extraction.issues.length?extraction.issues.join(" · "):"champs proposés à vérifier avant validation")+".");
}
function verify(){
 const ht=cleanAmount($("totalHT").value),vat=cleanAmount($("totalVAT").value),ttc=cleanAmount($("totalTTC").value),type=$("docType").value,errors=[];
 if([ht,vat,ttc].some(x=>x===null))errors.push("HT, TVA ou TTC manquant : ne pas valider sans document justificatif.");
 else if(Math.abs(Math.round((ht+vat-ttc)*100)/100)>.02)errors.push("Écart HT + TVA ≠ TTC : "+euro(ht+vat-ttc)+" €");
 if(["echeancier","recapitulatif","non_facture"].includes(type))errors.push("Document non comptabilisable seul. Vérifiez les factures détaillées.");
 if(type==="avoir")errors.push("Avoir : vérifiez le signe, la facture d'origine et la ventilation.");
 if(!$("supplierMatch").value.trim())errors.push("Fournisseur non identifié.");
 if(!$("invoiceDate").value)errors.push("Date manquante.");
 if(!$("invoiceNumber").value.trim())errors.push("Numéro de facture manquant.");
 if(!$("chargeAccount").value)errors.push("Compte de charge non vérifié.");
 $("summary").textContent=errors.length?errors.join(" · "):"Calculs cohérents et champs renseignés. Vérification humaine obligatoire avant tout enregistrement.";
 $("summary").className="status "+(errors.length?"err":"ok");
 return !errors.length;
}
function copy(){verify();const fields=[["Fournisseur","supplierMatch"],["Document","docType"],["Numéro","invoiceNumber"],["Date","invoiceDate"],["Début période","periodStart"],["Fin période","periodEnd"],["HT","totalHT"],["TVA","totalVAT"],["TTC","totalTTC"],["Compte fournisseur","supplierAccount"],["Charge","chargeAccount"],["Journal","journal"]];const value=fields.map(([l,k])=>l+" : "+$(k).value).join("\n")+"\nContrôle : "+$("summary").textContent;navigator.clipboard.writeText(value).then(()=>msg("Fiche copiée. Aucun enregistrement comptable effectué.")).catch(()=>msg("Copie refusée par le navigateur.",true))}
function boot(){
 $("supplierSelect").onchange=chooseSupplier;
 $("analyze").onclick=analyze;$("check").onclick=verify;$("copy").onclick=copy;$("refreshCatalog").onclick=loadCatalog;
 $("clear").onclick=()=>{$("sourceText").value="";lastText="";msg("Transcription effacée.")};
 document.addEventListener("invoice-pdf:replace",()=>{lastText="";chosenSupplierKey="";$("supplierSelect").value="";$("supplierMatch").value="";$("invoiceNumber").value="";$("invoiceDate").value="";["totalHT","totalVAT","totalTTC","supplierAccount"].forEach(id=>$(id).value="");$("chargeAccount").value="";$("sourceText").value="";msg("Extraction PDF en cours…")});
 document.addEventListener("invoice-pdf:partial",e=>{if(e.detail?.text)$("sourceText").value=e.detail.text});
 document.addEventListener("invoice-pdf:transcribed",e=>{const t=String(e.detail?.text||"");$("sourceText").value=t;lastText=t;if(t.trim())analyze();else msg("PDF sans texte : utilisez Forcer OCR.",true)});
 document.addEventListener("invoice-pdf:error",e=>msg("Erreur PDF : "+(e.detail?.message||"lecture impossible"),true));
 loadCatalog();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();