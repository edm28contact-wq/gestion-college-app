import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../admin/marne-invest/index.html', import.meta.url), 'utf8');
const origin = 'https://marne.test';
const propertyId = '00000000-0000-4000-8000-000000000001';
const tenantId = '00000000-0000-4000-8000-000000000002';
const leaseId = '00000000-0000-4000-8000-000000000003';
const installmentId = '00000000-0000-4000-8000-000000000004';
const paymentId = '00000000-0000-4000-8000-000000000005';
const mailId = '00000000-0000-4000-8000-000000000006';
const routes = [
  ['dashboard', 'Dashboard'], ['pilotage', 'Version finale'], ['properties', 'Mes Biens'],
  ['tenants', 'Locataires'], ['contracts', 'Contrats'], ['transactions', 'Transactions'],
  ['emails', 'Relances et e-mails'], ['mail', 'Messagerie Free'], ['works', 'Travaux'],
  ['documents', 'Documents'], ['reports', 'Rapports'], ['config', 'Paramètres'],
];
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function fixture({ readOnly = false, empty = false } = {}) {
  const now = new Date().toISOString();
  const data = {
    current_user: {
      username: 'qa-fixture', display_name: 'Compte de test', role: readOnly ? 'gestionnaire' : 'admin',
      permissions: { readonly: readOnly }, read_only: readOnly, payment_access: true,
      payment_void_access: true, work_access: true, document_access: true, bank_access: true,
      mail_access: true, mail_configured: false, mail_account: 'fixture@free.fr',
    },
    settings: [{ setting_key: 'sender_email', value: 'fixture@free.fr' }],
    tenants: [{ id: tenantId, property_id: propertyId, row_number: 2, data: {
      Locataire: 'Locataire Test', 'Nom du logement': 'Logement Test', 'Mail locataire': 'fixture@example.test',
      'Loyer de base': 600, Charge: 50, 'Date entrée locataire': '2026-11-01',
    } }],
    properties: [{ id: propertyId, name: 'Logement Test', is_example: false,
      data: { Adresse: 'Adresse de test', Ville: 'Paris', 'Type de bien': 'Studio' },
      current_tenant: {}, tenant_history: [], payment_schedule: [], source_sheet: 'fixture' }],
    leases: [{ id: leaseId, property_id: propertyId, tenant_row_id: tenantId,
      tenant_name: 'Locataire Test', status: 'active', verified_at: now, start_date: '2026-11-01',
      end_date: null, monthly_rent: 600, charges_amount: 50, due_day: 5, lease_kind: 'residential',
      issuer_name: 'Bailleur Test', issuer_address: 'Adresse de test', receipt_email_consent: false }],
    installments: [{ id: installmentId, lease_id: leaseId, property_id: propertyId,
      period: '2026-11-01', due_on: '2026-11-05', rent_amount: 600, charges_amount: 50,
      total_due: 650, status: 'scheduled' }],
    payments: [{ id: paymentId, lease_id: leaseId, property_id: propertyId,
      received_on: '2026-11-05', amount: 400, payment_method: 'virement', reference: 'TEST', status: 'recorded' }],
    payment_allocations: [{ payment_id: paymentId, installment_id: installmentId, amount: 400 }],
    reminder_drafts: [], mail_inbox: [{ id: mailId, subject: 'Message de test',
      sender_email: 'fixture@example.test', received_at: now, is_seen: true, has_attachments: false }],
    mail_outbox: [], mail_sync_state: null, automation_runs: [],
    work_orders: [{ id: 'work-fixture', property_id: propertyId, title: 'Radiateur de test',
      description: 'Signalement fictif', category: 'chauffage', priority: 'standard', status: 'open',
      estimate_amount: null, actual_amount: null }],
    documents: [{ id: 'document-fixture', property_id: propertyId, lease_id: leaseId,
      category: 'bail', label: 'Bail de test', original_name: 'fixture.pdf', byte_size: 1024, created_at: now }],
    bank_imports: [], bank_lines: [], irl_rules: [], irl_proposals: [], irl_indices: [],
    irl_candidates: [], irl_applications: [], health_reports: [{ id: 'health-fixture', checked_at: now,
      trigger_type: 'manual', status: 'ok', critical_count: 0, warning_count: 0, checks: [], metrics: { cron_jobs: 5 } }],
    tenant_headers: ['Locataire', 'Nom du logement', 'Mail locataire', 'Loyer de base', 'Charge'],
    comments: {}, commands: [], server_time: now,
  };
  if (empty) {
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && key !== 'tenant_headers') data[key] = [];
    }
  }
  return data;
}

