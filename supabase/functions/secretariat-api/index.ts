import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, authorization, x-admin-session, apikey","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const enc=new TextEncoder();
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
function db(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw new Error("Configuration serveur indisponible");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64u(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function fromB64u(s:string){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4),raw=atob(p);return Uint8Array.from(raw,c=>c.charCodeAt(0))}async function hmac(secret:string,data:string){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(data)))}async function secret(c:any){const q=await c.from("system_settings").select("admin_token").eq("id",1).single();if(q.error||!q.data?.admin_token)throw new Error("Configuration de sécurité indisponible");return String(q.data.admin_token)}function readToken(req:Request){const x=req.headers.get("x-admin-session");if(x)return x;const a=req.headers.get("authorization")||"";return a.startsWith("Bearer ")?a.slice(7):""}const granular=(p:any)=>p&&typeof p==="object"&&Object.keys(p).some(k=>k.includes("."));
async function verify(c:any,req:Request){try{const token=readToken(req),[body,sig]=token.split(".");if(!body||!sig)return null;if(b64u(await hmac(await secret(c),body))!==sig)return null;const p=JSON.parse(new TextDecoder().decode(fromB64u(body)));if(!p?.u||Date.now()>Number(p.exp||0))return null;const q=await c.from("admin_accounts").select("username,active,session_version,role,display_name,permissions").eq("username",p.u).maybeSingle();const a=q.data;if(!a?.active||Number(a.session_version)!==Number(p.v))return null;const perms=a.permissions||{},g=granular(perms),allowed=a.role==="admin"||perms.secretariat===true||perms["secretariat.read"]===true||perms["secretariat.orders.write"]===true||perms["secretariat.invoices.write"]===true;return allowed?{...a,permissions:perms,granular:g,read_only:a.role!=="admin"&&perms.readonly===true}:null}catch{return null}}
async function loadOrders(c:any){const [o,i]=await Promise.all([c.from("stock_orders").select("id,order_no,supplier,order_date,expected_date,status,note,created_by,updated_by,received_by,received_at,created_at,updated_at").order("created_at",{ascending:false}).limit(500),c.from("stock_order_items").select("id,order_id,product_id,quantity,created_at")]);if(o.error)throw o.error;if(i.error)throw i.error;return {orders:o.data??[],order_items:i.data??[]}}
function supplierKey(value:any){
 const k=String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(k.includes("passionfroid"))return "passionfroid";
 if(k.includes("henrijulien"))return "henrijulien";
 if(k.includes("lanormande"))return "lanormande";
 return k;
}
async function supplierDirectory(c:any,orders:any,activeIds:Set<string>){
 const [profiles,mappings,observed,purchases,invoices,invoiceItems]=await Promise.all([
  c.from("invoice_supplier_layout_profiles").select("supplier_key,supplier_name").limit(300),
  c.from("invoice_supplier_product_mappings").select("supplier_key,supplier_name,product_id,active").eq("active",true).limit(2000),
  c.from("invoice_supplier_product_observations").select("supplier_key,supplier_name,product_id,review_status").limit(3000),
  c.from("purchases").select("supplier,product_id,cancelled").eq("cancelled",false).limit(3000),
  c.from("supplier_invoices").select("id,supplier,status").limit(1000),
  c.from("supplier_invoice_items").select("invoice_id,product_id").limit(5000)
 ]);
 for(const [name,result] of [["profils",profiles],["vérifications",mappings],["observations",observed],["achats",purchases],["factures",invoices],["lignes facturées",invoiceItems]] as const){
  if(result.error)throw new Error("Catalogue fournisseur indisponible ("+name+") : "+result.error.message);
 }
 const names=new Map<string,string>(),connections=new Map<string,{supplier_key:string,product_id:string,source:string,rank:number}>();
 function register(name:any,key?:any,preferred=false){
  const k=supplierKey(key||name),label=String(name||"").trim();
  if(k&&label&&(!names.has(k)||preferred))names.set(k,label);
  return k;
 }
 for(const x of profiles.data||[])register(x.supplier_name,x.supplier_key,true);
 function link(key:any,productId:any,source:string,rank:number){
  const k=supplierKey(key),pid=String(productId||"");
  if(!k||!activeIds.has(pid))return;
  const id=k+"|"+pid,old=connections.get(id);
  if(!old||old.rank<rank)connections.set(id,{supplier_key:k,product_id:pid,source,rank});
 }
 for(const x of observed.data||[]){
  const k=register(x.supplier_name,x.supplier_key);
  link(k,x.product_id,"historique_a_confirmer",1);
 }
 for(const x of mappings.data||[]){
  const k=register(x.supplier_name,x.supplier_key);
  link(k,x.product_id,"verifie",5);
 }
 const invoiceNames=new Map<string,string>();
 for(const x of invoices.data||[])if(x.status!=="cancelled"){
  invoiceNames.set(x.id,register(x.supplier));
 }
 for(const x of invoiceItems.data||[])link(invoiceNames.get(x.invoice_id),x.product_id,"facture",4);
 for(const x of purchases.data||[])link(register(x.supplier),x.product_id,"achat",4);
 const orderNames=new Map<string,string>();
 for(const x of orders.orders||[])if(x.status!=="annulee")orderNames.set(x.id,register(x.supplier));
 for(const x of orders.order_items||[])link(orderNames.get(x.order_id),x.product_id,"commande",3);
 const counts=new Map<string,number>();
 for(const x of connections.values())counts.set(x.supplier_key,(counts.get(x.supplier_key)||0)+1);
 return {suppliers:[...names].map(([key,name])=>({key,name,product_count:counts.get(key)||0}))
    .sort((a,b)=>a.name.localeCompare(b.name,"fr")),
  supplier_products:[...connections.values()].map(({supplier_key,product_id,source})=>({supplier_key,product_id,source}))};
}

