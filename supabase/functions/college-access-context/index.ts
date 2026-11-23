import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const cors = {
  "Access-Control-Allow-Origin":"https://edm28contact-wq.github.io",
  "Access-Control-Allow-Headers":"content-type, authorization, x-admin-session, apikey",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Vary":"Origin"
};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store, private"}});
const encode=new TextEncoder();
function database(){
  const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;
  const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url=Deno.env.get("SUPABASE_URL");
  if(!url||!key)throw Error("Configuration du service indisponible");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function toUrl64(bytes:Uint8Array){
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function fromUrl64(value:string){
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4);
  return Uint8Array.from(atob(normalized),v=>v.charCodeAt(0));
}
function equal(a:string,b:string){
  let mismatch=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return mismatch===0;
}
async function sign(secret:string,body:string){
  const key=await crypto.subtle.importKey("raw",encode.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return toUrl64(new Uint8Array(await crypto.subtle.sign("HMAC",key,encode.encode(body))));
}
function has(p:Record<string,unknown>,...keys:string[]){
  return keys.some(key=>p[key]===true);
}
function computeAccess(account:any){
  const p:Record<string,unknown>=account.permissions&&typeof account.permissions==="object"?account.permissions:{};
  const superAdmin=account.username==="admin"&&account.is_super_admin===true;
  const college=superAdmin||has(p,"college_admin","dashboard.read","products.read","products.write","stock.read","stock.write","apps.read","apps.write","purchases.read","purchases.write","analytics.read","college.salaires.read","college.salaires.write","cuisine.manage","secretariat.orders.write");
  const secretariat=superAdmin||has(p,"secretariat","secretariat.read","secretariat.orders.write","secretariat.invoices.write","personnel.planning.read","personnel.planning.write","college.salaires.read","college.salaires.write","products.read","stock.read");
  const accounting=superAdmin||has(p,"accounting","accounting.read","accounting.write");
  const planning=superAdmin||has(p,"college.salaires.read","college.salaires.write","personnel.planning.read","personnel.planning.write","secretariat","secretariat.read");
  const cuisine=superAdmin||has(p,"cuisine","cuisine.read","cuisine.write","cuisine.manage","college_admin");
  const marne=superAdmin||has(p,"marne","marne_invest","marne_admin","marne_accounting","marne_tenants","marne_studios");
  const veryfi=superAdmin||has(p,"secretariat","secretariat.read","secretariat.invoices.write","accounting","accounting.read","accounting.write");
  const collegeFull=superAdmin||p.college_admin===true;
  const marneFull=superAdmin||has(p,"marne_admin","marne_invest");
  const marneMoney=marneFull||p.marne_accounting===true;
  const marneTenants=marneFull||p.marne_tenants===true;
  const marneStudios=marneFull||p.marne_studios===true;
  const pageAccess:Record<string,boolean>={
    holding:superAdmin,
    college, college_cuisine:collegeFull||p["cuisine.manage"]===true,
    college_products:collegeFull||has(p,"products.read","products.write","stock.read","stock.write"),
    college_apps:collegeFull||has(p,"apps.read","apps.write"),
    college_orders:collegeFull||has(p,"secretariat.orders.write","purchases.read","purchases.write"),
    college_readiness:collegeFull,
    college_supervision:superAdmin,
    secretariat,accounting,planning,cuisine,veryfi,marne,
    marne_tenants:marneTenants,
    marne_studios:marneStudios,
    marne_accounting:marneMoney,
    marne_works:marneFull||p.marne_studios===true,
    marne_mail:superAdmin||p.marne_admin===true,
    marne_documents:marneMoney,
    marne_config:superAdmin||p.marne_admin===true,
    accounting_setup:superAdmin,
    site_access:superAdmin,
    windows_agent:superAdmin,
    holding_control:superAdmin,
    holding_users:superAdmin,
    holding_powers:superAdmin,
    holding_companies:superAdmin
  };
  return {
    username:account.username,display_name:account.display_name||account.username,
    role:account.role,permissions:p,
    is_super_admin:superAdmin,
    read_only:!superAdmin&&p.readonly===true,
    session_version:Number(account.session_version),
    sites:Object.fromEntries(["college","secretariat","accounting","planning","cuisine","veryfi","marne","holding"].map(key=>[key,pageAccess[key]])),
    pages:pageAccess
  };
}
async function verify(db:any,req:Request){
  const auth=req.headers.get("authorization")||"";
  const token=req.headers.get("x-admin-session")||(auth.startsWith("Bearer ")?auth.slice(7):"");
  if(!token||token.length>4096)return null;
  const parts=token.split(".");
  if(parts.length!==2||!parts[0]||!parts[1])return null;
  const [body,sig]=parts;
  let payload:any;
  try{payload=JSON.parse(new TextDecoder().decode(fromUrl64(body)))}catch{return null}
  if(typeof payload?.u!=="string"||!Number.isFinite(Number(payload?.v))||!Number.isFinite(Number(payload.exp))||Number(payload.exp)<=Date.now()||Number(payload.exp)>Date.now()+24*60*60*1000)return null;
  if(payload.scope||typeof payload.u!=="string"||payload.u.length>80)return null;
  const settings=await db.from("system_settings").select("admin_token").eq("id",1).single();
  if(settings.error||typeof settings.data?.admin_token!=="string")throw Error("Clé de session indisponible");
  const suffix=payload.r==="comptabilite"?":accounting":payload.r===undefined?"":null;
  if(suffix===null)return null;
  if(!equal(sig,await sign(String(settings.data.admin_token)+suffix,body)))return null;
  const row=await db.from("admin_accounts")
    .select("username,display_name,role,permissions,active,central_active,is_super_admin,must_change_password,session_version")
    .eq("username",payload.u).maybeSingle();
  if(row.error)throw row.error;
  const account=row.data;
  if(!account||account.active!==true||account.central_active===false||account.must_change_password===true||Number(account.session_version)!==Number(payload.v))return null;
  if(payload.r==="comptabilite"&&account.role!=="comptabilite")return null;
  return account;
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return respond({error:"Méthode non autorisée"},405);
  try{
    const db=database(),account=await verify(db,req);
    if(!account)return respond({error:"Session invalide, expirée ou droits modifiés. Reconnectez-vous."},401);
    return respond({ok:true,...computeAccess(account)});
  }catch(error){console.error("college-access-context",error);return respond({error:"Autorisation temporairement indisponible"},503)}
});
