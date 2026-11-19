"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");
const reader=read("lecteur-veryfi/veryfi.js");
const queue=read("backend/secretariat-invoice-queue/index.ts");
const page=read("secretariat/factures-gestion/queue.js");
const connector=read("backend/ocr-connectors/index.ts");
const azure=read("backend/azure-invoice-reader/index.ts");
const settings=read("secretariat/factures-gestion/connecteurs.html");
test("Veryfi importe le PDF privé depuis la file avec contrôle SHA-256",()=>{
 assert.match(reader,/async function importQueuedInvoice\(/);
 assert.match(reader,/queueId/);
 assert.match(reader,/await digest\(bytes\)!==data.file_hash/);
 assert.match(reader,/data.state!=="todo"/);
 assert.match(reader,/setFile\(new File\(/);
 assert.match(page,/Traiter avec Veryfi/);
});
test("La réception doit être réellement créée avant le classement de la file",()=>{
 assert.match(queue,/action === "sync-receipt"/);
 assert.match(queue,/from\("supplier_invoices"\)/);
 assert.match(queue,/\.eq\("file_hash",invoice.data.file_hash\)/);
 assert.match(queue,/if\(!receipt.data\)return response/);
 assert.match(queue,/Classement manuel suspendu/);
 assert.match(reader,/await syncQueueAfterReception\(\)/);
});
test("Une facture changée manuellement ne classe pas une autre réception",()=>{
 assert.match(reader,/queueImported=false;/);
 assert.match(reader,/if\(!queueId\|\|!queueImported\|\|!authToken\)return/);
});
test("Azure est annulé sans effacer ses anciennes analyses",()=>{
 assert.match(azure,/Azure désactivé : utilisez Veryfi/);
 assert.match(connector,/const ALLOWED = \["ocrspace"\]/);
 assert.doesNotMatch(settings,/data-provider="azure_invoice"/);
 assert.doesNotMatch(page,/Lire avec Azure/);
 assert.match(page,/Lire avec OCR.space/);
});
test("Aucun mouvement de stock provoqué par la file Secrétariat",()=>{
 assert.doesNotMatch(queue,/from\("stock_movements"\)|from\("stock_balances"\)/);
 assert.match(queue,/stock_unchanged:true/);
});
