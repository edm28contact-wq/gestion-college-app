(()=>{
  const GEN_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/sandbox-generator';
  const JOURNEY_API='https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/sandbox-accounting-journey';
  async function post(url,preset){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({preset}),cache:'no-store'});const j=await r.json().catch(()=>({error:'Réponse invalide'}));if(!r.ok)throw new Error(j.error||'Erreur de génération');return j}
  async function generate(preset){
    const names={petit:'Petit',moyen:'Moyen',gros:'Gros'};
    const msg=preset==='gros'?'Générer un gros volume de données test selon ton vrai parcours ? Cela va créer plusieurs milliers de lignes dans le bac à sable.':'Générer un volume '+names[preset]+' selon ton vrai parcours ?';
    if(!confirm(msg+'\n\nLes données transactionnelles test actuelles seront remplacées. La production ne sera pas touchée.'))return;
    const btns=[...document.querySelectorAll('[data-sb-generate]')];btns.forEach(b=>b.disabled=true);
    try{
      const base=await post(GEN_API,preset);
      const journey=await post(JOURNEY_API,preset);
      alert('Parcours test généré.\n\nProduits ajoutés : '+base.products_added+'\nMouvements stock : '+base.stock_events+'\nAchats : '+base.purchases+'\nCommandes : '+base.orders+'\nFactures stock : '+base.supplier_invoices+'\n\nParcours comptable :\nÀ traiter : '+journey.a_traiter+'\nValidées : '+journey.validees+'\nOD à confirmer : '+journey.od_a_confirmer+'\nImportées Charlemagne : '+journey.importees+'\nAnomalies artificielles : '+journey.anomalies+'\nLots OD : '+journey.od_batches);
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
      box.innerHTML='<div class="actions" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div><h3>Générateur de parcours réel</h3><div class="muted">Crée les stocks, achats et commandes, puis la comptabilité dans le même ordre que ton utilisation réelle : facture reçue → contrôle IA → validation → OD → confirmation Charlemagne → clôture.</div></div><span class="pill">DONNÉES FICTIVES</span></div><div class="actions" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button class="btn secondary" data-sb-generate onclick="sandboxGenerateVolume(\'petit\')">Petit parcours</button><button class="btn primary" data-sb-generate onclick="sandboxGenerateVolume(\'moyen\')">Parcours moyen</button><button class="btn primary" data-sb-generate onclick="sandboxGenerateVolume(\'gros\')">Gros parcours</button></div><p class="muted" style="margin-top:10px">Les statuts comptables ne sont plus choisis au hasard. Les anomalies artificielles sont supprimées par défaut. Les factures à traiter restent disponibles pour une vraie réanalyse IA dans l’écran Comptabilité.</p>';
      anchor.insertAdjacentElement('afterend',box);
      const active=!!window.GestionCollegeTestMode?.active;box.querySelectorAll('button').forEach(b=>b.disabled=!active);
    };
    if(typeof sandboxData!=='undefined'&&sandboxData)drawSandbox();
  }
  let tries=0;const t=setInterval(()=>{inject();if(window.__sandboxGeneratorWrapped||++tries>50)clearInterval(t)},100);
})();
