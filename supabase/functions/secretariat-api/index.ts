import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"https://edm28contact-wq.github.io","Access-Control-Allow-Headers":"content-type, authorization, x-admin-session, apikey","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const enc=new TextEncoder();
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
function db(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}") as Record<string,string>;const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw new Error("Configuration serveur indisponible");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function b64u(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function fromB64u(s:string){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4),raw=atob(p);return Uint8Array.from(raw,c=>c.charCodeAt(0))}async function hmac(secret:string,data:string){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(data)))}async function secret(c:any){const q=await c.from("system_settings").select("admin_token").eq("id",1).single();if(q.error||!q.data?.admin_token)throw new Error("Configuration de sécurité indisponible");return String(q.data.admin_token)}function readToken(req:Request){const x=req.headers.get("x-admin-session");if(x)return x;const a=req.headers.get("authorization")||"";return a.startsWith("Bearer ")?a.slice(7):""}const granular=(p:any)=>p&&typeof p==="object"&&Object.keys(p).some(k=>k.includes("."));
async function verify(c:any,req:Request){try{const token=readToken(req),parts=token.split(".");if(token.length>4096||parts.length!==2)return null;const [body,sig]=parts;if(!body||!sig)return null;if(b64u(await hmac(await secret(c),body))!==sig)return null;const p=JSON.parse(new TextDecoder().decode(fromB64u(body)));if(typeof p?.u!=="string"||!p.u||p.u.length>80||(p.scope!==undefined&&p.scope!=="central-admin")||p.r!==undefined||!Number.isFinite(Number(p.exp))||Number(p.exp)<=Date.now()||!Number.isFinite(Number(p.v)))return null;const q=await c.from("admin_accounts").select("username,active,central_active,must_change_password,session_version,role,display_name,permissions").eq("username",p.u).maybeSingle();const a=q.data;if(q.error||!a?.active||a.central_active===false||a.must_change_password===true||Number(a.session_version)!==Number(p.v))return null;const perms=a.permissions||{},g=granular(perms),allowed=a.role==="admin"||perms.secretariat===true||perms["secretariat.read"]===true||perms["secretariat.orders.write"]===true||perms["secretariat.invoices.write"]===true||perms["personnel.planning.read"]===true||perms["personnel.planning.write"]===true||perms["college.salaires.read"]===true||perms["college.salaires.write"]===true||perms["products.read"]===true||perms["stock.read"]===true;return allowed?{...a,permissions:perms,granular:g,read_only:a.role!=="admin"&&perms.readonly===true}:null}catch{return null}}
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


