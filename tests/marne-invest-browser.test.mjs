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
  ['dashboard', 'Dashboard'], ['pilotage', 'Mise en service'], ['properties', 'Mes Biens'],
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
      permissions: readOnly ? { readonly: true, marne_invest: true } : {}, read_only: readOnly, payment_access: true,
      payment_void_access: true, work_access: true, document_access: true, bank_access: true,
      mail_access: true, mail_configured: false, mail_account: 'fixture@free.fr',
    },
    settings: [{ setting_key: 'sender_email', value: 'fixture@free.fr' }],
    tenants: [{ id: tenantId, property_id: propertyId, row_number: 2, data: {
      Locataire: 'Locataire Test', Logement: 'Logement Test', 'Mail locataire': 'fixture@example.test',
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
    tenant_headers: ['Locataire', 'Mail locataire', 'Logement', 'Adresse logement', 'Date entrée locataire', 'Date fin de bail', 'Loyer de base', 'Charge', 'Notes'],
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
  authenticated = true, fallback = false, apiHandler = null, irlResponse = null, confirmDialogs = [] } = {}) {
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
      if (irlResponse) await irlResponse;
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
      if (apiHandler) {
        try {
          const reply = await apiHandler({ action, request: req, data });
          if (reply) {
            if (reply.status >= 400) expectedHttpStatuses.add(reply.status);
            return json(reply.body, reply.status || 200);
          }
        } catch (error) {
          errors.push('Réponse fictive ' + action + ' : ' + error.message);
          return json({ error: 'Réponse fictive invalide' }, 500);
        }
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
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    if (dialog.type() === 'confirm' && confirmDialogs.some(pattern => pattern.test(dialog.message()))) await dialog.accept();
    else await dialog.dismiss();
  });
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

function setupScenario(data = fixture({ empty: true })) {
  const apiHandler = async ({ action, request }) => {
    if (request.method() !== 'POST') return null;
    const body = request.postDataJSON();
    if (action === 'save-site-config') {
      for (const [setting_key, value] of Object.entries(body.settings)) {
        const existing = data.settings.find(row => row.setting_key === setting_key);
        if (existing) existing.value = value;
        else data.settings.push({ setting_key, value });
      }
      data.current_user.mail_account = body.settings.sender_email;
      return { body: { ok: true, updated_fields: Object.keys(body.settings) } };
    }
    if (action === 'mail-configure') {
      data.current_user.mail_configured = true;
      data.mail_sync_state = { imap_verified_at: null, smtp_verified_at: null };
      return { body: { ok: true, stored: true, connection_test_required: true } };
    }
    if (action === 'new-property') {
      const property = { id: propertyId, name: body.name, is_example: false,
        data: { 'Nom du logement': body.name, Adresse: body.address, 'Champ historique': 'À conserver' },
        current_tenant: {}, tenant_history: [{ Locataire: 'Ancien dossier fictif' }], payment_schedule: [], source_sheet: 'fixture' };
      const rowNumber = Math.max(1, ...data.tenants.map(item => item.row_number)) + 1;
      const row = { id: data.tenants.length ? '10000000-0000-4000-8000-' + String(rowNumber).padStart(12, '0') : tenantId,
        row_number: rowNumber, property_id: propertyId,
        data: { Logement: body.name, 'Adresse logement': body.address, 'Champ historique': 'À conserver' } };
      data.properties.push(property); data.tenants.push(row);
      return { body: { ok: true, property, row } };
    }
    if (action === 'save-property') {
      const property = data.properties.find(row => row.id === body.id);
      if (!property) return { status: 404, body: { error: 'Bien fictif introuvable' } };
      property.name = body.name;
      Object.assign(property.data, body.data, { 'Nom du logement': body.name });
      return { body: { ok: true, item: property } };
    }
    if (action === 'save-tenant') {
      let row = data.tenants.find(item => item.id === body.id);
      if (!row) {
        const rowNumber = Math.max(1, ...data.tenants.map(item => item.row_number)) + 1;
        row = { id: data.tenants.length ? '10000000-0000-4000-8000-' + String(rowNumber).padStart(12, '0') : tenantId,
          row_number: rowNumber, property_id: null, data: {} };
        data.tenants.push(row);
      }
      row.property_id = body.property_id || null;
      Object.assign(row.data, body.data);
      const property = data.properties.find(item => item.id === row.property_id);
      if (property) row.data.Logement = property.name;
      return { body: { ok: true, item: row } };
    }
    if (action === 'prepare-lease') {
      const existing = data.leases.find(row => row.tenant_row_id === body.tenant_row_id && row.status !== 'closed');
      if (existing) return { body: { ok: true, lease: existing, already_exists: true } };
      const tenant = data.tenants.find(row => row.id === body.tenant_row_id);
      if (!tenant?.property_id) return { status: 409, body: { error: 'Locataire fictif sans logement' } };
      const lease = { id: leaseId, property_id: tenant.property_id, tenant_row_id: tenant.id,
        tenant_name: tenant.data.Locataire, status: 'draft', verified_at: null,
        start_date: null, end_date: null, monthly_rent: null, charges_amount: null, due_day: null,
        lease_kind: 'unverified', issuer_name: null, issuer_address: null, receipt_email_consent: false };
      data.leases.push(lease);
      return { body: { ok: true, lease, already_exists: false } };
    }
    if (action === 'save-lease') {
      const lease = data.leases.find(row => row.id === body.id);
      if (!lease || lease.status !== 'draft') return { status: 409, body: { error: 'Bail fictif non modifiable' } };
      for (const key of ['start_date', 'end_date', 'lease_kind', 'issuer_name', 'issuer_address', 'receipt_email_consent', 'notes']) {
        lease[key] = body[key];
      }
      for (const key of ['monthly_rent', 'charges_amount', 'due_day']) lease[key] = body[key] === '' ? null : Number(body[key]);
      let installmentsCreated = 0;
      if (body.activate) {
        lease.status = 'active'; lease.verified_at = data.server_time;
        const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date(data.server_time));
        const [year, month] = currentMonth.split('-').map(Number);
        const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
        for (const [index, period] of [currentMonth, nextMonth].entries()) {
          data.installments.push({ id: index ? '00000000-0000-4000-8000-000000000007' : installmentId,
            lease_id: lease.id, property_id: lease.property_id, period: period + '-01',
            due_on: period + '-' + String(lease.due_day).padStart(2, '0'), rent_amount: lease.monthly_rent,
            charges_amount: lease.charges_amount, total_due: lease.monthly_rent + lease.charges_amount, status: 'scheduled' });
          installmentsCreated++;
        }
      }
      return { body: { ok: true, lease, installments_created: installmentsCreated, skipped_partial_months: 0, partial_periods: [] } };
    }
    if (action === 'generate-installment') {
      const lease = data.leases.find(row => row.id === body.lease_id);
      const period = body.period + '-01';
      const previous = data.installments.find(row => row.lease_id === body.lease_id && row.period === period);
      if (previous) return { body: { ok: true, installment: previous, already_exists: true } };
      const installment = { id: installmentId, lease_id: lease.id, property_id: lease.property_id,
        period, due_on: body.period + '-' + String(lease.due_day).padStart(2, '0'),
        rent_amount: lease.monthly_rent, charges_amount: lease.charges_amount,
        total_due: lease.monthly_rent + lease.charges_amount, status: 'scheduled' };
      data.installments.push(installment);
      return { body: { ok: true, installment, already_exists: false } };
    }
    if (action === 'close-lease') {
      const lease = data.leases.find(row => row.id === body.id);
      if (!lease || lease.status !== 'active') return { status: 409, body: { error: 'Bail fictif non actif' } };
      if (!body.confirmed || !body.final_month_confirmed) return { status: 400, body: { error: 'Confirmation fictive manquante' } };
      lease.status = 'closed'; lease.end_date = body.end_date;
      return { body: { ok: true, lease, already_closed: false, cancelled_installments: 0,
        cancelled_reminders: 0, cancelled_irl_applications: 0, partial_final_month: true } };
    }
    if (action === 'save-partial-installment') {
      const lease = data.leases.find(row => row.id === body.lease_id);
      const period = body.period + '-01';
      let item = data.installments.find(row => row.lease_id === body.lease_id && row.period === period);
      const created = !item, rent = Number(body.rent_amount), charges = Number(body.charges_amount);
      const updated = !!item && (item.rent_amount !== rent || item.charges_amount !== charges);
      if (!item) {
        item = { id: installmentId, lease_id: lease.id, property_id: lease.property_id, period,
          due_on: body.period === lease.start_date.slice(0, 7) ? lease.start_date : period, status: 'scheduled' };
        data.installments.push(item);
      }
      Object.assign(item, { rent_amount: rent, charges_amount: charges, total_due: rent + charges });
      return { body: { ok: true, item, created, updated } };
    }
    return null;
  };
  return { data, apiHandler };
}

