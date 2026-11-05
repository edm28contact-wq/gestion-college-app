(function(){
"use strict";
const el=id=>document.getElementById(id);
const mode=a=>{const o=a.site_options||{};return o.inventory&&o.outgoing?"both":o.inventory?"inventory":o.outgoing?"outgoing":"other"};
const modeLabel={inventory:"Inventaire",outgoing:"Sorties de stock",both:"Inventaire et sorties",other:"Autre configuration"};
const isActive=a=>a.active!==false;
function listGroups(applications,categories){
 const cats=categories.filter(c=>c.active!==false||applications.some(a=>a.category_id===c.id)).sort((a,b)=>String(a.name).localeCompare(String(b.name),"fr"));
 const known=new Set(cats.map(c=>c.id));
 const groups=cats.map(c=>({id:c.id,name:c.name,items:applications.filter(a=>a.category_id===c.id)}));
 const residual=applications.filter(a=>!known.has(a.category_id));
 if(residual.length)groups.push({id:"__other__",name:"Sans catégorie",items:residual});
 return groups;
}
function appCard(a){
 const options=a.site_options||{},kind=mode(a);
 const products=(db.application_products||[]).filter(m=>m.application_id===a.id&&m.active!==false&&db.products.some(p=>p.id===m.product_id&&p.active!==false)).length;
 const href="https://edm28contact-wq.github.io/gestion-college-app/college/?id="+encodeURIComponent(a.public_id);
 const search=norm([a.name,a.code,a.description,cat(a.category_id)?.name,modeLabel[kind]].filter(Boolean).join(" "));
 return `<article class="apps-entry" data-category="${esc(a.category_id||"")}" data-status="${isActive(a)?"active":"inactive"}" data-mode="${kind}" data-search="${esc(search)}">
  <div class="apps-entry-heading"><div><h4>${esc(a.name)}</h4><small>Référence ${esc(a.code||"—")}</small></div><div>${statusPill(isActive(a))}${options.internal?' <span class="pill">Système</span>':""}</div></div>
  <p class="apps-description">${esc(a.description||"Aucune description renseignée.")}</p>
  <div class="apps-info"><span class="apps-mode">${esc(modeLabel[kind])}</span><span>${products} produit${products>1?"s":""}</span></div>
  <div class="apps-actions">${isActive(a)?`<a class="btn primary compact" href="${href}" rel="noopener" target="_blank">Ouvrir</a><button class="btn secondary compact" type="button" onclick="openAppQr('${a.id}')">QR code</button>`:""}<button class="btn secondary compact" type="button" onclick="editSite('${a.id}','${a.category_id||""}')">Configurer</button>${isActive(a)?`<button class="btn danger compact" type="button" onclick="disableSite('${a.id}')">Désactiver</button>`:""}</div>
 </article>`;
}
function groupCard(group){
 const ordered=[...group.items].sort((a,b)=>isActive(a)===isActive(b)?String(a.name).localeCompare(String(b.name),"fr"):isActive(a)?-1:1);
 const count=ordered.filter(isActive).length;
 return `<section class="apps-group" data-group="${esc(group.id)}"><header class="apps-group-header"><div><h3>${esc(group.name)}</h3><small>${count} active${count>1?"s":""} · ${ordered.length-count} archivée${ordered.length-count>1?"s":""}</small></div>${group.id!=="__other__"?`<button class="btn secondary compact" type="button" onclick="editSite('','${group.id}')">+ Application</button>`:""}</header><div class="apps-grid">${ordered.map(appCard).join("")}</div></section>`;
}
function render(){
 const applications=[...(db.applications||[])];
 const groups=listGroups(applications,db.categories||[]);
 const active=applications.filter(isActive).length;
 const archived=applications.length-active;
 const linked=(db.application_products||[]).filter(x=>x.active!==false).length;
 el("content").innerHTML=`
 <header class="apps-page-header"><div><div class="apps-overline">GESTION DES APPLICATIONS</div><h2>Applications du collège</h2><p class="muted">Applications regroupées par catégorie et par fonction, avec accès et configuration centralisés.</p></div><button class="btn primary" type="button" onclick="editSite('','')">+ Créer une application</button></header>
 <div class="apps-stats"><div><small>Catégories</small><strong>${groups.length}</strong></div><div><small>Applications actives</small><strong>${active}</strong></div><div><small>Applications archivées</small><strong>${archived}</strong></div><div><small>Produits liés</small><strong>${linked}</strong></div></div>
 <section class="card apps-panel"><div class="apps-panel-title"><h3>1. Sélectionner une catégorie</h3><span class="muted">Une catégorie ouvre toutes les applications correspondantes.</span></div><div class="apps-categories">
 <button class="apps-category selected" data-app-cat="" aria-pressed="true" type="button" onclick="openAppCategory('')"><span>Toutes les catégories</span><strong>${active}</strong><small>applications actives</small></button>
 ${groups.map(g=>{const n=g.items.filter(isActive).length;return `<button class="apps-category" data-app-cat="${esc(g.id)}" aria-pressed="false" type="button" onclick="openAppCategory('${g.id}')"><span>${esc(g.name)}</span><strong>${n}</strong><small>application${n>1?"s":""} active${n>1?"s":""}</small></button>`}).join("")}</div></section>
 <section class="card apps-panel"><h3>2. Filtrer les applications</h3><div class="apps-filter-grid">
 <label>Recherche<input id="appSearch" type="search" placeholder="Nom, code, fonction…" oninput="filterApps()"></label>
 <label>Catégorie<select id="appCategoryFilter" onchange="filterApps()"><option value="">Toutes</option>${groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></label>
 <label>Statut<select id="appStatusFilter" onchange="filterApps()"><option value="active" selected>Actives</option><option value="inactive">Archivées</option><option value="">Toutes</option></select></label>
 <label>Fonction<select id="appModeFilter" onchange="filterApps()"><option value="">Toutes</option><option value="inventory">Inventaire</option><option value="outgoing">Sorties</option><option value="both">Inventaire + sorties</option><option value="other">Autre</option></select></label>
 </div><div class="apps-filter-footer"><strong id="appResultsStatus" aria-live="polite" role="status"></strong><button class="btn secondary compact" type="button" onclick="resetAppFilters()">Effacer les filtres</button></div></section>
 <div class="apps-panel-title apps-results-title"><h3>3. Applications par catégorie</h3><span class="muted">Ouvrir · QR code · Configurer</span></div>
 <div class="apps-group-list" id="appCards">${groups.map(groupCard).join("")}</div>
 <div class="card apps-noresults" id="appsNoResults" hidden>Aucune application ne correspond à cette sélection.</div>
 <div class="status" id="pageStatus"></div>`;
 window.filterApps();
}
function filter(){
 const search=norm(el("appSearch")?.value||"");
 const category=el("appCategoryFilter")?.value||"";
 const status=el("appStatusFilter")?.value||"";
 const selectedMode=el("appModeFilter")?.value||"";
 let shown=0,groupCount=0;
 for(const entry of document.querySelectorAll("#appCards .apps-entry")){
  const catOk=!category||entry.dataset.category===category||(category==="__other__"&&!entry.dataset.category);
  const ok=catOk&&(!search||norm(entry.dataset.search||"").includes(search))&&(!status||entry.dataset.status===status)&&(!selectedMode||entry.dataset.mode===selectedMode);
  entry.hidden=!ok;if(ok)shown++;
 }
 for(const group of document.querySelectorAll("#appCards .apps-group")){
  const match=!category||group.dataset.group===category;
  const any=[...group.querySelectorAll(".apps-entry")].some(x=>!x.hidden);
  group.hidden=!match||!any;if(!group.hidden)groupCount++;
 }
 for(const button of document.querySelectorAll("[data-app-cat]")){
  const active=button.dataset.appCat===category;
  button.classList.toggle("selected",active);button.setAttribute("aria-pressed",String(active));
 }
 if(el("appResultsStatus"))el("appResultsStatus").textContent=`${shown} application${shown>1?"s":""} dans ${groupCount} catégorie${groupCount>1?"s":""}`;
 if(el("appsNoResults"))el("appsNoResults").hidden=shown!==0;
}
function selectCategory(id){
 if(el("appSearch"))el("appSearch").value="";
 if(el("appStatusFilter"))el("appStatusFilter").value="active";
 if(el("appModeFilter"))el("appModeFilter").value="";
 if(el("appCategoryFilter"))el("appCategoryFilter").value=id;
 filter();
 el("appCards")?.scrollIntoView({behavior:"smooth",block:"start"});
}
function reset(){
 for(const id of ["appSearch","appCategoryFilter","appModeFilter"])if(el(id))el(id).value="";
 if(el("appStatusFilter"))el("appStatusFilter").value="active";
 filter();
}
window.renderStructuredApps=function(){
 window.filterApps=filter;window.openAppCategory=selectCategory;window.resetAppFilters=reset;
 render();
};
window.__appsOrganizerTests={listGroups,mode};
})();