async function openApp(t, { viewport = { width: 1280, height: 900 }, data = fixture(), pageName = 'dashboard',
  authenticated = true, fallback = false } = {}) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  t.after(() => context.close());
  const errors = [], dialogs = [], requests = [], unexpected = [];
  const expectedHttpStatuses = new Set();
  const pendingActions = new Map(), privateDownloads = [];
  let expired = false, dataFailure = null, pendingData = null;
  await context.addInitScript(({ authenticated, fallback }) => {
    if (!sessionStorage.getItem('qa-initialized')) {
      sessionStorage.setItem('qa-initialized', '1');
      if (authenticated) localStorage.setItem('marne_invest_admin_token', 'synthetic-fixture-token');
      if (fallback) localStorage.setItem('holding_admin_token', 'synthetic-fallback-token');
    }
  }, { authenticated, fallback });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type' },
      body: JSON.stringify(body) });
    if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.origin === origin && url.pathname === '/private-fixture.pdf') {
      privateDownloads.push(req.url());
      return route.fulfill({ contentType: 'text/plain', body: 'DOCUMENT_CONFIDENTIEL_FIXTURE' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
    } });
    if (url.pathname === '/functions/v1/marne-irl') {
      return json({ ok: true, index: 146, period: 'T3 2026 — fixture', checked_at: data.server_time });
    }
    if (url.pathname === '/functions/v1/rental-admin-api') {
      const action = url.searchParams.get('action');
      const headers = await req.allHeaders();
      requests.push({ action, method: req.method(), id: url.searchParams.get('id'),
        authorization: headers.authorization, contentType: headers['content-type'] || '', body: req.postData() || '' });
      const actionGate = pendingActions.get(action);
      if (actionGate) { pendingActions.delete(action); actionGate.markReceived(); await actionGate.response; }
      if (actionGate?.reply) return json(actionGate.reply.body, actionGate.reply.status);
      if (expired) return json({ error: 'Session expirée' }, 401);
      if (action === 'login' && req.method() === 'POST') return json({ token: 'synthetic-reconnected-token' });
      if (action === 'data' && req.method() === 'GET') {
        const gate = pendingData;
        pendingData = null;
        if (gate) { gate.markReceived(); await gate.response; }
        if (dataFailure) return json({ error: dataFailure.message }, dataFailure.status);
        return json(data);
      }
      if (action === 'mail-message' && req.method() === 'GET') {
        const id = url.searchParams.get('id');
        return json({ item: { id,
          subject: id === mailId ? '<img src=x onerror="window.qaInjected=true">' : 'Message récent de test',
          sender_email: 'fixture@example.test',
          plain_body: id === mailId ? '<script>window.qaInjected=true</script>\nTexte reçu' : 'MESSAGE_RECENT_FIXTURE',
          is_seen: true, has_attachments: false,
        } });
      }
      if (action === 'document-download' && req.method() === 'GET') return json({ url: origin + '/private-fixture.pdf' });
      if (action === 'document-upload' && req.method() === 'POST') return json({ ok: true, id: 'new-document-fixture' });
      if (action === 'receipt-preview' && req.method() === 'POST') return json({
        document_type: 'recu', period: '2026-11', period_from: '2026-11-01', period_to: '2026-11-30',
        generated_on: '2026-11-23', issuer: 'BAILLEUR_CONFIDENTIEL_FIXTURE', issuer_address: 'Adresse de test',
        tenant: 'LOCATAIRE_CONFIDENTIEL_FIXTURE', property_name: 'LOGEMENT_CONFIDENTIEL_FIXTURE', address: 'Adresse de test',
        rent: 600, charges: 50, paid: 400, remaining: 250,
      });
    }
    if (url.origin === origin && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    unexpected.push({ url: req.url(), method: req.method() });
    return json({ error: 'Requête non prévue dans le test hors ligne' }, 405);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const httpStatus = msg.text().match(/Failed to load resource:.*status of (\d{3})\b/)?.[1];
    const expectedHttpError = httpStatus && expectedHttpStatuses.has(Number(httpStatus));
    if (!expectedHttpError) errors.push(msg.text());
  });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(origin + '/?page=' + pageName, { waitUntil: 'domcontentloaded' });
  if (authenticated || fallback) {
    await page.waitForFunction(() => document.querySelector('#serverTime')?.textContent.includes('Données actualisées'));
  }
  return {
    page, errors, dialogs, requests, unexpected, privateDownloads,
    expire() { expired = true; expectedHttpStatuses.add(401); },
    failData() { dataFailure = { status: 503, message: 'Service de test momentanément indisponible' }; expectedHttpStatuses.add(503); },
    recoverData() { dataFailure = null; },
    delayData() {
      assert.equal(pendingData, null, 'Une seule réponse data peut être retenue à la fois');
      let release, markReceived;
      const response = new Promise(resolve => { release = resolve; });
      const received = new Promise(resolve => { markReceived = resolve; });
      pendingData = { response, markReceived };
      return { received, release };
    },
    delayAction(action, reply = null) {
      assert.equal(pendingActions.has(action), false, 'Une seule réponse par action peut être retenue à la fois');
      let release, markReceived;
      const response = new Promise(resolve => { release = resolve; });
      const received = new Promise(resolve => { markReceived = resolve; });
      if (reply?.status >= 400) expectedHttpStatuses.add(reply.status);
      pendingActions.set(action, { response, markReceived, reply });
      return { received, release };
    },
  };
}

