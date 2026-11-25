"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const {createCreditTransfer,validIban}=require("../college/admin/sepa-credit-transfer.js");

function frenchIban(suffix){
 const bban="3000600001"+"0".repeat(12)+suffix;
 assert.equal(bban.length,23);
 const str=bban+"FR00";
 let rem=0;
 for(const c of str){
  const digits=/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c;
  for(const n of digits)rem=(rem*10+Number(n))%97;
 }
 const iban="FR"+String(98-rem).padStart(2,"0")+bban;
 assert.equal(validIban(iban),true);
 return iban;
}
function sample(){
 return {
  month:"2026-11",
  batchId:"AB12CD34EF56",
  now:"2026-11-25T18:00:00.000Z",
  issuer:{name:"COLLEGE PRIVE CHAMBERTIN SAS",number:"TEST-EMETTEUR",iban:frenchIban("1"),bic:"CMCIFRPP",date:"2026-11-28",filename:"Salaires 11-2026",label:"Salaire novembre 2026"},
  beneficiaries:[
   {name:"Alice & Bob",matricule:"101",amountCents:254837,iban:frenchIban("2"),bic:"CMCIFRPP",country:"FR",postcode:"92600",city:"Asnières-sur-Seine",address:"1 rue & 2",comment:"Salaire <novembre>"},
   {name:"Béatrice",matricule:"102",amountCents:42778,iban:frenchIban("3"),bic:"CCOPFRPPXXX",country:"FR",postcode:"75014",city:"Paris"},
   {name:"Compte inactif",matricule:"103",amountCents:0,iban:"",bic:"",country:"FR"}
  ]
 };
}
test("génère un XML SEPA pain.001.001.03 bien formé, avec les montants exacts",()=>{
 const output=createCreditTransfer(sample());
 assert.equal(output.count,2);
 assert.equal(output.totalCents,297615);
 assert.equal(output.filename,"Salaires 11-2026.xml");
 assert.equal(output.format,"pain.001.001.03");
 assert.match(output.xml,/urn:iso:std:iso:20022:tech:xsd:pain\.001\.001\.03/);
 assert.equal((output.xml.match(/<CdtTrfTxInf>/g)||[]).length,2);
 assert.match(output.xml,/<CtrlSum>2976\.15<\/CtrlSum>/);
 assert.match(output.xml,/<NbOfTxs>2<\/NbOfTxs>/);
 assert.match(output.xml,/<InstdAmt Ccy="EUR">2548\.37<\/InstdAmt>/);
 assert.match(output.xml,/<InstdAmt Ccy="EUR">427\.78<\/InstdAmt>/);
 assert.match(output.xml,/<Nm>Alice &amp; Bob<\/Nm>/);
 assert.match(output.xml,/<Ustrd>Salaire &lt;novembre&gt;<\/Ustrd>/);
 assert.doesNotMatch(output.xml,/Compte inactif/);
 assert.equal((new Set([...output.xml.matchAll(/<EndToEndId>([^<]+)<\/EndToEndId>/g)].map(x=>x[1]))).size,2);
 const parser=[
  "import sys,xml.etree.ElementTree as et",
  "root=et.fromstring(sys.stdin.read())",
  "ns={'n':'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'}",
  "assert root.tag=='{'+ns['n']+'}Document'",
  "assert len(root.findall('.//n:CdtTrfTxInf',ns))==2",
  "assert len(root.findall('.//n:DbtrAcct/n:Id/n:IBAN',ns))==1",
  "assert len(root.findall('.//n:CdtrAcct/n:Id/n:IBAN',ns))==2",
  "print('XML_OK')"
 ].join("\n");
 const py=spawnSync("python3",["-c",parser],{input:output.xml,encoding:"utf8"});
 assert.equal(py.status,0,py.stderr);
 assert.match(py.stdout,/XML_OK/);
});

test("bloque les virements si le compte, le BIC ou la date sont invalides",()=>{
 for(const [label,mutate] of [
  ["IBAN",x=>x.beneficiaries[0].iban="FR00INVALID"],
  ["BIC",x=>x.issuer.bic="INVALID"],
  ["date passée",x=>x.issuer.date="2026-11-20"],
  ["date impossible",x=>x.issuer.date="2026-11-31"],
  ["montant négatif",x=>x.beneficiaries[0].amountCents=-1],
  ["montant fractionné",x=>x.beneficiaries[0].amountCents=0.1],
  ["doublon matricule",x=>x.beneficiaries[1].matricule="101"],
  ["caractère XML interdit",x=>x.issuer.name="COLLEGE\u0001TEST"]
 ]){
  const input=sample();mutate(input);
  assert.throws(()=>createCreditTransfer(input),undefined,label);
 }
});

test("refuse un fichier sans paiement positif, sans identifiant unique ou sans destinataire",()=>{
 const x=sample();for(const row of x.beneficiaries)row.amountCents=0;
 assert.throws(()=>createCreditTransfer(x),/Aucun virement positif/);
 const y=sample();y.batchId="BAD";
 assert.throws(()=>createCreditTransfer(y),/Identifiant de lot/);
 const z=sample();z.beneficiaries[0].name="";
 assert.throws(()=>createCreditTransfer(z),/Nom du bénéficiaire/);
});

test("le contrôle montant n'est pas sujet aux erreurs d'arrondi des flottants",()=>{
 const x=sample();
 x.beneficiaries[0].amountCents=10;
 x.beneficiaries[1].amountCents=20;
 const result=createCreditTransfer(x);
 assert.equal(result.totalCents,30);
 assert.match(result.xml,/<CtrlSum>0\.30<\/CtrlSum>/);
});

test("des identifiants de lots différents donnent des références distinctes",()=>{
 const a=createCreditTransfer(sample()),b=sample();
 b.batchId="AA99ZZ88MM22";
 const next=createCreditTransfer(b);
 assert.notEqual(a.messageId,next.messageId);
 assert.notEqual(a.xml,next.xml);
});
