(()=>{
  const originalDetectSupplier=detectSupplier;
  const n=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const flat=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u00a0/g,' ').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
  const escRe=s=>String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const number=s=>{const v=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(v)&&v>0&&v<=1000000?v:0};
  const unit='(?:pi[eè]ces?|pce?s?|pcs?|unit[eé]s?|unites?|u\\.?|lots?|bo[iî]tes?|cartons?|sachets?|bidons?|rouleaux?)';

  function supplierType(text){
    const x=n(text);
    if(x.includes('henri julien')||x.includes('henrijulien com'))return 'HENRI JULIEN';
    if(x.includes('mobilier henry com')||x.includes('www henry fr')||/(^| )henry( |$)/.test(x))return 'HENRY';
    return '';
  }

  detectSupplier=function(text){
    return supplierType(text)||originalDetectSupplier(text);
  };

  function qtyFromTail(tail){
    let m=tail.match(/(?:qte|qt[eé]|quantit[eé]|qty)\s*[:=\-]?\s*(\d{1,7}(?:[.,]\d{1,3})?)/i);
    if(m)return number(m[1]);
    m=tail.match(/(?:^|\s)(\d{1,7}(?:[.,]\d{1,3})?)\s*[x×](?=\s|$)/i);
    if(m)return number(m[1]);
    m=tail.match(/(?:^|\s)[x×]\s*(\d{1,7}(?:[.,]\d{1,3})?)(?=\s|$)/i);
    if(m)return number(m[1]);
    m=new RegExp('(?:^|\\s)(\\d{1,7}(?:[.,]\\d{1,3})?)\\s*'+unit+'\\b','i').exec(tail);
    if(m)return number(m[1]);
    m=tail.match(/(?:^|\s)(\d{1,5}(?:[.,]\d{1,3})?)(?=\s|$)/);
    return m?number(m[1]):0;
  }

  function specializedQty(text,p){
    const raw=flat(text),code=flat(p.code),name=flat(p.name);
    if(!code)return 0;
    const cm=new RegExp('(?:^|\\s)'+escRe(code)+'(?:\\s|$)','i').exec(raw);
    if(!cm)return 0;
    const segment=raw.slice(cm.index,cm.index+650);
    const pos=name?segment.toLowerCase().indexOf(name.toLowerCase()):-1;
    if(pos<0)return 0;
    return qtyFromTail(segment.slice(pos+name.length,pos+name.length+150));
  }

  const originalDetectProducts=detectProducts;
  detectProducts=function(text){
    if(!supplierType(text))return originalDetectProducts(text);
    const items=[];
    for(const p of db.products.filter(x=>x.active)){
      const q=specializedQty(text,p);
      if(q>0)items.push({product_id:p.id,quantity:q,detected_label:`${p.code} ${p.name}`});
    }
    return items.length?items:originalDetectProducts(text);
  };
})();
