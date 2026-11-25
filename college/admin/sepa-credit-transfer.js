/* Virements de salaires : export local XML ISO 20022 pain.001.001.03.
   Aucun contact bancaire ni transfert de données vers un service tiers. */
(()=>{
"use strict";
const NAMESPACE="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";
const XML_INVALID=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/;
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[ch]));
function clean(value,max,label,required=true){
 const s=String(value??"").normalize("NFC").replace(/\s+/g," ").trim();
 if((required&&!s)||s.length>max||XML_INVALID.test(s))throw Error(label+" invalide ou trop long (maximum "+max+" caractères).");
 return s;
}
const compactIban=value=>String(value??"").replace(/\s/g,"").toUpperCase();
function validIban(value){
 const iban=compactIban(value);
 if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith("FR")&&iban.length!==27))return false;
 let remainder=0;
 for(const letter of iban.slice(4)+iban.slice(0,4)){
  const digits=/[A-Z]/.test(letter)?String(letter.charCodeAt(0)-55):letter;
  for(const digit of digits)remainder=(remainder*10+Number(digit))%97;
 }
 return remainder===1;
}
function requiredIban(value,label){
 const iban=compactIban(value);
 if(!validIban(iban))throw Error("IBAN invalide : "+label+".");
 return iban;
}
function requiredBic(value,label){
 const bic=String(value??"").replace(/\s/g,"").toUpperCase();
 if(!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic))throw Error("BIC invalide : "+label+".");
 return bic;
}
function validDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const stamp=new Date(value+"T00:00:00Z");
 return Number.isFinite(stamp.getTime())&&stamp.toISOString().slice(0,10)===value;
}
function parisDate(date){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(date);
 const part=key=>parts.find(x=>x.type===key)?.value||"";
 return part("year")+"-"+part("month")+"-"+part("day");
}
function euro(cents){
 return String(Math.floor(cents/100))+"."+String(cents%100).padStart(2,"0");
}
function createCreditTransfer(input){
 if(!input||!Array.isArray(input.beneficiaries)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month||""))
  throw Error("Période ou liste de virements invalide.");
 const now=input.now===undefined?new Date():new Date(input.now);
 if(!Number.isFinite(now.getTime()))throw Error("Date de création invalide.");
 const issuer=input.issuer||{};
 const batchId=String(input.batchId||"").replace(/-/g,"").toUpperCase();
 if(!/^[A-Z0-9]{8,20}$/.test(batchId))throw Error("Identifiant de lot invalide.");
 const issuerName=clean(issuer.name,70,"Nom émetteur");
 const issuerIban=requiredIban(issuer.iban,"émetteur");
 const issuerBic=requiredBic(issuer.bic,"émetteur");
 const number=clean(issuer.number,35,"Identifiant émetteur");
 const label=clean(issuer.label,140,"Libellé du virement");
 const executionDate=String(issuer.date||"").trim();
 if(!validDate(executionDate))throw Error("Date d’exécution du virement invalide.");
 if(executionDate<parisDate(now))throw Error("La date d’exécution est passée. Choisissez aujourd’hui ou une date future.");
 const amountRows=[];
 let total=0;
 const matricules=new Set();
 for(const item of input.beneficiaries){
  const cents=item?.amountCents;
  if(!Number.isSafeInteger(cents)||cents<0||cents>99999999999)throw Error("Montant de virement invalide.");
  if(cents===0)continue; // Correspond aux lignes inactives ou sans salaire dans le classeur.
  if(amountRows.length>=500)throw Error("Un lot ne peut pas contenir plus de 500 virements.");
  const name=clean(item.name,70,"Nom du bénéficiaire");
  const iban=requiredIban(item.iban,name),bic=requiredBic(item.bic,name);
  const matricule=clean(item.matricule,35,"Matricule de "+name);
  if(matricules.has(matricule))throw Error("Matricule en double : "+matricule+".");
  matricules.add(matricule);
  const country=clean(item.country||iban.slice(0,2),2,"Pays de "+name).toUpperCase();
  if(!/^[A-Z]{2}$/.test(country))throw Error("Code pays invalide : "+name+".");
  const postcode=clean(item.postcode,16,"Code postal de "+name,false);
  const city=clean(item.city,35,"Ville de "+name,false);
  const address=clean(item.address,70,"Adresse de "+name,false);
  const comment=clean(item.comment||label,140,"Libellé de "+name);
  total+=cents;
  if(!Number.isSafeInteger(total))throw Error("Montant total trop élevé.");
  amountRows.push({name,iban,bic,matricule,country,postcode,city,address,comment,cents});
 }
 if(!amountRows.length)throw Error("Aucun virement positif à exporter.");
 const yyyymm=input.month.replace("-","");
 const msgId="CHAM-SAL-"+yyyymm+"-"+batchId;
 const paymentId="VIRMT-"+yyyymm+"-"+batchId;
 if(msgId.length>35||paymentId.length>35)throw Error("Identifiant SEPA trop long.");
 const count=amountRows.length;
 const totalAmount=euro(total);
 const created=now.toISOString().slice(0,19)+"Z";
 const lines=[
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Document xmlns="'+NAMESPACE+'">',
  '  <CstmrCdtTrfInitn>',
  '    <GrpHdr>',
  '      <MsgId>'+esc(msgId)+'</MsgId>',
  '      <CreDtTm>'+created+'</CreDtTm>',
  '      <NbOfTxs>'+count+'</NbOfTxs>',
  '      <CtrlSum>'+totalAmount+'</CtrlSum>',
  '      <InitgPty>',
  '        <Nm>'+esc(issuerName)+'</Nm>',
  '        <Id><OrgId><Othr><Id>'+esc(number)+'</Id></Othr></OrgId></Id>',
  '      </InitgPty>',
  '    </GrpHdr>',
  '    <PmtInf>',
  '      <PmtInfId>'+esc(paymentId)+'</PmtInfId>',
  '      <PmtMtd>TRF</PmtMtd>',
  '      <NbOfTxs>'+count+'</NbOfTxs>',
  '      <CtrlSum>'+totalAmount+'</CtrlSum>',
  '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
  '      <ReqdExctnDt>'+executionDate+'</ReqdExctnDt>',
  '      <Dbtr><Nm>'+esc(issuerName)+'</Nm></Dbtr>',
  '      <DbtrAcct><Id><IBAN>'+issuerIban+'</IBAN></Id></DbtrAcct>',
  '      <DbtrAgt><FinInstnId><BIC>'+issuerBic+'</BIC></FinInstnId></DbtrAgt>',
  '      <ChrgBr>SLEV</ChrgBr>'
 ];
 for(const [index,row] of amountRows.entries()){
  const endToEndId="SAL-"+yyyymm+"-"+String(index+1).padStart(5,"0")+"-"+batchId.slice(-8);
  lines.push(
   '      <CdtTrfTxInf>',
   '        <PmtId><EndToEndId>'+esc(endToEndId)+'</EndToEndId></PmtId>',
   '        <Amt><InstdAmt Ccy="EUR">'+euro(row.cents)+'</InstdAmt></Amt>',
   '        <CdtrAgt><FinInstnId><BIC>'+row.bic+'</BIC></FinInstnId></CdtrAgt>',
   '        <Cdtr><Nm>'+esc(row.name)+'</Nm></Cdtr>'
  );
  if(row.country||row.postcode||row.city||row.address){
   lines.push(
    '        <PstlAdr>',
    '          <Ctry>'+row.country+'</Ctry>'
   );
   if(row.postcode)lines.push('          <PstCd>'+esc(row.postcode)+'</PstCd>');
   if(row.city)lines.push('          <TwnNm>'+esc(row.city)+'</TwnNm>');
   if(row.address)lines.push('          <AdrLine>'+esc(row.address)+'</AdrLine>');
   lines.push('        </PstlAdr>');
  }
  lines.push(
   '        </Cdtr>',
   '        <CdtrAcct><Id><IBAN>'+row.iban+'</IBAN></Id></CdtrAcct>',
   '        <RmtInf><Ustrd>'+esc(row.comment)+'</Ustrd></RmtInf>',
   '      </CdtTrfTxInf>'
  );
 }
 lines.push('    </PmtInf>','  </CstmrCdtTrfInitn>','</Document>');
 const safeName=clean(issuer.filename||"Salaires "+input.month,100,"Nom du fichier").replace(/[\\/:*?"<>|]+/g," ").replace(/\.+$/,"").trim();
 if(!safeName)throw Error("Nom du fichier SEPA invalide.");
 return {xml:lines.join("\r\n")+"\r\n",filename:(safeName.toLowerCase().endsWith(".xml")?safeName:safeName+".xml"),count,totalCents:total,format:"pain.001.001.03",messageId:msgId};
}
const api=Object.freeze({createCreditTransfer,validIban,validDate,parisDate});
if(typeof window!=="undefined")window.ChambertinSEPA=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();