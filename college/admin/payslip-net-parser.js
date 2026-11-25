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
  .replace(/[^A-Z0-9]+/g," ").replace(/\bD\s+(?=[A-Z]{3,}\b)/g,"D")
  .replace(/\s+/g," ").trim();
}
function moneyFromText(line){
 const rex=/(?<![\d./-])(?:\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d{1,8})[,.]\d{2}(?![\d./])/g;
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
const netLabel=/\b(?:MONTANT\s+)?NET\s+(?:A\s+)?(?:PAYER|PAYE|VERSE|VERSER)\b/g;
const notAfterTax=/\bAVANT\s+(?:IMPOT|IMPOTS|PRELEVEMENT|PAS|RETENUE\s+A\s+LA\s+SOURCE)\b/;
function extractNetPay(lines){
 const eligible=[],warnings=[];
 for(let i=0;i<lines.length;i++){
  const original=String(lines[i]||"");
  const line=cleanText(original);
  const matches=[...line.matchAll(netLabel)];
  for(let j=0;j<matches.length;j++){
   const match=matches[j],end=j+1<matches.length?matches[j+1].index:line.length;
   const span=line.slice(match.index,end),suffix=original.slice(match.index+match[0].length,end);
   const next=String(lines[i+1]||"").trim();
   if(notAfterTax.test(span)||/\b(?:NET\s+SOCIAL|NET\s+IMPOSABLE|NET\s+FISCAL)\b/.test(span))continue;
   if(/^\s*AVANT\s+(?:IMPOT|PRELEVEMENT)/.test(cleanText(next))&&!moneyFromText(suffix).length)continue;
   if(/[-−]\s*\d/.test(suffix)){warnings.push("Un net à payer négatif doit être vérifié.");continue}
   let amounts=moneyFromText(suffix);
   if(!amounts.length&&/^[\s\d.,€EUR\u00a0\u202f]+$/i.test(next)&&next.length<35){
    amounts=moneyFromText(next);
   }
   if(amounts.length!==1){
    warnings.push("Ligne de net à payer avec plusieurs montants ou sans valeur certaine.");
    for(const cents of amounts)eligible.push({cents,priority:0,label:original.trim(),manualOnly:true});
    continue;
   }
   const explicitAfter=/\bAPRES\s+(?:IMPOT|IMPOTS|PRELEVEMENT|PAS|RETENUE\s+A\s+LA\s+SOURCE)\b/.test(span);
   const paid=/\bNET\s+(?:PAYE|VERSE|A\s+VERSER)\b/.test(span);
   const priority=explicitAfter?6:paid?5:/\bEN\s+EUROS\b/.test(span)?4:3;
   eligible.push({cents:amounts[0],priority,label:original.trim(),manualOnly:false});
  }
 }
 const candidates=[...new Map(eligible.map(row=>[row.cents,row])).values()].map(row=>({cents:row.cents,label:row.label,priority:row.priority}));
 const reliable=eligible.filter(row=>row.priority>0&&!row.manualOnly);
 if(!reliable.length)return {cents:null,label:"",candidates,reason:warnings[0]||"Net à payer après impôt introuvable.",confidence:"none"};
 const maxPriority=Math.max(...reliable.map(x=>x.priority));
 const best=reliable.filter(x=>x.priority===maxPriority);
 const amounts=[...new Set(best.map(x=>x.cents))];
 if(amounts.length!==1){
  return {cents:null,label:"",candidates,reason:"Plusieurs montants nets à payer de même priorité : vérification obligatoire.",confidence:"ambiguous"};
 }
 const selected=best[0];
 // A strong, explicit label resolves differences from "net avant impôt".
 // If no strong label exists, contradictory lower-priority lines remain a warning.
 const contradictory=reliable.some(x=>x.cents!==selected.cents);
 if(contradictory&&maxPriority<5){
  return {cents:null,label:"",candidates,reason:"Plusieurs montants nets à payer différents dans le bulletin.",confidence:"ambiguous"};
 }
 return {cents:selected.cents,label:selected.label,candidates,reason:"",confidence:maxPriority>=6?"after-tax":maxPriority>=5?"paid":"standard"};
}
const monthNames={JANVIER:1,FEVRIER:2,MARS:3,AVRIL:4,MAI:5,JUIN:6,JUILLET:7,AOUT:8,SEPTEMBRE:9,OCTOBRE:10,NOVEMBRE:11,DECEMBRE:12};
const isoMonth=(year,month)=>String(year)+"-"+String(month).padStart(2,"0");
function filenamePeriod(filename){
 const file=cleanText(String(filename||"").replace(/\.PDF$/i,""));
 const a=file.match(/\b(20\d{2})[-_. ](0?[1-9]|1[0-2])\b/);
 if(a)return isoMonth(Number(a[1]),Number(a[2]));
 const b=file.match(/\b(0?[1-9]|1[0-2])[-_. ](20\d{2})\b/);
 if(b)return isoMonth(Number(b[2]),Number(b[1]));
 return null;
}
function findPayPeriod(lines,filename=""){
 const months=new Set();
 const add=(year,month)=>{if(Number(year)>=2000&&Number(year)<=2099&&Number(month)>=1&&Number(month)<=12)months.add(isoMonth(Number(year),Number(month)))};
 const extract=raw=>{
  const line=cleanText(raw);
  for(const match of line.matchAll(/\b(0?[1-9]|1[0-2])[\/.-](20\d{2})\b/g))add(match[2],match[1]);
  for(const match of line.matchAll(/\b(20\d{2})[\/.-](0?[1-9]|1[0-2])\b/g))add(match[1],match[2]);
  for(const match of line.matchAll(/\b(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+(20\d{2})\b/g))add(match[2],monthNames[match[1]]);
  for(const match of line.matchAll(/\b(?:DU\s+)?(?:0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](20\d{2})\b/g))add(match[2],match[1]);
 };
 for(let i=0;i<Math.min(lines.length,130);i++){
  const line=cleanText(lines[i]);
  const next=cleanText(lines[i+1]||"");
  const period=/\b(?:PERIODE|MOIS\s+DE\s+PAIE|MOIS\s+CONCERNE|MOIS|PAIE\s+(?:DE|DU|D'|:)|REMUNERATION)\b/.test(line)||
   /\bBULLETIN\s+DE\s+PAIE\s+(?:0?[1-9]|1[0-2])[\/.-]20\d{2}\b/.test(line);
  const labelOnly=/^(?:PERIODE(?:\s+DE\s+PAIE)?|MOIS(?:\s+DE\s+PAIE)?|PAIE)\s*[:\-]?$/.test(line);
  const range=/\bDU\s+(?:0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](20\d{2})\s+(?:AU|A)\s+(?:0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](20\d{2})\b/.test(line);
  const standalone=/^(?:BULLETIN\s+DE\s+PAIE\s+)?(?:JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)\s+20\d{2}$/.test(line);
  if(period||range||standalone)extract(line);
  if(labelOnly)extract(next);
 }
 const fileMonth=filenamePeriod(filename);
 if(months.size>1)return {month:null,source:"document",reason:"Plusieurs périodes de paie différentes dans le PDF."};
 const month=months.size?[...months][0]:null;
 if(month&&fileMonth&&month!==fileMonth)return {month:null,source:"conflict",reason:"La période "+month+" du PDF contredit le fichier "+fileMonth+"."};
 if(month)return {month,source:"document",reason:""};
 if(fileMonth)return {month:fileMonth,source:"filename",reason:"Mois "+fileMonth+" provenant du nom du fichier : vérifier dans le PDF."};
 return {month:null,source:"none",reason:"Période de paie non reconnue."};
}
function matchEmployee(lines,staff,filename=""){
 const header=lines.slice(0,115).map(cleanText);
 const basename=canonicalName(String(filename||"").replace(/\.pdf$/i,"").replace(/^(?:20\d{2}[-_. ](?:0?[1-9]|1[0-2]))[\s_.-]*/i,""));
 const find=(name,source)=>{
  const names=canonicalName(name);
  if(!names||names.length<2)return false;
  const parts=names.split(" ").filter(Boolean);
  const variants=[names];
  if(parts.length>1)variants.push([...parts].reverse().join(" "));
  if(source==="filename"){
   const padded=" "+basename+" ";
   return variants.some(v=>padded.includes(" "+v+" "));
  }
  return header.some(line=>{
   const normalized=canonicalName(line),padded=" "+normalized+" ";
   if(parts.length===1){
    const label=/\b(?:SALARIE|SALARIEE|NOM|PRENOM|MME|MONSIEUR|MADAME|EMPLOYE|PERSONNEL)\b/.test(cleanText(line));
    const corroborated=basename.split(" ").length>=2&&(" "+basename+" ").includes(" "+names+" ")&&padded.includes(" "+basename+" ");
    return padded.includes(" "+names+" ")&&(label||corroborated);
   }
   return variants.some(v=>padded.includes(" "+v+" "));
  });
 };
 const docMatches=[],filenameMatches=[];
 for(const person of staff||[]){
  if(!person?.id||!person?.name)continue;
  if(find(person.name,"document"))docMatches.push({id:person.id,name:person.name});
  if(find(person.name,"filename"))filenameMatches.push({id:person.id,name:person.name});
 }
 if(docMatches.length>1)return {id:null,name:"",source:"document",reason:"Plusieurs salariés correspondent au contenu du PDF."};
 if(docMatches.length===1){
  const p=docMatches[0];
  if(filenameMatches.length&&filenameMatches.some(x=>x.id!==p.id))return {id:null,name:"",source:"conflict",reason:"Le nom du fichier contredit le salarié trouvé dans le PDF."};
  return {...p,source:"document",reason:""};
 }
 if(filenameMatches.length===1)return {...filenameMatches[0],source:"filename",reason:"Salarié identifié par le nom du fichier : confirmer sur le bulletin."};
 return {id:null,name:"",source:"none",reason:filenameMatches.length?"Plusieurs salariés correspondent au nom du fichier.":"Salarié non identifié automatiquement."};
}
function inspectPayslip(lines,staff,expectedMonth,filename=""){
 if(!Array.isArray(lines)||!Array.isArray(staff))throw Error("Données d'analyse invalides.");
 const normalized=lines.map(x=>String(x||""));
 const net=extractNetPay(normalized),period=findPayPeriod(normalized,filename),person=matchEmployee(normalized,staff,filename);
 const reasons=[];
 if(net.reason)reasons.push(net.reason);
 if(person.reason)reasons.push(person.reason);
 if(period.reason)reasons.push(period.reason);
 if(period.month&&period.month!==expectedMonth)reasons.push("Bulletin du mois "+period.month+" alors que le dossier est "+expectedMonth+".");
 const text=normalized.slice(0,180).map(cleanText).join(" ");
 const proof=(/\bBULLETIN\s+(?:DE\s+)?(?:PAIE|SALAIRE)\b/.test(text)||/\bPAIE\b/.test(text)&&/\bCOTISATION/.test(text));
 if(!proof)reasons.push("Nature « bulletin de paie » non confirmée.");
 return {staffId:person.id,staffName:person.name,employeeSource:person.source,amountCents:net.cents,
  amountCandidates:net.candidates,netConfidence:net.confidence,period:period.month,periodSource:period.source,
  label:net.label,reasons,ready:reasons.length===0};
}
const api=Object.freeze({inspectPayslip,extractNetPay,findPayPeriod,matchEmployee,moneyFromText,filenamePeriod});
if(typeof window!=="undefined")window.ChambertinPayslipNet=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
