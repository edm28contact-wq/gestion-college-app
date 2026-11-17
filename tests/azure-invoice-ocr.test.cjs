"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const db=fs.readFileSync("backend/azure-invoice-reader/schema.sql","utf8");
const azure=fs.readFileSync("backend/azure-invoice-reader/index.ts","utf8");
const ui=fs.readFileSync("secretariat/factures-gestion/queue.js","utf8");
const queue=fs.readFileSync("backend/secretariat-invoice-queue/index.ts","utf8");

test("Azure and OCR.space share a total of three invoice attempts and an atomic quota",()=>{
 assert.match(db,/p_provider not in \('ocrspace','azure_invoice'\)/);
 assert.match(db,/v_invoice\.ocr_attempts >= 3/);
 assert.match(db,/for update/);
 assert.match(db,/monthly_request_cap/);
 assert.match(db,/provider in \('ocrspace','azure_invoice'\)/);
});
test("Never expose secrets or expose stock writes from Azure",()=>{
 assert.match(azure,/secretariat_ocr_connector_secret/);
 assert.match(azure,/redirect:"error"/);
 assert.match(azure,/operation\.origin!==base\.origin/);
 assert.match(azure,/pdf_hash_mismatch/);
 assert.doesNotMatch(azure,/\bstock_orders\b|\bstock_movements\b|\bstock_balances\b/);
 assert.match(azure,/stock_unchanged:true/);
});
test("Azure F0 processing is limited to two pages and results are not auto-validated",()=>{
 assert.match(azure,/pages=1-2/);
 assert.match(azure,/free_pdf_size_limit/);
 assert.match(azure,/auto_verified:false/);
 assert.match(azure,/partial_document_possible/);
 assert.match(db,/p_page_count not between 0 and 2/);
});
test("OCR result history includes the provider and structured invoice fields",()=>{
 assert.match(queue,/structured_result/);
 assert.match(queue,/provider,attempt,engine/);
 assert.match(ui,/Lire avec Azure/);
 assert.match(ui,/Lire avec OCR.space/);
 assert.match(ui,/fields\.items/);
});
