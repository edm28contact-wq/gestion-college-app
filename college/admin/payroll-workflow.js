/* Dossiers mensuels : uniquement via l'API authentifiée Gestion Collège. */
(()=>{
"use strict";
const ROOT="https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/college-payroll-workflow";
async function call(mode,token,month,data){
 if(typeof token!=="string"||!token.includes("."))throw Error("Connectez-vous avec un compte autorisé à modifier les salaires.");
 const url=new URL(ROOT);
 url.searchParams.set("mode",mode);
 if(month&&data===undefined)url.searchParams.set("month",month);
 const method=data===undefined?"GET":"POST";
 const response=await fetch(url,{method,headers:{"x-admin-session":token,"Content-Type":"application/json"},cache:"no-store",body:method==="POST"?JSON.stringify({...data,month}):undefined,signal:AbortSignal.timeout(20000)});
 const body=await response.json().catch(()=>({error:"Réponse du service invalide."}));
 if(!response.ok||body.ok!==true)throw Error(body.error||"Le service de paie est indisponible.");
 return body;
}
const api=Object.freeze({
 list:token=>call("list",token),
 load:(month,token)=>call("load",token,month),
 save:(month,token,version,draft)=>call("save",token,month,{version,draft}),
 status:(month,token,version,action,info={})=>call("status",token,month,{version,action,...info})
});
if(typeof window!=="undefined")window.ChambertinPayroll=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();