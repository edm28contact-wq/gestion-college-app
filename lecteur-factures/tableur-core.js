(function(root){
"use strict";
// Imports pasted Excel/Sheets cells, Markdown tables and invoice text; never modifies stock.
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const code=s=>norm(s).replace(/\s+/g,"");
const clean=s=>String(s??"").replace(/&nbsp;|&#160;|&#x20;/gi," ").replace(/[\u00a0\u202f\u2007]/g," ").trim();
function decimal(v){
 const s=clean(v).replace(/[\s€%]/g,"").replace(",",".");
 if(!/^\d{1,9}(?:\.\d{1,4})?$/.test(s))return null;
 const n=Number(s);
 return Number.isFinite(n)?n:null;
}
const lineRE=/^([A-Z][A-Z0-9._/-]{1,39})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-zÀ-ÿ.]{1,20})\s+(\d{1,2}(?:[.,]\d+)?)\s*%?\s+(\d+(?:[.,]\d{1,4})?)\s+(\d+(?:[.,]\d{1,2})?)\s*€?\s*$/i;
function build(ref,label,q,unit,vat,pu,ht,sourceLine){
 const quantity=decimal(q),rate=decimal(vat),price=decimal(pu),total=decimal(ht);
 if(!/^[A-Z][A-Z0-9._/-]{1,39}$/i.test(ref)||!clean(label)||quantity===null||quantity<=0||quantity>1000000||rate===null||rate>100||price===null||total===null)return null;
 return {reference:clean(ref).toUpperCase(),designation:clean(label),quantity,unit:clean(unit),vat:rate,unit_price_ht:price,total_ht:total,sourceLine};
}
function parseCells(cells,line){
 const cols=cells.map(clean);
 if(cols.length<7)return null;
 return build(cols[0],cols[1],cols[2],cols[3],cols[4],cols[5],cols[6],line);
}
function parseLine(line){
 const text=clean(line);
 const m=text.match(lineRE);
 return m?build(m[1],m[2],m[3],m[4],m[5],m[6],m[7],line):null;
}
function continuation(text){
 const s=clean(text);
 return s.length>=5&&s.length<=75&&!/[\d:;@]/.test(s)&&!/^(?:n[°o]\b|total\b|exp[eé]dition\b|ajout\b|fournisseur\b|d[eé]signation\b|livraison\b|facture\b|report\b)/i.test(s)&&/^[A-Za-zÀ-ÿ '"’.-]+$/.test(s)&&s.split(/\s+/).length<=5;
}
function format(rows){
 const cleanCell=x=>clean(x).replace(/[\t\r\n]+/g," ");
 return ["Référence\tDésignation\tQuantité\tUnité\tTVA %\tPrix HT\tTotal HT",...rows.map(r=>[r.reference,r.designation,r.quantity,r.unit,r.vat,r.unit_price_ht,r.total_ht].map(cleanCell).join("\t"))].join("\n");
}
function parse(text){
 if(typeof text!=="string"||text.length>150000)return {rows:[],ignored:0,ignoredLines:[],cleanedText:"",error:"Texte trop volumineux (150 000 caractères maximum)."};
 const lines=text.replace(/\r\n?/g,"\n").split("\n"),rows=[],ignoredLines=[];
 let ignored=0;
 for(let i=0;i<Math.min(lines.length,1000);i++){
  const raw=clean(lines[i]);
  if(!raw)continue;
  let item=null,line=raw;
  if(raw.startsWith("|")){
   const cols=raw.split("|").slice(1,raw.endsWith("|")?-1:undefined).map(clean);
   if(cols.every(c=>!c||/^:?-{3,}:?$/.test(c)))continue;
   item=parseCells(cols,raw);
   if(!item)line=cols.find(c=>c)||"";
  }else if(raw.includes("\t")){
   item=parseCells(raw.split("\t"),raw);
  }else if(raw.includes(";")&&raw.split(";").length>=7){
   item=parseCells(raw.split(";"),raw);
  }
  if(!item)item=parseLine(line);
  if(item){item.line=i+1;rows.push(item);continue;}
  if(rows.length&&continuation(line)){
   const prev=rows[rows.length-1];
   if(prev.line===i&&prev.designation.split(/\s+/).length<25){
    prev.designation+=" "+line;
    prev.sourceLine+="\n"+raw;
    continue;
   }
  }
  ignored++;ignoredLines.push({line:i+1,text:line});
 }
 return {rows,ignored,ignoredLines,cleanedText:format(rows),error:rows.length?"": "Aucune ligne de produit détectée. Collez des colonnes Référence, Désignation, Quantité, Unité, TVA, Prix HT, Total HT."};
}
function check(row){
 const quantity=decimal(row.quantity),price=decimal(row.unit_price_ht),total=decimal(row.total_ht),vat=decimal(row.vat);
 if(quantity===null||quantity<=0||price===null||total===null||vat===null||vat>100)return {ok:false,text:"Valeurs incomplètes ou incorrectes"};
 const expected=Math.round(quantity*price*100)/100;
 return {ok:Math.abs(expected-total)<=.02,expected,text:Math.abs(expected-total)<=.02?"Calcul HT correct":"Écart HT : attendu "+expected.toFixed(2)+" €"};
}
function match(row,db,supplier){
 const products=(db?.products||[]).filter(p=>p.active!==false),ref=code(row.reference),skey=code(supplier);
 const unique=(items,source)=>{
  const ids=[...new Set(items.map(x=>x.id||x.product_id).filter(Boolean))];
  if(ids.length===1){const p=products.find(x=>x.id===ids[0]);if(p)return {product:p,source,suggestions:[]};}
  if(ids.length>1)return {product:null,source:"Références ambiguës",suggestions:[]};
  return null;
 };
 if(skey){
  const aliases=(db?.manual_aliases||[]).filter(a=>code(a.supplier_key||a.supplier_name)===skey&&code(a.supplier_reference)===ref);
  const found=unique(aliases,"Association fournisseur confirmée");
  if(found)return found;
  const central=(db?.supplier_product_catalog||[]).filter(a=>code(a.supplier_key||a.supplier_name)===skey&&code(a.supplier_reference)===ref);
  const mapped=unique(central,"Référence fournisseur confirmée");
  if(mapped)return mapped;
 }
 const exact=products.filter(p=>code(p.code)===ref);
 if(exact.length===1)return {product:exact[0],source:"Référence catalogue exacte",suggestions:[]};
 if(exact.length>1)return {product:null,source:"Code catalogue ambigu",suggestions:[]};
 const label=norm(row.designation);
 const same=products.filter(p=>{
  const pName=norm(p.name),withoutPrefix=norm(String(p.name||"").replace(/^[a-z]-/i,""));
  return label.length>=7&&(pName===label||withoutPrefix===label);
 });
 if(same.length===1)return {product:same[0],source:"Désignation exacte",suggestions:[]};
 if(same.length>1)return {product:null,source:"Noms identiques multiples",suggestions:[]};
 const words=new Set(label.split(/\s+/).filter(w=>w.length>=4));
 const ranked=products.map(p=>{
  const tokens=new Set(norm(p.name).split(/\s+/).filter(w=>w.length>=4));
  const common=[...words].filter(w=>tokens.has(w)).length;
  return {p,score:common/Math.max(1,Math.max(words.size,tokens.size))};
 }).filter(x=>x.score>=.25).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.p);
 return {product:null,source:"Aucune correspondance certaine",suggestions:ranked};
}
const api={parse,format,check,match,decimal,norm};
if(typeof module==="object"&&module.exports)module.exports=api;
else root.InvoiceTableurCore=api;
})(typeof window!=="undefined"?window:this);
