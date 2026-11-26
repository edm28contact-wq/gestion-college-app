import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { URLS,verificationReport } from "./rates.mjs";

const send=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
function dbClient(){
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
 const key=keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key)throw Error("Service credential unavailable");
 return createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
const getPeriod=()=>{
 const pieces=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"})
  .formatToParts(new Date());
 const year=pieces.find(x=>x.type==="year")?.value,month=pieces.find(x=>x.type==="month")?.value;
 if(!year||!month)throw Error("Cannot determine Europe/Paris month");
 return year+"-"+month;
};
async function fetchOfficial(url:string){
 const response=await fetch(url,{
  method:"GET",redirect:"follow",headers:{"Accept":"text/html","User-Agent":"CoursChambertin-PayrollRateCheck/1.0 (+official-rate-verification)"},
  signal:AbortSignal.timeout(18000)
 });
 if(!response.ok)throw Error("HTTP "+response.status);
 if(new URL(response.url).hostname!==new URL(url).hostname)throw Error("Unexpected source redirect");
 const size=Number(response.headers.get("content-length")||0);
 if(size>1200000)throw Error("Official source too large");
 const html=await response.text();
 if(html.length<1000||html.length>1200000||!/<(main|table|html)\b/i.test(html))throw Error("Invalid official document");
 return html;
}
function expected2026(kind:string,payload:any){
 if(kind==="navigo")return payload.annualCents===99880&&payload.paidMonthCents===9080;
 if(kind==="repas")return payload.mealGeneralCents===550;
 if(kind==="logement")return JSON.stringify(payload.thresholds)==="[200250,240300,280350,360450,440550,520650,600750]"&&
  JSON.stringify(payload.one)==="[7970,9300,10620,11940,14640,17260,19940,22560]"&&
  JSON.stringify(payload.perRoom)==="[4260,5970,7970,9950,12610,15240,18570,21230]";
 if(kind==="vehicule")return payload.purchasedYoungPercent===15&&payload.leasedPercent===50&&payload.withFuelLeasedPercent===67;
 if(kind==="ntic")return payload.annualRate===0.1;
 return false;
}
Deno.serve(async req=>{
 if(req.method!=="POST")return send({error:"Method not allowed"},405);
 try{
  const raw=req.headers.get("x-college-rate-cron-token")||"";
  if(!/^[a-f0-9]{64}$/i.test(raw))return send({error:"Unauthorized"},401);
  const db=dbClient();
  const check=await db.rpc("college_verify_rates_cron_token",{p_token:raw});
  if(check.error||check.data!==true)return send({error:"Unauthorized"},401);
  if((Number(req.headers.get("content-length")||"0"))>2048)return send({error:"Request too large"},413);
  const {action}=await req.json().catch(()=>({action:""}));
  if(action!=="check")return send({error:"Invalid action"},400);
  const month=getPeriod(),year=Number(month.slice(0,4));
  const sources=await Promise.allSettled([
   fetchOfficial(URLS.navigo),fetchOfficial(URLS.urssaf),fetchOfficial(URLS.urssafDetails)
  ]);
  const byName=["navigo","urssaf","urssafDetails"] as const;
  const html:Record<string,string>={};
  const errors:Record<string,string>={};
  for(let i=0;i<byName.length;i++){
   const name=byName[i],item=sources[i];
   if(item.status==="fulfilled")html[name]=item.value;
   else errors[name]=String(item.reason?.message||"Source inaccessible").slice(0,180);
  }
  const report=verificationReport(year,html);
  const prior=await db.from("college_payroll_official_rate_snapshots")
   .select("category,payload").eq("year",year);
  if(prior.error)throw Error("Snapshot read failed: "+prior.error.code);
  const previous=new Map((prior.data||[]).map((x:any)=>[x.category,x.payload]));
  const categoryResults:Record<string,unknown>={};
  let review=false,allGood=true;
  for(const [name,item] of Object.entries(report.categories)){
   let result:any={...item};
   if(result.status==="verified"){
    const old=previous.get(name);
    if(year===2026&&!expected2026(name,result.payload)){
     result={...result,status:"review",message:"Le tarif officiel diverge des barèmes 2026 qualifiés : validation nécessaire avant remplacement.",payload:null};
    }else if(old&&JSON.stringify(Object.entries(old).sort())!==JSON.stringify(Object.entries(result.payload).sort())){
     result={...result,status:"review",message:"Une nouvelle valeur diffère du barème déjà archivé : validation nécessaire, ancien taux conservé.",payload:null};
    }else{
     const saved=await db.from("college_payroll_official_rate_snapshots").upsert({
      year,category:name,payload:result.payload,source_url:result.source,
      effective_from:result.payload.effectiveFrom||year+"-01-01",checked_at:new Date().toISOString()
     },{onConflict:"year,category"});
     if(saved.error){
      result={...result,status:"unavailable",message:"Enregistrement de la source échoué : "+saved.error.code,payload:null};
     }
    }
   }
   if(result.status!=="verified")allGood=false;
   if(result.status==="review")review=true;
   // Only archive figures actually verified; errors contain no employee information.
   categoryResults[name]=result;
  }
  const status=allGood?"verified":review?"review":"incomplete";
  const now=new Date().toISOString();
  const record={
   month,status,checked_at:now,categories:categoryResults,
   messages:{errors,period:month},source_urls:URLS
  };
  const insert=await db.from("college_payroll_rate_checks").upsert(record,{onConflict:"month"});
  if(insert.error)throw Error("Audit write failed: "+insert.error.code);
  const audit=await db.from("college_payroll_rate_check_runs").insert({
   month,status,details:{checked_at:now,sources:Object.keys(html),errors,
    categories:Object.fromEntries(Object.entries(categoryResults).map(([key,val]:any)=>[key,val.status]))}
  });
  if(audit.error)throw Error("Audit history write failed: "+audit.error.code);
  return send({ok:true,month,checked_at:now,status,
   categories:Object.fromEntries(Object.entries(categoryResults).map(([key,val]:any)=>[key,{status:val.status,message:val.message,source:val.source}]))});
 }catch(e){
  console.error("Official payroll rate refresh error:",String((e as Error)?.message||e));
  return send({error:"Official rate verification failed. No payroll or bank data was changed."},500);
 }
});