async function load(c:any,a:any){
 const [cats,products,balances,orders]=await Promise.all([
  c.from("categories").select("id,code,name,app_mode,color,active,updated_at").order("name"),
  c.from("products").select("id,code,category_id,name,unit,unit_price,initial_stock,min_stock,target_stock,stock_count_mode,active,updated_at").order("name"),
  c.from("stock_balances").select("product_id,quantity,updated_at"),
  loadOrders(c)
 ]);
 for(const q of [cats,products,balances])if(q.error)throw q.error;
 // Category visibility is independent from the active status of its products.
 const orderProducts=(products.data||[]).filter((x:any)=>x.active!==false);
 const activeIds=new Set<string>(orderProducts.map((x:any)=>x.id));
 const directory=await supplierDirectory(c,orders,activeIds);
 const stockProducts=orderProducts;
 return {current_user:{username:a.username,role:a.role,display_name:a.display_name,permissions:a.permissions||{},read_only:a.read_only===true},
  categories:cats.data||[],products:stockProducts,order_products:orderProducts,balances:balances.data||[],
  ...orders,...directory,stock_scope:"all_active",server_time:new Date().toISOString()};
}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});try{const c=db(),acct=await verify(c,req);if(!acct)return json({error:"Session expirée ou invalide"},401);const action=new URL(req.url).searchParams.get("action")||"data";if(action==="data"&&req.method==="GET")return json(await load(c,acct));if(req.method==="POST"){if(acct.read_only)return json({error:"Compte visiteur : modification interdite"},403);if(acct.role!=="admin"&&acct.permissions?.secretariat!==true){const need=action==="save-order"||action==="receive-order"?"secretariat.orders.write":"secretariat.invoices.write";if(acct.permissions?.[need]!==true)return json({error:"Modification non autorisée pour ce compte"},403)}}
if(action==="save-order"&&req.method==="POST"){const x=await req.json(),status=["brouillon","commandee"].includes(String(x.status))?String(x.status):"brouillon",items=Array.isArray(x.items)?x.items.map((v:any)=>({product_id:String(v.product_id||""),quantity:Number(v.quantity||0)})).filter((v:any)=>v.quantity>0):[],r=await c.rpc("save_stock_order",{p_order_id:x.id?String(x.id):null,p_supplier:String(x.supplier??"").slice(0,200),p_order_date:String(x.order_date||new Date().toISOString().slice(0,10)),p_expected_date:x.expected_date?String(x.expected_date):null,p_note:String(x.note??"").slice(0,500),p_status:status,p_username:acct.username,p_items:items});if(r.error)throw r.error;return json({ok:true,id:r.data})}
if(action==="receive-order"&&req.method==="POST"){const x=await req.json(),r=await c.rpc("receive_stock_order",{p_order_id:String(x.id??""),p_username:acct.username});if(r.error)throw r.error;return json({ok:true,id:r.data})}return json({error:"Action inconnue"},404)}catch(e){console.error(e);return json({error:e instanceof Error?e.message:"Erreur serveur"},500)}});
