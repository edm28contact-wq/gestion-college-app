"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const script = fs.readFileSync("secretariat/factures-gestion/connecteurs.js","utf8");
const html = fs.readFileSync("secretariat/factures-gestion/connecteurs.html","utf8");
const api = fs.readFileSync("backend/ocr-connectors/index.ts","utf8");

test("OCR settings never reuse the secretariat session",() => {
  assert.match(script,/localStorage\.getItem\("edm_admin_token"\)/);
  assert.doesNotMatch(script,/college_secretariat_token/);
  assert.match(script,/temporaryAdminToken/);
  assert.doesNotMatch(script,/localStorage\.setItem/);
});
test("Only a validated global super-admin can enable credential writes",() => {
  assert.match(api,/a\.role !== "admin" \|\| a\.is_super_admin !== true/);
  assert.match(script,/const state = await request\("GET"\)/);
  assert.match(script,/showAuthorized\(\)/);
  assert.match(script,/if \(!authorized\)/);
  assert.match(html,/id="adminLoginForm"/);
  assert.match(html,/data-save disabled/);
});
test("OCR.space confirmation no longer says OCR is unavailable",() => {
  assert.match(script,/La lecture manuelle sera possible/);
  assert.doesNotMatch(script,/Les lectures ne sont pas encore activées dans le site/);
});
