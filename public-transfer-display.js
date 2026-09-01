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
      found=true;
      const info=row.querySelector('.unit');
      if(!info)return;
      let el=row.querySelector('.garage-transfer-needed');
      if(!el){
        el=document.createElement('div');
        el.className='garage-transfer-needed';
        el.style.marginTop='4px';
        el.style.fontSize='13px';
        el.style.fontWeight='800';
        info.insertAdjacentElement('afterend',el);
      }
      const n=Math.max(0,Number(data.transfer_needed||0));
      el.style.color=n>0?'#b42318':'#68727d';
      el.textContent='À transférer du garage : '+n.toLocaleString('fr-FR');
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
