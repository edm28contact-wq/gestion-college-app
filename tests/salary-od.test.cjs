"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync("college/admin/salary-od.js","utf8");
const ctx={window:{addEventListener(){}},module:{exports:{}}};
vm.runInNewContext(source,ctx);
const api=ctx.module.exports;
test("OD Chambertin : les 18 lignes, comptes et sens suivent le modèle fourni",()=>{
 assert.deepEqual(Array.from(api.lines,l=>l.account+":"+l.side),["64110000:D","64115000:D","64510000:D","64510000:D","64530000:D","64530000:D","64533000:D","64532000:D","63330000:D","64730000:D","64131000:D","64143100:D","79100000:C","42500000:C","43100000:C","42100000:C","44850000:C","63110000:D"]);
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
 assert.match(html,/salary-od\.js\?v=1/);assert.match(html,/salaryOdClear\(\)/);
 assert.match(salary,/salaryOdMount\(\{month,staff:staffAvailable\?salaryStaff:\[\],defaultStaff:staffList,ready,canWrite:ready&&salaryCanWrite,session:token\}/);
 assert.doesNotMatch(source,/\b(localStorage|sessionStorage|fetch)\b/);
 assert.match(source,/p\.total!==cents\(d\.values\.payable\)/);
 assert.match(source,/Aucun paiement n’est émis/);
});