function writtenActions(app) {
  return app.requests.filter(request => request.method === 'POST').map(request => request.action);
}

function assertSetupRequests(app) {
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
  assert.equal(app.requests.some(request => ['mail-send', 'mail-sync', 'mail-test', 'record-payment'].includes(request.action)), false);
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
  assert.match(await app.page.locator('#content').innerText(), /Réception IMAP : vérifiée · Envoi SMTP : vérifié/);
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

test('Navigateur : un logement prêt exige le locataire exact, les coordonnées et les conditions du bail en cours', async t => {
  const data = fixture();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
  data.leases[0].start_date = day(-30);
  const completeLease = { ...data.leases[0] };
  const app = await openApp(t, { data, pageName: 'pilotage' });
  const panel = app.page.locator('section.release-block').filter({ hasText: 'Préparation des 1 logements' });
  assert.match(await panel.locator('.section-head strong').innerText(), /1\s*\/\s*1 prêts \(100 %\)/);
  for (const lease of [
    { tenant_row_id: 'another-tenant', start_date: day(-30), end_date: null },
    { tenant_row_id: tenantId, start_date: day(1), end_date: null },
    { tenant_row_id: tenantId, start_date: day(-30), end_date: day(-1) },
    { issuer_name: '' },
    { issuer_address: '' },
    { lease_kind: 'unverified' },
    { monthly_rent: -1 },
  ]) {
    Object.assign(data.leases[0], completeLease, lease);
    await app.page.evaluate(() => window.refresh());
    assert.match(await panel.locator('.section-head strong').innerText(), /0\s*\/\s*1 prêts \(0 %\)/);
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
  }
  Object.assign(data.leases[0], completeLease);
  data.properties[0].data.Adresse = '';
  await app.page.evaluate(() => window.refresh());
  assert.match(await panel.locator('.section-head strong').innerText(), /0\s*\/\s*1 prêts \(0 %\)/);
  assert.match(await panel.innerText(), /adresse du bien/);
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

test('Navigateur : la messagerie distingue un rattrapage en cours de sa fin', async t => {
  const data = fixture();
  data.current_user.mail_configured = true;
  data.mail_sync_state = { imap_verified_at: data.server_time, smtp_verified_at: data.server_time,
    last_sync_at: data.server_time, catchup_pending: true };
  const app = await openApp(t, { data, pageName: 'mail' });
  assert.match(await app.page.locator('#content').innerText(), /Rattrapage en cours/);
  assert.doesNotMatch(await app.page.locator('#content').innerText(), /Rattrapage terminé/);
  data.mail_sync_state.catchup_pending = false;
  await app.page.evaluate(() => window.refresh());
  assert.match(await app.page.locator('#content').innerText(), /Rattrapage terminé pour les messages disponibles au début du dernier passage/);
  assert.doesNotMatch(await app.page.locator('#content').innerText(), /Rattrapage en cours/);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
  assert.ok(app.requests.every(req => req.method === 'GET'));
});

test('Navigateur : les en-têtes seuls et le texte tronqué sont signalés dans la liste et le lecteur', { timeout: 30000 }, async t => {
  const data = fixture();
  const app = await openApp(t, { data, pageName: 'mail' });
  for (const [bodyStatus, bodyNote, label, reason] of [
    ['metadata_only', 'size_limit', /En-têtes seuls/, /trop volumineux.*en-têtes/i],
    ['metadata_only', 'no_text_part', /En-têtes seuls/, /ne contient pas de version texte.*en-têtes/i],
    ['truncated', 'text_limit', /Texte tronqué/, /Texte tronqué après 30 000 caractères/],
  ]) {
    Object.assign(data.mail_inbox[0], { body_status: bodyStatus, body_note: bodyNote });
    await app.page.evaluate(() => window.refresh());
    assert.match(await app.page.locator('.mail-item').innerText(), label);
    const held = app.delayAction('mail-message', { status: 200, body: { item: {
      ...data.mail_inbox[0], subject: 'Contenu limité de test',
      plain_body: bodyStatus === 'truncated' ? 'EXTRAIT_LIMITE_FIXTURE' : 'TEXTE_A_NE_PAS_AFFICHER_FIXTURE',
    } } });
    try {
      held.release();
      await app.page.evaluate(id => window.openFreeInboxMail(id), mailId);
      assert.match(await app.page.locator('#mailReader .note').innerText(), reason);
      assert.match(await app.page.locator('#mailReader .note').innerText(), /Free/);
      if (bodyStatus === 'metadata_only') {
        assert.equal(await app.page.locator('#mailReader .mail-text').count(), 0);
        assert.doesNotMatch(await app.page.locator('#mailReader').innerText(), /TEXTE_A_NE_PAS_AFFICHER_FIXTURE/);
      } else {
        assert.equal(await app.page.locator('#mailReader .mail-text').innerText(), 'EXTRAIT_LIMITE_FIXTURE');
      }
    } finally { held.release(); }
  }
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.unexpected, []);
  assert.ok(app.requests.every(req => req.method === 'GET'));
});

test('Navigateur : paramètres, bien et locataire permettent de préparer puis activer une location fictive', { timeout: 60000 }, async t => {
  const scenario = setupScenario();
  const app = await openApp(t, { ...scenario, pageName: 'pilotage', confirmDialogs: [/bail signé/, /Créer une échéance/] });
  for (const name of ['1. Paramètres communs', '2. Fiches biens', '3. Fiches locataires et baux']) {
    assert.equal(await app.page.getByRole('heading', { name, exact: true }).count(), 1);
  }
  await app.page.getByRole('button', { name: 'Ouvrir Paramètres', exact: true }).click();
  const settings = { landlord_name: 'Bailleur fictif', landlord_address: '1 rue fictive, 75001 Paris',
    owner_email: 'bailleur@example.test', sender_email: 'fixture@free.fr', bank_account_label: 'Compte fictif de gestion' };
  for (const [key, value] of Object.entries(settings)) await app.page.locator('#central-' + key).fill(value);
  await app.page.locator('#central-mail-password').fill('secret-entierement-fictif');
  await app.page.locator('#central-config-save').click();
  await app.page.locator('#central-config-status').filter({ hasText: /Paramètres enregistrés/ }).waitFor();
  assert.equal(await app.page.locator('#central-mail-password').inputValue(), '');
  assert.deepEqual(writtenActions(app), ['save-site-config', 'mail-configure']);
  const config = JSON.parse(app.requests.find(request => request.action === 'save-site-config').body);
  assert.deepEqual(config, { settings });
  assert.equal(JSON.stringify(scenario.data.settings).includes('secret-entierement-fictif'), false);

  await visit(app.page, 'properties');
  await app.page.getByRole('button', { name: /Ajouter un logement/ }).click();
  await app.page.locator('#npName').fill('Appartement de recette');
  await app.page.locator('#npAddress').fill('2 rue provisoire');
  await app.page.getByRole('button', { name: 'Créer le logement et sa ligne', exact: true }).click();
  await app.page.locator('.property-card').filter({ hasText: 'Appartement de recette' }).waitFor();
  assert.equal(scenario.data.properties.length, 1);
  assert.equal(scenario.data.tenants.length, 1);
  assert.equal(scenario.data.leases.length, 0);
  await app.page.getByRole('button', { name: 'Ouvrir le bien', exact: true }).click();
  await app.page.locator('#modal [onclick*="openPropertyEditor"]').click();
  await app.page.locator('[data-property-key="Adresse"]').fill('2 rue fictive');
  await app.page.locator('[data-property-key="Ville"]').fill('Paris');
  await app.page.locator('[data-property-key="Code postal"]').fill('75002');
  await app.page.locator('[data-property-key="Type de bien"]').fill('Studio');
  await app.page.locator('#property-notes').fill('Dossier de test uniquement');
  await app.page.locator('#property-save').click();
  await app.page.locator('#property-save').waitFor({ state: 'detached' });
  assert.equal(scenario.data.properties[0].data.Adresse, '2 rue fictive');
  assert.equal(scenario.data.properties[0].data['Champ historique'], 'À conserver');
  assert.deepEqual(scenario.data.properties[0].tenant_history, [{ Locataire: 'Ancien dossier fictif' }]);
  const propertyWrite = JSON.parse(app.requests.find(request => request.action === 'save-property').body);
  assert.equal(propertyWrite.id, propertyId);
  assert.equal('tenant_history' in propertyWrite, false);
  assert.equal('payment_schedule' in propertyWrite, false);

  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'tenants');
  await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  assert.equal(await app.page.locator('#tenant-property').inputValue(), propertyId);
  assert.equal(await app.page.locator('#lease-day').inputValue(), '');
  assert.equal(await app.page.locator('#lease-kind').inputValue(), 'unverified');
  assert.equal(await app.page.locator('#lease-issuer-name').inputValue(), settings.landlord_name);
  assert.equal(await app.page.locator('#lease-issuer-address').inputValue(), settings.landlord_address);
  assert.equal(await app.page.locator('#lease-email-consent').isChecked(), false);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const month = today.slice(0, 7);
  await app.page.locator('#tenant-name').fill('Alice Fixture');
  await app.page.locator('#tenant-email').fill('alice@example.test');
  await app.page.locator('#tenant-phone').fill('0600000000');
  await app.page.locator('#tenant-notes').fill('Contacts fictifs');
  await app.page.locator('#lease-start').fill(month + '-01');
  await app.page.locator('#lease-rent').fill('650');
  await app.page.locator('#lease-charges').fill('0');
  await app.page.locator('#lease-day').fill('5');
  await app.page.locator('#lease-kind').selectOption('residential');
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche et brouillon de bail enregistrés/ }).waitFor();
  assert.equal(scenario.data.leases.length, 1);
  assert.equal(scenario.data.leases[0].status, 'draft');
  assert.equal(scenario.data.leases[0].charges_amount, 0);
  assert.equal(scenario.data.tenants[0].data['Champ historique'], 'À conserver');
  assert.equal(scenario.data.installments.length, 0);
  await app.page.locator('#tenant-activate').click();
  await app.page.locator('#modalStatus').filter({ hasText: /bail activé/ }).waitFor();
  assert.equal(scenario.data.tenants.length, 1);
  assert.equal(scenario.data.leases.length, 1);
  assert.equal(scenario.data.leases[0].status, 'active');
  assert.equal(scenario.data.leases[0].tenant_row_id, tenantId);
  assert.equal(scenario.data.leases[0].issuer_address, settings.landlord_address);
  assert.equal(scenario.data.installments.length, 2);
  assert.match(await app.page.locator('#modalStatus').innerText(), /2 échéance/);
  assert.equal(await app.page.locator('#lease-rent').isDisabled(), true);
  assert.deepEqual(writtenActions(app).filter(action => ['save-tenant', 'prepare-lease', 'save-lease'].includes(action)),
    ['save-tenant', 'prepare-lease', 'save-lease', 'save-tenant', 'prepare-lease', 'save-lease']);

  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'pilotage');
  const readiness = app.page.locator('section.release-block').filter({ hasText: 'Préparation des 1 logements' });
  assert.match(await readiness.locator('.section-head strong').innerText(), /1\s*\/\s*1 prêts \(100 %\)/);
  await visit(app.page, 'contracts');
  await app.page.locator('#content [onclick*="editLease"]').click();
  await app.page.locator('#installment-month').fill(month);
  await app.page.getByRole('button', { name: 'Créer une échéance', exact: true }).click();
  await app.page.locator('#modalStatus').filter({ hasText: /Échéance déjà existante/ }).waitFor();
  assert.equal(scenario.data.installments.length, 2);
  assert.equal(scenario.data.installments[0].total_due, 650);
  assert.deepEqual(scenario.data.payments, []);
  assert.deepEqual(scenario.data.payment_allocations, []);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'transactions');
  await app.page.getByRole('button', { name: '+ Enregistrer un paiement', exact: true }).click();
  assert.equal(await app.page.locator('#payment-lease').inputValue(), leaseId);
  assert.equal(await app.page.locator('#payment-installment option[value="' + installmentId + '"]').count(), 1);
  await app.page.evaluate(() => window.closeModal());
  await app.page.getByRole('button', { name: 'Importer un relevé CSV', exact: true }).click();
  assert.equal(await app.page.locator('#bank-account-label').inputValue(), settings.bank_account_label);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'documents');
  await app.page.getByRole('button', { name: '+ Déposer un document', exact: true }).click();
  assert.equal(await app.page.locator('#document-property').inputValue(), propertyId);
  assert.equal(await app.page.locator('#document-lease option[value="' + leaseId + '"]').count(), 1);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'works');
  await app.page.getByRole('button', { name: '+ Signaler une intervention', exact: true }).click();
  assert.equal(await app.page.locator('#work-property').inputValue(), propertyId);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'emails');
  await app.page.getByRole('button', { name: 'Rédiger', exact: true }).click();
  assert.equal(await app.page.locator('#mailTo').inputValue(), 'alice@example.test');
  assert.match(await app.page.locator('#modal').innerText(), /fixture@free\.fr/);
  assert.equal(app.dialogs.filter(message => /bail signé/.test(message)).length, 1);
  assertSetupRequests(app);
});

