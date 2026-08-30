(()=>{
  const GEN_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/sandbox-generator';
  async function generate(preset){
    const names={petit:'Petit',moyen:'Moyen',gros:'Gros'};
    const msg=preset==='gros'?'Générer un gros volume de données test ? Cela va créer plusieurs milliers de lignes dans le bac à sable.':'Générer un volume '+names[preset]+' de données test ?';
    if(!confirm(msg+'\n\nLes données transactionnelles test actuelles seront remplacées. La production ne sera pas touchée.'))return;
    const btns=[...document.querySelectorAll('[data-sb-generate]')];btns.forEach(b=>b.disabled=true);
    try{
      const r=await fetch(GEN_API,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({preset}),cache:'no-store'});
      const j=await r.json().catch(()=>({error:'Réponse invalide'}));
      if(!r.ok)throw new Error(j.error||'Erreur de génération');
      alert('Données test générées.\n\nProduits ajoutés : '+j.products_added+'\nMouvements stock : '+j.stock_events+'\nAchats : '+j.purchases+'\nCommandes : '+j.orders+'\nFactures stock : '+j.supplier_invoices+'\nFactures comptables : '+j.accounting_invoices+'\nÉcritures comptables : '+j.entry_lines+'\nLots OD : '+j.od_batches);
      if(typeof renderSandbox==='function')await renderSandbox();
    }catch(e){alert(e.message||String(e))}finally{btns.forEach(b=>b.disabled=false)}
  }
  window.sandboxGenerateVolume=generate;

  function inject(){
    if(typeof drawSandbox!=='function'||window.__sandboxGeneratorWrapped)return;
    window.__sandboxGeneratorWrapped=true;
    const base=drawSandbox;
    drawSandbox=function(){
      base();
      const root=document.getElementById('content');if(!root||root.querySelector('[data-sb-generator-card]'))return;
      const cards=root.querySelectorAll('.card');const anchor=cards.length?cards[0]:root;
      const box=document.createElement('div');box.className='card';box.dataset.sbGeneratorCard='1';box.style.marginTop='14px';
      box.innerHTML='<div class="actions" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div><h3>Générateur massif de données test</h3><div class="muted">Remplit automatiquement tous les flux du bac à sable avec des données cohérentes sur environ 6 mois.</div></div><span class="pill">DONNÉES FICTIVES</span></div><div class="actions" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button class="btn secondary" data-sb-generate onclick="sandboxGenerateVolume(\'petit\')">Petit volume</button><button class="btn primary" data-sb-generate onclick="sandboxGenerateVolume(\'moyen\')">Volume moyen</button><button class="btn primary" data-sb-generate onclick="sandboxGenerateVolume(\'gros\')">Gros volume</button></div><p class="muted" style="margin-top:10px">Petit : ~15 produits, 80 mouvements, 30 commandes, 50 factures comptables. Moyen : ~40 produits, 300 mouvements, 100 commandes, 180 factures. Gros : ~100 produits, 1 000 mouvements, 300 commandes, 500 factures, plus les achats, factures fournisseurs, écritures et lots OD associés.</p>';
      anchor.insertAdjacentElement('afterend',box);
      const active=!!window.GestionCollegeTestMode?.active;box.querySelectorAll('button').forEach(b=>b.disabled=!active);
    };
    if(typeof sandboxData!=='undefined'&&sandboxData)drawSandbox();
  }
  let tries=0;const t=setInterval(()=>{inject();if(window.__sandboxGeneratorWrapped||++tries>50)clearInterval(t)},100);
})();
