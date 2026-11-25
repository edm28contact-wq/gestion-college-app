"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const ui=fs.readFileSync("college/admin/salary-od.js","utf8");
const page=fs.readFileSync("college/admin/index.html","utf8");
const service=fs.readFileSync("supabase/functions/college-payroll-workflow/index.ts","utf8");
const sql=fs.readFileSync("supabase/sql/college-payroll-workflow.sql","utf8");

test("Compta salaire charge la sauvegarde avant le bordereau et garde le fichier SEPA",()=>{
 assert.ok(page.indexOf('src="./payroll-workflow.js')>0);
 assert.ok(page.indexOf('src="./payroll-workflow.js')<page.indexOf('src="./salary-od.js'));
 assert.match(page,/sepa-credit-transfer.js/);
 assert.match(ui,/id="salaryWorkflowSave"/);
 assert.match(ui,/id="salaryWorkflowReload"/);
 assert.match(ui,/id="salaryWorkflowMonths"/);
 assert.match(ui,/id="salaryWorkflowPaid"/);
 assert.match(ui,/id="salaryWorkflowSubmit"/);
});

test("les montants et les coordonnées fixes sont sauvegardés, les RIB des salariés ne sont pas recopiés",()=>{
 assert.match(ui,/function workflowDraft\(d\)/);
 assert.match(ui,/bank:\{issuer:d\.bank\.issuer,beneficiaries:bankDraftEntries\(d\)\}/);
 assert.match(ui,/declarations:\[\.\.\.d\.declarations\]/);
 assert.match(ui,/if\(!await workflowSave\(d,true\)\)/);
 assert.match(ui,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(ui,/workflowStatus\("exported",\{exportInfo:/);
 assert.match(ui,/void workflowLoad\(config\.month\)/);
});

test("le suivi bancaire est distinct de la simple génération du fichier XML",()=>{
 assert.match(service,/submitted:\["exported"\]/);
 assert.match(service,/paid:\["submitted"\]/);
 assert.match(service,/rejected:\["exported","submitted"\]/);
 assert.match(service,/draft:\["exported","rejected"\]/);
 assert.match(service,/if\(expected\.totalCents!==meta\.totalCents/);
 assert.match(service,/toCents\(payable\)!==expected\.totalCents/);
 assert.match(service,/Le statut a changé sur un autre onglet/);
});

test("la base protège les données et journalise sans révéler les salaires",()=>{
 assert.match(sql,/enable row level security/g);
 assert.match(sql,/revoke all on public\.college_payroll_months from public,anon,authenticated/);
 assert.match(sql,/revoke all on public\.college_payroll_audit from public,anon,authenticated/);
 assert.match(sql,/check\(version>0\)/);
 assert.match(sql,/create trigger college_payroll_audit_changes/);
 assert.doesNotMatch(sql,/security definer/i);
});

test("client d'API : lecture, sauvegarde, statut et erreurs de session",async()=>{
 const source=fs.readFileSync("college/admin/payroll-workflow.js","utf8");
 const calls=[];
 let fail=false;
 const env={module:{exports:{}},URL,AbortSignal,fetch:async(url,config)=>{
  calls.push({url:String(url),method:config.method,headers:config.headers,body:config.body});
  return fail?{ok:false,status:401,json:async()=>({error:"Accès interdit"})}:{ok:true,status:200,json:async()=>({ok:true,months:[],record:{version:2}})};
 }};
 vm.runInNewContext(source,env,{filename:"payroll-workflow.js"});
 const api=env.module.exports;
 await api.list("part.signature");
 await api.load("2026-11","part.signature");
 await api.save("2026-11","part.signature",1,{version:2,month:"2026-11",payments:[]});
 await api.status("2026-11","part.signature",2,"submitted",{reference:"TEST-REF"});
 assert.deepEqual(calls.map(x=>x.method),["GET","GET","POST","POST"]);
 assert.ok(calls.every(x=>x.headers["x-admin-session"]==="part.signature"));
 assert.ok(calls[2].body.includes('"version":1'));
 assert.ok(calls[3].body.includes('"action":"submitted"'));
 fail=true;
 await assert.rejects(api.list("part.signature"),/Accès interdit/);
 await assert.rejects(api.list("invalid"),/Connectez-vous/);
});
