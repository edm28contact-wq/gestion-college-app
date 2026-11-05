/* Interface Admin Collège : éditeur de présentation des sites, sans modification des droits ni du code métier. */
const SITE_CONFIG_API=ROOT+"/college-site-settings";
const SITE_LABELS={
 "admin-college":"Administration Collège",
 secretariat:"Secrétariat",comptabilite:"Comptabilité",planning:"Planning du personnel",
 veryfi:"Lecteur Veryfi",holding:"Administration centrale", "holding-control":"Supervision Holding",
 "holding-users":"Gestion des utilisateurs","holding-societes":"Sociétés",
 "admin-commandes":"Commandes","marne-accounting":"Comptabilité 9 Marne",
 readiness:"Contrôles Collège","admin-access":"Gestion des accès",
 "admin-accounting-setup":"Configuration comptable","windows-agent":"Agent Windows"
};
const SITE_NAV_ENTRIES={
 "admin-college":[["Accueil","tab:#dashboard"],["Produits","tab:#products"],["Applications","tab:#apps"],["Catégories","tab:#categories"],["Achats","tab:#purchases"],["Commandes","tab:#commandes"],["Mouvements","tab:#events"],["Salaires","tab:#salaires"],["Outils avancés","tab:#advanced"]],
 secretariat:[["Stocks et produits","tab:#tStocks"],["Commandes fournisseurs","tab:#tOrders"],["Factures · Lecteur Veryfi","link:lecteur-veryfi/?origine=secretariat"],["Planning des incidents","link:secretariat/planning/"],["Paramètres","tab:#tSettings"],["Mot de passe","tab:#tPassword"],["Admin Collège","link:college/admin/"],["Comptabilité","link:comptabilite/"],["Holding","link:admin/holding/"]],
 comptabilite:[["Tableau de bord","tab:#td"],["Recettes","tab:#trc"],["Factures fournisseurs","tab:#tde"],["Import de factures","tab:#ti"],["Lecteur Veryfi","link:lecteur-veryfi/?origine=comptabilite"],["Livres et documents","tab:#tdoc"],["Outils avancés","tab:#tadv"]],
 planning:[["Registre des incidents","scroll:#rows"],["Nouvel incident","tab:#new"],["Filtrer le mois","scroll:#month"]],
 veryfi:[["Déposer un PDF","scroll:#drop"],["Suivi du quota","scroll:.usage-panel"],["Facture originale","scroll:.document-panel"],["Contrôle des produits","scroll:#lines"]],
 holding:[["Accueil Holding","link:admin/holding/"],["Utilisateurs et accès","link:admin/holding/utilisateurs/"],["Sociétés","link:admin/holding/societes/"],["Centre de supervision","link:admin/holding/controle/"],["Administration 9 Marne","link:admin/marne-invest/"]],
 "holding-control":[["Tableau de bord","tab:#tdash"],["Alertes","tab:#talerts"],["Journal","tab:#tactivity"],["Corbeille","tab:#ttrash"],["Sauvegarde","tab:#tbackup"],["Mode test","tab:#ttest"]],
 "holding-users":[["Accueil Holding","link:admin/holding/"],["Utilisateurs et accès","link:admin/holding/utilisateurs/"],["Sociétés","link:admin/holding/societes/"],["Centre de supervision","link:admin/holding/controle/"]],
 "holding-societes":[["Accueil Holding","link:admin/holding/"],["Utilisateurs et accès","link:admin/holding/utilisateurs/"],["Sociétés","link:admin/holding/societes/"]],
 "admin-commandes":[["Tableau de bord Collège","link:college/admin/"],["Achats et commandes","link:college/admin/?page=commandes"],["Secrétariat","link:secretariat/"],["Lecteur Veryfi","link:lecteur-veryfi/?origine=secretariat"]],
 "marne-accounting":[["Administration 9 Marne","link:admin/marne-invest/"],["Gestion locataires","link:admin/marne-invest/?page=tenants"],["Studios","link:admin/marne-invest/?page=properties"],["Comptabilité 9 Marne","link:admin/marne-invest/comptabilite/"]],
 readiness:[["Tableau de bord Collège","link:college/admin/"],["Contrôles pré-lancement","link:college/readiness/"],["Applications","link:college/admin/?page=apps"],["Centre de supervision","link:admin/holding/controle/"]],
 "admin-access":[["Accès et liens","link:admin/acces.html"],["Gestion utilisateurs","link:admin/holding/utilisateurs/"],["Gestion sociétés","link:admin/holding/societes/"],["Gestion applications","link:college/admin/?page=apps"]],
 "admin-accounting-setup":[["Administration Collège","link:college/admin/"],["Compte Comptabilité","link:admin/comptabilite/"],["Comptabilité Collège","link:comptabilite/"]],
 "windows-agent":[["Comptabilité Collège","link:comptabilite/"],["Agent Windows","link:admin/windows-agent/"],["Gestion des accès","link:admin/holding/utilisateurs/"]]
};
let siteEditorSite="secretariat",siteEditorRevision=0,siteEditorDraft={},siteEditorLoading=false;
const siteEditorEsc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function siteDesignerPage(){
 const el=document.getElementById("content");
 if(!el)return;
 if(db?.current_user?.role!=="admin"){
  el.innerHTML='<div class="card"><h2>Configuration des sites</h2><p class="muted">Réservé à l’administrateur global. Les autres comptes conservent leur accès habituel.</p></div>';return;
 }
 el.innerHTML='<div class="card"><div class="top"><div><h2 style="margin:0">Configuration des sites</h2><p class="muted">Personnalisez les présentations, menus, raccourcis et informations de chaque espace. Les droits, données et traitements ne changent pas.</p></div><button class="btn secondary" type="button" onclick="show(\'advanced\')">Retour aux outils avancés</button></div></div>'+
  '<div class="card"><label for="designerSite"><b>Site à paramétrer</b></label><select id="designerSite">'+Object.entries(SITE_LABELS).map(([key,label])=>'<option value="'+siteEditorEsc(key)+'" '+(key===siteEditorSite?'selected':'')+'>'+siteEditorEsc(label)+'</option>').join("")+'</select><p class="muted">Les noms sont modifiables sans changer les adresses, les autorisations ou les traitements.</p><div id="designerStatus" class="status" role="status" aria-live="polite"></div></div>'+
  '<div id="designerEditor"></div>';
 document.getElementById("designerSite").addEventListener("change",e=>{siteEditorSite=e.target.value;siteDesignerLoad()});
 siteDesignerLoad();
}
function siteDesignerMessage(message,error=false){
 const el=document.getElementById("designerStatus");
 if(el){el.className="status "+(error?"err":"ok");el.textContent=message}
}
async function siteDesignerApi(method="GET",body){
 const u=new URL(SITE_CONFIG_API);u.searchParams.set("site",siteEditorSite);
 const r=await fetch(u,{method,headers:{"content-type":"application/json","x-admin-session":token},body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>({error:"Réponse serveur invalide"}));
 if(!r.ok)throw Error(data.error||"Configuration indisponible");
 return data;
}
async function siteDesignerLoad(){
 const site=siteEditorSite;
 if(siteEditorLoading)return;
 siteEditorLoading=true;
 siteDesignerMessage("Chargement...");
 const area=document.getElementById("designerEditor");if(area)area.innerHTML="<div class='card'>Chargement des réglages…</div>";
 try{
  const data=await siteDesignerApi();
  if(site!==siteEditorSite||page!=="siteDesigner")return;
  siteEditorRevision=data.revision||0;
  siteEditorDraft=structuredClone(data.settings||{});
  siteEditorDraft.menu=siteEditorDraft.menu||{};
  siteEditorDraft.shortcuts=siteEditorDraft.shortcuts||[];
  siteEditorDraft.blocks=siteEditorDraft.blocks||[];
  siteDesignerMessage(data.updated_at?"Dernière modification : "+new Date(data.updated_at).toLocaleString("fr-FR"):"Réglages d’origine");
  siteDesignerRender();
 }catch(e){siteDesignerMessage(e.message,true);if(area)area.innerHTML='<div class="card err">Chargement impossible.</div>'}
 finally{siteEditorLoading=false}
}
function siteDesignerEntries(){
 const config=siteEditorDraft.menu||{};
 return (SITE_NAV_ENTRIES[siteEditorSite]||[]).map(([label,id],index)=>({
  id,label,index,config:config[id]||{},order:Number.isInteger(config[id]?.order)?config[id].order:index
 })).sort((a,b)=>a.order-b.order||a.index-b.index);
}
function siteDesignerRender(){
 const area=document.getElementById("designerEditor");if(!area)return;
 const s=siteEditorDraft,entries=siteDesignerEntries();
 const input=(key,label,max,placeholder="")=>'<label class="designer-field"><span>'+label+'</span><input data-site-field="'+key+'" maxlength="'+max+'" placeholder="'+siteEditorEsc(placeholder)+'" value="'+siteEditorEsc(s[key]||"")+'"></label>';
 area.innerHTML='<div class="card"><h3>Identité et présentation</h3><div class="designer-fields">'+input("title","Nom affiché du site",70,SITE_LABELS[siteEditorSite])+input("subtitle","Description sous le titre",160,"Espace de gestion")+
 '<label class="designer-field"><span>Couleur d’accentuation</span><input type="color" data-site-field="accent" value="'+(/^#[0-9a-f]{6}$/i.test(s.accent||"")?s.accent:"#32749f")+'"></label></div></div>'+
 '<div class="card"><h3>Menus et rubriques</h3><p class="muted">Renommez, masquez ou déplacez les entrées existantes. Le fonctionnement des boutons et les droits restent inchangés.</p><div id="designerMenu">'+entries.map((e,index)=>{
 const custom=e.config,hidden=custom.hidden===true;
 return '<div class="designer-line" data-designer-menu="'+siteEditorEsc(e.id)+'"><div class="designer-line-main"><small>'+siteEditorEsc(e.label)+'</small><input maxlength="65" aria-label="Nom personnalisé" data-menu-name="'+siteEditorEsc(e.id)+'" value="'+siteEditorEsc(custom.label||"")+'" placeholder="'+siteEditorEsc(e.label)+'"></div><label class="designer-check"><input type="checkbox" data-menu-hidden="'+siteEditorEsc(e.id)+'" '+(hidden?"checked":"")+'> Masquer</label><div class="designer-order"><button class="btn secondary compact" data-menu-move="'+index+'" data-dir="-1" type="button" '+(index===0?"disabled":"")+' aria-label="Monter">↑</button><button class="btn secondary compact" data-menu-move="'+index+'" data-dir="1" type="button" '+(index===entries.length-1?"disabled":"")+' aria-label="Descendre">↓</button></div></div>'
 }).join("")+'</div></div>'+
 '<div class="card"><div class="top"><h3>Raccourcis personnalisés</h3><button class="btn secondary compact" id="designerAddShortcut" type="button">+ Ajouter un raccourci</button></div><p class="muted">Liens internes uniquement : chemin relatif au projet, sans adresse extérieure ni script.</p><div id="designerShortcuts">'+s.shortcuts.map((x,i)=>'<div class="designer-line"><input maxlength="65" placeholder="Nom du raccourci" data-shortcut-label="'+i+'" value="'+siteEditorEsc(x.label)+'"><input maxlength="150" placeholder="Ex. secretariat/planning/" data-shortcut-path="'+i+'" value="'+siteEditorEsc(x.path)+'"><button class="btn danger compact" type="button" data-shortcut-remove="'+i+'">Supprimer</button></div>').join("")+'</div></div>'+
 '<div class="card"><div class="top"><h3>Blocs d’information</h3><button class="btn secondary compact" id="designerAddBlock" type="button">+ Ajouter un bloc</button></div><p class="muted">Ajoutez des consignes ou des informations visibles sur la page, sans HTML ni code.</p><div id="designerBlocks">'+s.blocks.map((x,i)=>'<div class="designer-line designer-block-line"><input maxlength="85" placeholder="Titre du bloc" data-block-title="'+i+'" value="'+siteEditorEsc(x.title)+'"><textarea maxlength="500" rows="2" placeholder="Consigne ou information" data-block-text="'+i+'">'+siteEditorEsc(x.text)+'</textarea><button class="btn danger compact" type="button" data-block-remove="'+i+'">Supprimer</button></div>').join("")+'</div></div>'+
 '<div class="card"><h3>Aperçu avant enregistrement</h3><div class="designer-preview" id="designerPreview"></div></div>'+
 '<div class="card"><div class="actions"><button class="btn primary" type="button" id="designerSave">Enregistrer les modifications</button><button class="btn secondary" type="button" id="designerReload">Annuler mes modifications</button><button class="btn danger" type="button" id="designerReset">Restaurer les valeurs d’origine</button></div><div class="muted">Toute modification est enregistrée dans l’historique d’administration. Actualisez le site concerné pour appliquer les changements.</div></div>';
 area.oninput=siteDesignerInput;
 area.onchange=siteDesignerInput;
 area.onclick=siteDesignerClick;
 siteDesignerPreview();
}
function siteDesignerInput(e){
 const t=e.target,s=siteEditorDraft;
 if(t.dataset.siteField){s[t.dataset.siteField]=t.value;siteDesignerPreview();return}
 const label=t.dataset.menuName,hidden=t.dataset.menuHidden;
 if(label!==undefined){s.menu[label]=s.menu[label]||{};s.menu[label].label=t.value;siteDesignerPreview();return}
 if(hidden!==undefined){s.menu[hidden]=s.menu[hidden]||{};s.menu[hidden].hidden=t.checked;siteDesignerPreview();return}
 for(const [attribute,field,array] of [["shortcutLabel","label","shortcuts"],["shortcutPath","path","shortcuts"],["blockTitle","title","blocks"],["blockText","text","blocks"]]){
  if(t.dataset[attribute]!==undefined){s[array][Number(t.dataset[attribute])][field]=t.value;siteDesignerPreview();return}
 }
}
function siteDesignerClick(e){
 const button=e.target.closest("button");if(!button)return;
 const s=siteEditorDraft;
 if(button.id==="designerAddShortcut"){
  if(s.shortcuts.length>=10)return siteDesignerMessage("Maximum 10 raccourcis.",true);
  s.shortcuts.push({label:"",path:""});siteDesignerRender();
 }else if(button.id==="designerAddBlock"){
  if(s.blocks.length>=8)return siteDesignerMessage("Maximum 8 blocs.",true);
  s.blocks.push({title:"",text:""});siteDesignerRender();
 }else if(button.dataset.shortcutRemove!==undefined){s.shortcuts.splice(Number(button.dataset.shortcutRemove),1);siteDesignerRender()}
 else if(button.dataset.blockRemove!==undefined){s.blocks.splice(Number(button.dataset.blockRemove),1);siteDesignerRender()}
 else if(button.dataset.menuMove!==undefined){
  const entries=siteDesignerEntries(),from=Number(button.dataset.menuMove),to=from+Number(button.dataset.dir);
  if(to<0||to>=entries.length)return;
  [entries[from],entries[to]]=[entries[to],entries[from]];
  entries.forEach((item,index)=>{s.menu[item.id]=s.menu[item.id]||{};s.menu[item.id].order=index});
  siteDesignerRender();
 }else if(button.id==="designerSave")siteDesignerSave(false);
 else if(button.id==="designerReset"){
  if(confirm("Restaurer tous les réglages d’origine pour "+SITE_LABELS[siteEditorSite]+" ?"))siteDesignerSave(true)
 }else if(button.id==="designerReload")siteDesignerLoad();
}
function siteDesignerPreview(){
 const el=document.getElementById("designerPreview");if(!el)return;
 const s=siteEditorDraft,items=siteDesignerEntries().filter(x=>x.config.hidden!==true);
 el.innerHTML='<strong style="color:'+(/^#[0-9a-f]{6}$/i.test(s.accent||"")?s.accent:"#32749f")+'">'+siteEditorEsc(s.title||SITE_LABELS[siteEditorSite])+'</strong>'+
 '<p class="muted">'+siteEditorEsc(s.subtitle||"Aucune description personnalisée")+'</p>'+
 '<div class="designer-preview-menu">'+items.map(e=>'<span>'+siteEditorEsc(e.config.label||e.label)+'</span>').join("")+'</div>'+
 '<div class="muted">Raccourcis : '+s.shortcuts.length+' · Blocs : '+s.blocks.length+'</div>';
}
async function siteDesignerSave(reset){
 if(db?.current_user?.role!=="admin")return siteDesignerMessage("Accès refusé.",true);
 const button=document.getElementById("designerSave");if(button)button.disabled=true;
 const site=siteEditorSite;
 try{
  const data=await siteDesignerApi("POST",{action:reset?"reset":"save",revision:siteEditorRevision,settings:reset?{}:siteEditorDraft});
  if(site!==siteEditorSite)return;
  siteEditorRevision=data.revision;
  siteEditorDraft=structuredClone(data.settings);
  siteEditorDraft.menu=siteEditorDraft.menu||{};siteEditorDraft.shortcuts=siteEditorDraft.shortcuts||[];siteEditorDraft.blocks=siteEditorDraft.blocks||[];
  siteDesignerMessage(reset?"Valeurs d’origine restaurées.":"Configuration enregistrée.");
  siteDesignerRender();
  if(site==="admin-college")applyAdminCollegeSettings(siteEditorDraft);
 }catch(e){siteDesignerMessage("Enregistrement impossible : "+e.message,true)}
 finally{if(button)button.disabled=false}
}
let adminCollegeVisualSettings={};
function applyAdminCollegeSettings(s){
 adminCollegeVisualSettings=s||{};
 const heading=document.querySelector("#app .brand");
 if(heading)heading.textContent=s?.title||"Société Collège";
 const nav=document.getElementById("nav");
 if(nav){
  for(const btn of nav.querySelectorAll("button[data-p]")){
   const opt=s?.menu?.["tab:#"+btn.dataset.p];
   const standard=pages.find(x=>x[0]===btn.dataset.p)?.[1]||btn.dataset.p;
   btn.textContent=opt?.label||standard;btn.hidden=opt?.hidden===true;
   btn.style.order=Number.isInteger(opt?.order)?opt.order:"";
  }
 }
 let panel=document.getElementById("adminCustomBlocks");
 if(!panel){panel=document.createElement("div");panel.id="adminCustomBlocks";document.getElementById("content")?.before(panel)}
 if(panel){
  panel.innerHTML="";
  if(Array.isArray(s?.blocks))for(const b of s.blocks.slice(0,8)){
   const box=document.createElement("div");box.className="card";const strong=document.createElement("strong");strong.textContent=String(b.title||"");const p=document.createElement("p");p.className="muted";p.textContent=String(b.text||"");box.append(strong,p);panel.append(box);
  }
 }
 let links=document.getElementById("adminCustomShortcuts");
 if(!links){links=document.createElement("div");links.id="adminCustomShortcuts";document.getElementById("content")?.before(links)}
 if(links){links.innerHTML="";for(const item of s?.shortcuts||[]){
  if(typeof item.path!=="string"||item.path.includes("..")||item.path.startsWith("/")||/[:?#\\]/.test(item.path))continue;
  const a=document.createElement("a");a.className="btn secondary compact";a.href=new URL("../../"+item.path,location.href);a.textContent=item.label;links.append(a)
 }}
 const accent=/^#[0-9a-f]{6}$/i.test(s?.accent||"")?s.accent:null;
 document.querySelector("#app")?.style.setProperty("--p",accent||"#243447");
}
async function loadAdminCollegeSettings(){
 try{
  const u=new URL(SITE_CONFIG_API);u.searchParams.set("site","admin-college");
  const r=await fetch(u,{cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!r.ok)return;const data=await r.json();
  if(data.ok)applyAdminCollegeSettings(data.settings||{});
 }catch{}
}
