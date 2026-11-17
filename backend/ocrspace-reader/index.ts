import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const ORIGIN="https://edm28contact-wq.github.io";
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","Vary":"Origin"};
const respond=(o:unknown,status=200)=>new Response(JSON.stringify(o),{status,headers:{...CORS,"content-type":"application/json; charset=utf-8"}});
const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4)),ch=>ch.charCodeAt(0));
function db(){const s=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");const key=s.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),url=Deno.env.get("SUPABASE_URL");if(!url||!key)throw Error("Backend misconfigured");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function auth(c:ReturnType<typeof db>,req:Request){
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer /,""),parts=token.split(".");
  if(parts.length!==2)return null;
  const payload=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(!payload?.u||!Number.isFinite(Number(payload.exp))||Date.now()>Number(payload.exp)||payload.r)return null;
  const s=await c.from("system_settings").select("admin_token").eq("id",1).single();
  if(s.error||!s.data?.admin_token)return null;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(s.data.admin_token),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("HMAC",key,decode(parts[1]),new TextEncoder().encode(parts[0])))return null;
  const q=await c.from("admin_accounts").select("username,role,active,permissions,session_version,must_change_password").eq("username",payload.u).maybeSingle();
  const a=q.data;
  if(q.error||!a?.active||a.must_change_password||Number(a.session_version)!==Number(payload.v)||a.permissions?.readonly===true)return null;
  if(!["admin","secretariat"].includes(a.role)&&a.permissions?.["secretariat.invoices.write"]!==true)return null;
  return a;
 }catch{return null}
}
const texts=(result:any)=>{
 if(result?.IsErroredOnProcessing===true||Number(result?.OCRExitCode)!==1||
    !Array.isArray(result.ParsedResults)||!result.ParsedResults.length||
    result.ParsedResults.length>3)throw Error("ocr_partial_or_failed");
 const pages=result.ParsedResults.map((p:any)=>{
  if(Number(p?.FileParseExitCode)!==1||typeof p.ParsedText!=="string")throw Error("ocr_page_failed");
  return String(p.ParsedText||"");
 });
 if(!pages.some((s:string)=>s.trim().length>5))throw Error("ocr_empty_document");
 return {text:pages.map((s:string,i:number)=>"--- PAGE "+(i+1)+" ---\n"+s).join("\n\n").slice(0,200000),
   pages:pages.length};
};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return respond({error:"Méthode non autorisée"},405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==ORIGIN)return respond({error:"Origine non autorisée"},403);
 try{
  const c=db(),a=await auth(c,req);
  if(!a)return respond({error:"Session Secrétariat invalide"},401);
  const body=await req.json().catch(()=>null),id=String(body?.invoice_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return respond({error:"Identifiant facture invalide"},400);
  const claim=await c.rpc("secretariat_ocr_claim",{p_invoice_id:id,p_provider:"ocrspace"});
  if(claim.error)throw claim.error;
  if(claim.data?.claimed!==true)return respond({ok:false,error:"Lecture non autorisée : "+String(claim.data?.reason||"indisponible"),reason:claim.data?.reason||"unavailable"},409);
  const info=claim.data,attempt=Number(info.attempt),engine=Number(info.engine);
  let status="failed",resultText="",pageCount=0,reason="ocr_failed";
  try{
   const [secret,download]=await Promise.all([
    c.rpc("secretariat_ocr_connector_secret",{p_provider:"ocrspace"}),
    c.storage.from("secretariat-ocr-queue").download(String(info.storage_path)),
   ]);
   if(secret.error||!secret.data||typeof secret.data!=="string")throw Error("credential_missing");
   if(download.error||!download.data)throw Error("pdf_unavailable");
   const pdf=download.data;
   if(pdf.size>1000000)throw Error("free_pdf_size_limit");
   const bytes=new Uint8Array(await pdf.arrayBuffer());
   if(String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw Error("invalid_pdf");
   const hash=await crypto.subtle.digest("SHA-256",bytes);
   const check=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
   if(check!==info.file_hash)throw Error("pdf_hash_mismatch");
   const multipart=new FormData();
   multipart.append("file",new Blob([bytes],{type:"application/pdf"}),String(info.file_name));
   multipart.append("language","auto");
   multipart.append("OCREngine",String(engine));
   multipart.append("isTable","true");
   multipart.append("scale","true");
   multipart.append("isOverlayRequired","false");
   const response=await fetch("https://api.ocr.space/parse/image",{
    method:"POST",headers:{"apikey":secret.data},body:multipart,signal:AbortSignal.timeout(65000),
   });
   if(!response.ok)throw Error("provider_http_"+response.status);
   const body=await response.json();
   const parsed=texts(body);
   resultText=parsed.text;pageCount=parsed.pages;status="review";reason="";
  }catch(e){
   reason=e instanceof Error?e.message:"ocr_failed";
   // Only fixed failure identifiers are stored. Never store server errors containing credentials.
   if(!/^(ocr_partial_or_failed|ocr_page_failed|ocr_empty_document|credential_missing|pdf_unavailable|free_pdf_size_limit|invalid_pdf|pdf_hash_mismatch|provider_http_[0-9]{3}|TimeoutError)$/.test(reason))reason="ocr_unavailable";
  }
  const finished=await c.rpc("secretariat_ocr_finish",{
   p_invoice_id:id,p_attempt:attempt,p_engine:engine,p_status:status,
   p_ocr_text:resultText,p_page_count:pageCount,p_error_code:reason||null,
  });
  if(finished.error)throw finished.error;
  if(finished.data!==true)return respond({error:"Cette lecture a été remplacée. Actualisez la facture."},409);
  if(status==="failed")return respond({ok:false,error:"Lecture OCR.space non aboutie : "+reason,reason},422);
  return respond({ok:true,status:"review",attempt,engine,page_count:pageCount,text:resultText,
    stock_unchanged:true,auto_verified:false});
 }catch(e){
  console.error("ocrspace-scanner",e instanceof Error?e.message:"unknown");
  return respond({error:"Service OCR indisponible, aucune écriture en stock"},500);
 }
});