test('Navigateur : un bail incomplet et un contact invalide restent à corriger avant toute écriture', async t => {
  const data = fixture();
  Object.assign(data.leases[0], { status: 'draft', verified_at: null, start_date: null, monthly_rent: null,
    charges_amount: null, due_day: null, lease_kind: 'unverified', issuer_name: '', issuer_address: '' });
  const app = await openApp(t, { data, pageName: 'tenants' });
  await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  for (const id of ['lease-start', 'lease-rent', 'lease-charges']) {
    assert.equal(await app.page.locator('#' + id).inputValue(), '', 'Une valeur historique ne remplit pas un champ effacé dans le bail');
  }
  await app.page.locator('#tenant-activate').click();
  assert.match(await app.page.locator('#modalStatus').innerText(), /À compléter avant activation/);
  assert.match(await app.page.locator('#modalStatus').innerText(), /loyer|charges|bailleur/);
  await app.page.locator('#tenant-email').fill('adresse-invalide');
  await app.page.locator('#tenant-save').click();
  assert.match(await app.page.locator('#modalStatus').innerText(), /Corrigez.*E-mail/);
  assert.deepEqual(writtenActions(app), []);
  assert.equal(data.leases[0].status, 'draft');
  assertSetupRequests(app);
});

test('Navigateur : un échec de préparation du bail distingue la fiche enregistrée et permet de reprendre', async t => {
  const data = fixture();
  Object.assign(data.leases[0], { status: 'draft', verified_at: null });
  const scenario = setupScenario(data);
  const app = await openApp(t, { ...scenario, pageName: 'tenants' });
  await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  await app.page.locator('#tenant-notes').fill('Coordonnées conservées après incident fictif');
  const held = app.delayAction('save-lease', { status: 503, body: { error: 'Bail temporairement indisponible dans le test' } });
  held.release();
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche enregistrée.*bail reste à terminer/ }).waitFor();
  assert.equal(data.tenants[0].data.Notes, 'Coordonnées conservées après incident fictif');
  assert.equal(data.leases[0].status, 'draft');
  assert.equal(await app.page.locator('#tenant-save').isEnabled(), true);
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche et brouillon de bail enregistrés/ }).waitFor();
  assert.equal(data.tenants.length, 1);
  assert.equal(data.leases.length, 1);
  assert.deepEqual(writtenActions(app), ['save-tenant', 'prepare-lease', 'save-lease', 'save-tenant', 'prepare-lease', 'save-lease']);
  assertSetupRequests(app);
});

