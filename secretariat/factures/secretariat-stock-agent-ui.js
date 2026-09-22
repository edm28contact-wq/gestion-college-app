(()=>{'use strict';
const AGENT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-stock-agent';
let agentState={reviewId:null,documentType:'invoice',movementSign:1,prepared:false,items:[]};window.__secretariatDocumentType='invoice';window.__secretariatReaderCertified={headerTriple:false,headerConsensus:false,consensusCertified:false};
const byId=id=>document.getElementById(id);
const esc2=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function auth2(){return {'content-type':'application/json','authorization':'Bearer '+token,'x-admin-session':token}}
async function agentReq(action,body){const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),15000);try{const r=await fetch(AGENT+'?action='+action,{method:'POST',headers:auth2(),body:JSON.stringify(body),cache:'no-store',signal:ctrl.signal}),j=await r.json().catch(()=>({error:'Réponse Agent Secrétaire invalide'}));if(!r.ok)throw new Error(j.error||'Erreur Agent Secrétaire');return j}catch(e){if(e&&e.name==='AbortError')throw new Error('Agent Secrétaire bloqué : délai 15 s dépassé, stock inchangé.');throw e}finally{clearTimeout(tm)}}
function numv(el){const v=el?.value;return v===''||v===null||v===undefined?null:Number(v)}
function ensureAgentBox(){let box=byId('stockAgentBox');if(box)return box;const warnings=byId('warnings');if(!warnings)return null;box=document.createElement('div');box.id='stockAgentBox';box.style.cssText='margin-top:12px;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';warnings.insertAdjacentElement('afterend',box);return box}
function rowNodes(){const advanced=[...document.querySelectorAll('.invoice-line-v5')];return advanced.length?advanced:[...document.querySelectorAll('#lines .line')]}
function rowMeta(r){if(r.classList.contains('invoice-line-v5'))return {};try{return JSON.parse(decodeURIComponent(r.dataset.meta||'%7B%7D'))}catch{return {}}}
function ensurePriceFields(r,item={}){
  if(r.classList.contains('invoice-line-v5')||r.querySelector('.agent-price-fields'))return;
  const m={...rowMeta(r),...item},box=document.createElement('div');box.className='agent-price-fields';box.style.cssText='grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:8px;padding-top:4px';
  box.innerHTML=`<div><label class="muted">Qté facture</label><input class="aiq" type="number" min="0.001" step="0.001" value="${esc2(m.invoice_quantity??m.quantity??'')}"></div><div><label class="muted">PU HT €</label><input class="apuht" type="number" min="0" step="0.0001" value="${esc2(m.unit_price_ht??'')}"></div><div><label class="muted">PU TTC €</label><input class="aputtc" type="number" min="0" step="0.0001" value="${esc2(m.unit_price_ttc??'')}"></div><div><label class="muted">Total TTC €</label><input class="attc" type="number" min="0" step="0.01" value="${esc2(m.line_total_ttc??'')}"></div>`;
  r.appendChild(box)
}
function collectUiItems(){
  return rowNodes().map((r,i)=>{const m=rowMeta(r),advanced=r.classList.contains('invoice-line-v5'),qty=advanced?numv(r.querySelector('.liq')):(numv(r.querySelector('.aiq'))??Number((m.invoice_quantity??r.querySelector('.lq')?.value)??0)),stockQty=advanced?numv(r.querySelector('.lsq')):numv(r.querySelector('.lq'));return {
    line_no:i+1,product_id:r.querySelector('.lp')?.value||m.product_id||'',
    detected_reference:advanced?(r.dataset.reference||''):String(m.detected_reference||''),
    detected_label:advanced?(r.querySelector('.detected')?.textContent||''):String(m.detected_label||m.product_name||r.querySelector('.lp')?.selectedOptions?.[0]?.textContent||''),
    invoice_quantity:qty,quantity:stockQty,invoice_unit:advanced?(r.dataset.unit||''):String(m.invoice_unit||''),
    unit_price_ht:advanced?numv(r.querySelector('.lpuht')):numv(r.querySelector('.apuht'))??m.unit_price_ht??null,
    unit_price_ttc:advanced?numv(r.querySelector('.lputtc')):numv(r.querySelector('.aputtc'))??m.unit_price_ttc??null,
    line_total_ht:advanced?numv(r.querySelector('.lht')):m.line_total_ht??null,
    line_total_ttc:advanced?numv(r.querySelector('.lttc')):numv(r.querySelector('.attc'))??m.line_total_ttc??null,
    vat_rate:advanced?numv(r.querySelector('.lvat')):m.vat_rate??null,
    reader_confidence:advanced?Number(r.dataset.confidence||0):Number(m.reader_confidence||0),
    double_read_agreement:advanced?r.dataset.agreement==='true':!!m.double_read_agreement,
    triple_read_agreement:advanced?(r.dataset.tripleAgreement==='true'):!!m.triple_read_agreement
  }})
}
function renderAgent(result){
  agentState={reviewId:result.review_id,documentType:result.document_type,movementSign:result.movement_sign,prepared:true,items:result.items||[]};
  const box=ensureAgentBox();if(!box)return;
  const credit=result.document_type==='credit_note',a=result.agent||{},rows=result.items||[];
  box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b>Agent Secrétaire Stock</b><div class="muted">Analyse des lignes, prix unitaires, produits existants et mouvements de stock.</div></div><span class="pill" style="background:${credit?'#fdeaea':'#e7f4eb'};color:${credit?'#941f1f':'#176b3a'}">${credit?'AVOIR · retrait du stock':'FACTURE · entrée en stock'}</span></div>
  <div class="muted" style="margin-top:8px">Confiance agent : <b>${Math.round(Number(a.confidence||0)*100)} %</b> · ${a.blocked_lines||0} ligne(s) bloquée(s) · mode automatique strict.</div>
  <div style="margin-top:8px">${rows.map(x=>`<div style="padding:7px 0;border-bottom:1px solid #e6ebef"><b>${esc2(x.detected_label||x.detected_reference||'Produit')}</b> → ${x.product_exists?`<span class="ok">${esc2(x.product_name||x.product_code)}</span>`:'<span class="err">Produit absent de la base</span>'}<div class="muted">Qté facture ${x.invoice_quantity??'—'} · Qté stock ${x.stock_quantity??'—'} · PU HT ${x.unit_price_ht??'—'} € · PU TTC ${x.unit_price_ttc??'—'} €${x.calculated_unit_price?' · prix unitaire calculé':''} · ${esc2(x.agent_reason||'')}</div></div>`).join('')}</div>`;
}
function syncAgentRows(items){
  const rows=rowNodes();
  items.forEach((x,i)=>{const r=rows[i];if(!r)return;ensurePriceFields(r,x);
    if(x.product_id&&r.querySelector('.lp'))r.querySelector('.lp').value=x.product_id;
    if(r.querySelector('.liq')&&x.invoice_quantity!=null)r.querySelector('.liq').value=x.invoice_quantity;
    if(r.querySelector('.lsq')&&x.stock_quantity!=null)r.querySelector('.lsq').value=x.stock_quantity;
    if(r.querySelector('.lq')&&x.stock_quantity!=null)r.querySelector('.lq').value=x.stock_quantity;
    if(r.querySelector('.aiq')&&x.invoice_quantity!=null)r.querySelector('.aiq').value=x.invoice_quantity;
    if(r.querySelector('.lpuht')&&x.unit_price_ht!=null)r.querySelector('.lpuht').value=Number(x.unit_price_ht).toFixed(4);
    if(r.querySelector('.lputtc')&&x.unit_price_ttc!=null)r.querySelector('.lputtc').value=Number(x.unit_price_ttc).toFixed(4);
    if(r.querySelector('.apuht')&&x.unit_price_ht!=null)r.querySelector('.apuht').value=Number(x.unit_price_ht).toFixed(4);
    if(r.querySelector('.aputtc')&&x.unit_price_ttc!=null)r.querySelector('.aputtc').value=Number(x.unit_price_ttc).toFixed(4);
    if(r.querySelector('.attc')&&x.line_total_ttc!=null)r.querySelector('.attc').value=Number(x.line_total_ttc).toFixed(2);
    if(r.classList.contains('invoice-line-v5')){r.dataset.confidence=String(x.reader_confidence??r.dataset.confidence??0);r.classList.toggle('good',x.agent_status==='ok');r.classList.toggle('warnline',x.agent_status!=='ok')}
    else r.dataset.meta=encodeURIComponent(JSON.stringify({...rowMeta(r),...x,quantity:x.stock_quantity}));
  });
}
async function prepareAgent(){
  if(!current?.file)return;
  const items=collectUiItems();
  const result=await agentReq('prepare',{
    file_hash:current.hash,file_name:current.file.name,raw_text:current.text,
    supplier:byId('supplier')?.value||'',invoice_number:byId('number')?.value||'',invoice_date:byId('date')?.value||'',
    document_type:window.__secretariatDocumentType||'invoice',header_triple_agreement:window.__secretariatReaderCertified?.headerTriple===true,header_consensus_agreement:window.__secretariatReaderCertified?.headerConsensus===true,reader_version:28,items
  });
  syncAgentRows(result.items||[]);renderAgent(result);
  const b=byId('validate');if(b){b.style.display='none';b.disabled=true}
  const st=byId('saveStatus');
  if(st){
    if(result.stock_updated){st.className='status ok';st.textContent=result.document_type==='credit_note'?'Agent Secrétaire certifié : avoir appliqué automatiquement, stock diminué.':'Agent Secrétaire certifié : facture appliquée automatiquement, stock mis à jour.'}
    else{st.className='status err';st.textContent='Document bloqué automatiquement : stock inchangé. '+((result.items||[]).filter(x=>x.agent_status==='blocked').map(x=>x.agent_reason).filter(Boolean).join(' | ')||'Certification stricte incomplète.')}
  }
  if(result.stock_updated){db=await req(SEC+'?action=data');await loadHistory()}
}
const baseReader=window.reader;
if(typeof baseReader==='function')window.reader=async function(action,file,text,extra={}){const out=await baseReader(action,file,text,extra);if(action==='verify'){window.__secretariatDocumentType=out.document_type||'invoice';window.__secretariatReaderCertified={headerTriple:out.header_triple_agreement===true,headerConsensus:out.header_consensus_agreement===true,tripleRead:out.triple_read===true,consensusCertified:out.consensus_certified===true,bestPair:out.best_pair||'',models:out.ai?.models||[]}}return out};
const oldHandle=window.handle;
if(typeof oldHandle==='function')window.handle=async function(file){await oldHandle(file);if(!byId('review')?.classList.contains('hide')){agentState={reviewId:null,prepared:false,canValidate:false,items:[]};const b=ensureAgentBox();if(b)b.innerHTML='<b>Agent Secrétaire Stock</b><div class="muted">Préparation du contrôle ligne par ligne…</div>';try{await prepareAgent()}catch(e){const s=byId('saveStatus');if(s){s.className='status err';s.textContent=e.message||'Agent Secrétaire indisponible'}}}};
window.validateInvoice=async()=>{const msg=byId('saveStatus');if(msg){msg.className='status err';msg.textContent='Validation humaine désactivée. Le stock est mis à jour uniquement par certification automatique stricte.'}};
const originalReset=window.resetReview;
window.resetReview=()=>{agentState={reviewId:null,documentType:'invoice',movementSign:1,prepared:false,items:[]};window.__secretariatDocumentType='invoice';window.__secretariatReaderCertified={headerTriple:false};if(originalReset)originalReset()};
})();