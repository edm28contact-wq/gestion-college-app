(()=>{
'use strict';

function amount(v){const n=Number(v||0);return Number.isFinite(n)?n:0}

window.updateChargeTotal=function(){
  const total=(typeof getCharges==='function'?getCharges():[]).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const ttc=amount(document.getElementById('a6')?.value);
  const diff=Math.round((ttc-total)*100)/100;
  const box=document.getElementById('chargeTotal');
  if(box)box.innerHTML=`Total charges TTC : <b>${total.toFixed(2)} €</b> · TTC facture : <b>${ttc.toFixed(2)} €</b> · Écart : <b class="${Math.abs(diff)<=.02?'ok':'err'}">${diff.toFixed(2)} €</b><div class="muted" style="margin-top:5px">TVA non récupérable : elle est incluse dans les comptes de charges.</div>`;
};

if(typeof chargeRow==='function'){
  window.chargeRow=function(account='',label='',amountValue=''){
    const id=crypto.randomUUID();
    return `<div class="charge-row" data-row="${id}"><input class="c-account" placeholder="Compte de charge" value="${esc(account)}"><input class="c-label" placeholder="Libellé" value="${esc(label)}"><input class="c-amount" type="number" step="0.01" placeholder="Montant TTC" value="${esc(amountValue)}" oninput="updateChargeTotal()"><button class="btn secondary" onclick="removeCharge('${id}')">Supprimer</button></div>`;
  };
}

if(typeof review==='function'){
  const reviewBeforeVatRule=review;
  window.review=async function(id){
    await reviewBeforeVatRule(id);
    const pane=document.querySelector('#modal .review > div:last-child');
    if(!pane)return;
    if(!pane.querySelector('.vat-nonrecoverable-info')){
      const info=document.createElement('div');
      info.className='status ok vat-nonrecoverable-info';
      info.style.marginBottom='10px';
      info.innerHTML='<b>TVA non récupérable.</b> La ventilation comptable se fait au TTC. Aucune ligne de TVA déductible ne sera générée.';
      pane.insertBefore(info,pane.firstChild);
    }
    const vat=document.getElementById('a5');
    if(vat){const d=vat.closest('div');const l=d?.querySelector('label');if(l)l.textContent='TVA (information uniquement)'}
    const ttc=document.getElementById('a6');
    if(ttc){const d=ttc.closest('div');const l=d?.querySelector('label');if(l)l.textContent='TTC — base comptable'}
    const vatAccount=document.getElementById('a12');
    if(vatAccount){const d=vatAccount.closest('div');if(d)d.style.display='none'}
    document.querySelectorAll('.c-amount').forEach(x=>x.setAttribute('placeholder','Montant TTC'));
    updateChargeTotal();
  };
}

if(typeof settingsPage==='function'){
  const settingsBeforeVatRule=settingsPage;
  window.settingsPage=function(){
    settingsBeforeVatRule();
    const content=document.getElementById('content');
    if(content&&!document.getElementById('vatCollegeRule'))content.insertAdjacentHTML('afterbegin','<div id="vatCollegeRule" class="card"><h2>TVA</h2><div class="status ok"><b>TVA non récupérable.</b></div><p class="muted">Pour le collège, la TVA facturée est intégrée au coût de la charge. Les écritures débitent les comptes de classe 6 pour le TTC et créditent le fournisseur pour le TTC. Aucun compte 4456 de TVA déductible n’est généré.</p></div>');
  };
}
})();
