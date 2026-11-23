// Shared navigation filter. Server authorization remains mandatory for each API action.
const endpoint="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/college-access-context";

function tokenKeys(area){
 const shared=["edm_admin_token","holding_admin_token"];
 if(area==="secretariat")return ["college_secretariat_token",...shared];
 if(area==="comptabilite")return ["college_accounting_token",...shared];
 if(area==="planning")return ["college_secretariat_token","college_admin_token",...shared];
 if(area==="veryfi")return new URLSearchParams(location.search).get("origine")==="comptabilite"
   ?["college_accounting_token",...shared]:["college_secretariat_token","college_accounting_token",...shared];
 if(area.startsWith("holding"))return shared;
 if(area==="cuisine")return ["kitchen_token","college_admin_token","college_secretariat_token",...shared];
 if(area==="marne-invest")return ["marne_invest_admin_token",...shared];
 if(area==="marne-accounting")return ["marne_invest_admin_token",...shared];
 return ["college_admin_token",...shared,"college_secretariat_token","college_accounting_token","marne_invest_admin_token"];
}

function allowedLink(href,context,base){
 const p=context?.pages||{};
 const target=new URL(href,base);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))return false;
 const route=target.pathname.slice(base.pathname.length),page=target.searchParams.get("page");
 if(route==="college/admin/"){
  if(page==="cuisine")return !!p.college_cuisine;
  if(page==="apps")return !!p.college_apps;
  if(page==="commandes")return !!p.college_orders;
  if(page==="products")return !!p.college_products;
  return !!p.college;
 }
 if(route==="secretariat/")return !!p.secretariat;
 if(route==="comptabilite/")return !!p.accounting;
 if(route==="secretariat/planning/")return !!p.planning;
 if(route==="lecteur-veryfi/")return !!p.veryfi;
 if(route==="cuisine/")return !!p.cuisine;
 if(route==="college/readiness/")return !!p.college_readiness;
 if(route==="admin/acces.html")return !!p.site_access;
 if(route==="admin/comptabilite/")return !!p.accounting_setup;
 if(route==="admin/windows-agent/")return !!p.windows_agent;
 if(route==="admin/holding/")return !!p.holding;
 if(route==="admin/holding/controle/")return !!p.holding_control;
 if(route==="admin/holding/utilisateurs/")return !!p.holding_users;
 if(route==="admin/holding/pouvoirs/")return !!p.holding_powers;
 if(route==="admin/holding/societes/")return !!p.holding_companies;
 if(route==="admin/marne-invest/comptabilite/")return !!p.marne_accounting;
 if(route==="admin/marne-invest/"){
  if(page==="tenants")return !!p.marne_tenants;
  if(page==="properties")return !!p.marne_studios;
  if(page==="works")return !!p.marne_works;
  if(page==="mail")return !!p.marne_mail;
  if(page==="documents")return !!p.marne_documents;
  if(page==="config")return !!p.marne_config;
  return !!p.marne;
 }
 return false;
}

function allowedTab(selector,context,area){
 if(!context)return false;
 const p=context.permissions||{};
 if(area==="secretariat"){
  if(selector==="#tSettings"||selector==="#tPassword")return context.is_super_admin===true;
  if(selector==="#tInvoices")return !!context.sites?.secretariat&&(context.is_super_admin||p.secretariat===true||p["secretariat.read"]===true||p["secretariat.invoices.write"]===true);
  if(selector==="#tOrders")return !!context.sites?.secretariat&&(context.is_super_admin||p.secretariat===true||p["secretariat.read"]===true||p["secretariat.orders.write"]===true);
  if(selector==="#tStocks")return !!context.sites?.secretariat&&(context.is_super_admin||p.secretariat===true||p["secretariat.read"]===true||p["products.read"]===true||p["stock.read"]===true);
  if(selector==="#tPlanning")return !!context.sites?.secretariat&&(context.is_super_admin||p.secretariat===true||p["secretariat.read"]===true||p["personnel.planning.read"]===true||p["personnel.planning.write"]===true);
  return !!context.sites?.secretariat;
 }
 if(area==="planning"&&selector==="#new")return context.read_only!==true&&(context.is_super_admin||p.secretariat===true||p["personnel.planning.write"]===true||p["secretariat.write"]===true);
 if(area==="holding-control")return context.is_super_admin===true;
 return true;
}

