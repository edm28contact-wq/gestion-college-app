/* Analyse de champs monétaires d'un bulletin PDF texte.
 * Les champs ambigus ne sont jamais déduits d'une colonne voisine. */
(()=>{
"use strict";
const clean=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\u00a0\u202f]/g," ").toUpperCase().replace(/\s+/g," ").trim();
const fields=Object.freeze({
 gross:{label:"Salaire brut",patterns:[/\b(?:TOTAL\s+(?:SALAIRE\s+)?BRUT|SALAIRE\s+BRUT|BRUT\s+TOTAL|REMUNERATION\s+BRUTE|TOTAL\s+REMUNERATION\s+BRUTE)\b/g],excluded:/\b(?:ASSIETTE|BASE|PLAFOND|BRUT\s+FISCAL)\b/},
 withholding:{label:"Prélèvement à la source",patterns:[/\b(?:PRELEVEMENT\s+A\s+LA\s+SOURCE|IMPOT\s+SUR\s+LE\s+REVENU\s+PRELEVE\s+A\s+LA\s+SOURCE|RETENUE\s+A\s+LA\s+SOURCE)\b/g],excluded:/\b(?:TAUX\s+PERSONNALISE\s+SEUL|NET\s+AVANT)\b/},
 beforeTax:{label:"Net avant impôt",patterns:[/\bNET\s+A\s+PAYER\s+AVANT\s+(?:IMPOT|PRELEVEMENT\s+A\s+LA\s+SOURCE)\b/g]},
 netSocial:{label:"Montant net social",patterns:[/\b(?:MONTANT\s+)?NET\s+SOCIAL\b/g]},
 taxableNet:{label:"Net imposable",patterns:[/\b(?:NET\s+IMPOSABLE|NET\s+FISCAL|CUMUL\s+NET\s+IMPOSABLE)\b/g],excluded:/\bCUMUL\b/}
});
function moneyCandidates(text){
 const fn=globalThis?.ChambertinPayslipNet?.moneyFromText;
 if(typeof fn==="function")return fn(text);
 const values=[];
 const expr=/(?<![\d./-])(?:\d{1,3}(?:[ .]\d{3})+|\d{1,8})[,.]\d{2}(?![\d./])/g;
 for(const match of String(text).matchAll(expr)){
  const s=match[0].replace(/\s/g,"").replace(/\.(?=\d{3}(?:[.,]|$))/g,"").replace(",",".");
  const [a,b]=s.split(".");
  const cents=Number(a)*100+Number(b);
  if(Number.isSafeInteger(cents)&&cents<=999999999)values.push(cents);
 }
 return values;
}
function extract(lines,key){
 const spec=fields[key];if(!spec)throw Error("Champ de bulletin inconnu");
 const values=[],candidates=[],matches=[];
 for(let i=0;i<Math.min(350,lines.length);i++){
  const line=clean(lines[i]);
  if(spec.excluded?.test(line))continue;
  for(const pattern of spec.patterns){
   pattern.lastIndex=0;
   const match=pattern.exec(line);
   if(!match)continue;
   if(key==="gross"&&/\bNET\b/.test(line.slice(0,match.index)))continue;
   const after=line.slice(match.index+match[0].length);
   let money=moneyCandidates(after);
   if(!money.length&&/^[\d\s.,€EUR]+$/.test(clean(lines[i+1]||"")))money=moneyCandidates(lines[i+1]);
   matches.push({line:i+1,count:money.length});
   if(money.length===1)values.push(money[0]);
   for(const cents of money)if(!candidates.includes(cents))candidates.push(cents);
   break;
  }
 }
 const unique=[...new Set(values)];
 const selected=matches.length&&matches.every(m=>m.count===1)&&unique.length===1?unique[0]:null;
 return {label:spec.label,cents:selected,candidates,confidence:selected===null?"review":"single",
  reason:matches.length===0?spec.label+" non identifié.":selected===null?spec.label+" : plusieurs colonnes ou montants incompatibles, vérification requise.":""};
}
function inspect(lines){
 if(!Array.isArray(lines))throw Error("Lignes de bulletin invalides");
 return Object.fromEntries(Object.keys(fields).map(key=>[key,extract(lines,key)]));
}
const api=Object.freeze({extract,inspect,fields});
if(typeof window!=="undefined")window.ChambertinPayslipDetails=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
