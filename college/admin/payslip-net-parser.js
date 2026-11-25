/* Lecture prudente des nets de bulletins de paie français.
 * Ne retient jamais "net social", "net imposable" ou "net avant impôt".
 * Indépendant du PDF : les lignes sont déjà extraites et classées par page. */
(()=>{
"use strict";
function cleanText(value){
 return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[’‘]/g,"'")
  .replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim().toUpperCase();
}
function canonicalName(value){
 return cleanText(value).replace(/\b(?:MONSIEUR|MADAME|MLLE|MME|MRS|MR|M)\b/g," ")
  .replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function moneyFromText(line){
 const rex=/(?<!\d)(?:\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d{1,8})[,.]\d{2}(?!\d)/g;
 const values=[];
 for(const match of String(line).matchAll(rex)){
  const numeric=match[0].replace(/[ \u00a0\u202f]/g,"").replace(/\.(?=\d{3}(?:[.,]|$))/g,"").replace(",",".");
  if(!/^\d{1,8}\.\d{2}$/.test(numeric))continue;
  const [euros,centimes]=numeric.split(".");
  const amount=Number(euros)*100+Number(centimes);
  if(Number.isSafeInteger(amount)&&amount<=999999999)values.push(amount);
 }
 return values;
}
const netLabel=/\b(?:MONTANT\s+)?NET\s+(?:A\s+)?(?:PAYER|PAYE|VERSE)\b/;
const notAfterTax=/\bAVANT\s+(?:IMPOT|IMPOTS|PRELEVEMENT|PAS)\b/;
function extractNetPay(lines){
 const eligible=[],warnings=[];
 for(let i=0;i<lines.length;i++){
  const original=String(lines[i]||"");
  const line=cleanText(original);
  const found=netLabel.exec(line);
  if(!found)continue;
  if(notAfterTax.test(line)||/\bNET\s+SOCIAL\b/.test(line)||/\bNET\s+IMPOSABLE\b/.test(line))continue;
  const suffix=original.slice(found.index+found[0].length);
  let amounts=moneyFromText(suffix);
  if(!amounts.length&&i+1<lines.length){
   const next=String(lines[i+1]||"").trim();
   if(/^[\s\d.,€EUR\u00a0\u202f-]+$/i.test(next))amounts=moneyFromText(next);
  }
  if(amounts.length!==1){warnings.push("Ligne « net à payer » ambiguë ou sans montant.");continue}
  const priority=/\bAPRES\s+(?:IMPOT|PRELEVEMENT|PAS)\b/.test(line)?3:/\bNET\s+(?:PAYER|PAYE|VERSE)\b/.test(line)?2:1;
  eligible.push({cents:amounts[0],priority,label:original.trim()});
 }
 if(!eligible.length)return {cents:null,label:"",reason:warnings[0]||"Net à payer après impôt introuvable."};
 const values=[...new Set(eligible.map(x=>x.cents))];
 if(values.length!==1)return {cents:null,label:"",reason:"Plusieurs montants nets à payer différents dans le bulletin."};
 const row=[...eligible].sort((a,b)=>b.priority-a.priority)[0];
 return {cents:row.cents,label:row.label,reason:""};
}
const monthNames={JANVIER:1,FEVRIER:2,MARS:3,AVRIL:4,MAI:5,JUIN:6,JUILLET:7,AOUT:8,SEPTEMBRE:9,OCTOBRE:10,NOVEMBRE:11,DECEMBRE:12};
const isoMonth=(year,month)=>String(year)+"-"+String(month).padStart(2,"0");
function findPayPeriod(lines){
 const months=new Set();
 for(const raw of lines.slice(0,135)){
  const line=cleanText(raw);
  if(!/\b(?:PERIODE|MOIS|BULLETIN|PAIE|REMUNERATION)\b/.test(line))continue;
  const numeric=line.match(/\b(?:PERIODE\s+(?:DE\s+PAIE\s*)?(?:DU\s*)?|DU\s+)?(?:0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](20\d{2})\b/);
  if(numeric)months.add(isoMonth(Number(numeric[2]),Number(numeric[1])));
  for(const pair of line.matchAll(/\b(0?[1-9]|1[0-2])[\/.-](20\d{2})\b/g))months.add(isoMonth(Number(pair[2]),Number(pair[1])));
  for(const pair of line.matchAll(/\b(20\d{2})[\/.-](0?[1-9]|1[0-2])\b/g))months.add(isoMonth(Number(pair[1]),Number(pair[2])));
  for(const pair of line.matchAll(/\b(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+(20\d{2})\b/g))months.add(isoMonth(Number(pair[2]),monthNames[pair[1]]));
 }
 if(months.size>1)return {month:null,reason:"Plusieurs périodes de paie différentes repérées."};
 if(!months.size)return {month:null,reason:"Période de paie non reconnue."};
 return {month:[...months][0],reason:""};
}
function matchEmployee(lines,staff){
 const header=lines.slice(0,115).map(cleanText);
 const matches=[];
 for(const person of staff||[]){
  if(!person?.id||!person?.name)continue;
  const name=canonicalName(person.name);
  if(!name||name.length<4)continue;
  const parts=name.split(" ").filter(Boolean);
  const found=header.some(line=>{
   if(parts.length===1&&!/\b(?:SALARIE|NOM|PRENOM|MME|MRS|MONSIEUR|MADAME|MR|EMPLOYE)\b/.test(line))return false;
   const padded=" "+canonicalName(line)+" ";
   return padded.includes(" "+name+" ")||parts.length>1&&padded.includes(" "+[...parts].reverse().join(" ")+" ");
  });
  if(found)matches.push({id:person.id,name:person.name});
 }
 if(matches.length!==1)return {id:null,name:"",reason:matches.length?"Plusieurs salariés correspondent à ce bulletin.":"Salarié non identifié automatiquement."};
 return {...matches[0],reason:""};
}
function inspectPayslip(lines,staff,expectedMonth){
 if(!Array.isArray(lines)||!Array.isArray(staff))throw Error("Données d'analyse invalides.");
 const normalized=lines.map(x=>String(x||""));
 const net=extractNetPay(normalized),period=findPayPeriod(normalized),person=matchEmployee(normalized,staff);
 const reasons=[];
 if(net.reason)reasons.push(net.reason);
 if(person.reason)reasons.push(person.reason);
 if(period.reason)reasons.push(period.reason);
 else if(period.month!==expectedMonth)reasons.push("Bulletin du mois "+period.month+" alors que le dossier est "+expectedMonth+".");
 const text=normalized.slice(0,180).map(cleanText).join(" ");
 const proof=(/\bBULLETIN\s+(?:DE\s+)?(?:PAIE|SALAIRE)\b/.test(text)||/\bPAIE\b/.test(text)&&/\bCOTISATION/.test(text));
 if(!proof)reasons.push("Nature « bulletin de paie » non confirmée.");
 return {staffId:person.id,staffName:person.name,amountCents:net.cents,period:period.month,
  label:net.label,reasons,ready:reasons.length===0};
}
const api=Object.freeze({inspectPayslip,extractNetPay,findPayPeriod,matchEmployee,moneyFromText});
if(typeof window!=="undefined")window.ChambertinPayslipNet=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