test('Navigateur : reprendre une nouvelle fiche partiellement enregistrée ne crée aucun doublon', async t => {
  const data = fixture({ empty: true });
  data.properties = fixture().properties;
  const scenario = setupScenario(data);
  const app = await openApp(t, { ...scenario, pageName: 'tenants' });
  await app.page.getByRole('button', { name: '+ Nouveau locataire', exact: true }).click();
  await app.page.locator('#tenant-property').selectOption(propertyId);
  await app.page.locator('#tenant-name').fill('Nouveau dossier fictif');
  await app.page.locator('#tenant-email').fill('nouveau@example.test');
  await app.page.locator('#lease-rent').fill('725');
  await app.page.locator('#lease-charges').fill('0');
  await app.page.locator('#lease-day').fill('7');
  await app.page.locator('#lease-notes').fill('Conditions saisies à conserver après la panne');
  const held = app.delayAction('save-lease', { status: 503, body: { error: 'Panne fictive après création de la fiche' } });
  held.release();
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche enregistrée.*bail reste à terminer/ }).waitFor();
  assert.equal(data.tenants.length, 1);
  assert.equal(data.leases.length, 1);
  assert.equal(await app.page.locator('#tenant-save').getAttribute('data-id'), tenantId);
  assert.equal(await app.page.locator('#tenant-activate').getAttribute('data-id'), tenantId);
  assert.equal(await app.page.locator('#lease-rent').inputValue(), '725');
  assert.equal(await app.page.locator('#lease-notes').inputValue(), 'Conditions saisies à conserver après la panne');
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche et brouillon de bail enregistrés/ }).waitFor();
  assert.equal(data.tenants.length, 1);
  assert.equal(data.leases.length, 1);
  assert.equal(data.leases[0].monthly_rent, 725);
  assert.equal(data.leases[0].charges_amount, 0);
  const saves = app.requests.filter(request => request.action === 'save-tenant').map(request => JSON.parse(request.body));
  assert.equal(saves.length, 2);
  assert.equal(saves[0].id || '', '');
  assert.equal(saves[1].id, tenantId);
  assertSetupRequests(app);
});

