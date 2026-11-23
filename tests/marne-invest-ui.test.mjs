import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../admin/marne-invest/index.html',import.meta.url),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
if(!match)throw new Error('Script Marne Invest absent');
const script=match[1];
const start=script.indexOf('function bankNormalizeHeader(');
const end=script.indexOf('function bankImportLabel(',start);
if(start<0||end<start)throw new Error('Parser CSV bancaire absent');
const bankCsvRows=new Function(script.slice(start,end)+'\nreturn bankCsvRows;')();

test('La page JavaScript est syntaxiquement valide',()=>{
 assert.doesNotThrow(()=>new Function(script));
});
test('La banque est toujours en validation manuelle',()=>{
 assert.match(script,/window\.confirmBankMatch\s*=\s*async/);
 assert.match(script,/confirmed:\s*true/);
 assert.match(script,/bank-match-verified/);
});
test('Le CSV francais a colonnes debit/credit et quotes est analyse',()=>{
 const rows=bankCsvRows('Date;Libellé;Débit;Crédit;Référence\n20/11/2026;"VIREMENT; LOCATAIRE";;850,00;REF-1\n21/11/2026;ASSURANCE;45,20;;REF-2');
 assert.equal(rows.length,2);
 assert.equal(rows[0].amount,'850.00');
 assert.equal(rows[0].description,'VIREMENT; LOCATAIRE');
 assert.equal(rows[1].amount,'-45.20');
});
test('Le CSV virgules et les montants entre guillemets sont lus',()=>{
 const rows=bankCsvRows('Date,Description,Montant\n2026-11-20,LOYER,"950,20"');
 assert.equal(rows.length,1);
 assert.equal(rows[0].amount,'950.20');
});
test('Le champ montant vide revient aux colonnes debit/credit',()=>{
 const rows=bankCsvRows('Date d’opération;Libellé;Montant;Débit (EUR);Crédit (EUR)\n21/11/2026;ASSURANCE;;23,95;');
 assert.equal(rows[0].amount,'-23.95');
});
test('Les retours ligne cites ne cassent pas le releve',()=>{
 const rows=bankCsvRows('Date;Libellé;Montant\n2026-11-21;"VIREMENT\n MARCHAND";500,00');
 assert.equal(rows[0].description,'VIREMENT MARCHAND');
});
test('Date impossible interdite',()=>{
 assert.throws(()=>bankCsvRows('Date;Libellé;Montant\n31/02/2026;LOYER;600,00'));
});
test('Montant non ambigu a deux decimales requis',()=>{
 assert.throws(()=>bankCsvRows('Date;Libellé;Montant\n20/11/2026;LOYER;1,234'));
});
test('Citation CSV incomplete interdite',()=>{
 assert.throws(()=>bankCsvRows('Date;Libellé;Montant\n20/11/2026;"LOYER;600,00'));
});
test('Limite de 200 mouvements',()=>{
 const lines=['Date;Libellé;Montant'];
 for(let i=0;i<201;i++)lines.push('20/11/2026;LOYER '+i+';600,00');
 assert.throws(()=>bankCsvRows(lines.join('\n')));
});
test('Mise en service et ses modules accessibles',()=>{
 for(const route of ['pilotage','contracts','transactions','documents','works','mail','config']){
  assert.ok(script.includes("'"+route+"'"),route+' absent');
 }
 assert.match(script,/function renderPilotage\(\)/);
});
test('Un changement IRL n est pas effectue dans le navigateur',()=>{
 assert.match(script,/window\.prepareIrlProposal\s*=\s*async/);
 assert.match(script,/Aucun loyer ni courriel modifié/);
 assert.doesNotMatch(script,/supabase_service_role_key/i);
});
test('Les emails entrants sont affiches sous forme de texte protege',()=>{
 assert.match(script,/function renderMail\(\)/);
 assert.match(script,/window\.openFreeInboxMail\s*=\s*async/);
 assert.match(script,/esc\(m\.plain_body/);
});
test('Archivage des documents soumis a session',()=>{
 assert.match(script,/window\.uploadRentalDocument\s*=\s*async/);
 assert.match(script,/api\(['"]document-download['"],\s*['"]GET['"]/);
 assert.match(script,/api\(['"]document-upload['"],\s*['"]POST['"]/);
});

test('IRL: lettre projet et notification restent une action humaine',()=>{
 assert.match(script,/window\.printIrlNotice\s*=\s*id=>/);
 assert.match(script,/PROJET À VÉRIFIER/);
 assert.match(script,/window\.showIrlNotification\s*=\s*id=>/);
 assert.match(script,/irl-notice-confirm/);
 assert.match(script,/window\.scheduleIrlNotice\s*=\s*async/);
 assert.match(script,/api\('schedule-irl','POST'/);
 assert.match(script,/confirmed:true/);
});
test('IRL: les baux programmé et appliqué sont distingués',()=>{
 assert.match(script,/application\.effective_on/);
 assert.match(script,/proposal\.status==='scheduled'/);
 assert.match(script,/proposal\.status==='applied'/);
});
test('Les courriers IRL ne partent pas directement du navigateur',()=>{
 const start=script.indexOf('window.printIrlNotice=id=>');
 const end=script.indexOf('window.showIrlNotification=id=>',start);
 const fragment=script.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(fragment,/fetch\(/);
 assert.doesNotMatch(fragment,/api\('mail-send'/);
 assert.doesNotMatch(fragment,/sendMail\(/);
});

test('La préparation des logements conserve les accès aux baux et documents',()=>{
 const start=script.indexOf('function renderPropertyReadiness()');
 const end=script.indexOf('function healthReportState(',start);
 assert.ok(start>=0&&end>start);
 const readiness=script.slice(start,end);
 assert.match(readiness,/ready\/props\.length/);
 assert.match(readiness,/openPropertyTenant\(this\.dataset\.id\)/);
 assert.match(readiness,/openPropertyEditor\(this\.dataset\.id\)/);
 assert.match(readiness,/showPropertyDocuments\(this\.dataset\.property\)/);
});

test('Diagnostic opérationnel affiché dans la mise en service',()=>{
 assert.match(script,/function renderOperationsHealth\(\)/);
 const start=script.indexOf('function renderPilotage()');
 const end=script.indexOf('window.runAutomaticInstallments=',start);
 assert.ok(start>=0&&end>start);
 assert.match(script.slice(start,end),/renderOperationsHealth\(\)/);
 assert.match(script,/window\.runMarneHealth\s*=\s*async/);
});
test('Exécution du diagnostic réservée à administrateur',()=>{
 assert.match(script,/db\.current_user\?\.payment_void_access/);
 assert.match(script,/api\('health-run','POST',\{confirmed:true\}\)/);
 assert.match(script,/read_only/);
});
test('Le diagnostic ne modifie aucun paiement ou bail dans le navigateur',()=>{
 const start=script.indexOf('function renderOperationsHealth()');
 const end=script.indexOf('function renderPilotage()',start);
 assert.ok(start>=0&&end>start);
 const part=script.slice(start,end);
 assert.doesNotMatch(part,/api\('record-payment'/);
 assert.doesNotMatch(part,/api\('save-lease'/);
 assert.doesNotMatch(part,/api\('mail-send'/);
});
