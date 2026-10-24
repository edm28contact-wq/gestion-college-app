(function(root){
"use strict";
// Deterministic extraction only; no automatic modification of stock or accounting.
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const code=s=>norm(s).replace(/\s+/g,"");
const clean=s=>String(s??"").replace(/&nbsp;|&#160;|&#x20;/gi," ").replace(/[\u00a0\u202f\u2007]/g," ").trim();
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
// Preserve 4-decimal quantities and prices, then round the product to cents (half up).
const pricedTotal=(quantity,price)=>Number((BigInt(Math.round(quantity*10000))*BigInt(Math.round(price*10000))+500000n)/1000000n)/100;
function decimal(v){
 if(v===null||v===undefined||String(v).trim()==="")return null;
 const s=clean(v).replace(/[\s€%]/g,"").replace(",",".");
 if(!/^\d{1,9}(?:\.\d{1,4})?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
const number="\\d+(?:[.,]\\d{1,4})?";
const pomonaTail=new RegExp("^(.*?)\\s+("+number+")\\s+(COL|COLIS|PU|PCE|PCS|POT|BQT\\.?|BQTE\\.?|BT\\.?|BOUT|KG|L|SACH|BARQ|SEAU|SEAUX|SEA)\\s+("+number+")\\s+(PU|PCE|PCS|POT|BQT\\.?|BQTE\\.?|BT\\.?|BOUT|KG|L|COL|COLIS|SACH|BARQ|SEAU|SEAUX|SEA)\\s+("+number+")\\s+([A-Z])\\s*(\\d{1,2})\\s+("+number+")\\s*(?:EUR|€)?$","i");
const pomonaPrefix=/^(\d{1,3})\s*\/\s*(\d{2,14})\s+(.+)$/i;
const standardRE=/^([A-Z0-9][A-Z0-9._/-]{1,39})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-zÀ-ÿ.]{1,20})\s+(\d{1,2}(?:[.,]\d+)?)\s*%?\s+(\d+(?:[.,]\d{1,4})?)\s+(\d+(?:[.,]\d{1,2})?)\s*€?\s*$/i;
const validRef=s=>/^[A-Z0-9][A-Z0-9._/-]{1,39}$/i.test(String(s||""));
function standard(ref,label,q,unit,vat,pu,ht,raw){
 const quantity=decimal(q),rate=decimal(vat),price=decimal(pu),total=decimal(ht);
 if(!validRef(ref)||!clean(label)||quantity===null||quantity<=0||quantity>1000000||rate===null||rate>100||price===null||total===null)return null;
 return {layout:"standard",line_number:null,reference:clean(ref).toUpperCase(),designation:clean(label),delivered_quantity:quantity,delivered_unit:clean(unit),quantity,unit:clean(unit),vat:rate,vat_code:"",unit_price_ht:price,total_ht:total,sourceLine:raw,needs_review:false,review_reason:""};
}
function fromCells(cols,raw){
 const c=cols.map(clean);
 if(c.length>=11&&/^\d{1,3}$/.test(c[0])&&validRef(c[1])){
  const delivered=decimal(c[3]),priced=decimal(c[5]),pu=decimal(c[9]),total=decimal(c[10]);
  if(delivered!==null&&priced!==null&&pu!==null&&total!==null)
   return {layout:"pomona",line_number:Number(c[0]),reference:c[1],designation:c[2],delivered_quantity:delivered,delivered_unit:c[4],quantity:priced,unit:c[6],vat_code:c[7],vat:decimal(c[8]),unit_price_ht:pu,total_ht:total,sourceLine:raw,needs_review:false,review_reason:""};
 }
 if(c.length>=7)return standard(c[0],c[1],c[2],c[3],c[4],c[5],c[6],raw);
 return null;
}
function parseStandard(raw){
 const m=clean(raw).match(standardRE);
 return m?standard(m[1],m[2],m[3],m[4],m[5],m[6],m[7],raw):null;
}
function parsePomona(raw,rates){
 const prefix=clean(raw).match(pomonaPrefix),body=prefix?prefix[3]:clean(raw);
 const m=body.match(pomonaTail);
 if(!m)return prefix?{partial:{line_number:Number(prefix[1]),reference:prefix[2],designation:clean(prefix[3]),sourceLine:raw}}:null;
 const delivered=decimal(m[2]),priced=decimal(m[4]),price=decimal(m[6]),total=decimal(m[9]);
 if(delivered===null||priced===null||price===null||total===null||delivered<=0||priced<=0)return null;
 const vatCode=m[7].toUpperCase()+m[8],rate=rates[String(m[8])];
 const row={layout:"pomona",line_number:prefix?Number(prefix[1]):null,reference:prefix?prefix[2]:"",designation:clean(m[1]),delivered_quantity:delivered,delivered_unit:m[3].toUpperCase(),quantity:priced,unit:m[5].toUpperCase(),vat:rate??"",vat_code:vatCode,unit_price_ht:price,total_ht:total,sourceLine:raw,needs_review:false,review_reason:""};
 return prefix?{row}:{orphan:row};
}
function invoiceSummary(lines){
 const meta={vat_rates:{},expected_ht:null,expected_vat:null,expected_ttc:null,calculated_ht:null,difference:null,reconciled:null};
 const arr=lines.map(clean);
 for(let i=0;i<arr.length;i++){
  const ln=arr[i];
  const t=ln.match(/^(\d+(?:[.,]\d{2}))\s+(\d{1,2})\s+(\d{1,2}(?:[.,]\d{1,2}))\s+(\d+(?:[.,]\d{2}))\s*$/);
  if(t&&arr.slice(Math.max(0,i-4),i).some(x=>/montant\s+ht/i.test(x)&&/montant\s+tva/i.test(x))){
   const base=decimal(t[1]),rate=decimal(t[3]),vat=decimal(t[4]);
   if(base!==null&&rate!==null&&rate<=100&&vat!==null&&Math.abs(round(base*rate/100)-vat)<=.03){
    meta.vat_rates[t[2]]=rate;
    meta.expected_ht=round((meta.expected_ht??0)+base);
    meta.expected_vat=round((meta.expected_vat??0)+vat);
   }
  }
  const ttc=ln.match(/net\s+[àa]\s+payer\s*:\s*(\d+(?:[.,]\d{2}))\s*(?:eur|€)?/i);
  if(ttc)meta.expected_ttc=decimal(ttc[1]);
 }
 if(meta.expected_ht!==null&&meta.expected_vat!==null&&meta.expected_ttc!==null&&Math.abs(meta.expected_ht+meta.expected_vat-meta.expected_ttc)>.03)
  meta.summary_warning="Les totaux HT, TVA et TTC de la transcription ne concordent pas.";
 return meta;
}
function continuation(text){
 const s=clean(text);
 return s.length>=5&&s.length<=80&&!/[\d:;@]/.test(s)&&!/^(?:n[°o]\b|total\b|exp[eé]dition\b|ajout\b|fournisseur\b|d[eé]signation\b|livraison\b|facture\b|report\b|se reporter\b)/i.test(s)&&/^[A-Za-zÀ-ÿ '"’.-]+$/.test(s)&&s.split(/\s+/).length<=5;
}
function format(rows){
 const wide=rows.some(r=>r.layout==="pomona");
 const out=wide?["Ligne\tArticle\tDésignation\tQté livrée\tUnité livrée\tQté facturée\tUnité fact.\tCode TVA\tTVA %\tPU HT\tTotal HT"]:["Référence\tDésignation\tQuantité\tUnité\tTVA %\tPrix HT\tTotal HT"];
 for(const r of rows){
  const vals=wide?[r.line_number??"",r.reference,r.designation,r.delivered_quantity??r.quantity,r.delivered_unit??r.unit,r.quantity,r.unit,r.vat_code??"",r.vat??"",r.unit_price_ht,r.total_ht]:[r.reference,r.designation,r.quantity,r.unit,r.vat,r.unit_price_ht,r.total_ht];
  out.push(vals.map(x=>clean(x).replace(/[\t\r\n]+/g," ")).join("\t"));
 }
 return out.join("\n");
}
function parse(text){
 const empty=()=>({rows:[],ignored:0,ignoredLines:[],unresolvedLines:[],cleanedText:"",meta:{},error:""});
 if(typeof text!=="string"||text.length>150000)return {...empty(),error:"Texte trop volumineux (150 000 caractères maximum)."};
 const lines=text.replace(/\r\n?/g,"\n").split("\n");
 const pomona=/\bpomona\b/i.test(text)||/Qt[eé]\s+fact/i.test(text)||lines.some(x=>pomonaPrefix.test(clean(x)));
 const meta=invoiceSummary(lines),rows=[],ignoredLines=[],unresolvedLines=[],orphan=[],partial=[];
 for(let i=0;i<Math.min(lines.length,1000);i++){
  const raw=clean(lines[i]);if(!raw)continue;
  let row=null,line=raw;
  if(raw.startsWith("|")){
   const cols=raw.split("|").slice(1,raw.endsWith("|")?-1:undefined).map(clean);
   if(cols.every(c=>!c||/^:?-{3,}:?$/.test(c)))continue;
   row=fromCells(cols,raw);
   if(!row)line=cols.find(c=>c)||"";
  }else if(raw.includes("\t"))row=fromCells(raw.split("\t"),raw);
  else if(raw.includes(";")&&raw.split(";").length>=7)row=fromCells(raw.split(";"),raw);
  if(row){row.sourceLineNumber=i+1;rows.push(row);continue;}
  if(pomona){
   const parsed=parsePomona(line,meta.vat_rates);
   if(parsed?.row){parsed.row.sourceLineNumber=i+1;rows.push(parsed.row);continue;}
   if(parsed?.partial){partial.push({...parsed.partial,sourceLineNumber:i+1});continue;}
   if(parsed?.orphan){orphan.push({...parsed.orphan,sourceLineNumber:i+1});continue;}
  }
  row=parseStandard(line);
  if(row){row.sourceLineNumber=i+1;rows.push(row);continue;}
  if(!pomona&&rows.length&&continuation(line)){
   const prev=rows[rows.length-1];
   if(prev.sourceLineNumber===i&&prev.designation.split(/\s+/).length<25){
    prev.designation+=" "+line;prev.sourceLine+="\n"+raw;continue;
   }
  }
  ignoredLines.push({line:i+1,text:line});
 }
 // A top-of-page priced fragment can complete a bottom-of-page article.
 // Reassemble only a unique unambiguous pair, then require human verification.
 if(partial.length===1&&orphan.length===1&&Math.abs(orphan[0].sourceLineNumber-partial[0].sourceLineNumber)<80){
  const head=partial[0],tail=orphan[0];
  rows.push({...tail,line_number:head.line_number,reference:head.reference,designation:head.designation+" "+tail.designation,
   sourceLine:head.sourceLine+"\n"+tail.sourceLine,sourceLineNumber:head.sourceLineNumber,
   needs_review:true,review_reason:"Ligne coupée et remise dans l'ordre ; désignation à vérifier sur la facture."});
 }else{
  for(const item of partial)unresolvedLines.push({line:item.sourceLineNumber,text:item.sourceLine,reason:"Début d'article sans prix ni quantités : rapprochement nécessaire."});
  for(const item of orphan)unresolvedLines.push({line:item.sourceLineNumber,text:item.sourceLine,reason:"Fin de ligne tarifée sans code article : à rattacher manuellement."});
 }
 // Refill the tax-rate column when lines are pasted from a table but the invoice VAT summary is present.
 for(const r of rows){
  if(r.layout==="pomona"&&(r.vat===null||r.vat===undefined||r.vat==="")){
   const rateCode=String(r.vat_code||"").match(/(\d{1,2})$/)?.[1];
   if(rateCode&&Object.prototype.hasOwnProperty.call(meta.vat_rates,rateCode))r.vat=meta.vat_rates[rateCode];
  }
 }
 // OCR engines occasionally duplicate an identical numbered line. Keep one and preserve
 // conflicting duplicates as review items rather than silently summing a repeated charge.
 const uniqueRows=[],seen=new Map();
 for(const row of rows){
  const key=row.layout==="pomona"&&row.line_number!==null&&row.reference?row.line_number+"|"+code(row.reference):null;
  if(!key){uniqueRows.push(row);continue}
  const previous=seen.get(key);
  if(previous){
   const same=["quantity","delivered_quantity","unit_price_ht","total_ht"].every(k=>decimal(previous[k])===decimal(row[k]))
    &&norm(previous.designation)===norm(row.designation);
   if(same){
    ignoredLines.push({line:row.sourceLineNumber,text:row.sourceLine,reason:"Ligne déjà reconnue : doublon exact écarté."});
    continue;
   }
   previous.needs_review=true;
   previous.review_reason="Deux lignes portent le même numéro/référence avec des données différentes.";
   row.needs_review=true;
   row.review_reason=previous.review_reason;
  }else seen.set(key,row);
  uniqueRows.push(row);
 }
 rows.splice(0,rows.length,...uniqueRows);
 if(pomona)rows.sort((a,b)=>(a.line_number??9999)-(b.line_number??9999)||a.sourceLineNumber-b.sourceLineNumber);
 if(meta.expected_ht!==null){
  meta.calculated_ht=round(rows.reduce((n,r)=>n+(decimal(r.total_ht)||0),0));
  meta.difference=round(meta.calculated_ht-meta.expected_ht);
  meta.reconciled=unresolvedLines.length===0&&Math.abs(meta.difference)<=.02;
 }
 meta.layout=pomona?"Pomona (colis livrés / unités facturées)":"Classique (quantité unique)";
 meta.reconstructed=rows.filter(r=>r.needs_review).length;
 return {rows,ignored:ignoredLines.length,ignoredLines,unresolvedLines,cleanedText:format(rows),meta,error:rows.length?"":"Aucune ligne de produit complète détectée. Vérifiez le format de la transcription."};
}
function check(row){
 const q=decimal(row.quantity),delivered=decimal(row.delivered_quantity),pu=decimal(row.unit_price_ht),ht=decimal(row.total_ht),vat=decimal(row.vat);
 if(q===null||q<=0||pu===null||ht===null||delivered===null||delivered<=0||(vat!==null&&vat>100))return {ok:false,text:"Quantités, taux ou prix incomplets / invalides"};
 const expected=pricedTotal(q,pu),ok=Math.abs(expected-ht)<=.02;
 return {ok,expected,text:ok?"Calcul HT correct":"Écart HT : "+expected.toFixed(2)+" € attendu"};
}
function detectProfile(text,db){
 const t=norm(text).replace(/\s+/g," ");
 if(/passion\s*froid|passionfroid/.test(t)&&/qt[eé]?\s*livr[eé]e|qt[eé]?\s*fact|article\s*[-–]/i.test(t)||/passionfroid/.test(t))return {supplier_key:"passionfroid",supplier_name:"PASSION FROID",layout_type:"pomona"};
 if(/henri\s*julien|henrijulien/.test(t))return {supplier_key:"henrijulien",supplier_name:"HENRI JULIEN",layout_type:"standard"};
 if(/la\s*normande/.test(t)&&/mise\s+a\s+disposition|repas\s+livres|facturation/.test(t))return {supplier_key:"lanormande",supplier_name:"LA NORMANDE",layout_type:"la_normande"};
 return null;
}
function supplierKey(name,db){
 const key=code(name);
 if(!key)return "";
 const profiles=db?.layout_profiles||[];
 const matched=profiles.find(p=>code(p.supplier_key)===key||code(p.supplier_name)===key);
 if(matched)return code(matched.supplier_key);
 if(key==="pomona"||key.includes("passionfroid"))return "passionfroid";
 if(key.includes("henrijulien"))return "henrijulien";
 if(key.includes("lanormande"))return "lanormande";
 return key;
}
function match(row,db,supplier){
 const products=(db?.products||[]).filter(p=>p.active!==false),ref=code(row.reference),skey=supplierKey(supplier,db);
 const layout=String(row.layout||"standard");
 // Confirmed mappings always take precedence over historic observations.
 const confirmed=(db?.verified_mappings||[]).filter(m=>code(m.supplier_key)===skey&&String(m.layout_type)===layout&&code(m.supplier_reference_norm||m.supplier_reference)===ref);
 if(skey&&confirmed.length===1){
  const item=products.find(p=>p.id===confirmed[0].product_id);
  if(item)return {product:item,source:"Association vérifiée pour ce fournisseur et ce format",suggestions:[],confirmed:true};
  return {product:null,source:"Ancienne association : produit inactif ou absent, à vérifier",suggestions:[],conflict:true};
 }
 if(skey&&confirmed.length>1)return {product:null,source:"Associations vérifiées contradictoires, à contrôler",suggestions:[],conflict:true};
 const unique=(items,source)=>{
  const ids=[...new Set(items.map(x=>x.id||x.product_id).filter(Boolean))];
  if(ids.length===1){const p=products.find(x=>x.id===ids[0]);if(p)return {product:p,source,suggestions:[]};}
  if(ids.length>1)return {product:null,source:"Références ambiguës",suggestions:[]};
  return null;
 };
 if(skey){
  const aliases=(db?.manual_aliases||[]).filter(a=>code(a.supplier_key||a.supplier_name)===skey&&code(a.supplier_reference)===ref);
  const found=unique(aliases,"Association fournisseur confirmée");if(found)return found;
  const central=(db?.supplier_product_catalog||[]).filter(a=>code(a.supplier_key||a.supplier_name)===skey&&code(a.supplier_reference)===ref);
  const mapped=unique(central,"Référence fournisseur confirmée");if(mapped)return mapped;
 }
 const seen=(db?.product_observations||[]).filter(o=>code(o.supplier_key)===skey&&String(o.layout_type)===layout&&code(o.supplier_reference_norm||o.supplier_reference)===ref);
 if(skey&&seen.length===1&&seen[0].match_basis==="reference_exact"){
  const p=products.find(p=>p.id===seen[0].product_id);
  if(p)return {product:p,source:"Référence historique retrouvée ("+seen[0].observed_documents+" facture(s)) — à confirmer",suggestions:[],historical:true};
 }
 if(skey&&seen.length>1)return {product:null,source:"Historique ambigu : vérifier",suggestions:seen.map(o=>products.find(p=>p.id===o.product_id)).filter(Boolean)};
 const exact=products.filter(p=>code(p.code)===ref);
 if(exact.length===1)return {product:exact[0],source:"Référence catalogue exacte",suggestions:[]};
 if(exact.length>1)return {product:null,source:"Code catalogue ambigu",suggestions:[]};
 const label=norm(row.designation);
 const same=products.filter(p=>{const pName=norm(p.name),withoutPrefix=norm(String(p.name||"").replace(/^[a-z]-/i,""));return label.length>=7&&(pName===label||withoutPrefix===label)});
 if(same.length===1)return {product:same[0],source:"Désignation exacte",suggestions:[]};
 if(same.length>1)return {product:null,source:"Noms multiples",suggestions:[]};
 const words=new Set(label.split(/\s+/).filter(w=>w.length>=4));
 const suggestions=products.map(p=>{const t=new Set(norm(p.name).split(/\s+/).filter(w=>w.length>=4));return {p,score:[...words].filter(w=>t.has(w)).length/Math.max(1,Math.max(words.size,t.size))}}).filter(x=>x.score>=.25).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.p);
 return {product:null,source:"À associer manuellement",suggestions};
}

// Reconcile corrected/pasted product lines without duplicating a unique supplier reference.
function mergeRows(existing,incoming,replaceAll=false){
 const old=Array.isArray(existing)?existing:[],items=Array.isArray(incoming)?incoming:[];
 const output=replaceAll?[]:old.map(r=>({...r})),used=new Set();
 let added=0,updated=0,unchanged=0,ambiguous=0;
 const fields=["reference","designation","delivered_quantity","delivered_unit","quantity","unit","vat_code","vat","unit_price_ht","total_ht"];
 function equal(a,b){
  return fields.every(k=>["quantity","delivered_quantity","vat","unit_price_ht","total_ht"].includes(k)?
    decimal(a?.[k])===decimal(b?.[k]):norm(a?.[k])===norm(b?.[k]));
 }
 function locate(row){
  const ref=code(row.reference);if(!ref)return -1;
  const candidates=old.map((r,i)=>({r,i})).filter(x=>!used.has(x.i)&&code(x.r.reference)===ref);
  if(!candidates.length)return -1;
  if(row.line_number!=null){
   const exact=candidates.filter(x=>x.r.line_number!=null&&Number(x.r.line_number)===Number(row.line_number));
   if(exact.length===1)return exact[0].i;
   if(exact.length>1)return -2;
  }
  const same=candidates.filter(x=>equal(x.r,row));
  if(same.length===1)return same[0].i;
  if(candidates.length===1&&(row.line_number==null||candidates[0].r.line_number==null))return candidates[0].i;
  return -2;
 }
 function combine(row,index){
  if(index<0)return {...row,product_id:"",verified:false,manual_corrected:true};
  const prev=old[index];
  // A short corrected line must never turn two delivered cartons into 276 cartons.
  const carry=prev.layout==="pomona"&&row.layout!=="pomona"?
   {...row,layout:"pomona",line_number:prev.line_number,delivered_quantity:prev.delivered_quantity,
    delivered_unit:prev.delivered_unit,vat_code:prev.vat_code||row.vat_code}:row;
  const same=equal(prev,carry)&&Number(prev.line_number??-1)===Number(carry.line_number??-1);
  return {...prev,...carry,product_id:prev.product_id||"",verified:same?!!prev.verified:false,
   needs_review:same?!!prev.needs_review:!!carry.needs_review,manual_corrected:!same||!!prev.manual_corrected};
 }
 for(const item of items){
  const index=locate(item);
  if(index>=0){
   const next=combine(item,index);used.add(index);
   if(replaceAll)output.push(next);else output[index]=next;
   if(equal(old[index],next)&&!!old[index].verified===!!next.verified)unchanged++;else updated++;
  }else{
   if(index===-2)ambiguous++;
   output.push(combine(item,-1));added++;
  }
 }
 if(output.some(x=>x.line_number!==null&&x.line_number!==undefined))
  output.sort((a,b)=>Number(a.line_number??999999)-Number(b.line_number??999999));
 return {rows:output,added,updated,unchanged,ambiguous};
}
const api={parse,format,check,match,supplierKey,mergeRows,detectProfile,decimal,norm};
if(typeof module==="object"&&module.exports)module.exports=api;
else root.InvoiceTableurCore=api;
})(typeof window!=="undefined"?window:this);
