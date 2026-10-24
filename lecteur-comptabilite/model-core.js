(function(g){"use strict";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),compact=s=>norm(s).replace(/\s+/g,"");
const money=s=>{if(!s)return null;let x=String(s).replace(/[ €¤\u00a0\u202f]/g,"").replace(",",".");return /^-?\d+(?:\.\d{1,3})?$/.test(x)?Number(x):null};
const dates=s=>{const m=String(s||"").match(/(\d{4})[-/.](\d\d)[-/.](\d\d)|(\d\d?)[/.](\d\d?)[/.](\d{2,4})|(\d\d?)\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d\d)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d\d?,?\s+20\d\d/i);if(!m)return "";let a,b,c;if(m[1]){a=+m[1];b=+m[2];c=+m[3]}else if(m[4]){c=+m[4];b=+m[5];a=+m[6];if(a<100)a+=2000}else if(m[7]){c=+m[7];b=["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"].indexOf(norm(m[8]))+1;a=+m[9]}else{const v=m[0].match(/([a-z]+)\s+(\d+),?\s+(20\d\d)/i);c=+v[2];a=+v[3];b=["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(v[1].toLowerCase())+1}const d=new Date(Date.UTC(a,b-1,c));return d.getUTCFullYear()===a&&d.getUTCMonth()===b-1&&d.getUTCDate()===c?[a,String(b).padStart(2,"0"),String(c).padStart(2,"0")].join("-"):""};
const amountPattern="(-?\\d{1,3}(?:[\\u00a0\\u202f ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2}|-?\\d{1,6})";
function getAmount(lines,patterns){for(const re of patterns){for(const line of lines){const m=line.match(re);if(m){const n=money(m[1]);if(n!==null)return {value:n,source:line}}}}return null}
function getNo(lines,patterns){for(const re of patterns){for(const line of lines){const m=line.match(re);if(m)return {value:m[1],source:line}}}return null}

// Backup calculations are suggestions, never accounting entries.
const cents=x=>Math.round(Number(x)*100),round=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
function fromTtc(ttc,rate){
 if(!Number.isFinite(ttc)||!Number.isFinite(rate)||rate<0||rate>25)return null;
 const gross=cents(ttc),base=Math.round(gross/(1+rate/100));
 return {ht:base/100,vat:(gross-base)/100,ttc:gross/100,rate};
}
function rateEvidence(text){
 const rates=new Set(),reg=/(?:\b(?:tva|taux\s+(?:de\s+)?tva|taxe\s+sur\s+la\s+valeur\s+ajout[eé]e)\s*[:(]?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%|\b(\d{1,2}(?:[,.]\d{1,2})?)\s*%\s*(?:de\s+)?tva\b)/gi;
 for(const m of String(text||"").matchAll(reg)){
  const rate=Number(String(m[1]||m[2]).replace(",","."));
  if(Number.isFinite(rate)&&rate>=0&&rate<=25)rates.add(rate);
 }
 return [...rates].sort((a,b)=>a-b);
}
function pomonaEvidence(text,ttc){
 if(!g.InvoiceTableurCore?.parse)return null;
 const invoice=g.InvoiceTableurCore.parse(text);
 const meta=invoice.meta||{},rows=invoice.rows||[];
 const rates=Object.values(meta.vat_rates||{}).filter(x=>typeof x==="number");
 const total=ttc?.value;
 if(Number.isFinite(meta.expected_ht)&&Number.isFinite(meta.expected_vat)&&Number.isFinite(total)&&Math.abs(round(meta.expected_ht+meta.expected_vat-total))<=.02){
  return {ht:{value:meta.expected_ht,source:"Tableau de TVA Pomona (document)"},vat:{value:meta.expected_vat,source:"Tableau de TVA Pomona (document)"},rates,kind:"tableau_tva",rowCount:rows.length};
 }
 const eligible=rows.length>0&&!invoice.unresolvedLines?.length&&rows.every(r=>g.InvoiceTableurCore.check(r).ok);
 if(eligible&&Number.isFinite(total)){
  const sum=round(rows.reduce((n,r)=>n+Number(r.total_ht||0),0));
  // Only accept when the calculated VAT agrees with a single proven VAT rate.
  const observed=[...new Set([...rates,...rateEvidence(text)])];
  const matches=observed.filter(rate=>Math.abs(sum+round(sum*rate/100)-total)<=.04);
  if(matches.length===1)return {ht:{value:sum,source:"Somme des "+rows.length+" lignes HT Pomona"},vat:{value:round(total-sum),source:"TTC moins lignes HT Pomona"},rates:observed,kind:"lignes_ht",rowCount:rows.length};
 }
 return {rates,kind:"unverified_lines",rowCount:rows.length};
}

const extract=(text,p)=>{
 const supplier=p?.supplier_key||"",lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.replace(/[\u00a0\u202f]/g," ").replace(/\s{2,}/g," ").trim()).filter(Boolean);
 const generic=[/num[eé]ro\s+de\s+(?:la\s+)?facture\s*[: ]+([\w./-]{3,})/i,/facture\s*n[°ºo.]?\s*[: ]+([\w./-]{3,})/i,/invoice\s+number\s+([\w-]{4,})/i];
 const specific={freepro:[/\b\d\d\/\d\d\/20\d\d\s+(F\d{9,})/],freemobile:[/facture\s+n[°ºo.]?\s*(\d{8,})\s+du/i],engie:[/facture\s+n[°ºo.]?\s*(\d{8,})\s+du/i],edf:[/d[eé]tail\s+de\s+votre\s+facture\s+du\s+[\d/]+\s+n[°ºo.]?\s*(\d{8,})/i],amazon:[/num[eé]ro\s+de\s+la\s+facture\s+([A-Z][\w-]{6,})/i],suez:[/facture\s+n[°ºo.]?\s*:\s*(\d{8,})/i],totalenergies:[/N[°ºo.]\s*(\d{7,}\s*[-–]\s*[A-Z]\d+)/i]};
 const number=getNo(lines,[...(supplier==="henrijulien"?[/\bfacture\s+(FA[-\s]?\d{5,})\b/i]:[]),...(specific[supplier]||[]),...generic]);
 let date=null;
 const reDate=/date\s+(?:de\s+(?:la\s+)?)?(?:facture|facturation|d['’]?[eé]mission)\s*[: /]+\s*(\d\d?[/.]\d\d?[/.]\d{2,4}|\d\d?\s+\w+\s+20\d\d)/i;
 for(const line of lines){const m=line.match(reDate);if(m){const d=dates(m[1]);if(d){date={value:d,source:line};break}}}
 if(!date){for(const line of lines){if(/facture.+\bdu\b|date\s*:|date of issue|date de la facture|date de vente/i.test(line)){const d=dates(line);if(d){date={value:d,source:line};break}}}}
 if(!date&&supplier==="henrijulien"){for(const line of lines.slice(0,35)){const m=line.match(/\b(?:date\s+document|date\s+facture)\s*[: ]*([0-3]?\d[/.][01]?\d[/.]20\d\d)/i);if(m){const d=dates(m[1]);if(d){date={value:d,source:line};break}}}}
 if(!date&&supplier==="freepro")for(const l of lines){if(/\bF20\d{8}/.test(l)){const d=dates(l);if(d){date={value:d,source:l};break}}}
 const amount=(pattern)=>getAmount(lines,[new RegExp(pattern+"\\s*[:=]?\\s*"+amountPattern,"i")]);
 let ht=amount("(?:total\\s+ht|sous[- ]total\\s+ht|montant\\s+hors\\s+tva|total\\s+electricite\\s*\\/\\s*hors\\s+tva|total\\s+de\\s+la\\s+facture\\s+ht)");
 let vat=amount("(?:total\\s+tva(?:\\s+\\d{1,2}%)?|montant\\s+tva(?:\\s*\\([^)]*\\))?|tva\\s+pay[eé]e\\s+sur\\s+les\\s+d[eé]bits)");
 let ttc=amount("(?:total\\s+ttc|montant\\s+ttc\\s+[aà]\\s+payer|montant\\s+[aà]\\s+payer|somme\\s*[àa]\\s*payer\\s*ttc|net\\s+[àa]\\s+(?:payer|pr[eé]lever)|facture\\s+ttc)");
 if(supplier==="henrijulien"){const joined=lines.join(" ");const m=joined.match(/total\s+eur\s+ht\s*[: ]*([\d.,]+)[\s\S]{0,140}?tva\s*20%\s*[: ]*([\d.,]+)[\s\S]{0,100}?total\s+eur\s+ttc\s*[: ]*([\d.,]+)/i);if(m){ht={value:money(m[1]),source:"Total EUR HT"};vat={value:money(m[2]),source:"TVA 20%"};ttc={value:money(m[3]),source:"Total EUR TTC"}}else{ht=amount("(?:total\\s+eur\\s+ht|total\\s+ht|total\\s+hors\\s+taxes)");ttc=amount("(?:total\\s+eur\\s+ttc|total\\s+ttc|net\\s+[àa]\\s+payer)");vat=amount("(?:montant\\s+tva|tva\\s*20%|total\\s+tva)")}}
 if(supplier==="freepro"){ht=amount("total\\s+ht");vat=amount("total\\s+tva\\s+\\d+%");ttc=amount("total\\s+ttc")}
 if(supplier==="edf"){ht=amount("montant\\s+hors\\s+tva");vat=amount("montant\\s+tva(?:\\s*\\([^)]*\\))?");ttc=amount("facture\\s+ttc")}
 if(supplier==="engie"){ht=amount("total\\s+[eé]lectricit[eé]\\s*\\/\\s*hors\\s+tva");vat=amount("tva\\s+pay[eé]e\\s+sur\\s+les\\s+d[eé]bits");ttc=amount("montant\\s+ttc\\s+[aà]\\s+payer")}
 if(supplier==="totalenergies")for(const l of lines){const m=l.match(/total\s+g[eé]n[eé]ral\s+([\d.,]+)\s+([\d.,]+)\s*(?:eur|€)?\s+([\d.,]+)/i);if(m){ht={value:money(m[1]),source:l};vat={value:money(m[2]),source:l};ttc={value:money(m[3]),source:l};break}}
 if(supplier==="suez"&&ht&&ttc){const found=lines.map(x=>x.match(/^montant\s+tva\s*\([\d.,]+\s*%\)\s*([\d.,]+)/i)).filter(Boolean);if(found.length){const sum=Math.round(found.reduce((v,x)=>v+(money(x[1])||0),0)*100)/100;if(Math.abs(ht.value+sum-ttc.value)<.03)vat={value:sum,source:"Somme des lignes TVA"}}}
 if(supplier==="chatgpt"){const x=amount("(?:subtotal|total|amount\\s+due)\\s*€");if(x){ht=x;ttc=x;if(/reverse charge/i.test(text))vat={value:0,source:"Autoliquidation : vérifier"}}}
 let computation=null;
 const pomona=supplier==="passionfroid"?pomonaEvidence(text,ttc):null;
 if(pomona?.ht&&pomona?.vat&&(!ht||!vat)){
  if(!ht)ht=pomona.ht;if(!vat)vat=pomona.vat;
  computation={kind:pomona.kind,verifiedBy:"lecture du document",message:"HT et TVA récupérés du document Pomona."};
 }
 if(!vat&&ht&&ttc){vat={value:round(ttc.value-ht.value),source:"TTC - HT (à contrôler)"};computation={kind:"difference",message:"TVA calculée : TTC moins HT."}}
 if(!ht&&vat&&ttc){ht={value:round(ttc.value-vat.value),source:"TTC - TVA (à contrôler)"};computation={kind:"difference",message:"HT calculé : TTC moins TVA."}}
 const explicitRates=[...new Set([...rateEvidence(text),...(pomona?.rates||[])])].sort((a,b)=>a-b);
 const storedRate=p?.field_hints?.default_vat_rate;
 const defaultRate=typeof storedRate==="number"&&Number.isFinite(storedRate)&&storedRate>=0&&storedRate<=25?storedRate:null;
 // Supplier default applies only if no invoice VAT rate is readable; it never overwrites explicit amounts.
 const selectedRate=explicitRates.length===1?explicitRates[0]:(explicitRates.length===0?defaultRate:null);
 if(ttc&&!ht&&!vat&&selectedRate!==null){
  const calc=fromTtc(ttc.value,selectedRate);
  if(calc){
   const onDocument=explicitRates.length===1;
   ht={value:calc.ht,source:onDocument?"Calcul TTC au taux indiqué sur la facture":"Calcul TTC au taux habituel fournisseur (à confirmer)"};
   vat={value:calc.vat,source:"Calcul TTC - HT"};
   computation={kind:onDocument?"single_rate":"supplier_default_rate",rate:selectedRate,message:onDocument
     ?"HT et TVA calculés avec le taux de "+selectedRate+" % relevé sur la facture : à confirmer."
     :"HT et TVA calculés automatiquement avec le taux habituel de "+selectedRate+" % pour ce fournisseur : à confirmer sur la facture."};
  }
 }
 const suggestedRate=selectedRate;
 const variant=(p?.field_hints?.variants||[]).map(x=>({...x,score:(x.anchors||[]).filter(a=>norm(text).includes(norm(a))).length})).sort((a,b)=>b.score-a.score)[0];
 const t=norm(text);let type=variant?.score>0?variant.document_type:"facture";
 if(/recapitulatif multilignes/.test(t))type="recapitulatif";
 if(/ceci n est pas une facture|infos detaillees finales sur la commande/.test(t))type="non_facture";
 if(/avis d echeance|echeancier/.test(t)&&!/facture n/.test(t))type="echeancier";
 if(ttc?.value<0||/avoir n|facture d avoir|note de credit/.test(t))type="avoir";
 const issues=[];if(!number)issues.push("Numéro non reconnu");if(!date)issues.push("Date non reconnue");if(!ht||!ttc||!vat)issues.push("Montants incomplets");if(ht&&vat&&ttc&&Math.abs(ht.value+vat.value-ttc.value)>.03)issues.push("HT + TVA différent du TTC");if(type!=="facture")issues.push("Type de document à contrôler");
 if(supplier==="amazon"&&new Set(lines.map(x=>x.match(/num[eé]ro\s+de\s+la\s+facture\s+([A-Z][\w-]{6,})/i)?.[1]).filter(Boolean)).size>1)issues.push("Plusieurs factures dans le PDF");
 if(["single_rate","supplier_default_rate"].includes(computation?.kind))issues.push("HT et TVA calculés : vérifier le taux de TVA et les montants sur le PDF");
 if(defaultRate!==null&&explicitRates.length&&explicitRates.some(rate=>Math.abs(rate-defaultRate)>0.001))issues.push("Taux du PDF différent du taux habituel fournisseur ("+defaultRate+" %) : contrôle obligatoire");
 if(explicitRates.length>1&&!ht&&!vat)issues.push("Plusieurs taux de TVA détectés : ventilation obligatoire");
 return {number,date,ht,vat,ttc,variant:variant?.score>0?variant:null,type,issues,computation,taxRates:explicitRates,suggestedRate,hasMixedVat:explicitRates.length>1,pomonaRows:pomona?.rowCount||0};
 };
const api={extract,fromTtc,rateEvidence,norm,compact};if(typeof module!=="undefined"&&module.exports)module.exports=api;else g.AccountingModelCore=api;
})(typeof window!=="undefined"?window:this);