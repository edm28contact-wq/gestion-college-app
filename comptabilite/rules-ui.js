const rulesPageBase=rulesPage;
rulesPage=function(){
  const rules=[...(db.rules||[])].sort((a,b)=>String(a.supplier_name||'').localeCompare(String(b.supplier_name||''),'fr'));
  const known=rules.filter(r=>r.expense_account).length, pending=rules.length-known;
  $('content').innerHTML=`<div class="card"><div class="actions" style="justify-content:space-between"><div><h2>Règles fournisseurs</h2><div class="muted">${rules.length} fournisseurs actifs · ${known} avec compte de charge par défaut · ${pending} à définir selon la facture.</div></div><input id="ruleSearch" style="max-width:320px" placeholder="Rechercher un fournisseur ou un compte"></div></div><div class="card table"><table><thead><tr><th>Fournisseur</th><th>Compte fournisseur</th><th>Compte de charge par défaut</th><th>Libellé</th><th>TVA</th><th>Journal</th></tr></thead><tbody id="rulesBody">${rules.map(r=>ruleRow(r)).join('')}</tbody></table></div>`;
  const q=$('ruleSearch');if(q)q.oninput=()=>filterRules(q.value);
}
function ruleRow(r){const missing=!r.expense_account;return `<tr data-rule-search="${esc([r.supplier_name,r.supplier_account,r.expense_account,r.expense_label].join(' ').toLowerCase())}"><td><b>${esc(r.supplier_name||'')}</b></td><td>${esc(r.supplier_account||'')}</td><td>${missing?'<span class="badge warn">À définir</span>':`<b>${esc(r.expense_account)}</b>`}</td><td>${esc(r.expense_label||(missing?'À définir selon facture':''))}</td><td>${esc(r.vat_account||'44566000')}</td><td>${esc(r.journal||'AC')}</td></tr>`}
function filterRules(v){const n=String(v||'').toLowerCase().trim();document.querySelectorAll('#rulesBody tr').forEach(tr=>{tr.style.display=!n||String(tr.dataset.ruleSearch||'').includes(n)?'':'none'})}