async function visit(page, name) {
  await page.locator('#nav button[data-p="' + name + '"]').click();
  assert.ok((await page.locator('#content').innerText()).trim().length > 0, 'Contenu vide : ' + name);
}

for (const [label, viewport] of [
  ['ordinateur', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }],
]) {
  test('Navigateur : les 12 rubriques fonctionnent sur ' + label, { timeout: 60000 }, async t => {
    const app = await openApp(t, { viewport });
    for (const [name, title] of routes) {
      await visit(app.page, name);
      assert.equal(await app.page.locator('#pageTitle').innerText(), title);
      const size = await app.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.scroll <= size.width + 1, `${name} déborde horizontalement : ${size.scroll} > ${size.width}`);
    }
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.dialogs, []);
    assert.deepEqual(app.unexpected, []);
    assert.ok(app.requests.every(req => req.method === 'GET'), 'La navigation ne doit effectuer aucune écriture');
  });
}

test('Navigateur : toutes les rubriques acceptent un portefeuille vide', { timeout: 60000 }, async t => {
  const app = await openApp(t, { data: fixture({ empty: true }) });
  for (const [name] of routes) await visit(app.page, name);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.dialogs, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un compte en lecture seule ne peut ouvrir les saisies financières', async t => {
  const app = await openApp(t, { data: fixture({ readOnly: true }) });
  await visit(app.page, 'transactions');
  assert.equal(await app.page.getByRole('button', { name: '+ Enregistrer un paiement', exact: true }).count(), 0);
  await app.page.evaluate(() => { window.openPaymentModal(); window.openDocumentUploader(); window.newWorkOrder(); });
  assert.equal(await app.page.locator('#modal').innerHTML(), '');
  await visit(app.page, 'contracts');
  await app.page.evaluate(id => window.editLease(id), leaseId);
  assert.equal(await app.page.locator('#modal input:not([type="hidden"]):not(:disabled),#modal select:not(:disabled)').count(), 0);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'config');
  assert.equal(await app.page.locator('#central-config-save').count(), 0);
  assert.equal(await app.page.locator('#central-mail-password').isDisabled(), true);
  await visit(app.page, 'pilotage');
  assert.equal(await app.page.locator('#health-run-button').isDisabled(), true);
  assert.ok(app.requests.every(req => req.method === 'GET'));
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : le courriel reçu reste du texte inerte', async t => {
  const app = await openApp(t, { pageName: 'mail' });
  await app.page.locator('.mail-item').click();
  await app.page.waitForFunction(() => document.querySelector('#mailReader .mail-text'));
  assert.match(await app.page.locator('#mailReader .mail-text').innerText(), /<script>window\.qaInjected=true<\/script>/);
  assert.equal(await app.page.locator('#mailReader img,#mailReader script').count(), 0);
  assert.equal(await app.page.evaluate(() => window.qaInjected), undefined);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : expiration de session ferme aussi la fenêtre privée ouverte', async t => {
  const app = await openApp(t, { pageName: 'contracts' });
  await app.page.evaluate(id => window.editLease(id), leaseId);
  assert.equal(await app.page.locator('#modal .modal').count(), 1);
  app.expire();
  await app.page.evaluate(() => window.refresh());
  assert.equal(await app.page.locator('#login').isVisible(), true);
  assert.equal(await app.page.locator('#app').isVisible(), false);
  assert.equal(await app.page.locator('#modal').innerHTML(), '');
  assert.equal(await app.page.locator('#content').innerHTML(), '');
  assert.equal(await app.page.evaluate(() => localStorage.getItem('marne_invest_admin_token')), null);
  assert.deepEqual(app.errors, []);
});

