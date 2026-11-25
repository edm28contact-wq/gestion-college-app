"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("college/admin/salary-od.js","utf8");
const ctx={window:{addEventListener(){}},module:{exports:{}},esc:value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))};
vm.runInNewContext(source,ctx);
const api=ctx.module.exports;
test("OD Chambertin : les 19 lignes suivent le modèle et le crédit TESE du TXT réel",()=>{
 assert.deepEqual(Array.from(api.lines,l=>l.account+":"+l.side),["64110000:D","64115000:D","64510000:D","64510000:D","64530000:D","64530000:D","64533000:D","64532000:D","63330000:D","64730000:D","64131000:D","64143100:D","79100000:C","42500000:C","43100000:C","42100000:C","43100000:C","44850000:C","63110000:D"]);
 assert.equal(api.lines.find(l=>l.key==="benefits_credit").derived,"benefits");
});
test("OD : calcul en centimes, champs manquants et journal équilibré",()=>{
 const values=Object.fromEntries(api.lines.filter(l=>!l.derived).map(l=>[l.key,"0"]));
 assert.equal(api.cents("1 234,56"),123456);assert.equal(api.cents("0"),0);
 for(const v of ["","abc","-2","12,345","1e3"])assert.equal(api.cents(v),null);
 Object.assign(values,{salary:"1000,01",benefits:"50",payable:"900,01",advances:"50",withholding:"50"});
 const j=api.journal(values);assert.equal(j.debit,105001);assert.equal(j.credit,105001);assert.equal(j.ok,true);
 assert.equal(j.entries.find(l=>l.key==="benefits_credit").amount,5000);
 values.payable="900";assert.equal(api.journal(values).ok,false);
 assert.throws(()=>api.journalCsv("2026-11",values));
 values.payable="900,01";const out=api.journalCsv("2026-11",values);
 assert.match(out,/"20261130";"OD";"64110000"/);assert.match(out,/"79100000"/);
 delete values.tese;assert.equal(api.journal(values).missing,1);assert.equal(api.journal(values).ok,false);
 assert.equal(api.monthEnd("2028-02"),"20280229");
 assert.throws(()=>api.monthEnd("2026-13"));
});
test("Virements : le net est reporté sans nouvelle déduction et les données incomplètes sont bloquées",()=>{
 assert.equal(api.paymentTotals(new Map([["a","500,01"],["b","200,02"]])).total,70003);
 assert.equal(api.paymentTotals(new Map([["a","500"],["b",""]])).ok,false);
 assert.equal(api.paymentTotals(new Map([["a","0"]])).ok,false);
 assert.match(api.csv([["=FORMULE"]]),/"'=FORMULE"/);
 const raw={version:1,month:"2026-11",values:{salary:"700"},payments:[["a","500"]]};
 const d=api.restoreDraft(raw,"2026-11",new Set(["a","b"]),["a","b"]);
 assert.equal(d.payments.get("b"),"");assert.equal(d.payConfirmed,false);assert.equal(d.odConfirmed,false);
 assert.throws(()=>api.restoreDraft(raw,"2026-12",new Set(["a"]),["a"]));
 assert.throws(()=>api.restoreDraft({...raw,payments:[["intrus","1"]]},"2026-11",new Set(["a"]),["a"]));
 assert.throws(()=>api.restoreDraft({...raw,values:{salary:"-1"}},"2026-11",new Set(["a"]),["a"]));
});
test("Compta salaire : module intégré au mois, aux droits de modification et à la déconnexion",()=>{
 const html=fs.readFileSync("college/admin/index.html","utf8"),salary=fs.readFileSync("college/admin/salaires.js","utf8");
 assert.match(html,/salary-od\.js\?v=[0-9a-z-]+/i);assert.match(html,/salaryOdClear\(\)/);
 assert.match(salary,/salaryOdMount\(\{month,staff:staffAvailable\?salaryStaff:\[\],defaultStaff:staffList,ready,canWrite:ready&&salaryCanWrite,session:token,declarationStaff\}/);
 assert.doesNotMatch(source,/\b(localStorage|sessionStorage|fetch)\b/);
 assert.match(source,/!reconcilePayments\(d\)\.ok/);assert.doesNotMatch(source,/salaryPayToOD/);
 assert.match(source,/Aucun paiement n’est émis/);
});

test("TXT d'injection : colonnes, tabulations, encodage Windows-1252 et crédit TESE",()=>{
 const v=Object.fromEntries(api.lines.filter(l=>!l.derived).map(l=>[l.key,"0"]));
 Object.assign(v,{salary:"1000",benefits:"12,50",tese:"200",payable:"700",tese_credit:"500"});
 const result=api.journalText("2026-10",v),rows=result.trimEnd().split("\r\n");
 assert.equal(api.journal(v).ok,true);
 assert.equal(rows[0],"Date\tJournal\tCompte\tLibel Compte\t\tLibelEcriture\tMontant\tD/C\t\t");
 assert.match(result,/20261031\tOD\t43100000\tTESE\t\tOD Oct\. 2026: TESE\t500\tC\t\t\r\n/);
 assert.match(result,/12,5\tD\t\t\r\n/);
 assert.ok(result.split("\r\n").filter(Boolean).every(row=>row.split("\t").length===10));
 assert.equal(Buffer.from(api.windows1252("Sécurité")).toString("hex"),"53e96375726974e9");
 assert.throws(()=>api.windows1252("😀"));
});
test("Rapprochement : conserver le 421 et le total bancaire séparés",()=>{
 const d=api.restoreDraft({version:1,month:"2026-10",values:{payable:"900"},payments:[["a","800"]]},"2026-10",new Set(["a"]),["a"]);
 assert.equal(api.reconcilePayments(d).difference,10000);assert.equal(api.reconcilePayments(d).ok,false);
 d.reconciliation={reason:"Pièce justificative vérifiée",difference:10000};
 assert.equal(api.reconcilePayments(d).ok,true);
 d.values.payable="901";assert.equal(api.reconcilePayments(d).ok,false);
 const restored=api.restoreDraft({version:2,month:"2026-10",values:d.values,payments:[...d.payments],reconciliation:d.reconciliation},"2026-10",new Set(["a"]),["a"]);
 assert.equal(restored.reconciliation.difference,null);
 assert.equal(restored.reconciliation.reason,d.reconciliation.reason);
});
test("Bordereau : vérification syntaxique de l'IBAN, du BIC et de la date",()=>{
 // Examples generated from a fake account number, not from employee RIBs.
 const country="FR",bban="00000000000000000000000";
 const rem=BigInt(bban+"152700")%97n;
 const iban=country+String(98n-rem).padStart(2,"0")+bban;
 assert.equal(api.validIban(iban),true);assert.equal(api.validIban(iban.slice(0,-1)+"1"),false);
 assert.equal(api.validBic("TESTFRPP"),true);assert.equal(api.validBic("INVALID"),false);
 assert.equal(api.validExecutionDate("2026-02-30"),false);assert.equal(api.validExecutionDate("2026-10-30"),true);
 const d=api.restoreDraft({version:2,month:"2026-10",values:{payable:"800"},payments:[["a","800"]]},"2026-10",new Set(["a"]),["a"]);
 assert.match(api.bankProblem(d),/émetteur/);
 d.bank.issuer={name:"Société de test",number:"TEST",iban,bic:"TESTFRPP",filename:"test",label:"Paie",date:"2026-10-30"};
 assert.match(api.bankProblem(d),/bénéficiaires/);
 d.bank.beneficiaries.set("a",{matricule:"1",iban,bic:"TESTFRPP",country:"FR",comment:"Paie"});
 assert.equal(api.bankProblem(d),"");
 const html=api.bankPrintHtml("2026-10",d,()=>"<Salarié fictif>");
 assert.match(html,/&lt;Salarié fictif&gt;/);
 assert.match(html,/Nombre de virements : 1/);
 assert.match(html,/Ne constitue pas un ordre de virement SEPA/);
});

test("Déclaration gérance : champs du modèle, contrôle explicite et exclusion des notes internes",()=>{
 const staff=[{id:"a",name:"Salarié fictif",roleLabel:"Cuisine"}];
 const d=api.restoreDraft({version:2,month:"2026-10",values:{},payments:[["a",""]]},"2026-10",new Set(["a"]),["a"]);
 assert.match(api.declarationProblem(d,staff),/contrat/);
 d.declarations.set("a",{contract:"CDI",status:"Employé",start:"2020-09-01",hours:"151,67",rate:"15",gross:"2275,05",transport:"0",health:"0",comments:"Note sociale",internal:"NE PAS EXPORTER"});
 assert.equal(api.declarationProblem(d,staff),"");
 const data=api.declarationData(d,staff);
 assert.equal(data[0].length,16);
 assert.ok(data[0].includes("N° SS"));assert.ok(data[1].includes("Cuisine"));
 assert.ok(data[1].includes("Note sociale"));assert.doesNotMatch(api.csv(data),/NE PAS EXPORTER/);
 assert.doesNotMatch(api.declarationPrintHtml("2026-10",data),/NE PAS EXPORTER/);
 d.declarations.get("a").gross="";assert.match(api.declarationProblem(d,staff),/montants/);
 assert.throws(()=>api.restoreDraft({version:2,month:"2026-10",values:{},payments:[],declarations:[["intrus",{gross:"1"}]]},"2026-10",new Set(["a"]),["a"]));
});

test("RIB salariés : rattachement par identifiant, effacement des anciens RIB du brouillon et reconfirmation",()=>{
 const d=api.restoreDraft({version:2,month:"2026-10",values:{},payments:[["a","100"],["b","200"]],bank:{issuer:{},beneficiaries:[["a",{iban:"ancien",bic:"ancien",country:"FR",matricule:"1",comment:"Paie"}]]}},"2026-10",new Set(["a","b"]),["a","b"]);
 assert.equal(d.bank.beneficiaries.get("a").iban,undefined);
 d.bankConfirmed=true;
 assert.equal(api.mergeSavedBanks(d,[{personnel_id:"a",iban:"FR-EXEMPLE",bic:"TESTFRPP"}]),true);
 assert.equal(d.bankConfirmed,false);
 assert.equal(d.bank.beneficiaries.get("a").matricule,"1");
 assert.equal(d.bank.beneficiaries.get("a").iban,"FR-EXEMPLE");
 assert.equal(d.bank.beneficiaries.get("b").iban,"");
 assert.doesNotMatch(JSON.stringify(api.bankDraftEntries(d)),/FR-EXEMPLE|TESTFRPP/);
 assert.equal(api.mergeSavedBanks(d,[]),true);
 assert.equal(d.bank.beneficiaries.get("a").iban,"");
 assert.match(source,/staff-bank-payroll/);
 assert.match(source,/d\.bankSignature!==bankSignature\(d\)/);
});
test("RIB : accès serveur séparé du planning et privilèges directs révoqués",()=>{
 const backend=fs.readFileSync("supabase/functions/personnel-planning/index.ts","utf8");
 const sql=fs.readFileSync("supabase/migrations/20261125150644_college_personnel_private_bank_details.sql","utf8");
 for(const action of ["staff-bank-detail","staff-bank-payroll","staff-bank-save"])assert.match(backend,new RegExp('action==="'+action+'"[^\\n]*\\{\\s*if\\(!user\\.salaryWrite\\)'));
 assert.match(backend,/iban_last4:String\(row\.iban\)\.slice\(-4\)/);
 assert.match(backend,/bank=normalizeStaffBank\(x\)/);
 assert.match(backend,/x\.confirmed!==true/);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on table .* from public, anon, authenticated, service_role/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/where personnel_id=p_personnel_id and version=p_version/i);
 assert.match(sql,/jsonb_build_object\('version',v\)/);
});