export {allowedLink, allowedTab, tokenKeys};

export function attach({aside,brand,footer,base,area,target,filterMenu}){
 const keys=tokenKeys(area);
 let access=null,lastToken="",lastCheck=0,inFlight=false,invalidToken="";
 const currentToken=()=>{
  if(area==="marne-accounting"&&localStorage.getItem("marne_invest_logged_out")==="1")return "";
  return keys.map(k=>k==="kitchen_token"?(sessionStorage.getItem(k)||""):(localStorage.getItem(k)||"")).find(t=>t.includes("."))||"";
 };
 const apply=()=>{
  for(const a of aside.querySelectorAll(".school-nav-links a")){
   a.hidden=a.dataset.configHidden==="true"||!allowedLink(a.href,access,base);
  }
  for(const b of aside.querySelectorAll(".school-nav-links button")){
   const id=b.dataset.configId||"";
   b.hidden=b.dataset.configHidden==="true"||!access||(id.startsWith("tab:")&&!allowedTab(id.slice(4),access,area));
  }
  for(const group of aside.querySelectorAll(".school-nav-section")){
   group.hidden=![...group.querySelectorAll(".school-nav-links > a, .school-nav-links > button")].some(e=>!e.hidden);
  }
  const home=access&&[
   ["college","college/admin/"],["secretariat","secretariat/"],["accounting","comptabilite/"],
   ["planning","secretariat/planning/"],["cuisine","cuisine/"],["marne","admin/marne-invest/"],["holding","admin/holding/"]
  ].find(([key])=>access.sites?.[key]===true);
  brand.href=home?new URL(home[1],base).href:location.href;
  filterMenu();
 };
 const refresh=async(force=false)=>{
  const token=currentToken();
  if(!token){access=null;lastToken="";lastCheck=0;invalidToken="";footer.textContent="Connectez-vous pour voir les espaces autorisés.";apply();return;}
  if(token===invalidToken){access=null;footer.textContent="Session expirée ou droits modifiés. Reconnectez-vous.";apply();return;}
  if(invalidToken&&invalidToken!==token)invalidToken="";
  if(token!==lastToken)access=null;
  if(inFlight||(!force&&token===lastToken&&Date.now()-lastCheck<30000))return;
  inFlight=true;
  try{
   const response=await fetch(endpoint,{headers:{"x-admin-session":token},cache:"no-store",signal:AbortSignal.timeout(12000)});
   if(!response.ok){if(response.status===401)invalidToken=token;throw Error(response.status===401?"Droits modifiés ou session expirée : reconnectez-vous.":"Vérification des droits indisponible.");}
   const result=await response.json();
   if(!result?.ok||token!==currentToken()){access=null;return;}
   access=result;lastToken=token;lastCheck=Date.now();
   footer.textContent="Accès vérifiés · "+(result.display_name||result.username)+(result.read_only?" · Lecture seule":"");
  }catch(error){
   access=null;lastToken="";lastCheck=0;
   footer.textContent=error.message||"Autorisations indisponibles.";
  }finally{
   inFlight=false;apply();
   if(token!==currentToken())refresh(true);
  }
 };
 document.addEventListener("college:secretariat-role",()=>refresh(true));
 window.addEventListener("storage",event=>{if(!event.key||keys.includes(event.key))refresh(true)});
 window.addEventListener("focus",()=>refresh());
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
 const timer=setInterval(()=>{if(!document.hidden&&access)refresh()},45000);
 window.addEventListener("pagehide",()=>clearInterval(timer),{once:true});
 new MutationObserver(()=>{if(!target.classList.contains("hide"))refresh()}).observe(target,{attributes:true,attributeFilter:["class"]});
 apply();
 refresh(true);
 return apply;
}
