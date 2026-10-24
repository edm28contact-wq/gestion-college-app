(()=>{
"use strict";
const $=id=>document.getElementById(id),URL_CATALOG="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/invoice-central-catalog";
let catalog=null,lastText="";
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
    fillAccounts();showProfiles();if(lastText)analyze();return;
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
 const t=norm(text).replace(/\s+/g," ");
 const list=[...(catalog?.accounting_layouts||[])].sort((a,b)=>String(b.supplier_name||"").length-String(a.supplier_name||"").length);
 const hits=list.map(p=>{const names=[p.supplier_name,...(p.detection_tokens||[])].filter(Boolean);return {p,score:names.reduce((v,name)=>{const n=norm(name);return n.length>=4&&t.includes(n)?Math.max(v,n.length):v},0)}}).filter(x=>x.score).sort((a,b)=>b.score-a.score);
 // Reject a supplier inferred from a common word without any distinctive signature.
 const top=hits[0];return top&&top.score>=5?top.p:null;
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
 const rules=(catalog.supplier_rules||[]).filter(r=>norm(r.supplier_key||r.supplier_name).replace(/\s/g,"")===norm(profile.supplier_key).replace(/\s/g,""));
 if(rules.length!==1)return;
 const r=rules[0];if(r.supplier_account)$("supplierAccount").value=r.supplier_account;
 const accounts=(catalog.supplier_charges||[]).filter(x=>x.supplier_rule_id===r.id&&x.active!==false);
 const account=accounts.length===1?accounts[0].expense_account:(accounts.filter(x=>x.is_default).length===1?accounts.find(x=>x.is_default).expense_account:r.expense_account);
 if(account&&[...$("chargeAccount").options].some(o=>o.value===account))$("chargeAccount").value=account;
}
function analyze(){
 const text=$("sourceText").value;if(!text.trim())return msg("Aucun texte : importez un PDF ou collez la transcription.",true);
 lastText=text;const profile=identify(text);
 if(profile){$("supplierMatch").value=profile.supplier_name;suggestAccount(profile)}
 $("layoutInfo").textContent=profile?"Fournisseur détecté : "+profile.supplier_name+" · modèle "+profile.layout_type+" · validation obligatoire.":"Modèle fournisseur non reconnu : saisie manuelle nécessaire.";
 showProfiles(profile);
 $("docType").value=classify(text,$("invoicePdf").files?.[0]?.name||"");
 $("invoiceNumber").value=guessInvoiceNumber(text);
 const date=guessInvoiceDate(text);if(date)$("invoiceDate").value=date;
 // Prefer document-level totals; never sum every amount on a utilities bill.
 setAmount("totalHT",findMoney(text,[/(?:total\s*(?:net\s*)?(?:facture\s*)?(?:h\.?\s*t\.?|hors\s*taxes?)|montant\s*hors\s*tva)\s*[: ]+(-?[\d\s.,]+)\s*(?:€|eur)?/i,/(?:montant\s*ht)\s*[: ]+(-?[\d\s.,]+)\s*(?:€|eur)?/i]));
 setAmount("totalVAT",findMoney(text,[/(?:total\s*t\.?\s*v\.?\s*a\.?|montant\s*tva(?:\s*\([^)]*\))?)\s*[: ]+(-?[\d\s.,]+)\s*(?:€|eur)?/i]));
 setAmount("totalTTC",findMoney(text,[/(?:total\s*g[eé]n[eé]ral|total\s*(?:net\s*)?t\.?\s*t\.?\s*c\.?|net\s*[àa]\s*payer|montant\s*ttc\s*[àa]\s*payer|somme\s*[àa]\s*payer\s*ttc|facture\s*ttc|net\s*[àa]\s*pr[eé]lever)\s*[: ]+(-?[\d\s.,]+)\s*(?:€|eur)?/i]));
 verify();msg(profile?"Profil proposé : "+profile.supplier_name+". Contrôlez les montants et le compte de charge.":"Fournisseur non identifié, veuillez remplir la fiche manuellement.");
}
function verify(){
 const ht=cleanAmount($("totalHT").value),vat=cleanAmount($("totalVAT").value),ttc=cleanAmount($("totalTTC").value),type=$("docType").value,errors=[];
 if([ht,vat,ttc].some(x=>x===null))errors.push("HT, TVA ou TTC manquant : ne pas valider sans document justificatif.");
 else if(Math.abs(Math.round((ht+vat-ttc)*100)/100)>.02)errors.push("Écart HT + TVA ≠ TTC : "+euro(ht+vat-ttc)+" €");
 if(["echeancier","recapitulatif"].includes(type))errors.push("Document non comptabilisable seul. Vérifiez les factures détaillées.");
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
 $("analyze").onclick=analyze;$("check").onclick=verify;$("copy").onclick=copy;$("refreshCatalog").onclick=loadCatalog;
 $("clear").onclick=()=>{$("sourceText").value="";lastText="";msg("Transcription effacée.")};
 document.addEventListener("invoice-pdf:replace",()=>{lastText="";$("sourceText").value="";msg("Extraction PDF en cours…")});
 document.addEventListener("invoice-pdf:partial",e=>{if(e.detail?.text)$("sourceText").value=e.detail.text});
 document.addEventListener("invoice-pdf:transcribed",e=>{const t=String(e.detail?.text||"");$("sourceText").value=t;lastText=t;if(t.trim())analyze();else msg("PDF sans texte : utilisez Forcer OCR.",true)});
 document.addEventListener("invoice-pdf:error",e=>msg("Erreur PDF : "+(e.detail?.message||"lecture impossible"),true));
 loadCatalog();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();