function canReadManualInvoices(a:any){
 const p=a?.permissions||{};
 return !!a&&(a.role==="admin"||p.secretariat===true||p["secretariat.read"]===true||p["secretariat.invoices.write"]===true);
}
function canCreateFoodProduct(a:any){
 const p=a?.permissions||{};
 return !!a&&!a.read_only&&p.readonly!==true&&(a.role==="admin"||p.secretariat===true||p["secretariat.invoices.write"]===true);
}
function foodProductPayload(x:any,categoryId:string){
 const get=(key:string)=>String(x?.[key]??"").trim();
 const code=get("code").toUpperCase(),name=get("name"),unit=get("unit"),sale=get("conditionnement"),stock=get("inventory_unit_label"),mode=get("stock_count_mode");
 if(get("category_id")!==categoryId||x?.id||!get("supplier")||get("supplier").length>200)return null;
 if(!/^[A-Z0-9][A-Z0-9_.-]{0,49}$/.test(code)||!name||name.length>200||!unit||unit.length>120||!sale||sale.length>160||!stock||stock.length>120||!["unit","litre"].includes(mode))return null;
 const factor=Number(x.purchase_to_stock_factor),price=Number(x.unit_price??0),min=Number(x.min_stock??0),target=Number(x.target_stock??0);
 if(!Number.isFinite(factor)||factor<=0||factor>1000000||[price,min,target].some(n=>!Number.isFinite(n)||n<0)||target<min)return null;
 const sub=get("subcategory_id");
 if(sub&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub))return null;
 return {code,name,category_id:categoryId,subcategory_id:sub||null,unit,conditionnement:sale,inventory_unit_label:stock,purchase_to_stock_factor:factor,inventory_to_stock_factor:1,stock_count_mode:mode,unit_price:price,initial_stock:0,min_stock:min,target_stock:target,active:true};
}
async function manualInvoiceOptions(c:any,a:any){
 if(!canReadManualInvoices(a))return json({error:"Accès aux factures non autorisé"},403);
 const category=await c.from("categories").select("id,code,name,active").eq("code","alimentaire").eq("active",true).maybeSingle();
 if(category.error)throw category.error;
 if(!category.data)return json({error:"Catégorie Alimentaire indisponible"},409);
 const [products,subs,orders]=await Promise.all([
  c.from("products").select("id,code,name,category_id,subcategory_id,active").eq("category_id",category.data.id).limit(2000),
  c.from("product_subcategories").select("id,category_id,name").eq("category_id",category.data.id).eq("active",true).order("sort_order").order("name"),
  loadOrders(c)
 ]);
 if(products.error)throw products.error;if(subs.error)throw subs.error;
 const foodProducts=products.data||[],allIds=new Set<string>(foodProducts.map((x:any)=>x.id)),activeIds=new Set<string>(foodProducts.filter((x:any)=>x.active).map((x:any)=>x.id));
 const directory=await supplierDirectory(c,orders,allIds);
 return json({ok:true,can_create_food:canCreateFoodProduct(a),can_manage_catalog:canCreateFoodProduct(a)&&(a.role==="admin"||a.permissions?.["products.write"]===true||(a.role==="admin_limited"&&a.permissions?.college_admin===true)),categories:[category.data],subcategories:subs.data||[],products:foodProducts,suppliers:directory.suppliers.filter(x=>x.product_count>0),supplier_products:directory.supplier_products.filter(x=>activeIds.has(x.product_id))});
}
async function createFoodProduct(c:any,a:any,req:Request){
 if(!canCreateFoodProduct(a))return json({error:"Création de produit alimentaire non autorisée"},403);
 const x=await req.json().catch(()=>null);
 const category=await c.from("categories").select("id,code,app_mode").eq("code","alimentaire").eq("active",true).maybeSingle();
 if(category.error)throw category.error;
 if(!category.data)return json({error:"Catégorie Alimentaire indisponible"},409);
 const payload=foodProductPayload(x,category.data.id);
 if(!payload)return json({error:"Produit invalide : fournisseur, code (50 caractères maximum), catégorie, conditionnements et valeurs numériques à vérifier"},400);
 if(payload.subcategory_id){
  const sub=await c.from("product_subcategories").select("id").eq("id",payload.subcategory_id).eq("category_id",category.data.id).eq("active",true).maybeSingle();
  if(sub.error)throw sub.error;
  if(!sub.data)return json({error:"Sous-catégorie alimentaire invalide"},400);
 }
 const duplicate=await c.from("products").select("id").ilike("code",payload.code.replace(/_/g,"\\_")).limit(1);
 if(duplicate.error)throw duplicate.error;
 if(duplicate.data?.length)return json({error:"Ce code existe déjà, y compris parmi les produits inactifs. Rapprochez le produit existant ou utilisez un code interne distinct."},409);
 const app=await c.from("applications").select("id").eq("code","garage-nfc-alimentaire").eq("active",true).maybeSingle();
 if(app.error)throw app.error;
 const result=await c.from("products").insert(payload).select("id,code,name,category_id,subcategory_id,unit,conditionnement,inventory_unit_label,purchase_to_stock_factor,stock_count_mode,unit_price,active").single();
 if(result.error){if(result.error.code==="23505")return json({error:"Code déjà utilisé. Actualisez le catalogue."},409);throw result.error}
 // The existing ensure_product_balance trigger creates a zero stock balance atomically.
 // After insertion, report secondary failures explicitly instead of inviting a duplicate retry.
 const warnings:string[]=[];
 if(app.data?.id&&["sortie","sortie_inventaire"].includes(category.data.app_mode)){
  try{const linked=await c.from("application_products").upsert({application_id:app.data.id,product_id:result.data.id,active:true,sort_order:100},{onConflict:"application_id,product_id"});if(linked.error)throw linked.error}catch{warnings.push("Association QR/NFC à vérifier dans l’administration.")}
 }
 try{const audit=await c.from("admin_audit_log").insert({username:a.username,action:"create-food-product-from-invoice",entity_type:"product",entity_id:result.data.id,details:{code:payload.code,supplier:String(x.supplier).trim()}});if(audit.error)throw audit.error}catch{warnings.push("Journal d’audit à vérifier.")}
 return json({ok:true,item:result.data,warnings},201);
}

