/* Source commune des droits : utilisateurs et pouvoirs utilisent les mêmes groupes. */
(()=>{
"use strict";
const groups={
'Administration et supervision':[['college_admin','Administration Cours Chambertin'],['dashboard.read','Tableau de bord'],['analytics.read','Statistiques'],['audit.read','Journal d’audit'],['activity.read','Activité'],['anomalies.read','Voir les alertes'],['anomalies.manage','Gérer les alertes'],['trash.read','Voir la corbeille'],['trash.manage','Gérer la corbeille'],['backup.read','Sauvegardes'],['backup.manage','Restaurations'],['test.manage','Mode test']],
'Cours Chambertin · produits et stocks':[['products.read','Voir les produits'],['products.write','Modifier les produits'],['stock.read','Voir les stocks'],['stock.write','Modifier les stocks'],['apps.read','Voir les applications'],['apps.write','Modifier les applications'],['purchases.read','Voir les achats'],['purchases.write','Modifier les achats'],['suppliers.read','Voir les fournisseurs'],['export.read','Exporter'],['search.read','Rechercher']],
'Secrétariat et personnel':[['secretariat','Accès secrétariat'],['secretariat.read','Voir le secrétariat'],['secretariat.orders.write','Gérer les commandes'],['secretariat.invoices.write','Gérer les factures'],['secretariat.write','Écriture secrétariat historique'],['personnel.planning.read','Consulter le planning et les événements'],['personnel.planning.write','Saisir les événements du planning']],
'Ressources humaines · Salaires':[['college.salaires.read','Consulter les salariés et les périodes de paie'],['college.salaires.write','Modifier les fiches et valider les événements']],
'Comptabilité et facturation':[['accounting','Accès comptabilité'],['accounting.read','Voir la comptabilité'],['accounting.write','Écriture comptabilité']],
'Cuisine et températures':[['cuisine','Accès cuisine historique'],['cuisine.read','Consulter les relevés HACCP'],['cuisine.write','Accès agent cuisine historique'],['cuisine.manage','Paramétrer la cuisine, les chambres froides et les sondes']],
'9 Marne et Marne Invest':[['marne','Accès global 9 Marne'],['marne_invest','Marne Invest'],['marne_admin','Administration 9 Marne'],['marne_accounting','Comptabilité 9 Marne'],['marne_tenants','Locataires 9 Marne'],['marne_studios','Biens 9 Marne']]
};
const keyLabel=new Map(Object.values(groups).flat().map(([key,label])=>[key,label]));
const known=new Set(keyLabel.keys());
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function values(root){
 const out={};
 if(!root)return out;
 root.querySelectorAll('input[data-access-key]:checked').forEach(input=>{out[input.dataset.accessKey]=true});
 return out;
}
function updateCounts(root){
 const chosen=Object.keys(values(root)).length;
 const count=root.querySelector("[data-access-count]");if(count)count.textContent=chosen+" droit(s) sélectionné(s)";
 root.querySelectorAll(".holding-rights-group").forEach(group=>{
  const n=group.querySelectorAll('input[data-access-key]:checked').length;
  const target=group.querySelector("[data-group-count]");if(target)target.textContent=String(n);
 });
}
function render(root,selected={},options={}){
 if(!root)throw Error("Conteneur des droits introuvable");
 const checked=new Set(Object.keys(selected||{}).filter(k=>selected[k]===true&&k!=="readonly"));
 const extra=[...new Set([...checked,...(options.extra||[])])].filter(k=>!known.has(k)&&k!=="readonly"&&k!=="*").sort();
 const combined=[...Object.entries(groups),...(extra.length?[["Autres autorisations personnalisées",extra.map(k=>[k,k])]]:[])];
 root.innerHTML='<div class="holding-rights-toolbar"><input type="search" data-access-search aria-label="Rechercher un accès" placeholder="Rechercher une fenêtre ou une autorisation…"><span data-access-count aria-live="polite"></span></div>'
  +'<div class="holding-rights-grid">'+combined.map(([title,entries],idx)=>{
   const active=entries.filter(([key])=>checked.has(key)).length;
   return '<details class="holding-rights-group" '+(active||idx===0?'open':'')+'><summary><span>'+escape(title)+'</span><span class="holding-rights-counter"><b data-group-count>'+active+'</b>/'+entries.length+'</span></summary>'
    +'<div class="holding-rights-items">'+entries.map(([key,label])=>'<label class="holding-right"><input type="checkbox" data-access-key="'+escape(key)+'" '+(checked.has(key)?'checked':'')+'><span>'+escape(label)+'</span></label>').join('')+'</div></details>';
  }).join('')+'</div>';
 root.onchange=event=>{
  if(event.target.matches('input[data-access-key]'))updateCounts(root);
 };
 const search=root.querySelector("[data-access-search]");
 search.addEventListener("input",()=>{
  const term=search.value.trim().toLocaleLowerCase("fr");
  root.querySelectorAll(".holding-rights-group").forEach(group=>{
   let matched=false;
   const title=group.querySelector("summary").textContent.toLocaleLowerCase("fr");
   group.querySelectorAll(".holding-right").forEach(label=>{
    const visible=!term||label.textContent.toLocaleLowerCase("fr").includes(term)||title.includes(term);
    label.hidden=!visible;if(visible)matched=true;
   });
   group.hidden=!matched;
   if(term&&matched)group.open=true;
  });
 });
 updateCounts(root);
}
function add(root,key){
 const normalized=String(key||"").trim().toLowerCase();
 if(!/^[a-z][a-z0-9._-]{1,79}$/.test(normalized)||normalized==="readonly"||normalized==="*")throw Error("Code de droit invalide.");
 const existing=values(root);
 if(existing[normalized])throw Error("Ce droit est déjà sélectionné.");
 const extra=[...root.querySelectorAll("input[data-access-key]")].map(el=>el.dataset.accessKey).filter(k=>!known.has(k));
 render(root,{...existing,[normalized]:true},{extra:[...extra,normalized]});
 return normalized;
}
window.HoldingAccessCatalog=Object.freeze({groups,known,render,values,add,label:key=>keyLabel.get(key)||key});
})();