test('Navigateur : une déconnexion explicite ne réutilise pas le jeton Holding au rechargement', async t => {
  const app = await openApp(t, { authenticated: false, fallback: true });
  await app.page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  const count = app.requests.length;
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await app.page.locator('#login').isVisible(), true);
  assert.equal(await app.page.locator('#app').isVisible(), false);
  assert.equal(app.requests.length, count, 'Aucune réauthentification implicite ne doit suivre la déconnexion');
  assert.equal(await app.page.evaluate(() => localStorage.getItem('holding_admin_token')), 'synthetic-fallback-token');
  assert.deepEqual(app.errors, []);
});

test('Navigateur : sans session, seul le formulaire de connexion est visible', async t => {
  const app = await openApp(t, { authenticated: false });
  assert.equal(await app.page.locator('#login').isVisible(), true);
  assert.equal(await app.page.locator('#app').isVisible(), false);
  assert.deepEqual(app.requests, []);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : les tests IMAP et SMTP réussis sont affichés sans demander un nouveau test', async t => {
  const data = fixture();
  data.current_user.mail_configured = true;
  data.mail_sync_state = { imap_verified_at: data.server_time, smtp_verified_at: data.server_time, last_sync_at: data.server_time };
  const app = await openApp(t, { data, pageName: 'config' });
  assert.equal(await app.page.getByText('IMAP et SMTP vérifiés', { exact: true }).count(), 1);
  await visit(app.page, 'pilotage');
  assert.match(await app.page.locator('#content').innerText(), /IMAP vérifié ; SMTP vérifié/);
  await visit(app.page, 'mail');
  assert.match(await app.page.locator('.mail-banner').innerText(), /IMAP : Vérifié · SMTP : Vérifié/);
  assert.ok(app.requests.every(req => req.method === 'GET'));
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un diagnostic absent ou périmé ne confirme jamais le succès actuel', async t => {
  const data = fixture();
  data.health_reports = [];
  const app = await openApp(t, { data, pageName: 'pilotage' });
  const panel = app.page.locator('#operationsHealth');
  assert.match(await panel.locator(':scope > .kv .mini-tag').innerText(), /Contrôle à lancer/);
  assert.doesNotMatch(await panel.innerText(), /Aucune anomalie détectée/);
  data.health_reports = [{ id: 'stale-fixture', checked_at: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    trigger_type: 'daily', status: 'ok', critical_count: 0, warning_count: 0, checks: [], metrics: { cron_jobs: 5 } }];
  await app.page.evaluate(() => window.refresh());
  assert.match(await panel.locator(':scope > .kv .mini-tag').innerText(), /Diagnostic à actualiser/);
  assert.match(await panel.locator(':scope > .kv .mini-tag').getAttribute('class'), /\bwarn\b/);
  assert.doesNotMatch(await panel.innerText(), /Aucune anomalie détectée/);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un logement prêt exige le locataire exact du bail et des dates en cours', async t => {
  const data = fixture();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  data.leases[0].start_date = day(-30);
  const app = await openApp(t, { data, pageName: 'pilotage' });
  const panel = app.page.locator('section.release-block').filter({ hasText: 'Préparation des 1 logements' });
  assert.match(await panel.locator('.section-head strong').innerText(), /1\s*\/\s*1 prêts \(100 %\)/);
  for (const lease of [
    { tenant_row_id: 'another-tenant', start_date: day(-30), end_date: null },
    { tenant_row_id: tenantId, start_date: day(1), end_date: null },
    { tenant_row_id: tenantId, start_date: day(-30), end_date: day(-1) },
  ]) {
    Object.assign(data.leases[0], lease);
    await app.page.evaluate(() => window.refresh());
    assert.match(await panel.locator('.section-head strong').innerText(), /0\s*\/\s*1 prêts \(0 %\)/);
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
  }
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un échec de rechargement masque les anciens soldes et permet une reprise', async t => {
  const app = await openApp(t, { pageName: 'transactions' });
  assert.match(await app.page.locator('#content').innerText(), /400,00/);
  await app.page.evaluate(() => window.openPaymentModal());
  assert.equal(await app.page.locator('#modal .modal').count(), 1);
  app.failData();
  await app.page.evaluate(() => window.refresh());
  assert.match(await app.page.getByRole('alert').innerText(), /Actualisation impossible/);
  assert.doesNotMatch(await app.page.locator('#content').innerText(), /400,00/);
  assert.equal(await app.page.locator('#content table').count(), 0);
  assert.equal(await app.page.locator('#modal').innerHTML(), '');
  assert.equal(await app.page.locator('#releaseMini').innerHTML(), '');
  await app.page.evaluate(() => window.showPage('reports'));
  assert.match(await app.page.getByRole('alert').innerText(), /Actualisation impossible/);
  app.recoverData();
  await app.page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await app.page.waitForFunction(() => document.querySelector('#serverTime')?.textContent.includes('Données actualisées'));
  assert.equal(await app.page.getByRole('alert').count(), 0);
  assert.match(await app.page.locator('#content').innerText(), /400,00/);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.dialogs, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : une réponse data tardive après déconnexion ne restaure aucune donnée privée', async t => {
  const app = await openApp(t, { pageName: 'transactions' });
  const held = app.delayData();
  try {
    await app.page.evaluate(() => { window.qaPendingRefresh = window.refresh(); });
    await held.received;
    await app.page.evaluate(() => window.logout());
    held.release();
    await app.page.evaluate(() => window.qaPendingRefresh);
    await app.page.evaluate(() => window.showPage('reports'));
    assert.equal(await app.page.locator('#login').isVisible(), true);
    assert.equal(await app.page.locator('#app').isVisible(), false);
    for (const id of ['content', 'modal', 'releaseMini', 'serverTime']) {
      assert.equal(await app.page.locator('#' + id).innerHTML(), '', id + ' doit rester vide');
    }
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : un HTTP 401 lors de la lecture du courriel ferme la session privée', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'mail' });
  app.expire();
  await app.page.evaluate(id => window.openFreeInboxMail(id), mailId);
  assert.equal(await app.page.locator('#login').isVisible(), true);
  assert.equal(await app.page.locator('#app').isVisible(), false);
  assert.equal(await app.page.locator('#content').innerHTML(), '');
  assert.equal(await app.page.evaluate(() => localStorage.getItem('marne_invest_admin_token')), null);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un HTTP 401 lors du téléchargement ferme la session et ne télécharge rien', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  app.expire();
  const held = app.delayAction('document-download');
  try {
    const popupEvent = app.page.waitForEvent('popup');
    await app.page.evaluate(() => { window.qaPrivateAction = window.downloadRentalDocument('document-fixture'); });
    const popup = await popupEvent;
    await held.received;
    held.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    assert.equal(await app.page.locator('#login').isVisible(), true);
    assert.equal(await app.page.locator('#app').isVisible(), false);
    assert.equal(await app.page.locator('#content').innerHTML(), '');
    assert.deepEqual(app.privateDownloads, []);
    if (!popup.isClosed()) assert.doesNotMatch(await popup.locator('body').innerText(), /CONFIDENTIEL_FIXTURE/);
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : un HTTP 401 lors du dépôt ferme la session et le formulaire de document', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  await app.page.evaluate(() => window.openDocumentUploader());
  await app.page.locator('#document-label').fill('Archive de test');
  await app.page.locator('#document-file').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  app.expire();
  await app.page.evaluate(() => window.uploadRentalDocument());
  assert.equal(await app.page.locator('#login').isVisible(), true);
  assert.equal(await app.page.locator('#app').isVisible(), false);
  assert.equal(await app.page.locator('#modal').innerHTML(), '');
  assert.equal(await app.page.locator('#content').innerHTML(), '');
  assert.equal(await app.page.evaluate(() => localStorage.getItem('marne_invest_admin_token')), null);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : une URL de document reçue après déconnexion ne déclenche aucun téléchargement', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  const held = app.delayAction('document-download');
  try {
    const popupEvent = app.page.waitForEvent('popup');
    await app.page.evaluate(() => { window.qaPrivateAction = window.downloadRentalDocument('document-fixture'); });
    const popup = await popupEvent;
    await held.received;
    await app.page.evaluate(() => window.logout());
    held.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 10000 });
    assert.equal(popup.isClosed(), true, 'La fenêtre de préparation doit être fermée');
    assert.equal(await app.page.locator('#login').isVisible(), true);
    assert.equal(await app.page.locator('#content').innerHTML(), '');
    assert.deepEqual(app.privateDownloads, []);
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : un aperçu de paiement reçu après déconnexion ne révèle aucune donnée dans son onglet', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  const held = app.delayAction('receipt-preview');
  try {
    const popupEvent = app.page.waitForEvent('popup');
    await app.page.evaluate(id => { window.qaPrivateAction = window.openPaymentDocument(id); }, installmentId);
    const popup = await popupEvent;
    await held.received;
    await app.page.evaluate(() => window.logout());
    held.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 10000 });
    assert.equal(popup.isClosed(), true, 'La fenêtre de préparation doit être fermée');
    assert.equal(await app.page.locator('#login').isVisible(), true);
    assert.equal(await app.page.locator('#content').innerHTML(), '');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : un ancien HTTP 401 ne déconnecte pas une nouvelle session', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'mail' });
  const held = app.delayAction('mail-message', { status: 401, body: { error: 'Ancienne session expirée' } });
  try {
    await app.page.evaluate(id => { window.qaPrivateAction = window.openFreeInboxMail(id); }, mailId);
    await held.received;
    await app.page.evaluate(() => window.logout());
    await app.page.locator('#user').fill('qa-fixture');
    await app.page.locator('#pass').fill('synthetic-fixture-password');
    await app.page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await app.page.waitForFunction(() => document.querySelector('#serverTime')?.textContent.includes('Données actualisées'));
    assert.equal(await app.page.evaluate(() => localStorage.getItem('marne_invest_admin_token')), 'synthetic-reconnected-token');
    held.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    assert.equal(await app.page.locator('#app').isVisible(), true);
    assert.equal(await app.page.locator('#login').isVisible(), false);
    assert.equal(await app.page.evaluate(() => localStorage.getItem('marne_invest_admin_token')), 'synthetic-reconnected-token');
    assert.doesNotMatch(await app.page.locator('#content').innerText(), /Ancienne session expirée/);
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : une ancienne lecture de mail ne remplace pas la dernière sélection', { timeout: 30000 }, async t => {
  const data = fixture(), secondId = '00000000-0000-4000-8000-000000000007';
  data.mail_inbox.push({ ...data.mail_inbox[0], id: secondId, subject: 'Message récent de test' });
  const app = await openApp(t, { data, pageName: 'mail' });
  const held = app.delayAction('mail-message', { status: 200, body: { item: {
    id: mailId, subject: 'Message ancien de test', sender_email: 'fixture@example.test',
    plain_body: 'MESSAGE_ANCIEN_FIXTURE', is_seen: true, has_attachments: false,
  } } });
  try {
    await app.page.evaluate(id => { window.qaPrivateAction = window.openFreeInboxMail(id); }, mailId);
    await held.received;
    await app.page.evaluate(id => window.openFreeInboxMail(id), secondId);
    assert.match(await app.page.locator('#mailReader .mail-text').innerText(), /MESSAGE_RECENT_FIXTURE/);
    held.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    assert.match(await app.page.locator('#mailReader .mail-text').innerText(), /MESSAGE_RECENT_FIXTURE/);
    assert.doesNotMatch(await app.page.locator('#mailReader').innerText(), /MESSAGE_ANCIEN_FIXTURE/);
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.unexpected, []);
  } finally { held.release(); }
});

