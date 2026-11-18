// Deterministic, conservative invoice triage; no database or stock operations.
export const clean = value => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const money = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim().replace(/[\u00a0\u202f €]/g, "");
  if (!raw || !/^-?[0-9][0-9.,]*$/.test(raw)) return null;
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  if (comma !== -1 && dot !== -1) {
    const sep = Math.max(comma, dot);
    const decimalPart = raw.length - 1 - sep;
    if (decimalPart > 2) return null;
    const v = Number(raw.slice(0, sep).replace(/[.,]/g, "") + "." + raw.slice(sep + 1));
    return Number.isFinite(v) ? v : null;
  }
  const separator = comma !== -1 ? "," : dot !== -1 ? "." : null;
  if (!separator) return Number(raw);
  if ((raw.match(new RegExp("\\" + separator, "g")) || []).length !== 1) return null;
  const frac = raw.split(separator)[1];
  if (frac.length > 2) return null; // 2,000 could mean 2 or 2000; do not guess.
  return Number(raw.replace(",", "."));
};
const positive = n => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const unique = arr => [...new Set(arr.filter(Boolean))];
export function invoiceLabel(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  // Preserve internal manufacturer pack sizes such as 115Gx4x12.
  return clean(text
    .replace(/\s+\d{1,8}(?:[.,]\d{1,3})?\s+(?:COL|COLIS|CARTONS?|CTNS?)\s+\d{1,8}(?:[.,]\d{1,3})?\s+(?:POTS?|PU|PCS?|PCE|PIECES?|KG|LITRES?|BOUTEILLES?|BARQUETTES?)\s*$/i, "")
    .replace(/\s+\d{1,8}[.,]\d{3}\s+(?:POTS?|PU|PCS?|PCE|PIECES?|KG|LITRES?|BOUTEILLES?|BARQUETTES?)\s*$/i, ""));
}
const unit = value => {
  const v = clean(value);
  const groups = {
    piece:["piece","pieces","unite","unites","pu","pce","pcs","pc","u"],
    pot:["pot","pots"], carton:["carton","cartons","col","colis","ctn"],
    litre:["l","lt","litre","litres","ltr"], kg:["kg","kgs","kilogramme"],
    bidon:["bidon","bidons"], boite:["boite","boites","bte"],
    lot:["lot","lots"], bouteille:["bt","bouteille","bouteilles"],
    rouleau:["rouleau","rouleaux"], sachet:["sachet","sachets","sac"],
    barquette:["barquette","barquettes"], ramette:["ramette","ramettes"],
  };
  return Object.entries(groups).find(([, aliases]) => aliases.includes(v))?.[0] || v;
};
const physical = product => {
  if (product.stock_count_mode === "litre") return "litre";
  const label = String(product.inventory_unit_label || product.unit || "");
  const key = clean(label);
  if (key.startsWith("rouleau")) return "rouleau";
  if (key.startsWith("sachet")) return "sachet";
  return unit(label);
};
const auditedFactors = { RV40:20, TH49:10, VN19:4, VW27:4, VX38:8, XV90:5 };
function stockFromInvoice(line, product) {
  const qty = money(line.quantity), factor = money(product.purchase_to_stock_factor);
  if (!positive(qty) || !positive(factor)) return {quantity:null,ok:false,reason:"Quantité ou coefficient d'achat invalide"};
  const invoice = unit(line.unit), purchase = unit(product.unit), stored = physical(product);
  if (!invoice) return {quantity:null,ok:false,reason:"Unité facturée non lue"};
  if (factor === 1) {
    if (invoice === purchase && purchase === stored) return {quantity:qty,ok:true};
    if (invoice === "piece" && purchase === stored && ["pot","bouteille","sachet","barquette"].includes(purchase))
      return {quantity:qty,ok:false,reason:"Pièce générique : confirmer le conditionnement"};
    return {quantity:null,ok:false,reason:"Unité facturée incompatible avec l'unité de stock"};
  }
  if (auditedFactors[product.code] !== factor)
    return {quantity:null,ok:false,reason:"Coefficient de conversion non vérifié"};
  const pack = clean(product.conditionnement), invoicePackage = ["bidon","carton","boite","lot"].includes(invoice);
  const matchedPack = invoicePackage && pack.startsWith(invoice);
  if (invoice === purchase || matchedPack) {
    const result = Math.round(qty * factor * 1000) / 1000;
    return {quantity:result,ok:true,reason:"Conversion fournisseur vérifiée"};
  }
  return {quantity:null,ok:false,reason:"Conditionnement fournisseur différent de la fiche"};
}
function matchProduct(line, supplier, catalog, aliases) {
  const ref = clean(line.product_code), label = invoiceLabel(line.description);
  const active = (catalog.products || []).filter(p => p.active !== false);
  const verified = (catalog.verified_mappings || []).filter(x =>
    Number(x.verification_count || 0)>0 && clean(x.supplier_key || x.supplier_name) === supplier &&
    clean(x.supplier_reference_norm || x.supplier_reference) === ref && ref);
  const aliasRef = (aliases || []).filter(a => a.alias_kind === "reference" &&
    clean(a.supplier_key) === supplier && clean(a.keyword_norm || a.keyword) === ref && ref);
  const exactName = active.filter(p => invoiceLabel(p.name) === label && label.length >= 8);
  const directRef = active.filter(p => clean(p.code) === ref && ref);
  const verifiedIds = unique(verified.map(x=>x.product_id));
  const aliasIds = unique(aliasRef.map(x=>x.product_id));
  const knownIds = unique([...verifiedIds,...aliasIds]);
  if (knownIds.length > 1 || directRef.length > 1 || exactName.length > 1)
    return {product:null,ambiguous:true,reason:"Correspondances fournisseurs contradictoires"};
  if (knownIds.length && directRef.length && knownIds[0] !== directRef[0].id)
    return {product:null,ambiguous:true,reason:"Référence fournisseur et catalogue contradictoires"};
  if (knownIds.length && exactName.length && knownIds[0] !== exactName[0].id)
    return {product:null,ambiguous:true,reason:"Référence et désignation fournisseur contradictoires"};
  if (directRef.length && exactName.length && directRef[0].id !== exactName[0].id)
    return {product:null,ambiguous:true,reason:"Référence et désignation catalogue contradictoires"};
  const candidateId=knownIds[0] || directRef[0]?.id || exactName[0]?.id;
  let product=active.find(p=>p.id===candidateId);
  if (!product) {
    const history=(catalog.supplier_product_catalog||[]).filter(x=>
      clean(x.supplier_key||x.supplier_name)===supplier &&
      (ref && clean(x.supplier_reference)===ref ||
       label.length>=8 && invoiceLabel(x.supplier_product_name)===label));
    const ids=unique(history.map(h=>h.product_id));
    if(ids.length===1)product=active.find(p=>p.id===ids[0]);
    if(ids.length>1)return {product:null,ambiguous:true,reason:"Historique fournisseur ambigu"};
    if(product)return {product,confirmed:false,reason:"Produit proposé par l'historique fournisseur"};
    return {product:null,ambiguous:false,reason:"Produit absent du catalogue actif"};
  }
  const fullName = exactName.length===1;
  const verifiedLabel = verified.some(v=>v.product_id===product.id &&
    invoiceLabel(v.supplier_label)===label && label.length>=8);
  const aliasLabel = (aliases || []).some(a=>a.product_id===product.id && a.alias_kind!=="reference" &&
    clean(a.supplier_key)===supplier && invoiceLabel(a.keyword)===label && label.length>=8);
  const provenReference = verifiedIds.includes(product.id) || aliasIds.includes(product.id) || directRef.some(p=>p.id===product.id);
  return {product,confirmed:Boolean(provenReference && (fullName||verifiedLabel||aliasLabel)),
    reason:provenReference?"Référence connue, désignation à vérifier":"Désignation exacte, référence fournisseur non vérifiée"};
}
function corroboration(line, scans) {
  // Text search can assist review, but is NOT proof of a value or its row position.
  const ref=clean(line.product_code);
  return scans.some(s=>s.provider==="ocrspace" && s.status==="review" && ref.length>=4 && clean(s.ocr_text).includes(ref));
}
export function evaluateInvoice({readings=[],catalog={},aliases=[]}) {
  const azure = readings.filter(r=>r.provider==="azure_invoice" && r.status==="review" &&
    r.structured_result && Array.isArray(r.structured_result.items));
  const textOnly=readings.filter(r=>r.provider==="ocrspace" && r.status==="review");
  if (!azure.length) return {
    version:1,ready:false,needs_review:true,retry_needed:true,orange_lines:0,red_lines:0,green_lines:0,
    reasons:["Aucune lecture structurée Azure exploitable : OCR.space fournit uniquement du texte libre"],
    lines:[],source_count:textOnly.length,comparison_complete:false,
  };
  const latest=azure.at(-1),structured=latest.structured_result;
  const otherAzure=azure.slice(0,-1);
  const supplier=clean(structured.supplier);
  const rows=structured.items.slice(0,300);
  // A page-count of two cannot prove full coverage under Azure F0; never auto-accept it.
  const missingCoverage=Number(latest.page_count)!==1 || structured.partial_document_possible===true;
  const lines=rows.map((source,index)=>{
    const line={index:index+1,reference:String(source.product_code||""),description:String(source.description||""),
      quantity:source.quantity,unit:source.unit,unit_price:source.unit_price,total:source.amount,
      confidence:Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
      matched_product_id:null,matched_product_name:null,stock_quantity:null,status:"orange",excluded:false,
      reasons:[],corroborated_text:corroboration(source, textOnly)};
    const match=matchProduct(source,supplier,catalog,aliases);
    if(match.product){
      line.matched_product_id=match.product.id;
      line.matched_product_name=match.product.name;
    } else if(!match.ambiguous && line.description && Number(source.confidence)>=0.85 && !missingCoverage){
      line.status="red";line.excluded=true;line.reasons.push("Produit absent du catalogue actif : exclu de la réception, récupérable manuellement");
      return line;
    } else {
      line.reasons.push(match.reason);
      return line;
    }
    if(!match.confirmed)line.reasons.push(match.reason);
    const q=money(source.quantity),p=money(source.unit_price),t=money(source.amount);
    if(!positive(q)||p===null||p<0||t===null||t<0||Math.abs(round(q*p)-t)>.02)
      line.reasons.push("Quantité × prix HT ≠ montant HT, ou montant ambigu");
    const stock=stockFromInvoice(source,match.product);
    line.stock_quantity=stock.quantity;
    if(!stock.ok)line.reasons.push(stock.reason);
    if(line.confidence===null||line.confidence<.90)
      line.reasons.push("Confiance Azure insuffisante ou absente");
    if(missingCoverage)
      line.reasons.push("Couverture complète du PDF non démontrée (Azure F0 : deux pages maximum)");
    if(!supplier)
      line.reasons.push("Identité du fournisseur absente : correspondance fournisseur non fiable");
    if(otherAzure.some(prev=>{
      const previous=prev.structured_result.items[index];
      return !previous || invoiceLabel(previous.description)!==invoiceLabel(source.description) ||
        clean(previous.product_code)!==clean(source.product_code) ||
        money(previous.quantity)!==q || money(previous.amount)!==t;
    }))line.reasons.push("Deux lectures Azure ne concordent pas sur cette ligne");
    if(!line.reasons.length)line.status="green";
    return line;
  });
  const subtotal=money(structured.subtotal),sum=rows.reduce((a,r)=>{
    const v=money(r.amount);return v===null?NaN:a+v;
  },0);
  const sumsAgreed=subtotal!==null&&Number.isFinite(sum)&&Math.abs(round(sum)-subtotal)<=.02;
  if(!sumsAgreed){
    for(const line of lines)if(line.status==="green"){
      line.status="orange";line.reasons.push("Total des lignes et sous-total du PDF non recoupés");
    }
  }
  // A missing Azure line cannot be treated as an absent catalogue product.
  // A blank structured list requires full document review, not a completed invoice.
  if(!rows.length || !supplier) {
    for(const line of lines) if(line.status==="red"){
      line.status="orange";line.excluded=false;
      line.reasons.push("Document incomplet ou fournisseur non identifié");
    }
  }
  const green_lines=lines.filter(r=>r.status==="green").length;
  const orange_lines=lines.filter(r=>r.status==="orange").length;
  const red_lines=lines.filter(r=>r.status==="red").length;
  return {version:1,ready:rows.length>0,needs_review:Boolean(!rows.length||!supplier||orange_lines||missingCoverage||!sumsAgreed),retry_needed:Boolean(!rows.length||orange_lines||red_lines||missingCoverage||!sumsAgreed),
    green_lines,orange_lines,red_lines,
    reasons:[...(!rows.length?["Aucune ligne produit structurée : contrôle intégral du PDF obligatoire"]:[]),...(missingCoverage?["Le PDF doit être vérifié sur toutes ses pages"]:[]),
      ...(!sumsAgreed?["Somme des lignes incompatible ou subtotal absent"]:[]),
      ...(!supplier?["Fournisseur non identifié avec certitude"]:[])],
    lines,source_count:azure.length+textOnly.length,comparison_complete:azure.length>0&&textOnly.length>0,
    source:"azure_invoice",stock_unchanged:true
  };
}