async function load(c:any,a:any){
 const p=a.permissions||{};
 const broad=a.role==="admin"||p.secretariat===true||p["secretariat.read"]===true;
 const stock=broad||p["products.read"]===true||p["products.write"]===true||p["stock.read"]===true||p["stock.write"]===true;
 const ordersAllowed=broad||p["secretariat.orders.write"]===true;
 const productsAllowed=stock||ordersAllowed;
 const current_user={username:a.username,role:a.role,display_name:a.display_name,permissions:p,read_only:a.read_only===true};
 // Planning-only sessions must never receive stock, orders, suppliers or pricing.
 if(!productsAllowed)return {current_user,categories:[],products:[],order_products:[],balances:[],orders:[],order_items:[],suppliers:[],supplier_products:[],stock_scope:"none",server_time:new Date().toISOString()};
 const [cats,products,balances,orders]=await Promise.all([
  c.from("categories").select("id,code,name,app_mode,color,active,updated_at").order("name"),
  c.from("products").select("id,code,category_id,name,unit,unit_price,initial_stock,min_stock,target_stock,stock_count_mode,active,updated_at").order("name"),
  stock?c.from("stock_balances").select("product_id,quantity,updated_at"):Promise.resolve({data:[],error:null}),
  ordersAllowed?loadOrders(c):Promise.resolve({orders:[],order_items:[]})
 ]);
 for(const q of [cats,products,balances])if(q.error)throw q.error;
 const orderProducts=(products.data||[]).filter((x:any)=>x.active!==false);
 const directory=ordersAllowed?await supplierDirectory(c,orders,new Set<string>(orderProducts.map((x:any)=>x.id))):{suppliers:[],supplier_products:[]};
 return {current_user,categories:cats.data||[],products:stock?orderProducts:[],order_products:ordersAllowed?orderProducts:[],balances:balances.data||[],...orders,...directory,stock_scope:stock?"all_active":"none",server_time:new Date().toISOString()};
}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});try{const c=db(),acct=await verify(c,req);if(!acct)return json({error:"Session expirée ou invalide"},401);const action=new URL(req.url).searchParams.get("action")||"data";if(action==="data"&&req.method==="GET")return json(await load(c,acct));if(action==="manual-invoice-options"&&req.method==="GET")return await manualInvoiceOptions(c,acct);if(action==="create-food-product"&&req.method==="POST")return await createFoodProduct(c,acct,req);if(req.method==="POST"){if(acct.read_only)return json({error:"Compte visiteur : modification interdite"},403);if(acct.role!=="admin"&&acct.permissions?.secretariat!==true){const need=action==="save-order"||action==="receive-order"?"secretariat.orders.write":"secretariat.invoices.write";if(acct.permissions?.[need]!==true)return json({error:"Modification non autorisée pour ce compte"},403)}}
if(action==="save-order"&&req.method==="POST"){const x=await req.json(),status=["brouillon","commandee"].includes(String(x.status))?String(x.status):"brouillon",items=Array.isArray(x.items)?x.items.map((v:any)=>({product_id:String(v.product_id||""),quantity:Number(v.quantity||0)})).filter((v:any)=>v.quantity>0):[],r=await c.rpc("save_stock_order",{p_order_id:x.id?String(x.id):null,p_supplier:String(x.supplier??"").slice(0,200),p_order_date:String(x.order_date||new Date().toISOString().slice(0,10)),p_expected_date:x.expected_date?String(x.expected_date):null,p_note:String(x.note??"").slice(0,500),p_status:status,p_username:acct.username,p_items:items});if(r.error)throw r.error;return json({ok:true,id:r.data})}
if(action==="receive-order"&&req.method==="POST"){const x=await req.json(),r=await c.rpc("receive_stock_order",{p_order_id:String(x.id??""),p_username:acct.username});if(r.error)throw r.error;return json({ok:true,id:r.data})}return json({error:"Action inconnue"},404)}catch(e){console.error(e);return json({error:e instanceof Error?e.message:"Erreur serveur"},500)}});