test('Navigateur : une session valide peut télécharger un document et consulter un aperçu de paiement', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  const download = app.delayAction('document-download');
  try {
    const popupEvent = app.page.waitForEvent('popup');
    await app.page.evaluate(() => { window.qaPrivateAction = window.downloadRentalDocument('document-fixture'); });
    const popup = await popupEvent;
    await download.received;
    download.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    await popup.waitForURL(origin + '/private-fixture.pdf');
    assert.match(await popup.locator('body').innerText(), /DOCUMENT_CONFIDENTIEL_FIXTURE/);
    assert.deepEqual(app.privateDownloads, [origin + '/private-fixture.pdf']);
    const request = app.requests.find(req => req.action === 'document-download');
    assert.equal(request.id, 'document-fixture');
    assert.equal(request.authorization, 'Bearer synthetic-fixture-token');
    await popup.close();
  } finally { download.release(); }
  const receipt = app.delayAction('receipt-preview');
  try {
    const popupEvent = app.page.waitForEvent('popup');
    await app.page.evaluate(id => { window.qaPrivateAction = window.openPaymentDocument(id); }, installmentId);
    const popup = await popupEvent;
    await receipt.received;
    receipt.release();
    await app.page.evaluate(() => window.qaPrivateAction);
    assert.match(await popup.locator('body').innerText(), /LOCATAIRE_CONFIDENTIEL_FIXTURE/);
    assert.match(await popup.locator('body').innerText(), /400,00/);
    const request = app.requests.find(req => req.action === 'receipt-preview');
    assert.equal(JSON.parse(request.body).installment_id, installmentId);
    assert.equal(request.authorization, 'Bearer synthetic-fixture-token');
    await popup.close();
  } finally { receipt.release(); }
  assert.equal(await app.page.locator('#app').isVisible(), true);
  assert.equal(await app.page.locator('#login').isVisible(), false);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});

