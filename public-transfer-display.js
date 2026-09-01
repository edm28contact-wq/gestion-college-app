(()=>{
  'use strict';
  const PROJECT='https://zreegtzfpwrjgdhhunxx.supabase.co';
  const publicId=(new URLSearchParams(location.search).get('id')||'').trim();
  if(!publicId)return;
  const API=PROJECT+'/functions/v1/public-stock-transfer?id='+encodeURIComponent(publicId);
  let byProduct=new Map(),loading=false;

  function draw(){
    const page=document.getElementById('page-outgoing');
    if(!page||!byProduct.size)return false;
    let found=false;
    page.querySelectorAll('.line[data-id]').forEach(row=>{
      const data=byProduct.get(String(row.dataset.id||''));
      if(!data)return;
      const input=row.querySelector('.outQty');
      if(!input)return;
      found=true;

      const available=Math.max(0,Number(data.current_stock||0));
      input.max=String(available);
      input.dataset.availableStock=String(available);
      input.title='Stock disponible : '+available.toLocaleString('fr-FR');
      input.addEventListener('input',()=>{
        const max=Number(input.dataset.availableStock||0),v=Number(input.value||0);
        if(Number.isFinite(v)&&v>max){
          input.value=String(max);
          input.setCustomValidity('Impossible de sortir plus que le stock disponible ('+max.toLocaleString('fr-FR')+').');
          input.reportValidity();
        }else input.setCustomValidity('');
      },{once:false});

      row.style.gridTemplateColumns='minmax(0,1fr) minmax(210px,230px)';
      row.style.columnGap='8px';

      let slot=row.querySelector('.out-transfer-slot');
      if(!slot){
        slot=document.createElement('div');
        slot.className='out-transfer-slot';
        slot.style.display='grid';
        slot.style.gridTemplateColumns='1fr 1fr';
        slot.style.gap='6px';
        slot.style.alignItems='stretch';
        row.appendChild(slot);
        slot.appendChild(input);
      }

      let stockEl=slot.querySelector('.garage-stock-available');
      if(!stockEl){
        stockEl=document.createElement('div');
        stockEl.className='garage-stock-available';
        stockEl.style.gridColumn='1 / -1';
        stockEl.style.fontSize='11px';
        stockEl.style.color='#68727d';
        stockEl.style.textAlign='center';
        slot.prepend(stockEl);
      }
      stockEl.textContent='Stock disponible : '+available.toLocaleString('fr-FR');

      let el=slot.querySelector('.garage-transfer-needed');
      if(!el){
        el=document.createElement('div');
        el.className='garage-transfer-needed';
        el.style.minHeight='44px';
        el.style.border='1px solid #e2a39e';
        el.style.borderRadius='9px';
        el.style.background='#fff7f6';
        el.style.padding='4px 3px';
        el.style.display='flex';
        el.style.flexDirection='column';
        el.style.alignItems='center';
        el.style.justifyContent='center';
        el.style.textAlign='center';
        el.style.fontSize='10px';
        el.style.lineHeight='1.05';
        el.innerHTML='<span>À transférer</span><strong class="garage-transfer-number" style="font-size:18px;line-height:1.1"></strong>';
        slot.appendChild(el);
      }

      const n=Math.max(0,Number(data.transfer_needed||0));
      const number=el.querySelector('.garage-transfer-number');
      el.style.color=n>0?'#b42318':'#68727d';
      el.style.borderColor=n>0?'#e2a39e':'#d8dde2';
      el.style.background=n>0?'#fff7f6':'#f7f8f9';
      if(number)number.textContent=n.toLocaleString('fr-FR');
    });
    return found;
  }

  async function refresh(){
    if(loading)return;
    loading=true;
    try{
      const r=await fetch(API,{cache:'no-store'});
      if(!r.ok)return;
      const j=await r.json();
      byProduct=new Map((j.products||[]).map(x=>[String(x.product_id),x]));
      draw();
    }catch(e){console.warn('Affichage transfert garage indisponible',e)}
    finally{loading=false}
  }

  let attempts=0;
  const wait=setInterval(()=>{
    attempts++;
    if(draw()||attempts>=20)clearInterval(wait);
  },250);
  refresh();
  setInterval(refresh,30000);
})();
