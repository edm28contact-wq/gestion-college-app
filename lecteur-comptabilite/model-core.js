(function(g){"use strict";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),compact=s=>norm(s).replace(/\s+/g,"");
const money=s=>{if(!s)return null;let x=String(s).replace(/[ €¤\u00a0\u202f]/g,"").replace(",",".");return /^-?\d+(?:\.\d{1,3})?$/.test(x)?Number(x):null};
const dates=s=>{const m=String(s||"").match(/(\d{4})[-/.](\d\d)[-/.](\d\d)|(\d\d?)[/.](\d\d?)[/.](\d{2,4})|(\d\d?)\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d\d)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d\d?,?\s+20\d\d/i);if(!m)return "";let a,b,c;if(m[1]){a=+m[1];b=+m[2];c=+m[3]}else if(m[4]){c=+m[4];b=+m[5];a=+m[6];if(a<100)a+=2000}else if(m[7]){c=+m[7];b=["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"].indexOf(norm(m[8]))+1;a=+m[9]}else{const v=m[0].match(/([a-z]+)\s+(\d+),?\s+(20\d\d)/i);c=+v[2];a=+v[3];b=["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(v[1].toLowerCase())+1}const d=new Date(Date.UTC(a,b-1,c));return d.getUTCFullYear()===a&&d.getUTCMonth()===b-1&&d.getUTCDate()===c?[a,String(b).padStart(2,"0"),String(c).padStart(2,"0")].join("-"):""};
const amountPattern="(-?\\d{1,3}(?:[\\u00a0\\u202f ]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2}|-?\\d{1,6})";
function getAmount(lines,patterns){for(const re of patterns){for(const line of lines){const m=line.match(re);if(m){const n=money(m[1]);if(n!==null)return {value:n,source:line}}}}return null}
function getNo(lines,patterns){for(const re of patterns){for(const line of lines){const m=line.match(re);if(m)return {value:m[1],source:line}}}return null}
const extract=(text,p)=>{
 const supplier=p?.supplier_key||"",lines=String(text||"").replace(/\r/g,"").split("\n").map(x=>x.replace(/[\u00a0\u202f]/g," ").replace(/\s{2,}/g," ").trim()).filter(Boolean);
 const generic=[/num[eé]ro\s+de\s+(?:la\s+)?facture\s*[: ]+([\w./-]{3,})/i,/facture\s*n[°ºo.]?\s*[: ]+([\w./-]{3,})/i,/invoice\s+number\s+([\w-]{4,})/i];
 const specific={freepro:[/\b\d\d\/\d\d\/20\d\d\s+(F\d{9,})/],freemobile:[/facture\s+n[°ºo.]?\s*(\d{8,})\s+du/i],engie:[/facture\s+n[°ºo.]?\s*(\d{8,})\s+du/i],edf:[/d[eé]tail\s+de\s+votre\s+facture\s+du\s+[\d/]+\s+n[°ºo.]?\s*(\d{8,})/i],amazon:[/num[eé]ro\s+de\s+la\s+facture\s+([A-Z][\w-]{6,})/i],suez:[/facture\s+n[°ºo.]?\s*:\s*(\d{8,})/i],totalenergies:[/N[°ºo.]\s*(\d{7,}\s*[-–]\s*[A-Z]\d+)/i]};
 const number=getNo(lines,[...(specific[supplier]||[]),...generic]);
 let date=null;
 const reDate=/date\s+(?:de\s+(?:la\s+)?)?(?:facture|facturation|d['’]?[eé]mission)\s*[: /]+\s*(\d\d?[/.]\d\d?[/.]\d{2,4}|\d\d?\s+\w+\s+20\d\d)/i;
 for(const line of lines){const m=line.match(reDate);if(m){const d=dates(m[1]);if(d){date={value:d,source:line};break}}}
 if(!date){for(const line of lines){if(/facture.+\bdu\b|date\s*:|date of issue|date de la facture|date de vente/i.test(line)){const d=dates(line);if(d){date={value:d,source:line};break}}}}
 if(!date&&supplier==="freepro")for(const l of lines){if(/\bF20\d{8}/.test(l)){const d=dates(l);if(d){date={value:d,source:l};break}}}
 const amount=(pattern)=>getAmount(lines,[new RegExp(pattern+"\\s*[:=]?\\s*"+amountPattern,"i")]);
 let ht=amount("(?:total\\s+ht|sous[- ]total\\s+ht|montant\\s+hors\\s+tva|total\\s+electricite\\s*\\/\\s*hors\\s+tva|total\\s+de\\s+la\\s+facture\\s+ht)");
 let vat=amount("(?:total\\s+tva(?:\\s+\\d{1,2}%)?|montant\\s+tva(?:\\s*\\([^)]*\\))?|tva\\s+pay[eé]e\\s+sur\\s+les\\s+d[eé]bits)");
 let ttc=amount("(?:total\\s+ttc|montant\\s+ttc\\s+[aà]\\s+payer|montant\\s+[aà]\\s+payer|somme\\s*[àa]\\s*payer\\s*ttc|net\\s+[àa]\\s+(?:payer|pr[eé]lever)|facture\\s+ttc)");
 if(supplier==="freepro"){ht=amount("total\\s+ht");vat=amount("total\\s+tva\\s+\\d+%");ttc=amount("total\\s+ttc")}
 if(supplier==="edf"){ht=amount("montant\\s+hors\\s+tva");vat=amount("montant\\s+tva(?:\\s*\\([^)]*\\))?");ttc=amount("facture\\s+ttc")}
 if(supplier==="engie"){ht=amount("total\\s+[eé]lectricit[eé]\\s*\\/\\s*hors\\s+tva");vat=amount("tva\\s+pay[eé]e\\s+sur\\s+les\\s+d[eé]bits");ttc=amount("montant\\s+ttc\\s+[aà]\\s+payer")}
 if(supplier==="totalenergies")for(const l of lines){const m=l.match(/total\s+g[eé]n[eé]ral\s+([\d.,]+)\s+([\d.,]+)\s*(?:eur|€)?\s+([\d.,]+)/i);if(m){ht={value:money(m[1]),source:l};vat={value:money(m[2]),source:l};ttc={value:money(m[3]),source:l};break}}
 if(supplier==="suez"&&ht&&ttc){const found=lines.map(x=>x.match(/^montant\s+tva\s*\([\d.,]+\s*%\)\s*([\d.,]+)/i)).filter(Boolean);if(found.length){const sum=Math.round(found.reduce((v,x)=>v+(money(x[1])||0),0)*100)/100;if(Math.abs(ht.value+sum-ttc.value)<.03)vat={value:sum,source:"Somme des lignes TVA"}}}
 if(supplier==="chatgpt"){const x=amount("(?:subtotal|total|amount\\s+due)\\s*€");if(x){ht=x;ttc=x;if(/reverse charge/i.test(text))vat={value:0,source:"Autoliquidation : vérifier"}}}
 if(!vat&&ht&&ttc)vat={value:Math.round((ttc.value-ht.value)*100)/100,source:"Calcul TTC - HT (à contrôler)"};
 const variant=(p?.field_hints?.variants||[]).map(x=>({...x,score:(x.anchors||[]).filter(a=>norm(text).includes(norm(a))).length})).sort((a,b)=>b.score-a.score)[0];
 const t=norm(text);let type=variant?.score>0?variant.document_type:"facture";
 if(/recapitulatif multilignes/.test(t))type="recapitulatif";
 if(/ceci n est pas une facture|infos detaillees finales sur la commande/.test(t))type="non_facture";
 if(/avis d echeance|echeancier/.test(t)&&!/facture n/.test(t))type="echeancier";
 if(ttc?.value<0||/avoir n|facture d avoir|note de credit/.test(t))type="avoir";
 const issues=[];if(!number)issues.push("Numéro non reconnu");if(!date)issues.push("Date non reconnue");if(!ht||!ttc||!vat)issues.push("Montants incomplets");if(ht&&vat&&ttc&&Math.abs(ht.value+vat.value-ttc.value)>.03)issues.push("HT + TVA différent du TTC");if(type!=="facture")issues.push("Type de document à contrôler");
 if(supplier==="amazon"&&new Set(lines.map(x=>x.match(/num[eé]ro\s+de\s+la\s+facture\s+([A-Z][\w-]{6,})/i)?.[1]).filter(Boolean)).size>1)issues.push("Plusieurs factures dans le PDF");
 return {number,date,ht,vat,ttc,variant:variant?.score>0?variant:null,type,issues};
 };
const api={extract,norm,compact};if(typeof module!=="undefined"&&module.exports)module.exports=api;else g.AccountingModelCore=api;
})(typeof window!=="undefined"?window:this);