test('Navigateur : le locataire du bail prime sur une ancienne ligne vide ou un dossier ambigu', async t => {
  const data = fixture();
  const named = data.tenants[0];
  const blank = { id: 'blank-fixture', row_number: 1, property_id: propertyId, data: { Logement: 'Logement Test' } };
  const other = { id: 'other-fixture', row_number: 3, property_id: propertyId, data: { Locataire: 'Autre locataire fictif', Logement: 'Logement Test' } };
  data.tenants = [blank, other, named];
  const app = await openApp(t, { data, pageName: 'properties' });
  const card = app.page.locator('.property-card');
  assert.match(await card.innerText(), /Locataire Test/);
  assert.doesNotMatch(await card.innerText(), /Autre locataire fictif|Aucun locataire/);
  Object.assign(data.leases[0], { status: 'draft', verified_at: null });
  await app.page.evaluate(() => window.refresh());
  assert.match(await card.innerText(), /Locataire Test/);
  data.leases = []; data.tenants = [blank, named];
  await app.page.evaluate(() => window.refresh());
  assert.match(await card.innerText(), /Locataire Test/);
  data.tenants.push(other);
  await app.page.evaluate(() => window.refresh());
  assert.doesNotMatch(await card.innerText(), /Locataire Test|Autre locataire fictif/);
  data.tenants = [blank, named];
  Object.assign(named.data, { 'Loyer de base': -5, Charge: -8, 'Date entrée locataire': 'pas une date', 'Mail locataire': 'invalide' });
  await app.page.evaluate(() => window.refresh());
  assert.match(await card.locator('.mini-tag').innerText(), /1\/5 champs/);
  assert.deepEqual(writtenActions(app), []);
  assertSetupRequests(app);
});

test('Navigateur : une réponse IRL tardive conserve les paramètres et le secret encore saisis', async t => {
  let release;
  const irlResponse = new Promise(resolve => { release = resolve; });
  const app = await openApp(t, { pageName: 'config', irlResponse, viewport: { width: 390, height: 844 } });
  try {
    await app.page.locator('#central-landlord_name').fill('Saisie à préserver');
    await app.page.locator('#central-landlord_address').fill('Adresse non encore enregistrée');
    await app.page.locator('#central-mail-password').fill('secret-fictif-non-enregistre');
    release();
    await app.page.locator('#config-irl-live').filter({ hasText: /Indice INSEE vérifié/ }).waitFor();
    assert.equal(await app.page.locator('#central-landlord_name').inputValue(), 'Saisie à préserver');
    assert.equal(await app.page.locator('#central-landlord_address').inputValue(), 'Adresse non encore enregistrée');
    assert.equal(await app.page.locator('#central-mail-password').inputValue(), 'secret-fictif-non-enregistre');
    const size = await app.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(size.scroll <= size.width + 1);
    assert.deepEqual(writtenActions(app), []);
    assertSetupRequests(app);
  } finally { release(); }
});

test('Navigateur : mettre à jour un contact conserve les conditions et les règlements des baux actifs ou clos', async t => {
  for (const state of ['active', 'closed']) {
    const data = fixture();
    data.leases[0].status = state;
    if (state === 'closed') data.leases[0].end_date = '2026-11-20';
    const originalLease = structuredClone(data.leases[0]);
    const originalPayments = structuredClone(data.payments);
    const scenario = setupScenario(data);
    const app = await openApp(t, { ...scenario, pageName: 'tenants' });
    await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
    assert.equal(await app.page.locator('#tenant-property').isDisabled(), true);
    assert.equal(await app.page.locator('#lease-rent').isDisabled(), true);
    assert.equal(await app.page.locator('#lease-issuer-name').isDisabled(), true);
    assert.equal(await app.page.locator('#tenant-activate').count(), 0);
    await app.page.locator('#tenant-email').fill('nouveau-contact@example.test');
    await app.page.locator('#tenant-phone').fill('0611111111');
    await app.page.locator('#tenant-save').click();
    await app.page.locator('#modalStatus').filter({ hasText: 'Fiche enregistrée.' }).waitFor();
    assert.equal(await app.page.locator('#tenant-email').inputValue(), 'nouveau-contact@example.test');
    assert.deepEqual(data.leases[0], originalLease);
    assert.deepEqual(data.payments, originalPayments);
    assert.deepEqual(writtenActions(app), ['save-tenant']);
    assertSetupRequests(app);
  }
});

test('Navigateur : clôturer un bail demande le dernier mois vérifié et conserve les règlements antérieurs', async t => {
  const data = fixture();
  const before = structuredClone({ installments: data.installments, payments: data.payments, allocations: data.payment_allocations });
  const scenario = setupScenario(data);
  const app = await openApp(t, { ...scenario, pageName: 'tenants', confirmDialogs: [/clôtur/i] });
  await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  await app.page.getByRole('button', { name: 'Clôturer le bail', exact: true }).click();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await app.page.locator('#lease-close-date').fill(today);
  await app.page.locator('#lease-close-save').click();
  assert.equal(writtenActions(app).includes('close-lease'), false);
  assert.match(await app.page.locator('#modalStatus').innerText(), /dernier mois|confirm|vérifi/i);
  await app.page.locator('#lease-close-final-confirm').check();
  await app.page.locator('#lease-close-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /clôturé/i }).waitFor();
  const closure = JSON.parse(app.requests.find(request => request.action === 'close-lease').body);
  assert.deepEqual(closure, { id: leaseId, end_date: today, confirmed: true, final_month_confirmed: true });
  assert.equal(data.leases[0].status, 'closed');
  assert.equal(data.leases[0].end_date, today);
  assert.deepEqual({ installments: data.installments, payments: data.payments, allocations: data.payment_allocations }, before);
  assert.deepEqual(writtenActions(app), ['close-lease']);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'transactions');
  assert.match(await app.page.locator('#content').innerText(), /400,00/);
  await visit(app.page, 'documents');
  assert.equal(await app.page.locator('#content [onclick*="openPaymentDocument"]').count(), 1);
  assertSetupRequests(app);
});

