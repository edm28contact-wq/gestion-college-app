(()=>{'use strict';
const AGENT='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-stock-agent';
let agentState={reviewId:null,documentType:'invoice',movementSign:1,prepared:false,canValidate:false,items:[]};
const byId=id=>document.getElementById(id);
const esc2=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function auth2(){return {'content-type':'application/json','authorization':'Bearer '+token,'x-admin-session':token}}
async function agentReq(action,body){const r=await fetch(AGENT+'?action='+action,{method:'POST',headers:auth2(),body:JSON.stringify(body),cache:'no-store'}),j=await r.json().catch(()=>({error:'Réponse Agent Secrétaire invalide'}));if(!r.ok)throw new Error(j.error||'Erreur Agent Secrétaire');return j}
function numv(el){const v=el?.value;return v===''||v===null||v===undefined?null:Number(v)}
function ensureAgentBox(){let box=byId('stockAgentBox');if(box)return box;const warnings=byId('warnings');if(!warnings)return null;box=document.createElement('div');box.id='stockAgentBox';box.style.cssText='margin-top:12px;padding:12px;border:1px solid #d7dee5;border-radius:10px;background:#f8fafb';warnings.insertAdjacentElement('afterend',box);return box}
function collectUiItems(){
  return [...document.querySelectorAll('.invoice-line-v5')].map((r,i)=>({
    line_no:i+1,
    product_id:r.querySelector('.lp')?.value||'',
    detected_reference:r.dataset.reference||'',
    detected_label:r.querySelector('.detected')?.textContent||'',
    invoice_quantity:numv(r.querySelector('.liq')),
    quantity:numv(r.querySelector('.lsq')),
    invoice_unit:r.dataset.unit||'',
    unit_price_ht:numv(r.querySelector('.lpuht')),
    unit_price_ttc:numv(r.querySelector('.lputtc')),
    line_total_ht:numv(r.querySelector('.lht')),
    line_total_ttc:numv(r.querySelector('.lttc')),
    vat_rate:numv(r.querySelector('.lvat')),
    reader_confidence:Number(r.dataset.confidence||0),
    double_read_agreement:r.dataset.agreement==='true'
  }))
}
function renderAgent(result){
  agentState={reviewId:result.review_id,documentType:result.document_type,movementSign:result.movement_sign,prepared:true,canValidate:!!result.can_validate,items:result.items||[]};
  const box=ensureAgentBox();if(!box)return;
  const credit=result.document_type==='credit_note',a=result.agent||{},rows=result.items||[];
  box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b>Agent Secrétaire Stock</b><div class="muted">Analyse des lignes, prix unitaires, produits existants et mouvements de stock.</div></div><span class="pill" style="background:${credit?'#fdeaea':'#e7f4eb'};color:${credit?'#941f1f':'#176b3a'}">${credit?'AVOIR · retrait du stock':'FACTURE · entrée en stock'}</span></div>
  <div class="muted" style="margin-top:8px">Confiance agent : <b>${Math.round(Number(a.confidence||0)*100)} %</b> · ${a.blocked_lines||0} bloquée(s) · ${a.review_lines||0} à contrôler.</div>
  <div style="margin-top:8px">${rows.map(x=>`<div style="padding:7px 0;border-bottom:1px solid #e6ebef"><b>${esc2(x.detected_label||x.detected_reference||'Produit')}</b> → ${x.product_exists?`<span class="ok">${esc2(x.product_name||x.product_code)}</span>`:'<span class="err">Produit absent de la base</span>'}<div class="muted">Qté facture ${x.invoice_quantity??'—'} · Qté stock ${x.stock_quantity??'—'} · PU HT ${x.unit_price_ht??'—'} € · PU TTC ${x.unit_price_ttc??'—'} €${x.calculated_unit_price?' · prix unitaire calculé':''} · ${esc2(x.agent_reason||'')}</div></div>`).join('')}</div>`;
}
function syncAgentRows(items){
  const rows=[...document.querySelectorAll('.invoice-line-v5')];
  items.forEach((x,i)=>{const r=rows[i];if(!r)return;
    if(x.product_id&&r.querySelector('.lp'))r.querySelector('.lp').value=x.product_id;
    if(r.querySelector('.liq')&&x.invoice_quantity!=null)r.querySelector('.liq').value=x.invoice_quantity;
    if(r.querySelector('.lsq')&&x.stock_quantity!=null)r.querySelector('.lsq').value=x.stock_quantity;
    if(r.querySelector('.lpuht')&&x.unit_price_ht!=null)r.querySelector('.lpuht').value=Number(x.unit_price_ht).toFixed(2);
    if(r.querySelector('.lputtc')&&x.unit_price_ttc!=null)r.querySelector('.lputtc').value=Number(x.unit_price_ttc).toFixed(2);
    r.dataset.confidence=String(x.reader_confidence??r.dataset.confidence??0);
    r.classList.toggle('good',x.agent_status==='ok');r.classList.toggle('warnline',x.agent_status!=='ok');
  });
}
async function prepareAgent(){
  if(!current?.file)return;
  const items=collectUiItems();
  const result=await agentReq('prepare',{
    file_hash:current.hash,file_name:current.file.name,raw_text:current.text,
    supplier:byId('supplier')?.value||'',invoice_number:byId('number')?.value||'',invoice_date:byId('date')?.value||'',
    document_type:window.__secretariatDocumentType||'invoice',reader_version:13,items
  });
  syncAgentRows(result.items||[]);renderAgent(result);
  const b=byId('validate');if(b)b.textContent=result.document_type==='credit_note'?'Valider humainement et retirer du stock':'Valider humainement et mettre à jour le stock';
  const s=byId('saveStatus');if(s){s.className='status '+(result.can_validate?'ok':'err');s.textContent=result.can_validate?'Agent Secrétaire terminé. Validation humaine obligatoire avant modification du stock.':'Agent Secrétaire terminé, mais une ou plusieurs lignes sont bloquées. Corrige-les puis relance le contrôle.'}
}
const oldHandle=window.handle;
if(typeof oldHandle==='function')window.handle=async function(file){await oldHandle(file);if(!byId('review')?.classList.contains('hide')){agentState={reviewId:null,prepared:false,canValidate:false,items:[]};const b=ensureAgentBox();if(b)b.innerHTML='<b>Agent Secrétaire Stock</b><div class="muted">Préparation du contrôle ligne par ligne…</div>';try{await prepareAgent()}catch(e){const s=byId('saveStatus');if(s){s.className='status err';s.textContent=e.message||'Agent Secrétaire indisponible'}}}};
window.validateInvoice=async()=>{
  const msg=byId('saveStatus');
  if(!agentState.prepared){try{await prepareAgent()}catch(e){if(msg){msg.className='status err';msg.textContent=e.message}return}}
  if(!agentState.canValidate){if(msg){msg.className='status err';msg.textContent='Validation bloquée : relancez l’Agent Secrétaire après avoir corrigé les lignes inconnues ou incohérentes.'}return}
  const items=collectUiItems().map(x=>({...x,stock_quantity:x.quantity}));
  if(!confirm(agentState.documentType==='credit_note'?'Confirmer cet avoir ? Les quantités validées seront retirées du stock.':'Confirmer cette facture ? Les quantités validées seront ajoutées au stock.'))return;
  const btn=byId('validate');if(btn)btn.disabled=true;
  try{
    const r=await agentReq('validate',{review_id:agentState.reviewId,items});
    if(msg){msg.className='status ok';msg.textContent=agentState.documentType==='credit_note'?'Avoir validé. Stock diminué avec traçabilité.':'Facture validée. Stock mis à jour avec traçabilité.'}
    db=await req(SEC+'?action=data');await loadHistory();setTimeout(resetReview,1200)
  }catch(e){if(msg){msg.className='status err';msg.textContent=e.message||'Validation impossible'}}
  finally{if(btn)btn.disabled=false}
};
const originalReset=window.resetReview;
window.resetReview=()=>{agentState={reviewId:null,documentType:'invoice',movementSign:1,prepared:false,canValidate:false,items:[]};window.__secretariatDocumentType='invoice';if(originalReset)originalReset()};
})();