// Couche de compatibilite College -> backend EDM actif.
// Aucune cle privee n'est exposee ici.
(()=>{
  const OLD='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/accounting-api';
  const ACTIVE='https://ojjbnwpkfvzjfukgqddz.supabase.co/functions/v1/accounting-api';
  const baseFetch=window.fetch.bind(window);

  window.fetch=(input,init)=>{
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(raw&&raw.startsWith(OLD)){
        const next=ACTIVE+raw.slice(OLD.length);
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

      if(typeof window.settingsPage==='function'){
        window.settingsPage=()=>{
          const content=document.getElementById('content');
          if(content)content.innerHTML='<div class="card"><h2>Paramètres</h2><p>La TVA est traitée comme non récupérable dans cette configuration. La somme des lignes de charges doit donc être égale au montant TTC avant validation.</p><p class="muted">La validation humaine reste obligatoire avant export Charlemagne.</p></div>';
        };
      }

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