test('Navigateur : un dépôt autorisé conserve les champs et la frontière multipart du navigateur', { timeout: 30000 }, async t => {
  const app = await openApp(t, { pageName: 'documents' });
  await app.page.evaluate(() => {
    const send = window.fetch.bind(window);
    window.fetch = (resource, init) => {
      if (new URL(resource).searchParams.get('action') === 'document-upload') {
        const body = init.body, multipart = body instanceof FormData, file = multipart && body.get('file');
        window.qaUploadPayload = {
          multipart, explicitContentType: new Headers(init.headers).get('content-type'),
          propertyId: multipart && body.get('property_id'), label: multipart && body.get('label'),
          file: file && { name: file.name, type: file.type, size: file.size },
        };
        window.qaUploadFileText = file && typeof file.text === 'function' ? file.text() : Promise.resolve(null);
      }
      return send(resource, init);
    };
  });
  await app.page.evaluate(() => window.openDocumentUploader());
  await app.page.locator('#document-label').fill('Archive de test');
  await app.page.locator('#document-file').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await app.page.evaluate(() => window.uploadRentalDocument());
  const uploads = app.requests.filter(req => req.action === 'document-upload');
  assert.equal(uploads.length, 1);
  const request = uploads[0], boundary = request.contentType.match(/^multipart\/form-data;\s*boundary="?([^";]+)"?$/i)?.[1];
  assert.ok(boundary, 'La frontière multipart doit être créée par le navigateur');
  assert.equal(request.authorization, 'Bearer synthetic-fixture-token');
  const payload = await app.page.evaluate(async () => ({ ...window.qaUploadPayload, text: await window.qaUploadFileText }));
  assert.equal(payload.multipart, true);
  assert.equal(payload.explicitContentType, null, 'Le code applicatif ne doit pas imposer de Content-Type au FormData');
  assert.equal(payload.propertyId, propertyId);
  assert.equal(payload.label, 'Archive de test');
  assert.deepEqual(payload.file, { name: 'fixture.pdf', type: 'application/pdf', size: Buffer.byteLength('%PDF-1.4\n%%EOF') });
  assert.equal(payload.text, '%PDF-1.4\n%%EOF');
  assert.equal(await app.page.locator('#modal').innerHTML(), '');
  assert.equal(await app.page.locator('#pageTitle').innerText(), 'Documents');
  assert.equal(await app.page.locator('#app').isVisible(), true);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
});