test('Navigateur : les mois incomplets exigent des montants saisis et une confirmation propre à chaque période', async t => {
  const data = fixture();
  Object.assign(data.leases[0], { start_date: '2026-11-15', end_date: '2026-12-12' });
  data.installments = []; data.payments = []; data.payment_allocations = [];
  const contract = structuredClone(data.leases[0]);
  const scenario = setupScenario(data);
  const app = await openApp(t, { ...scenario, pageName: 'contracts' });
  await app.page.locator('#content [onclick*="editLease"]').click();
  await app.page.getByRole('button', { name: 'Renseigner un premier / dernier mois incomplet', exact: true }).click();
  assert.deepEqual(await app.page.locator('#partial-period option').evaluateAll(options => options.map(option => option.value)), ['2026-11', '2026-12']);
  assert.equal(await app.page.locator('#partial-rent').inputValue(), '');
  assert.equal(await app.page.locator('#partial-charges').inputValue(), '');
  assert.equal(await app.page.locator('#partial-confirmed').isChecked(), false);
  await app.page.locator('#partial-save').click();
  assert.match(await app.page.locator('#modalStatus').innerText(), /Renseignez les deux montants/);
  await app.page.locator('#partial-rent').fill('275.35');
  await app.page.locator('#partial-charges').fill('0');
  await app.page.locator('#partial-save').click();
  assert.match(await app.page.locator('#modalStatus').innerText(), /Confirmez les montants/);
  assert.deepEqual(writtenActions(app), []);
  await app.page.locator('#partial-confirmed').check();
  await app.page.locator('#partial-period').selectOption('2026-12');
  assert.equal(await app.page.locator('#partial-confirmed').isChecked(), false);
  assert.equal(await app.page.locator('#partial-rent').inputValue(), '');
  assert.equal(await app.page.locator('#partial-charges').inputValue(), '');
  await app.page.locator('#partial-period').selectOption('2026-11');
  await app.page.locator('#partial-rent').fill('275.35');
  await app.page.locator('#partial-charges').fill('0');
  await app.page.locator('#partial-confirmed').check();
  await app.page.locator('#partial-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Échéance du mois incomplet créée/ }).waitFor();
  assert.equal(data.installments.length, 1);
  assert.equal(data.installments[0].rent_amount, 275.35);
  assert.equal(data.installments[0].charges_amount, 0);
  assert.equal(data.installments[0].total_due, 275.35);
  assert.deepEqual(data.leases[0], contract);
  assert.deepEqual(data.payments, []);
  const body = JSON.parse(app.requests.find(request => request.action === 'save-partial-installment').body);
  assert.deepEqual(body, { lease_id: leaseId, period: '2026-11', rent_amount: '275.35', charges_amount: '0', confirmed: true });
  await app.page.getByRole('button', { name: 'Renseigner un premier / dernier mois incomplet', exact: true }).click();
  assert.equal(await app.page.locator('#partial-rent').inputValue(), '275.35');
  assert.equal(await app.page.locator('#partial-confirmed').isChecked(), false);
  await app.page.locator('#partial-confirmed').check();
  await app.page.locator('#partial-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Montants déjà enregistrés, aucun doublon/ }).waitFor();
  assert.equal(data.installments.length, 1);
  assert.deepEqual(writtenActions(app), ['save-partial-installment', 'save-partial-installment']);
  assertSetupRequests(app);
});

test('Navigateur : les coordonnées du bailleur peuvent être enregistrées sans configurer une messagerie', async t => {
  const scenario = setupScenario();
  const app = await openApp(t, { ...scenario, pageName: 'config' });
  await app.page.locator('#central-landlord_name').fill('Bailleur sans messagerie');
  await app.page.locator('#central-landlord_address').fill('Adresse fictive du bailleur');
  assert.equal(await app.page.locator('#central-sender_email').inputValue(), '');
  await app.page.locator('#central-mail-password').fill('secret-fictif-sans-compte');
  await app.page.locator('#central-config-save').click();
  assert.match(await app.page.locator('#central-config-status').innerText(), /adresse Free/);
  assert.deepEqual(writtenActions(app), []);
  await app.page.locator('#central-mail-password').fill('');
  await app.page.locator('#central-config-save').click();
  await app.page.locator('#central-config-status').filter({ hasText: /Paramètres enregistrés/ }).waitFor();
  assert.equal(await app.page.locator('#central-landlord_name').inputValue(), 'Bailleur sans messagerie');
  assert.equal(await app.page.locator('#central-landlord_address').inputValue(), 'Adresse fictive du bailleur');
  assert.equal(await app.page.locator('#central-sender_email').inputValue(), '');
  assert.equal(scenario.data.current_user.mail_configured, false);
  assert.deepEqual(writtenActions(app), ['save-site-config']);
  const body = JSON.parse(app.requests.find(request => request.action === 'save-site-config').body);
  assert.equal(body.settings.sender_email, '');
  assert.equal(body.settings.landlord_name, 'Bailleur sans messagerie');
  assert.equal(JSON.stringify(body).includes('secret-fictif-sans-compte'), false);
  assertSetupRequests(app);
});

test('Navigateur : une fiche sans bien conserve toutes les conditions saisies jusqu’à la préparation du bail', { timeout: 60000 }, async t => {
  const scenario = setupScenario();
  scenario.data.settings.push({ setting_key: 'landlord_name', value: 'Bailleur général' },
    { setting_key: 'landlord_address', value: 'Adresse générale' });
  const app = await openApp(t, { ...scenario, pageName: 'tenants' });
  await app.page.getByRole('button', { name: '+ Nouveau locataire', exact: true }).click();
  await app.page.locator('#tenant-name').fill('Nina Fixture');
  await app.page.locator('#tenant-email').fill('nina@example.test');
  const inputs = { start: '2026-11-15', end: '2027-08-27', rent: '432.10', charges: '25.50', day: '12',
    'issuer-name': 'Émetteur propre à ce dossier', 'issuer-address': 'Adresse propre à ce dossier', notes: 'Conditions provisoires conservées' };
  for (const [id, value] of Object.entries(inputs)) await app.page.locator('#lease-' + id).fill(value);
  await app.page.locator('#lease-kind').selectOption('parking');
  await app.page.locator('#lease-email-consent').check();
  assert.equal(await app.page.locator('#tenant-property').inputValue(), '');
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: 'Fiche enregistrée.' }).waitFor();
  assert.deepEqual(writtenActions(app), ['save-tenant']);
  assert.equal(scenario.data.tenants.length, 1);
  assert.equal(scenario.data.leases.length, 0);
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForFunction(() => document.querySelector('#serverTime')?.textContent.includes('Données actualisées'));
  await app.page.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  for (const [id, value] of Object.entries(inputs)) {
    const actual = await app.page.locator('#lease-' + id).inputValue();
    if (['rent', 'charges'].includes(id)) assert.equal(Number(actual), Number(value));
    else assert.equal(actual, value);
  }
  assert.equal(await app.page.locator('#lease-kind').inputValue(), 'parking');
  assert.equal(await app.page.locator('#lease-email-consent').isChecked(), true);
  await app.page.evaluate(() => window.closeModal());
  await visit(app.page, 'properties');
  await app.page.getByRole('button', { name: '+ Ajouter un logement', exact: true }).click();
  await app.page.locator('#npName').fill('Bien ajouté après le dossier');
  await app.page.locator('#npAddress').fill('Adresse fictive du nouveau bien');
  await app.page.getByRole('button', { name: 'Créer le logement et sa ligne', exact: true }).click();
  await app.page.locator('.property-card').filter({ hasText: 'Bien ajouté après le dossier' }).waitFor();
  await visit(app.page, 'tenants');
  await app.page.getByRole('row').filter({ hasText: 'Nina Fixture' }).getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  await app.page.locator('#tenant-property').selectOption(propertyId);
  await app.page.locator('#tenant-save').click();
  await app.page.locator('#modalStatus').filter({ hasText: /Fiche et brouillon de bail enregistrés/ }).waitFor();
  const lease = scenario.data.leases[0];
  assert.equal(scenario.data.leases.length, 1);
  assert.equal(lease.status, 'draft');
  assert.equal(lease.tenant_row_id, tenantId);
  assert.equal(lease.property_id, propertyId);
  assert.equal(lease.start_date, inputs.start);
  assert.equal(lease.end_date, inputs.end);
  assert.equal(lease.monthly_rent, 432.1);
  assert.equal(lease.charges_amount, 25.5);
  assert.equal(lease.due_day, 12);
  assert.equal(lease.lease_kind, 'parking');
  assert.equal(lease.issuer_name, inputs['issuer-name']);
  assert.equal(lease.issuer_address, inputs['issuer-address']);
  assert.equal(lease.receipt_email_consent, true);
  assert.equal(lease.notes, inputs.notes);
  assert.deepEqual(scenario.data.installments, []);
  assert.deepEqual(writtenActions(app), ['save-tenant', 'new-property', 'save-tenant', 'prepare-lease', 'save-lease']);
  assertSetupRequests(app);
});

