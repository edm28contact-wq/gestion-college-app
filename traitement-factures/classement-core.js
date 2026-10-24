(function(root) {
"use strict";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function decimal(v) {
 if(v===null||v===undefined||String(v).trim()==="")return null;
 let s=String(v).replace(/[\s\u00a0€]/g,"");
 if(s.includes(",")&&s.includes("."))s=s.lastIndexOf(",")>s.lastIndexOf(".")?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
 else s=s.replace(",",".");
 if(!/^-?\d+(?:\.\d+)?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
const empty=(page,raw)=>({page,raw,reference:"",product_id:"",qty:"",unit:"",vat:"",ht:"",ttc:"",account:"",checked:false,match_source:"",read_status:""});
function matchesToken(text,ref) {
 const pattern=ref.replace(/[^\w]/g,"\\$&");
 return new RegExp("(?:^|[^a-z0-9])"+pattern+"(?=$|[^a-z0-9])","i").test(text);
}
function matchProduct(text,db,supplier) {
 const sameSupplier=(a,b)=>norm(a).replace(/\s/g,"")===norm(b).replace(/\s/g,"");
 const products=(db?.products||[]).filter(p=>p.active!==false);
 const codes=products.filter(p=>String(p.code||"").length>=3&&matchesToken(text,String(p.code)));
 if(codes.length===1)return {product:codes[0],source:"Référence exacte"};
 if(codes.length>1)return {source:"Références multiples"};
 const line=norm(text),names=products.filter(p=>norm(p.name).length>=9&&line.includes(norm(p.name)));
 if(names.length===1)return {product:names[0],source:"Nom exact"};
 if(names.length>1)return {source:"Noms multiples"};
 const skey=norm(supplier);
 const aliases=(db?.learned_products||[]).filter(a=>skey&&sameSupplier(a.supplier_key,skey)&&
   (norm(a.product_name).length>=9&&line.includes(norm(a.product_name))||
    String(a.product_code||"").length>=3&&matchesToken(text,String(a.product_code))));
 const ids=[...new Set(aliases.map(a=>a.product_id))];
 if(ids.length===1){const p=products.find(x=>x.id===ids[0]);if(p)return {product:p,source:"Apprentissage fournisseur"};}
 if(ids.length>1)return {source:"Aliases multiples"};
 const central=(db?.supplier_product_catalog||[]).filter(a=>a.product_id&&a.supplier_name&&sameSupplier(a.supplier_name,supplier)&&((a.supplier_reference&&matchesToken(text,a.supplier_reference))||(a.product_code&&matchesToken(text,a.product_code))||(norm(a.supplier_product_name).length>=8&&norm(text).includes(norm(a.supplier_product_name)))));
 const centralIds=[...new Set(central.map(a=>a.product_id))];
 if(centralIds.length===1){const p=products.find(x=>x.id===centralIds[0]);if(p)return {product:p,source:"Catalogue central fournisseur"};}
 return {source:centralIds.length>1?"Correspondances fournisseur multiples":"Produit non reconnu"};
}
function charge(text,p,db,supplier) {
 const skey=norm(supplier),accountSet=new Set((db?.accounts||[]).map(a=>String(a.account)));
 const central=(db?.supplier_product_catalog||[]).filter(row=>row.product_id===p?.id&&row.account&&norm(row.supplier_name).replace(/\s/g,"")===skey.replace(/\s/g,""));
 const centralAccounts=[...new Set(central.filter(row=>row.account_source==="Historique comptable exact").map(row=>row.account))];
 if(centralAccounts.length===1)return centralAccounts[0];
 const choices=(db?.keywords||[]).filter(k=>{
  if(!accountSet.has(String(k.expense_account)))return false;
  if(k.supplier_key&&norm(k.supplier_key).replace(/\s/g,"")!==skey.replace(/\s/g,""))return false;
  const word=norm(k.keyword);
  return word.length>=3&&(norm(p?.code)===word||norm(text).includes(word));
 });
 const accounts=[...new Set(choices.map(k=>String(k.expense_account)))];
 if(accounts.length===1)return accounts[0];
 if(accounts.length>1)return "";
 const rs=(db?.supplier_rules||[]).filter(r=>skey&&norm(r.supplier_key||r.supplier_name).replace(/\s/g,"")===skey.replace(/\s/g,""));
 if(rs.length!==1)return "";
 const defaults=(db?.supplier_charges||[]).filter(c=>c.supplier_rule_id===rs[0].id&&c.is_default&&accountSet.has(String(c.expense_account)));
 if(defaults.length===1)return String(defaults[0].expense_account);
 if(rs[0].expense_account&&accountSet.has(String(rs[0].expense_account)))return String(rs[0].expense_account);
 const centralDefaults=[...new Set(central.filter(row=>row.account_source==="Compte par défaut fournisseur (à vérifier)").map(row=>row.account))];
 return centralDefaults.length===1?centralDefaults[0]:"";
}
function amounts(line,product) {
 const code=String(product?.code||"");
 if(code){const pos=line.toLowerCase().indexOf(code.toLowerCase());if(pos>=0)line=line.slice(pos+code.length);}
 const numbers=[...line.matchAll(/(?:^|[\s|;:])(-?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)(?=$|[\s|;€%])/g)]
  .map(m=>decimal(m[1])).filter(n=>n!==null).slice(-9);
 const possibilities=[];
 for(let i=Math.max(0,numbers.length-5);i+2<numbers.length;i++){
  const [q,pu,ht]=numbers.slice(i,i+3);
  if(!(q>0&&q<=100000&&pu>=0&&ht>=0))continue;
  if(Math.abs(Math.round(q*pu*100)/100-ht)>.02)continue;
  let ttc=null,vat=null;
  for(const n of numbers.slice(i+3)){
   const r=ht>0?(n/ht-1)*100:0;
   const found=[0,2.1,5.5,10,20].find(v=>n+.02>=ht&&Math.abs(r-v)<.16);
   if(found!==undefined){ttc=n;vat=found;break;}
  }
  possibilities.push({qty:q,unit:pu,ht,ttc,vat});
 }
 return possibilities.length===1?{...possibilities[0],quality:"Qté × PU = HT"}:{ambiguous:true,quality:possibilities.length?"Plusieurs quantités possibles":"Quantité à contrôler"};
}
function classify(inputs,db,supplier) {
 const matched=[],excluded=[];
 for(const input of inputs) {
  const raw=String(input.raw||"").trim();if(!raw)continue;
  const hit=matchProduct(raw,db,supplier);
  if(!hit.product){excluded.push({page:input.page||1,raw,reason:hit.source});continue;}
  const r=empty(input.page||1,raw),parsed=amounts(raw,hit.product);
  r.product_id=hit.product.id;r.reference=hit.product.code;r.match_source=hit.source;r.account=charge(raw,hit.product,db,supplier);
  r.read_status=parsed.quality;
  const quantities=raw.match(/(\d+(?:[,.]\d+)?)\s*(COL|COLIS)\b[^\n]{0,36}?(\d+(?:[,.]\d+)?)\s*(POT|POTS|PCE|PCS|PI[EÈ]CES?|UNIT[EÉ]S?|KG|L|BTL|BT|BARQ|SACHETS?)\b/i);
  if(quantities){
   const cartons=decimal(quantities[1]),priced=decimal(quantities[3]);
   if(cartons>0&&priced>0&&priced>=cartons){
    r.qty=String(cartons);r.stock_qty=String(priced);r.stock_factor=priced/cartons;
    r.unit_label=quantities[2].toUpperCase();r.priced_unit_label=quantities[4].toUpperCase();
    r.read_status="Quantités facture : "+cartons+" "+r.unit_label+" = "+priced+" "+r.priced_unit_label;
    const tail=raw.slice(quantities.index+quantities[0].length);
    const candidates=[...tail.matchAll(/(?:^|\s)(\d{1,8}[,.]\d{2,4})(?=\s|$)/g)]
      .map(m=>decimal(m[1])).filter(n=>n!==null&&n>=0);
    const solutions=[];
    for(let i=0;i<candidates.length;i++){
     for(let j=i+1;j<candidates.length;j++){
      const pu=candidates[i],total=candidates[j];
      if(Math.abs(Math.round(priced*pu*100)/100-total)<=0.02)
       solutions.push({unit:pu,ht:total});
     }
    }
    if(solutions.length===1){
     r.unit=String(solutions[0].unit);r.ht=String(solutions[0].ht);
     r.read_status="Quantité × prix unitaire = HT sur "+priced+" "+r.priced_unit_label;
    }
   }
  }
  if(!parsed.ambiguous && !r.stock_qty){r.qty=String(parsed.qty);r.unit=String(parsed.unit);r.ht=String(parsed.ht);if(parsed.ttc!==null)r.ttc=String(parsed.ttc);if(parsed.vat!==null)r.vat=String(parsed.vat);}
  matched.push(r);
 }
 return {matched,excluded};
}
function check(row,db) {
 const errors=[],warnings=[],product=(db?.products||[]).find(p=>p.id===row.product_id);
 const accountSet=new Set((db?.accounts||[]).map(a=>String(a.account)));
 const q=decimal(row.qty),pu=decimal(row.unit),ht=decimal(row.ht),ttc=decimal(row.ttc),vat=decimal(row.vat);
 if(!product)errors.push("Produit non confirmé");
 if(!row.account||!accountSet.has(String(row.account)))errors.push("Compte de charge à choisir");
 if(q===null||q<=0)errors.push("Quantité à vérifier");
 if(pu===null||pu<0)errors.push("Prix unitaire HT à vérifier");
 if(ht===null||ht<0)errors.push("Total HT à vérifier");
 if(ttc!==null&&ttc<0)errors.push("Total TTC invalide");
 if(vat!==null&&(vat<0||vat>100))errors.push("Taux TVA invalide");
 const pricedQty=row.stock_qty!==undefined&&decimal(row.stock_qty)!==null?decimal(row.stock_qty):q;
 if(q!==null&&row.stock_qty!==undefined&&decimal(row.stock_qty)!==null&&Number.isFinite(Number(row.stock_factor))&&Number(row.stock_factor)>0&&
    Math.abs(q*Number(row.stock_factor)-decimal(row.stock_qty))>0.01)
  errors.push("Colis × conditionnement différent de la quantité tarifée");
 if(pricedQty!==null&&pu!==null&&ht!==null&&Math.abs(Math.round(pricedQty*pu*100)/100-ht)>.02)
  errors.push("Quantité tarifée × PU HT ≠ total HT");
 if(ht!==null&&ttc!==null){
  if(ttc+.02<ht)errors.push("TTC inférieur au HT");
  if(vat!==null&&Math.abs(Math.round(ht*(1+vat/100)*100)/100-ttc)>.02)errors.push("HT + TVA ≠ TTC");
 }
 const factor=Number(product?.purchase_to_stock_factor??1);
 const stockQty=row.stock_qty!==undefined&&decimal(row.stock_qty)!==null?decimal(row.stock_qty):(q!==null&&q>0&&Number.isFinite(factor)&&factor>0?q*factor:null);
 if(product?.stock_count_mode!=="litre"&&stockQty!==null&&Math.abs(stockQty-Math.round(stockQty))>1e-8)warnings.push("Stock fractionnaire à contrôler");
 if(row.stock_qty&&row.stock_factor&&Math.abs(row.stock_factor-factor)>0.001)warnings.push("Conditionnement facture ×"+row.stock_factor+" différent de la fiche produit ×"+factor);
 if(row.read_status&&/ambigu|incoh[ée]rent|non v[ée]rifi[ée]/i.test(row.read_status))warnings.push(row.read_status);
 return {errors,warnings,stockQty,factor,ready:errors.length===0};
}
const api={norm,decimal,empty,matchProduct,charge,amounts,classify,check};
if(typeof module==="object"&&module.exports)module.exports=api;
else root.InvoiceClassify=api;
})(typeof window!=="undefined"?window:this);