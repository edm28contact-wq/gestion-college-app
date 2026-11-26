"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createWorkbookCreditTransfer,validIban}=require("../college/admin/sepa-credit-transfer.js");
const {calculateExcel}=require("../college/admin/payroll-excel-engine.js");
function iban(suffix){
 const bban="3000600001"+"0".repeat(12)+String(suffix);
 let remainder=0;
 for(const c of bban+"FR00"){
  const digits=/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c;
  for(const digit of digits)remainder=(remainder*10+Number(digit))%97;
 }
 const value="FR"+String(98-remainder).padStart(2,"0")+bban;
 assert.equal(validIban(value),true);
 return value;
}
function sample(){
 return {
  month:"2026-11",batchId:"AABBCCDD1122",now:"2026-11-25T16:45:36Z",
  issuer:{name:"TEST EMETTEUR",number:"TEST",iban:iban(1),bic:"CMCIFRPP",date:"2026-11-27",filename:"Salaires 11-2026",label:"Salaire nov 2026"},
  beneficiaries:[
   {name:"Salarié 2",creditorName:"PAYEE B",rowOrder:"12",amountCents:42778,iban:iban(2),bic:"CMCIFRPP",matricule:"102",country:"FR"},
   {name:"Salarié 1",creditorName:"PAYEE A",rowOrder:"10",amountCents:254837,iban:iban(3),bic:"CCOPFRPPXXX",matricule:"101",country:"FR"},
   {name:"Salarié inactif",rowOrder:"99",amountCents:0,iban:"",bic:"",country:"FR",matricule:"103"}
  ]
 };
}
test("le format VBA est different du generateur SEPA generique et reproduit les champs du classeur",()=>{
 const result=createWorkbookCreditTransfer(sample());
 assert.equal(result.filename,"Salaires 11-2026.xml");
 assert.equal(result.messageId,"Salaires 11-2026");
 assert.equal(result.count,2);
 assert.equal(result.totalCents,297615);
 assert.ok(result.xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n'));
 assert.ok(result.xml.includes('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"\rxmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'));
 assert.ok(result.xml.includes("<CreDtTm>2026-11-25T17:45:36</CreDtTm>"));
 assert.ok(result.xml.includes("<PmtInfId>VIRMT Salaires 11-2026</PmtInfId>"));
 assert.ok(result.xml.includes("<CtrlSum>2976.15</CtrlSum>"));
 assert.equal((result.xml.match(/<EndToEndId>Salaire nov 2026<\/EndToEndId>/g)||[]).length,2);
 assert.ok(!result.xml.includes("<RmtInf>"));
 assert.ok(!result.xml.includes("<PstCd>"));
 assert.ok(result.xml.includes("<PstlAdr>\r\n             <Ctry>FR</Ctry>\r\n           </PstlAdr>"));
 assert.ok(result.xml.indexOf("<Nm>PAYEE A</Nm>")<result.xml.indexOf("<Nm>PAYEE B</Nm>"));
 assert.ok(!result.xml.includes("Salarié inactif"));
});
test("le calcul F34 et F25 reproduit exactement le cache Excel avec brut 600",()=>{
 const result=calculateExcel({gross:"600",plafond:"3925",csgBase:"600",prevoyanceBase:"600",transport:"44.4",acompte:"0",withholding:"0",cadre:"o",mutuelle:""});
 assert.ok(Math.abs(result.employeeDeductions-126.06135294117648)<1e-10);
 assert.ok(Math.abs(result.employerCharges-185.856)<1e-10);
 assert.ok(Math.abs(result.netBeforeTax-473.9386470588235)<1e-10);
 assert.ok(Math.abs(result.net-518.3386470588235)<1e-10);
});
test("le moteur du classeur garde ses particularites : C11 vide, C20/C22 fixes et APEC patronale",()=>{
 const x=calculateExcel({gross:"2000",plafond:"3925",csgBase:"600",prevoyanceBase:"600",transport:"0",acompte:"0",withholding:"0",cadre:"n",mutuelle:""});
 const byRow=Object.fromEntries(x.contributions.map(v=>[v.cell,v]));
 assert.equal(byRow["11"].base,0);
 assert.equal(byRow["11"].employer,0);
 assert.equal(byRow["20"].base,600);
 assert.equal(byRow["22"].base,600*x.rates.csgCoefficient);
 assert.equal(byRow["18"].employer,2000*0.00036);
 assert.equal(byRow["14"].salary,0);
});
test("les erreurs de saisie sont signalees, sans inventer un net",()=>{
 assert.throws(()=>calculateExcel({gross:"n/a"}),/Montant non valide/);
 assert.throws(()=>createWorkbookCreditTransfer({...sample(),beneficiaries:[{name:"Test",amountCents:-1}]}),/Montant/);
});