test('Navigateur : les relances annulées ou périmées sont repréparées et la rédaction utilise le dernier solde vérifié', { timeout: 60000 }, async t => {
  for (const [status, stage] of [['cancelled', 7], ['prepared', 7], ['cancelled', 14], ['prepared', 14]]) {
    const data = fixture();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
    data.leases[0].start_date = day(-60);
    Object.assign(data.installments[0], { period: day(-21).slice(0, 7) + '-01', due_on: day(-21) });
    const reminderId = '00000000-0000-4000-8000-000000000008';
    const draft = { id: reminderId, lease_id: leaseId, installment_id: installmentId, stage, status,
      due_at_preparation: 650, recipient_email: 'ancien-contact@example.test', subject: 'Ancien rappel',
      body: 'ANCIEN_CORPS_A_EXCLURE', prepared_at: day(-12) + 'T12:00:00Z', declared_sent_at: null };
    data.reminder_drafts = stage === 14 ? [{ ...draft, id: '00000000-0000-4000-8000-000000000009',
      stage: 7, status: 'declared_sent', due_at_preparation: 250, declared_sent_at: day(-10) + 'T12:00:00Z' }, draft] : [draft];
    let preparations = 0;
    const apiHandler = async ({ action, request }) => {
      if (action !== 'prepare-reminder' || request.method() !== 'POST') return null;
      preparations++;
      if (preparations === 2) {
        data.payments.push({ ...data.payments[0], id: 'payment-additional-fixture', amount: 50, received_on: today });
        data.payment_allocations.push({ payment_id: 'payment-additional-fixture', installment_id: installmentId, amount: 50 });
        data.tenants[0].data['Mail locataire'] = 'contact-actualise@example.test';
      }
      Object.assign(draft, { status: 'prepared', due_at_preparation: preparations === 1 ? 250 : 200,
        recipient_email: data.tenants[0].data['Mail locataire'], prepared_at: data.server_time,
        subject: preparations === 1 ? 'Rappel repréparé' : 'Rappel revalidé avant rédaction',
        body: preparations === 1 ? 'CORPS_REPREPARE_250' : 'CORPS_REVALIDE_200' });
      return { body: { ok: true, id: reminderId, reprepared: true, already_exists: false } };
    };
    const app = await openApp(t, { data, apiHandler, pageName: 'emails' });
    assert.equal(await app.page.getByRole('button', { name: 'Ouvrir le brouillon', exact: true }).count(), 0);
    assert.equal(await app.page.getByRole('button', { name: 'Déclarer envoyé', exact: true }).count(), 0);
    await app.page.getByRole('button', { name: 'Repréparer J+' + stage, exact: true }).click();
    const openDraft = app.page.getByRole('button', { name: 'Ouvrir le brouillon', exact: true });
    await openDraft.waitFor();
    assert.equal(draft.due_at_preparation, 250);
    assert.equal(draft.status, 'prepared');
    await openDraft.click();
    await app.page.locator('#mailBody').waitFor();
    assert.equal(await app.page.locator('#mailBody').inputValue(), 'CORPS_REVALIDE_200');
    assert.equal(await app.page.locator('#mailSubject').inputValue(), 'Rappel revalidé avant rédaction');
    assert.equal(await app.page.locator('#mailTo').inputValue(), 'contact-actualise@example.test');
    assert.equal(draft.due_at_preparation, 200);
    assert.equal(draft.declared_sent_at, null);
    assert.deepEqual(writtenActions(app), ['prepare-reminder', 'prepare-reminder']);
    for (const request of app.requests.filter(request => request.action === 'prepare-reminder')) {
      assert.deepEqual(JSON.parse(request.body), { installment_id: installmentId, stage });
    }
    assert.deepEqual(data.mail_outbox, []);
    assertSetupRequests(app);
  }
});

