(()=>{
  const style=document.createElement('style');style.textContent=`
  .invoice-line-v5{border:1px solid #e2e7eb;border-radius:10px;padding:10px;margin:10px 0;background:#fff}
  .invoice-line-grid{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(220px,1.2fr) 100px 105px 105px 115px 105px;gap:8px;align-items:end}
  .invoice-line-v5 .detected{font-weight:800}.invoice-line-v5 .meta{font-size:12px;color:#6e7983;margin-top:4px}
  .invoice-line-v5.good{border-color:#b9ddc5;background:#fbfffc}.invoice-line-v5.warnline{border-color:#e6c36b;background:#fffdf6}
  .invoice-line-v5 .flag{font-size:12px;font-weight:800;margin-top:7px}.invoice-line-v5.good .flag{color:#14733e}.invoice-line-v5.warnline .flag{color:#8a5a00}
  @media(max-width:900px){.invoice-line-grid{grid-template-columns:1fr 1fr 100px 100px}.invoice-line-grid>div:nth-child(n+5){grid-column:auto}}
  @media(max-width:620px){.invoice-line-grid{grid-template-columns:1fr}.invoice-line-grid>div{grid-column:auto!important}}
  `;document.head.appendChild(style);

  async function fastPdfText(file){
    try{
      const work=(async()=>{let waited=0;while(!window.pdfjsLib&&waited<4000){await new Promise(r=>setTimeout(r,100));waited+=100}if(!window.pdfjsLib)return '';const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let t='';const total=Math.min(pdf.numPages,20);for(let n=1;n<=total;n++){const p=await pdf.getPage(n),c=await p.getTextContent();t+=c.items.map(x=>x.str).join(' ')+'\n';prog(5+Math.round(25*n/total),`Lecture PDF ${n}/${total}…`)}return t})();
      return await Promise.race([work,new Promise(r=>setTimeout(()=>r(''),10000))]);
    }catch(e){console.warn('Texte PDF local indisponible',e);return ''}
  }

  productOptions=function(sel=''){return `<option value="">— Choisir le produit stock —</option>`+db.products.filter(p=>p.active).map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(p.name)} — ${esc(p.code)}</option>`).join('')};

  function val(v){return v===null||v===undefined||v===''?'':Number(v)}
  function money(v){return v===null||v===undefined||v===''?'':Number(v).toFixed(2)}
  function recalcRow(row){const pid=row.querySelector('.lp').value,p=db.products.find(x=>x.id===pid),iq=Number(row.querySelector('.liq').value||0),factor=Number(p?.purchase_to_stock_factor||1);row.dataset.factor=String(factor);row.querySelector('.lsq').value=iq>0?(iq*factor).toFixed(3).replace(/\.000$/,''):'';}

  addLineObj=function(item={}){
    const d=document.createElement('div');d.className='invoice-line-v5 '+(item.double_read_agreement?'good':'warnline');
    const label=item.detected_label||item.product_name||'';
    d.dataset.reference=item.detected_reference||'';d.dataset.unit=item.invoice_unit||'';d.dataset.confidence=String(item.reader_confidence??0);d.dataset.agreement=String(!!item.double_read_agreement);d.dataset.factor=String(item.conversion_factor||1);
    d.innerHTML=`<div class="invoice-line-grid">
      <div><label>Produit lu sur la facture</label><div class="detected">${esc(label||'Ligne non nommée')}</div><div class="meta">${item.detected_reference?`Réf. ${esc(item.detected_reference)} · `:''}${item.invoice_unit?`Unité ${esc(item.invoice_unit)} · `:''}${item.evidence?esc(item.evidence):''}</div></div>
      <div><label>Produit du stock</label><select class="lp">${productOptions(item.product_id||'')}</select></div>
      <div><label>Qté facture</label><input class="liq" type="number" min="0.001" step="0.001" value="${esc(val(item.invoice_quantity??item.quantity))}"></div>
      <div><label>Qté stock</label><input class="lsq" type="number" readonly value="${esc(val(item.quantity))}"></div>
      <div><label>PU HT €</label><input class="lpuht" type="number" min="0" step="0.01" value="${esc(money(item.unit_price_ht))}"></div>
      <div><label>PU TTC €</label><input class="lputtc" type="number" min="0" step="0.01" value="${esc(money(item.unit_price_ttc))}"></div>
      <div><label>Total TTC €</label><input class="lttc" type="number" min="0" step="0.01" value="${esc(money(item.line_total_ttc))}"></div>
    </div><div class="actions" style="justify-content:space-between"><div class="flag">${item.double_read_agreement?'✓ Deux lectures concordantes':'⚠ À contrôler : désaccord ou ligne vue une seule fois'}</div><button class="btn danger remove" type="button">Supprimer</button></div>
    <input class="lht" type="hidden" value="${esc(money(item.line_total_ht))}"><input class="lvat" type="hidden" value="${esc(val(item.vat_rate))}">`;
    d.querySelector('.remove').onclick=()=>d.remove();d.querySelector('.lp').onchange=()=>recalcRow(d);d.querySelector('.liq').oninput=()=>recalcRow(d);recalcRow(d);$('lines').appendChild(d)
  };

  renderLines=function(items){$('lines').innerHTML='';(items||[]).forEach(addLineObj);if(!items?.length)addLineObj({})};
  window.addLine=()=>addLineObj({double_read_agreement:false});

  handle=async function(file){
    if(!file)return;if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))return setStatus('PDF requis.');if(file.size>20*1024*1024)return setStatus('Fichier trop volumineux (20 Mo maximum).');
    try{$('review').classList.add('hide');prog(2,'Préparation du PDF original…');const buf=await file.arrayBuffer();current={file,hash:await sha256(buf),text:''};const text=await fastPdfText(file);current.text=text;prog(35,'Lecture 1 : fournisseur, produits, quantités et prix…');const first=await readerCall('first',file,text);prog(62,'Lecture 2 indépendante : contrôle ligne par ligne…');const verified=await readerCall('verify',file,text,{previous:first.analysis||{},first_model:first.model||''});
      $('supplier').value=verified.supplier||first.analysis?.supplier||'';$('number').value=verified.invoice_number||first.analysis?.invoice_number||'';$('date').value=verified.invoice_date||first.analysis?.invoice_date||'';
      const all=[...(verified.items||[]),...(verified.unmatched||[])];renderLines(all);
      const confirmed=all.filter(x=>x.double_read_agreement).length,unmatched=(verified.unmatched||[]).length;const ws=[...(verified.warnings||[])];if(unmatched)ws.unshift(`${unmatched} produit(s) lu(s) mais non rapproché(s) du stock : sélection manuelle obligatoire.`);$('warnings').textContent=ws.join(' · ');$('review').classList.remove('hide');prog(100,`${verified.supplier||'Facture'} · ${all.length} ligne(s) lue(s) · ${confirmed} confirmée(s) par les 2 lectures · ${unmatched} à rapprocher.`);setTimeout(()=>$('prog').classList.add('hide'),1800)
    }catch(e){setStatus(e.message||'Impossible de lire la facture')}
  };

  window.validateInvoice=async()=>{
    const rows=[...document.querySelectorAll('.invoice-line-v5')];if(!current.file||!rows.length)return $('saveStatus').textContent='Aucune ligne à enregistrer.';
    const items=[];for(const r of rows){const pid=r.querySelector('.lp').value,iq=Number(r.querySelector('.liq').value),sq=Number(r.querySelector('.lsq').value);if(!pid){$('saveStatus').className='status err';$('saveStatus').textContent='Chaque produit lu doit être rapproché d’un produit du stock avant validation.';return}if(!(iq>0)&&!(sq>0)){ $('saveStatus').className='status err';$('saveStatus').textContent='Quantité invalide sur une ligne.';return}items.push({product_id:pid,quantity:sq,invoice_quantity:iq,detected_reference:r.dataset.reference||'',detected_label:r.querySelector('.detected').textContent||'',invoice_unit:r.dataset.unit||'',unit_price_ht:r.querySelector('.lpuht').value||null,unit_price_ttc:r.querySelector('.lputtc').value||null,line_total_ht:r.querySelector('.lht').value||null,line_total_ttc:r.querySelector('.lttc').value||null,vat_rate:r.querySelector('.lvat').value||null,reader_confidence:Number(r.dataset.confidence||0),double_read_agreement:r.dataset.agreement==='true'})}
    if(!$('supplier').value.trim()){ $('saveStatus').className='status err';$('saveStatus').textContent='Fournisseur obligatoire.';return}
    const uncertain=items.filter(x=>!x.double_read_agreement).length;if(!confirm(uncertain?`Confirmer cette facture ? ${uncertain} ligne(s) n’ont pas été confirmées identiquement par les deux lectures. Vérifie leurs quantités et prix avant de continuer.`:'Confirmer cette facture ? Tous les produits sélectionnés seront ajoutés au stock.'))return;
    $('validate').disabled=true;$('saveStatus').className='status';$('saveStatus').textContent='Enregistrement des produits, quantités et prix…';
    try{await req(INV+'?action=record','POST',{file_hash:current.hash,file_name:current.file.name,supplier:$('supplier').value,invoice_number:$('number').value,invoice_date:$('date').value,raw_text:current.text,items});$('saveStatus').textContent='Facture enregistrée. Quantités et prix de facture conservés, stock mis à jour.';$('saveStatus').className='status ok';db=await req(ADMIN+'?action=data');await loadHistory();setTimeout(resetReview,1200)}catch(e){$('saveStatus').textContent=e.message;$('saveStatus').className='status err'}finally{$('validate').disabled=false}
  };
})();