// Couche de compatibilite College -> backend de production actif.
// Aucune cle privee n'est exposee ici.
(()=>{
  const LEGACY='https://ojjbnwpkfvzjfukgqddz.supabase.co/functions/v1/accounting-api';
  const PROD='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-api';
  const ACCESS='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-access-api';
  const LOGIN='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-login-bridge';
  const baseFetch=window.fetch.bind(window);

  const user=document.getElementById('user');
  if(user&&String(user.value).trim().toLowerCase()==='holding-admin')user.value='admin';

  window.fetch=(input,init)=>{
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(raw&&(raw.startsWith(LEGACY)||raw.startsWith(PROD))){
        const current=new URL(raw);
        const target=current.searchParams.get('action')==='login'?LOGIN:ACCESS;
        const next=target+current.search;
        if(typeof input==='string')return baseFetch(next,init);
        return baseFetch(new Request(next,input),init);
      }
    }catch{}
    return baseFetch(input,init);
  };

  // L'etablissement ne recupere pas la TVA dans ce module :
  // la ventilation des charges doit donc totaliser le TTC.
  let tries=0;
  const patch=setInterval(()=>{
    tries++;
    if(typeof window.updateChargeTotal==='function'){
      window.updateChargeTotal=()=>{
        const rows=[...document.querySelectorAll('.charge-row')];
        const total=rows.reduce((sum,row)=>sum+Number(row.querySelector('.c-amount')?.value||0),0);
        const ttc=Number(document.getElementById('a6')?.value||0);
        const diff=Math.round((ttc-total)*100)/100;
        const box=document.getElementById('chargeTotal');
        if(box)box.innerHTML=`Total charges : <b>${total.toFixed(2)} €</b> · TTC : <b>${ttc.toFixed(2)} €</b> · Écart : <b class="${Math.abs(diff)<=.02?'ok':'err'}">${diff.toFixed(2)} €</b>`;
      };

      if(typeof window.importPage==='function'){
        const originalImport=window.importPage;
        window.importPage=()=>{
          originalImport();
          const p=document.querySelector('#content .card p.muted');
          if(p)p.textContent='Le PDF original est conservé. Après lecture, ventilez le montant TTC sur les comptes de charges puis contrôlez les montants avant validation.';
        };
      }

      clearInterval(patch);
    }else if(tries>100){
      clearInterval(patch);
    }
  },50);
})();