test('Navigateur : la révision IRL exige une année cible explicitement choisie parmi les indices publiés', async t => {
  const data = fixture();
  data.leases[0].start_date = '2024-01-01';
  data.irl_indices = [
    { year: 2024, quarter: 4, geographic_scope: 'metropole', value: 140, published_on: '2025-01-15', source_url: origin + '/irl-fixture' },
    { year: 2025, quarter: 4, geographic_scope: 'metropole', value: 142, published_on: '2026-01-15', source_url: origin + '/irl-fixture' },
    { year: 2026, quarter: 4, geographic_scope: 'metropole', value: 144, published_on: '2027-01-15', source_url: origin + '/irl-fixture' },
  ];
  const originalLease = structuredClone(data.leases[0]);
  const apiHandler = async ({ action, request }) => {
    if (action !== 'save-irl-rule' || request.method() !== 'POST') return null;
    const { confirmed, ...values } = request.postDataJSON();
    const rule = { ...values, verified_at: data.server_time };
    data.irl_rules = [rule];
    return { body: { ok: true, lease_id: rule.lease_id } };
  };
  const app = await openApp(t, { data, apiHandler, pageName: 'contracts' });
  await app.page.getByRole('button', { name: 'Configurer / calculer', exact: true }).click();
  await app.page.locator('#irl-clause').check();
  await app.page.locator('#irl-dpe').selectOption('D');
  await app.page.locator('#irl-date').fill('2026-01-01');
  await app.page.locator('#irl-date').press('Tab');
  await app.page.locator('#irl-quarter').selectOption('4');
  assert.equal(await app.page.locator('#irl-target-year option[value="2025"]').count(), 0);
  assert.equal(await app.page.locator('#irl-target-year').inputValue(), '');
  await app.page.locator('#irl-verified').check();
  await app.page.locator('#irl-date').fill('2026-02-01');
  await app.page.locator('#irl-date').press('Tab');
  assert.equal(await app.page.locator('#irl-target-year option[value="2025"]').count(), 1);
  assert.equal(await app.page.locator('#irl-target-year option[value="2026"]').count(), 0);
  assert.equal(await app.page.locator('#irl-target-year').inputValue(), '', 'Une année disponible ne doit pas être supposée');
  assert.equal(await app.page.locator('#irl-clause').isChecked(), true);
  assert.equal(await app.page.locator('#irl-dpe').inputValue(), 'D');
  assert.equal(await app.page.locator('#irl-verified').isChecked(), false);
  await app.page.locator('#irl-verified').check();
  await app.page.getByRole('button', { name: 'Enregistrer les règles du bail', exact: true }).click();
  assert.match(await app.page.locator('#modalStatus').innerText(), /année|indice/i);
  assert.deepEqual(writtenActions(app), []);
  await app.page.locator('#irl-target-year').selectOption('2025');
  await app.page.getByRole('button', { name: 'Enregistrer les règles du bail', exact: true }).click();
  await app.page.getByRole('button', { name: 'Calculer la proposition', exact: true }).waitFor();
  assert.equal(await app.page.locator('#irl-target-year').inputValue(), '2025');
  assert.deepEqual(writtenActions(app), ['save-irl-rule']);
  const body = JSON.parse(app.requests.find(request => request.action === 'save-irl-rule').body);
  assert.deepEqual(body, { lease_id: leaseId, has_revision_clause: true, is_mobility_lease: false,
    dpe_rating: 'D', geographic_scope: 'metropole', revision_due_on: '2026-02-01',
    reference_quarter: 4, target_year: 2025, confirmed: true });
  assert.deepEqual(data.leases[0], originalLease);
  assertSetupRequests(app);
});

test('Navigateur : ajouter un indice historique confirmé conserve les paramètres encore non enregistrés', async t => {
  const data = fixture();
  const apiHandler = async ({ action, request }) => {
    if (action !== 'irl-register' || request.method() !== 'POST') return null;
    const body = request.postDataJSON();
    const item = { year: body.year, quarter: body.quarter, value: Number(body.value),
      published_on: body.published_on, source_url: body.source_url, geographic_scope: 'metropole' };
    data.irl_indices.push(item);
    return { body: { ok: true, item, already_exists: false } };
  };
  const app = await openApp(t, { data, apiHandler, pageName: 'config' });
  await app.page.locator('#central-landlord_name').fill('Coordonnées encore en cours de saisie');
  await app.page.locator('#central-landlord_address').fill('Adresse non enregistrée à conserver');
  await app.page.locator('#central-mail-password').fill('secret-fictif-non-enregistre');
  const dataLoads = app.requests.filter(request => request.action === 'data').length;
  await app.page.locator('#irl-register-form > summary').click();
  await app.page.locator('#irl-register-year').fill('2024');
  await app.page.locator('#irl-register-quarter').selectOption('4');
  await app.page.locator('#irl-register-value').fill('140.25');
  await app.page.locator('#irl-register-date').fill('2025-01-15');
  await app.page.locator('#irl-register-source').fill('https://www.insee.fr/fr/statistiques/1234567');
  await app.page.locator('#irl-register-save').click();
  assert.match(await app.page.locator('#irl-register-status').innerText(), /Confirmez la vérification/);
  assert.deepEqual(writtenActions(app), []);
  await app.page.locator('#irl-register-confirm').check();
  await app.page.locator('#irl-register-save').click();
  await app.page.locator('#irl-register-status').filter({ hasText: /Indice enregistré/ }).waitFor();
  assert.match(await app.page.locator('#irl-reference-panel').innerText(), /T4 2024/);
  assert.match(await app.page.locator('#irl-reference-panel').innerText(), /140[.,]25/);
  assert.equal(await app.page.locator('#central-landlord_name').inputValue(), 'Coordonnées encore en cours de saisie');
  assert.equal(await app.page.locator('#central-landlord_address').inputValue(), 'Adresse non enregistrée à conserver');
  assert.equal(await app.page.locator('#central-mail-password').inputValue(), 'secret-fictif-non-enregistre');
  assert.equal(app.requests.filter(request => request.action === 'data').length, dataLoads);
  assert.deepEqual(writtenActions(app), ['irl-register']);
  const body = JSON.parse(app.requests.find(request => request.action === 'irl-register').body);
  assert.deepEqual(body, { year: 2024, quarter: 4, value: '140.25', published_on: '2025-01-15',
    source_url: 'https://www.insee.fr/fr/statistiques/1234567', confirmed: true });
  assert.equal(JSON.stringify(body).includes('secret-fictif-non-enregistre'), false);
  assert.equal(data.irl_indices.length, 1);
  assertSetupRequests(app);
});
