/* Shared navigation: the original page controls and authentication remain untouched. */
(() => {
 "use strict";
 const script=document.currentScript;
 if(!script)return;
 const area=script.dataset.area||"secretariat";
 const targetSelector=script.dataset.target||"#app";
 const base=new URL("../",script.src);
 const url=(path)=>new URL(path,base).href;
 const section=(title,items)=>({title,items});
 const link=(label,path)=>({label,path});
 const tab=(label,selector)=>({label,selector});
 const scroll=(label,selector)=>({label,scrollTo:selector});
 const common=[
  link("Administration Collège","college/admin/"),
  link("Secrétariat","secretariat/"),
  link("Comptabilité","comptabilite/"),
  link("Planning du personnel","secretariat/planning/"),
  link("Lecteur Veryfi","lecteur-veryfi/?origine="+(area==="comptabilite"?"comptabilite":"secretariat")),
  link("Administration centrale","admin/holding/")
 ];
 const holding=[
  link("Accueil Holding","admin/holding/"),
  link("Utilisateurs et accès","admin/holding/utilisateurs/"),
  link("Sociétés","admin/holding/societes/"),
  link("Centre de supervision","admin/holding/controle/"),
  link("Administration 9 Marne","admin/marne-invest/")
 ];
 const areas={
  secretariat:{label:"Secrétariat",hideTabs:true,sections:[
   section("Gestion quotidienne",[
    tab("Stocks et produits","#tStocks"),
    tab("Commandes fournisseurs","#tOrders"),
    link("Factures · Lecteur Veryfi","lecteur-veryfi/?origine=secretariat"),
    link("Planning des incidents","secretariat/planning/")
   ]),
   section("Réglages",[tab("Paramètres","#tSettings"),tab("Mot de passe","#tPassword")]),
   section("Autres espaces",[
    link("Admin Collège","college/admin/"),
    link("Comptabilité","comptabilite/"),
    link("Holding","admin/holding/")
   ])]},
  comptabilite:{label:"Comptabilité",hideTabs:true,sections:[
   section("Comptabilité",[tab("Tableau de bord","#td"),tab("Recettes","#trc"),tab("Factures fournisseurs","#tde"),tab("Import de factures","#ti"),link("Lecteur Veryfi","lecteur-veryfi/?origine=comptabilite"),tab("Livres et documents","#tdoc"),tab("Outils avancés","#tadv")]),
   section("Autres espaces",common)]},
  planning:{label:"Planning du personnel",sections:[
   section("Planning",[scroll("Événements du mois","#rows"),tab("Nouvel événement","#new"),scroll("Filtrer le mois","#month")]),
   section("Autres espaces",common)]},
  veryfi:{label:"Factures fournisseurs · Veryfi",sections:[
   section("Lecteur de factures",[scroll("Déposer un PDF","#drop"),scroll("Suivi du quota",".usage-panel"),scroll("Facture originale",".document-panel"),scroll("Contrôle des produits","#lines")]),
   section("Autres espaces",common)]},
  holding:{label:"Administration centrale",sections:[
   section("Holding",holding),
   section("Collège",common)]},
  "holding-control":{label:"Supervision Holding",hideTabs:true,sections:[
   section("Supervision",[tab("Tableau de bord","#tdash"),tab("Alertes","#talerts"),tab("Journal","#tactivity"),tab("Corbeille","#ttrash"),tab("Sauvegarde","#tbackup"),tab("Mode test","#ttest")]),
   section("Holding",holding),section("Collège",common)]},
  "holding-users":{label:"Gestion utilisateurs",sections:[
   section("Holding",holding),section("Collège",common)]},
  "holding-societes":{label:"Gestion sociétés",sections:[
   section("Holding",holding),section("Collège",common)]},
  "admin-commandes":{label:"Commandes fournisseurs",sections:[
   section("Administration",[link("Tableau de bord Collège","college/admin/"),link("Achats et commandes","college/admin/?page=commandes"),link("Secrétariat","secretariat/"),link("Lecteur Veryfi","lecteur-veryfi/?origine=secretariat")]),
   section("Autres espaces",common)]},
  "marne-accounting":{label:"Comptabilité 9 Marne",sections:[
   section("9 Marne",[link("Administration 9 Marne","admin/marne-invest/"),link("Gestion locataires","admin/marne-invest/?page=tenants"),link("Studios","admin/marne-invest/?page=properties"),link("Comptabilité 9 Marne","admin/marne-invest/comptabilite/")]),
   section("Holding",holding)]},
  readiness:{label:"Contrôles Collège",sections:[
   section("Administration",[link("Tableau de bord Collège","college/admin/"),link("Contrôles pré-lancement","college/readiness/"),link("Applications","college/admin/?page=apps"),link("Centre de supervision","admin/holding/controle/")]),
   section("Autres espaces",common)]},
  "admin-access":{label:"Accès et applications",sections:[
   section("Administration",[link("Accès et liens","admin/acces.html"),link("Gestion utilisateurs","admin/holding/utilisateurs/"),link("Gestion sociétés","admin/holding/societes/"),link("Gestion applications","college/admin/?page=apps")]),
   section("Autres espaces",common)]},
  "admin-accounting-setup":{label:"Configuration comptable",sections:[
   section("Administration",[link("Administration Collège","college/admin/"),link("Compte Comptabilité","admin/comptabilite/"),link("Comptabilité Collège","comptabilite/")]),
   section("Autres espaces",common)]},
  "windows-agent":{label:"Agent Comptabilité",sections:[
   section("Administration",[link("Comptabilité Collège","comptabilite/"),link("Agent Windows","admin/windows-agent/"),link("Gestion des accès","admin/holding/utilisateurs/")]),
   section("Autres espaces",common)]}
 };
 function mount(){
  const target=document.querySelector(targetSelector);
  if(!target||target.classList.contains("school-workspace"))return;
  const config=areas[area]||areas.secretariat;
  const aside=document.createElement("aside");
  aside.className="school-nav-aside";
  aside.setAttribute("aria-label","Navigation des espaces de gestion");
  const brand=document.createElement("a");
  brand.className="school-nav-brand";brand.href=url("college/admin/");
  const title=document.createElement("strong");title.textContent="Cours Chambertin";
  const subtitle=document.createElement("small");subtitle.textContent="Gestion et administration";
  brand.append(title,subtitle);aside.append(brand);
  const context=document.createElement("div");context.className="school-nav-context";context.textContent=config.label;
  aside.append(context);
  const bindings=[];
  for(const block of config.sections){
   const group=document.createElement("section");group.className="school-nav-section";
   const heading=document.createElement("h2");heading.textContent=block.title;
   const menu=document.createElement("nav");menu.className="school-nav-links";menu.setAttribute("aria-label",block.title);
   for(const item of block.items){
    const control=item.path?document.createElement("a"):document.createElement("button");
    control.textContent=item.label;
    if(item.path){
     const href=url(item.path);control.href=href;
     const current=new URL(href);
     if(current.pathname===location.pathname&&(!current.searchParams.has("origine")||current.searchParams.get("origine")===(new URL(location.href)).searchParams.get("origine")))
      control.setAttribute("aria-current","page");
    }else{
     control.type="button";
     if(item.selector){
      const original=document.querySelector(item.selector);
      if(!original)continue;
      control.addEventListener("click",()=>original.click());
      const update=()=>{
       const current=original.classList.contains("active");
       control.classList.toggle("is-current",current);
       if(current)control.setAttribute("aria-current","page");else control.removeAttribute("aria-current");
      };
      update();
      bindings.push({original,update});
     }else if(item.scrollTo){
      control.addEventListener("click",()=>{
       document.querySelector(item.scrollTo)?.scrollIntoView({behavior:"smooth",block:"start"});
      });
     }
    }
    menu.append(control);
   }
   if(!menu.children.length)continue;
   group.append(heading,menu);aside.append(group);
  }
  const footer=document.createElement("div");
  footer.className="school-nav-footer";
  footer.textContent="Accès conservés selon les droits de chaque compte.";
  aside.append(footer);
  const body=document.createElement("div");
  body.className="school-workspace-main";
  while(target.firstChild)body.appendChild(target.firstChild);
  target.append(aside,body);
  target.classList.add("school-workspace");
  target.dataset.schoolArea=area;
  if(config.hideTabs)target.classList.add("school-tabs-in-sidebar");
  const host=target.closest("main")||target;
  host.classList.add("school-workspace-host");
  if(bindings.length&&typeof MutationObserver==="function"){
   const observer=new MutationObserver(()=>bindings.forEach(({update})=>update()));
   for(const {original} of bindings)observer.observe(original,{attributes:true,attributeFilter:["class"]});
  }
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
 else mount();
})();