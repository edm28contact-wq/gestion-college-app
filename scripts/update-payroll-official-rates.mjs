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
const safe=Object.fromEntries(Object.entries(report.categories).map(([name,item])=>[name,{
 status:item.status,source:item.source,message:item.message,
 ...(item.status==="verified"&&item.payload?{payload:item.payload}:{})
}]));
const count=Object.values(safe).filter(x=>x.status==="verified").length;
console.log("Barèmes officiels vérifiés :",count,"sur",Object.keys(safe).length);
const path="college/admin/official-rates-cache.json";
if(count===0)throw new Error("Aucun taux officiel vérifié : aucune cache publique mise à jour.");
const data={year,checkedAt:new Date().toISOString(),status:count===5?"verified":"incomplete",categories:safe,errors};
const existing=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):null;
if(existing&&existing.year===year){
 for(const [name,item] of Object.entries(existing.categories||{})){
  const next=data.categories[name];
  if(item.status==="verified"&&next?.status!=="verified")data.categories[name]=item;
  if(item.status==="verified"&&next?.status==="verified"&&JSON.stringify(item.payload)!==JSON.stringify(next.payload)){
   data.categories[name]={status:"review",source:next.source,message:"Changement officiel détecté : contrôle réglementaire requis.",payload:item.payload};
  }
 }
}
fs.writeFileSync(path,JSON.stringify(data,null,2)+"\n");
