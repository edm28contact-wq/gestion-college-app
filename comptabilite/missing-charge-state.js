function hasMissingChargeAccount(i){
  return !!i
    && ['a_controler','erreur'].includes(String(i.status||''))
    && !!String(i.supplier||'').trim()
    && !!String(i.invoice_number||'').trim()
    && !String(i.expense_account||'').trim();
}

const dashboardBeforeMissingChargeState=dashboard;
dashboard=function(){
  dashboardBeforeMissingChargeState();
  const rows=$('content')?.querySelectorAll('tbody tr')||[];
  const invoices=db?.invoices||[];
  rows.forEach((tr,index)=>{
    const i=invoices[index];
    if(!i)return;
    const stateCell=tr.querySelector('td');
    if(!stateCell)return;
    if(['validee','exportee'].includes(String(i.status||''))){
      stateCell.innerHTML=badge(i.status);
      return;
    }
    if(hasMissingChargeAccount(i))stateCell.innerHTML='<span class="badge warn">Compte de charge absent</span>';
  });
};

const reviewBeforeMissingChargeState=review;
review=async function(id){
  await reviewBeforeMissingChargeState(id);
  const i=(db?.invoices||[]).find(x=>x.id===id);
  if(!hasMissingChargeAccount(i))return;
  const reviewPane=$('modal')?.querySelector('.review > div:last-child');
  if(!reviewPane)return;
  const box=document.createElement('div');
  box.className='status err';
  box.style.marginBottom='10px';
  box.innerHTML='<b>État : Compte de charge absent.</b> Renseigne le numéro de compte et sa ventilation avant de valider l’écriture. Dès validation réussie, cet état disparaît.';
  reviewPane.insertBefore(box,reviewPane.firstChild);
};
