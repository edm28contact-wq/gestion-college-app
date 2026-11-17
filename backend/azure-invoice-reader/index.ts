import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const ORIGIN="https://edm28contact-wq.github.io";
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","Vary":"Origin"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"content-type":"application/json; charset=utf-8"}});
const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4)),ch=>ch.charCodeAt(0));
function db(){
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const url=Deno.env.get("SUPABASE_URL"),key=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)throw Error("db_configuration");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function auth(c:ReturnType<typeof db>,req:Request){
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer /,""),parts=token.split(".");
  if(parts.length!==2)return null;
  const payload=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(!payload?.u||!Number.isFinite(Number(payload.exp))||Date.now()>Number(payload.exp)||payload.r)return null;
  const s=await c.from("system_settings").select("admin_token").eq("id",1).single();
  if(s.error||!s.data?.admin_token)return null;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(s.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("HMAC",key,decode(parts[1]),new TextEncoder().encode(parts[0])))return null;
  const q=await c.from("admin_accounts").select("username,role,active,permissions,session_version,must_change_password").eq("username",payload.u).maybeSingle();
  const a=q.data;
  if(q.error||!a?.active||a.must_change_password||Number(a.session_version)!==Number(payload.v)||a.permissions?.readonly===true)return null;
  return ["admin","secretariat"].includes(a.role)||a.permissions?.["secretariat.invoices.write"]===true?a:null;
 }catch{return null}
}
function safeField(x:any){
 if(!x||typeof x!=="object")return null;
 const value=x.valueString??x.valueNumber??x.valueInteger??x.valueDate??
             x.valueCurrency?.amount??x.content??null;
 return value===null?null:String(value).slice(0,500);
}
function invoiceData(result:any){
 const analyzed=result?.analyzeResult;
 const docs=Array.isArray(analyzed?.documents)?analyzed.documents:[];
 const fields=docs[0]?.fields??{};
 const rawItems=Array.isArray(fields.Items?.valueArray)?fields.Items.valueArray:[];
 const items=rawItems.slice(0,300).map((record:any,i:number)=>{
  const f=record?.valueObject??{};
  const row={
   index:i+1,
   description:safeField(f.Description),
   product_code:safeField(f.ProductCode),
   quantity:safeField(f.Quantity),
   unit:safeField(f.Unit),
   unit_price:safeField(f.UnitPrice),
   amount:safeField(f.Amount),
   tax:safeField(f.Tax),
   confidence:Number.isFinite(Number(record?.confidence))?Number(record.confidence):null
  };
  return row;
 });
 const pages=Array.isArray(analyzed?.pages)?analyzed.pages.length:0;
 if(!pages||pages>2)throw Error("azure_page_coverage_invalid");
 const content=String(analyzed?.content||"");
 if(content.trim().length<6)throw Error("azure_empty_result");
 return {
  text:content.slice(0,200000),
  page_count:pages,
  structured:{
   supplier:safeField(fields.VendorName),
   invoice_number:safeField(fields.InvoiceId),
   date:safeField(fields.InvoiceDate),
   total:safeField(fields.InvoiceTotal),
   subtotal:safeField(fields.SubTotal),
   tax:safeField(fields.TotalTax),
   items,
   source:"azure-prebuilt-invoice",
   verified_by_human:false,
   partial_document_possible:pages===2,
  }
 };
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return respond({error:"Méthode non autorisée"},405);
 if(req.headers.get("origin")&&req.headers.get("origin")!==ORIGIN)return respond({error:"Origine non autorisée"},403);
 try{
  const c=db(),account=await auth(c,req);
  if(!account)return respond({error:"Session Secrétariat invalide"},401);
  const input=await req.json().catch(()=>null),id=String(input?.invoice_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return respond({error:"Identifiant facture invalide"},400);
  const claim=await c.rpc("secretariat_ocr_claim",{p_invoice_id:id,p_provider:"azure_invoice"});
  if(claim.error)throw claim.error;
  if(claim.data?.claimed!==true)return respond({ok:false,error:"Lecture Azure indisponible : "+String(claim.data?.reason||"refused"),reason:claim.data?.reason||"refused"},409);
  const info=claim.data,attempt=Number(info.attempt),endpoint=String(info.endpoint||"");
  let status="failed",ocrText="",pageCount=0,structured:any=null,reason="azure_unavailable";
  try{
   const base=new URL(endpoint);
   if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||base.pathname!=="/"||
      !/^[a-z0-9-]+\.(cognitiveservices\.azure\.com|api\.cognitive\.microsoft\.com)$/.test(base.hostname))
     throw Error("invalid_endpoint");
   const [secret,download]=await Promise.all([
     c.rpc("secretariat_ocr_connector_secret",{p_provider:"azure_invoice"}),
     c.storage.from("secretariat-ocr-queue").download(String(info.storage_path)),
   ]);
   if(secret.error||!secret.data||typeof secret.data!=="string")throw Error("credential_missing");
   if(download.error||!download.data)throw Error("pdf_unavailable");
   if(download.data.size>4000000)throw Error("free_pdf_size_limit");
   const bytes=new Uint8Array(await download.data.arrayBuffer());
   if(String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw Error("invalid_pdf");
   const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
   const actualHash=Array.from(hash,n=>n.toString(16).padStart(2,"0")).join("");
   if(actualHash!==info.file_hash)throw Error("pdf_hash_mismatch");
   const route="/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30&pages=1-2";
   const response=await fetch(base.origin+route,{
     method:"POST",headers:{"Ocp-Apim-Subscription-Key":secret.data,"Content-Type":"application/pdf"},
     body:bytes,redirect:"error",signal:AbortSignal.timeout(25000),
   });
   if(response.status!==202)throw Error("azure_http_"+response.status);
   const location=response.headers.get("operation-location");
   if(!location)throw Error("operation_location_missing");
   const operation=new URL(location);
   if(operation.origin!==base.origin||operation.username||operation.password||
       !operation.pathname.startsWith("/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/")||
       operation.searchParams.get("api-version")!=="2024-11-30")
     throw Error("invalid_operation_location");
   let result:any=null;
   for(let i=0;i<12;i++){
     await pause(1800);
     const poll=await fetch(operation.toString(),{
       headers:{"Ocp-Apim-Subscription-Key":secret.data},redirect:"error",
       signal:AbortSignal.timeout(12000),
     });
     if(!poll.ok)throw Error("azure_poll_http_"+poll.status);
     const data=await poll.json();
     const state=String(data?.status||"").toLowerCase();
     if(state==="succeeded"){result=data;break}
     if(state==="failed"||state==="canceled")throw Error("azure_processing_failed");
     if(!["notstarted","running"].includes(state))throw Error("azure_unknown_state");
   }
   if(!result)throw Error("azure_poll_timeout");
   const parsed=invoiceData(result);
   ocrText=parsed.text;pageCount=parsed.page_count;structured=parsed.structured;
   status="review";reason="";
  }catch(e){
   const code=e instanceof Error?e.message:"azure_unavailable";
   reason=/^(invalid_endpoint|credential_missing|pdf_unavailable|free_pdf_size_limit|invalid_pdf|pdf_hash_mismatch|operation_location_missing|invalid_operation_location|azure_processing_failed|azure_unknown_state|azure_page_coverage_invalid|azure_empty_result|azure_poll_timeout|azure_http_[0-9]{3}|azure_poll_http_[0-9]{3})$/.test(code)?code:"azure_unavailable";
  }
  const finished=await c.rpc("secretariat_ocr_finish_azure",{
   p_invoice_id:id,p_attempt:attempt,p_status:status,p_ocr_text:ocrText,
   p_page_count:pageCount,p_error_code:reason||null,p_structured_result:structured,
  });
  if(finished.error)throw finished.error;
  if(finished.data!==true)return respond({error:"Lecture remplacée, actualisez la liste."},409);
  if(status!=="review")return respond({ok:false,error:"Lecture Azure non aboutie : "+reason,reason},422);
  return respond({ok:true,status:"review",provider:"azure_invoice",attempt,page_count:pageCount,
    structured,stock_unchanged:true,auto_verified:false});
 }catch(e){
  console.error("secretariat-azure-invoice-reader",e instanceof Error?e.message:"unknown");
  return respond({error:"Service Azure indisponible, aucun stock modifié"},500);
 }
});