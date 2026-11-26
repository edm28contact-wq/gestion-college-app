import fs from "node:fs";
import { URLS,verificationReport,verifyNavigoDataset } from "../supabase/functions/college-payroll-rates-sync/rates.mjs";
const year=Number(new Intl.DateTimeFormat("en",{year:"numeric",timeZone:"Europe/Paris"}).format(new Date()));
const urls={navigo:URLS.navigo,urssaf:URLS.urssaf,urssafDetails:URLS.urssafDetails};
const html={},errors={};
const fetchData=async(url,json=false)=>{
 const signal=AbortSignal.timeout(18000);
 const response=await fetch(url,{signal,headers:{"Accept":json?"application/json":"text/html"}});
 if(!response.ok)throw new Error("HTTP "+response.status);
 return json?response.json():response.text();
};
await Promise.all(Object.entries(urls).map(async([name,url])=>{
 try{
  const data=await fetchData(url);
  if(data.length<1000||data.length>1200000)throw new Error("Unexpected document size");
  html[name]=data;
  process.stdout.write(name+" : official page available\n");
 }catch(e){
  errors[name]=String(e.message||e);
  process.stdout.write(name+" : unavailable ("+errors[name]+")\n");
 }
}));
const report=verificationReport(year,html);
if(report.categories.navigo.status!=="verified"){
 try{
  const api=await fetchData(URLS.navigoData,true);
  const fallback=verifyNavigoDataset(api,year);
  if(fallback.status==="verified")report.categories.navigo=fallback;
 }catch(e){errors.navigoDataset=String(e.message||e)}
}
const now=new Date().toISOString();
const safe=Object.fromEntries(Object.entries(report.categories).map(([name,item])=>[name,{
 status:item.status,source:item.source,message:item.message,
 ...(item.status==="verified"&&item.payload?{payload:item.payload,lastVerifiedAt:now}:{})
}]));
const path="college/admin/official-rates-cache.json";
const existing=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):null;
if(existing&&existing.year===year){
 for(const [name,item] of Object.entries(existing.categories||{})){
  const next=safe[name];
  if(item.status==="verified"||item.status==="previously_verified"){
   if(next?.status!=="verified"){
    safe[name]={...item,status:"previously_verified",lastVerifiedAt:item.lastVerifiedAt||existing.checkedAt,
     message:"Dernier barème officiellement vérifié conservé ; contrôle du "+now.slice(0,10)+" non concluant."};
   }else if(JSON.stringify(item.payload)!==JSON.stringify(next.payload)){
    safe[name]={...item,status:"review",lastVerifiedAt:item.lastVerifiedAt||existing.checkedAt,
     message:"Modification du barème détectée ; ancien montant archivé sans application automatique."};
   }
  }
 }
}
const count=Object.values(safe).filter(x=>x.status==="verified").length;
console.log("Barèmes officiels vérifiés à cette exécution :",count,"sur",Object.keys(safe).length);
const data={year,checkedAt:now,status:count===5?"verified":Object.values(safe).some(x=>x.status==="review")?"review":"incomplete",categories:safe,errors};
if(count===0&&!existing)throw new Error("Aucun taux officiel vérifié et aucune dernière valeur archivée.");
fs.writeFileSync(path,JSON.stringify(data,null,2)+"\n");
