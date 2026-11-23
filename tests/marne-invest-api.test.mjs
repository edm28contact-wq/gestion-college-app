import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const sourcePath = process.env.MARNE_API_SOURCE || new URL('../supabase/functions/rental-admin-api/index.ts', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(sourcePath, 'utf8').replace(/^import \{ createClient \}[^\n]*\n/, ''));
const leaseId = '11111111-1111-4111-8111-111111111111';
const propertyId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const otherPropertyId = '44444444-4444-4444-8444-444444444444';
const admin = { username: 'test-admin', role: 'admin', permissions: {} };
const draftLease = { id: leaseId, status: 'draft', property_id: propertyId, tenant_row_id: tenantId, tenant_name: 'Locataire de test' };
const validLeaseBody = {
  id: leaseId, start_date: '2026-01-01', end_date: null,
  monthly_rent: 500.50, charges_amount: 50, due_day: 5,
  lease_kind: 'residential', issuer_name: 'Bailleur de test', issuer_address: 'Adresse de test',
  receipt_email_consent: false, notes: '', activate: true,
};

function mockClient(overrides = {}, options = {}) {
  const data = structuredClone({
    rental_leases: [draftLease],
    rental_properties: [{ id: propertyId, is_example: false }],
    rental_tenant_rows: [{ id: tenantId, property_id: propertyId, data: { Locataire: 'Locataire de test' } }],
    ...overrides,
  });
  const calls = [], mutations = [];
  const client = {
    calls, mutations, data,
    from(table) {
      let operation = 'select', payload, single = false, head = false;
      const filters = [], orders = [];
      let from = 0, to = Infinity, wantsCount = false;
      const query = {
        select(fields, config) { head = !!config?.head; wantsCount = config?.count === 'exact'; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        gte(key, value) { filters.push(row => row[key] >= value); return query; },
        order(key, config) { orders.push([key, config?.ascending !== false]); return query; },
        limit(size) { to = size - 1; return query; },
        range(start, end) { from = start; to = end; return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        async then(resolve, reject) {
          try {
            calls.push({ table, operation, from, to, wantsCount });
            if (operation === 'insert') {
              if (options.insertResult) {
                const result = options.insertResult(table);
                if (result) return resolve(result);
              }
              mutations.push({ table, operation, payload });
              (data[table] ||= []).push(payload);
              return resolve({ data: single ? payload : [payload], error: null });
            }
            if (operation === 'update' && options.beforeUpdate) options.beforeUpdate(table, data);
            const rows = (data[table] || []).filter(row => filters.every(filter => filter(row)));
            if (operation === 'update') {
              if (options.updateResult) {
                const result = options.updateResult(table);
                if (result) return resolve(result);
              }
              if (rows.length) mutations.push({ table, operation, payload });
              rows.forEach(row => Object.assign(row, payload));
              return resolve({ data: single ? rows[0] || null : rows, error: null });
            }
            rows.sort((a, b) => {
              for (const [key, asc] of orders) {
                if (a[key] === b[key]) continue;
                return (a[key] < b[key] ? -1 : 1) * (asc ? 1 : -1);
              }
              return 0;
            });
            const result = { data: head ? null : single ? rows[0] || null : rows.slice(from, to + 1), count: wantsCount ? rows.length : null, error: null };
            return resolve(options.queryResult ? options.queryResult(table, result, { from, to }) : result);
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
    async rpc(name, params) {
      calls.push({ rpc: name, params });
      if(options.rpcResult){
        const result=options.rpcResult(name,params);
        if(result)return result;
      }
      if (name === 'marne_mail_password_exists') return { data: false, error: null };
      if (name === 'marne_run_health_check') return { data: { id: 'health-test', status: 'ok', critical_count: 0, warning_count: 0 }, error: null };
      if(name === 'marne_create_property_sheet'){
        const tenant=data.rental_tenant_rows.find(row=>row.row_number===params.p_row_number);
        const property=data.rental_properties.find(row=>row.id===tenant?.property_id);
        if(property)return {data:property,error:null};
      }
      throw new Error('Unexpected RPC in isolated test: ' + name);
    },
  };
  return client;
}

function runtime(client = mockClient(), account = admin) {
  const errors = [];
  const context = vm.createContext({
    Request, Response, URL, TextEncoder, TextDecoder, Uint8Array, AbortSignal,
    console: { error(...args) { errors.push(args); } }, errors, fixtureClient: client, fixtureAccount: account,
    fetch() { throw new Error('Network is forbidden in isolated API tests'); },
    Deno: { serve(handler) { context.handler = handler; }, env: { get() { return undefined; } } },
  });
  vm.runInContext(source + '\ndb = () => fixtureClient; verifyToken = async () => fixtureAccount;', context);
  return context;
}

async function request(context, action, body = {}, method = 'POST') {
  const response = await context.handler(new Request('https://example.invalid/api?action=' + action, {
    method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }));
  return { status: response.status, body: await response.json() };
}

test('Un bail actif ne peut pas être réécrit en réutilisant activate=true', async () => {
  const client = mockClient({ rental_leases: [{ ...draftLease, status: 'active' }] });
  const result = await request(runtime(client), 'save-lease', validLeaseBody);
  assert.equal(result.status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Un bail clôturé est protégé contre toute modification', async () => {
  const client = mockClient({ rental_leases: [{ ...draftLease, status: 'closed' }] });
  assert.equal((await request(runtime(client), 'save-lease', validLeaseBody)).status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Un brouillon correctement relié peut être activé une seule fois', async () => {
  const client = mockClient();
  const context = runtime(client);
  assert.equal((await request(context, 'save-lease', validLeaseBody)).status, 200);
  assert.equal(client.data.rental_leases[0].status, 'active');
  assert.equal(client.data.rental_leases[0].monthly_rent, 500.50);
  assert.equal((await request(context, 'save-lease', { ...validLeaseBody, monthly_rent: 700 })).status, 409);
  assert.equal(client.data.rental_leases[0].monthly_rent, 500.50);
});

test('Un brouillon incomplet peut rester brouillon sans activer des montants inventés', async () => {
  const client = mockClient();
  const result = await request(runtime(client), 'save-lease', { ...validLeaseBody, activate: false, start_date: null, monthly_rent: null, charges_amount: null, due_day: null, lease_kind: 'unverified' });
  assert.equal(result.status, 200);
  assert.equal(client.data.rental_leases[0].status, 'draft');
  assert.equal(client.data.rental_leases[0].verified_at, null);
});

test('Une activation concurrente ne peut pas être écrasée par une ancienne lecture', async () => {
  const client = mockClient({}, { beforeUpdate(table, data) { if (table === 'rental_leases') data.rental_leases[0].status = 'active'; } });
  assert.equal((await request(runtime(client), 'save-lease', validLeaseBody)).status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Un locataire relié à un autre logement bloque l’activation', async () => {
  const client = mockClient({ rental_tenant_rows: [{ id: tenantId, property_id: otherPropertyId, data: { Locataire: 'Locataire de test' } }] });
  assert.equal((await request(runtime(client), 'save-lease', validLeaseBody)).status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Un logement exemple ou un locataire absent ne peut pas être activé', async () => {
  for (const overrides of [
    { rental_properties: [{ id: propertyId, is_example: true }] },
    { rental_tenant_rows: [] },
    { rental_leases: [{ ...draftLease, tenant_row_id: null }] },
    { rental_tenant_rows: [{ id: tenantId, property_id: propertyId, data: {} }] },
  ]) {
    const client = mockClient(overrides);
    assert.equal((await request(runtime(client), 'save-lease', validLeaseBody)).status, 409);
    assert.equal(client.mutations.length, 0);
  }
});

test('Une date impossible, un UUID invalide et plus de deux décimales sont refusés', async () => {
  for (const body of [
    { ...validLeaseBody, start_date: '2026-02-31' },
    { ...validLeaseBody, id: '-'.repeat(36) },
    { ...validLeaseBody, monthly_rent: 500.501 },
    { ...validLeaseBody, charges_amount: 0.005 },
  ]) {
    const client = mockClient();
    assert.equal((await request(runtime(client), 'save-lease', body)).status, 400);
    assert.equal(client.mutations.length, 0);
  }
});

test('Les refus d’authentification et de droits ne déclenchent aucune mutation', async () => {
  for (const [account, status] of [
    [null, 401],
    [{ role: 'marne_invest', permissions: { readonly: true } }, 403],
    [{ role: 'staff', permissions: { marne_tenants: true } }, 403],
    [{ ...admin, must_change_password: true }, 403],
  ]) {
    const client = mockClient();
    assert.equal((await request(runtime(client, account), 'save-lease', validLeaseBody)).status, status);
    assert.equal(client.mutations.length, 0);
  }
});

test('Le diagnostic applique les mêmes règles administrateur/lecture seule que l’API', async () => {
  assert.equal((await request(runtime(mockClient(), { ...admin, permissions: { readonly: true } }), 'health-run', { confirmed: true })).status, 200);
  const client = mockClient();
  assert.equal((await request(runtime(client, { role: 'staff', permissions: { marne_admin: true, readonly: true } }), 'health-run', { confirmed: true })).status, 403);
  assert.equal(client.calls.length, 0);
});

test('L’ancien endpoint de paramètres ne contourne pas la configuration centralisée', async () => {
  for (const [account, status] of [[admin, 409], [{ role: 'staff', permissions: { marne_tenants: true } }, 403]]) {
    const client = mockClient({ rental_settings: [{ setting_key: 'bank_account_label', value: 'Compte de test' }] });
    const result = await request(runtime(client, account), 'save-setting', { setting_key: 'bank_account_label', value: { arbitrary: true } });
    assert.equal(result.status, status);
    assert.equal(client.mutations.length, 0);
    assert.equal(client.data.rental_settings[0].value, 'Compte de test');
  }
});

test('Les dates impossibles de paiement et d’intervention sont rejetées avant tout appel SQL métier', async () => {
  const client = mockClient({ rental_work_orders: [{ id: leaseId, status: 'open' }] });
  const context = runtime(client);
  const payment = await request(context, 'record-payment', {
    confirmed: true, idempotency_key: tenantId, lease_id: leaseId, amount: '500.00', received_on: '2026-02-31',
  });
  assert.equal(payment.status, 400);
  assert.equal(client.calls.some(call => call.rpc), false);
  const work = await request(context, 'work-details', { id: leaseId, scheduled_for: '2026-02-31', estimate_amount: '', actual_amount: '' });
  assert.equal(work.status, 400);
  assert.equal(client.mutations.length, 0);
});

test('Un échec du journal est signalé sans annoncer l’échec d’une mutation déjà effectuée', async () => {
  const client = mockClient({}, { insertResult(table) { return table === 'admin_audit_log' ? { data: null, error: { code: 'TEST_LOG_ERROR', message: 'private text must not be logged' } } : null; } });
  const context = runtime(client);
  assert.equal((await request(context, 'save-lease', validLeaseBody)).status, 200);
  assert.equal(client.data.rental_leases[0].status, 'active');
  assert.equal(context.errors.length, 1);
  assert.match(JSON.stringify(context.errors), /TEST_LOG_ERROR/);
  assert.doesNotMatch(JSON.stringify(context.errors), /private text/);
});

function tenantFixture(overrides = {}, options = {}) {
  return mockClient({
    rental_tenant_rows: [{ id: tenantId, row_number: 2, property_id: propertyId, data: { Locataire: 'Locataire de test', Logement: 'Logement initial' } }],
    rental_properties: [{ id: propertyId, name: 'Logement initial', is_example: false }, { id: otherPropertyId, name: 'Autre logement', is_example: false }],
    ...overrides,
  }, options);
}

test('Le locataire d’un bail brouillon, actif ou clôturé conserve son logement historique', async () => {
  for (const status of ['draft', 'active', 'closed']) {
    const client = tenantFixture({ rental_leases: [{ ...draftLease, status }] });
    const result = await request(runtime(client), 'save-tenant', { id: tenantId, data: { Locataire: 'Locataire de test', Logement: 'Autre logement' } });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /nouvelle fiche/);
    assert.equal(client.mutations.length, 0);
    assert.equal(client.data.rental_tenant_rows[0].property_id, propertyId);
  }
});

test('Supprimer le logement d’une fiche liée à un bail est refusé', async () => {
  const client = tenantFixture();
  assert.equal((await request(runtime(client), 'save-tenant', { id: tenantId, data: { Locataire: 'Locataire de test', Logement: '' } })).status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Les coordonnées du locataire restent modifiables sur le même logement', async () => {
  const client = tenantFixture();
  assert.equal((await request(runtime(client), 'save-tenant', { id: tenantId, data: { Locataire: 'Locataire de test', Logement: 'Logement initial', Notes: 'Contact corrigé' } })).status, 200);
  assert.equal(client.data.rental_tenant_rows[0].property_id, propertyId);
  assert.equal(client.data.rental_tenant_rows[0].data.Notes, 'Contact corrigé');
});

test('Une fiche sans bail peut changer de logement', async () => {
  const client = tenantFixture({ rental_leases: [] });
  assert.equal((await request(runtime(client), 'save-tenant', { id: tenantId, data: { Locataire: 'Locataire de test', Logement: 'Autre logement' } })).status, 200);
  assert.equal(client.data.rental_tenant_rows[0].property_id, otherPropertyId);
});

test('La création de dossier refuse une réaffectation avant de créer un logement orphelin', async () => {
  for (const name of ['Autre logement', 'Nouveau logement absent']) {
    const client = tenantFixture({ rental_tenant_rows: [{ id: tenantId, row_number: 2, property_id: propertyId, data: { Locataire: 'Locataire de test', Logement: name } }] });
    assert.equal((await request(runtime(client), 'create-property-sheet', { row_number: 2 })).status, 409);
    assert.equal(client.mutations.length, 0);
    assert.equal(client.data.rental_properties.length, 2);
  }
});

test('La création de dossier conserve une liaison existante correcte', async () => {
  const client = tenantFixture();
  assert.equal((await request(runtime(client), 'create-property-sheet', { row_number: 2 })).status, 200);
  assert.equal(client.data.rental_properties.length, 2);
  assert.equal(client.data.rental_tenant_rows[0].property_id, propertyId);
});

test('Une liaison ajoutée simultanément est présentée comme conflit métier 409', async () => {
  for (const action of ['save-tenant', 'create-property-sheet']) {
    const client = tenantFixture({
      rental_leases: [],
      rental_tenant_rows: [{ id: tenantId, row_number: 2, property_id: propertyId, data: { Locataire: 'Locataire de test', Logement: action === 'save-tenant' ? 'Logement initial' : 'Autre logement' } }],
    }, {
      updateResult(table) { return table === 'rental_tenant_rows' ? { data: null, error: { code: '23503' } } : null; },
      rpcResult(name) { return name === 'marne_create_property_sheet' ? { data: null, error: { code: '23503' } } : null; },
    });
    const body = action === 'save-tenant' ? { id: tenantId, data: { Locataire: 'Locataire de test', Logement: 'Autre logement' } } : { row_number: 2 };
    assert.equal((await request(runtime(client), action, body)).status, 409);
    assert.equal(client.mutations.length, 0);
  }
});

test('Une nouvelle fiche locataire est créée par une seule RPC avec le logement résolu', async () => {
  const created={id:tenantId,row_number:3,property_id:otherPropertyId,data:{Locataire:'Nouveau locataire',Logement:'Autre logement'}};
  const client=tenantFixture({}, {rpcResult(name){return name==='marne_create_tenant'?{data:created,error:null}:null;}});
  const result=await request(runtime(client),'save-tenant',{data:created.data});
  assert.equal(result.status,200);
  assert.deepEqual(result.body.item,created);
  const calls=client.calls.filter(call=>call.rpc==='marne_create_tenant');
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_property_id,otherPropertyId);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params.p_data)),created.data);
  assert.equal(client.mutations.some(change=>change.table!=='admin_audit_log'),false);
});

test('Un nouveau logement et sa fiche sont créés ensemble par la RPC transactionnelle', async () => {
  const created={property:{id:otherPropertyId,name:'Nouveau bien'},row:{id:tenantId,row_number:3,property_id:otherPropertyId}};
  const client=tenantFixture({}, {rpcResult(name){return name==='marne_create_property'?{data:created,error:null}:null;}});
  const result=await request(runtime(client),'new-property',{name:'  Nouveau bien  ',address:' Adresse de test '});
  assert.equal(result.status,200);
  assert.deepEqual(result.body.property,created.property);
  assert.deepEqual(result.body.row,created.row);
  const calls=client.calls.filter(call=>call.rpc==='marne_create_property');
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)),{p_name:'Nouveau bien',p_address:'Adresse de test'});
  assert.equal(client.mutations.some(change=>change.table!=='admin_audit_log'),false);
});

test('La création et la liaison du dossier logement passent par la même transaction SQL', async () => {
  const property={id:otherPropertyId,name:'Dossier de test'};
  const client=tenantFixture({rental_leases:[],rental_tenant_rows:[{id:tenantId,row_number:2,property_id:null,data:{Locataire:'Locataire de test',Logement:'Dossier de test','Adresse logement':'Adresse de test'}}]},
    {rpcResult(name){return name==='marne_create_property_sheet'?{data:property,error:null}:null;}});
  const result=await request(runtime(client),'create-property-sheet',{row_number:2});
  assert.equal(result.status,200);
  assert.deepEqual(result.body.property,property);
  const calls=client.calls.filter(call=>call.rpc==='marne_create_property_sheet');
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_row_number,2);
  assert.equal(calls[0].params.p_property.name,'Dossier de test');
  assert.equal(calls[0].params.p_property.data.Adresse,'Adresse de test');
  assert.equal(client.mutations.some(change=>change.table!=='admin_audit_log'),false);
});

test('Les conflits et erreurs de validation des créations SQL ne produisent aucune seconde écriture', async () => {
  const scenarios=[
    ['save-tenant','marne_create_tenant',{data:{Locataire:'Nouveau locataire',Logement:'Autre logement'}},'22023',400],
    ['save-tenant','marne_create_tenant',{data:{Locataire:'Nouveau locataire',Logement:'Autre logement'}},'23503',409],
    ['new-property','marne_create_property',{name:'Nouveau bien',address:''},'23505',409],
    ['new-property','marne_create_property',{name:'Nouveau bien',address:''},'22023',400],
    ['create-property-sheet','marne_create_property_sheet',{row_number:2},'22023',409],
    ['create-property-sheet','marne_create_property_sheet',{row_number:2},'23505',409],
  ];
  for(const [action,rpc,body,code,status] of scenarios){
    const client=tenantFixture({}, {rpcResult(name){return name===rpc?{data:null,error:{code,message:'Validation de test'}}:null;}});
    const result=await request(runtime(client),action,body);
    assert.equal(result.status,status,action+' '+code);
    assert.equal(client.mutations.length,0);
    assert.equal(client.calls.filter(call=>call.rpc===rpc).length,1);
  }
});

function pages(count, options = {}) {
  const all = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(8, '0') }));
  const calls = [];
  return { all, calls, query: () => ({ async range(from, to) {
    calls.push([from, to]);
    const data = all.slice(from, Math.min(to + 1, from + (options.cap || Infinity)));
    return options.response ? options.response({ data, count, error: null }, calls.length) : { data, count, error: null };
  } }) };
}

test('La lecture financière récupère toutes les pages, au-delà de 1 000 lignes', async () => {
  const sample = pages(1017);
  const result = await runtime().loadCompleteRows(sample.query, 'paiements');
  assert.equal(result.data.length, 1017);
  assert.deepEqual(Array.from(result.data, row => row.id), sample.all.map(row => row.id));
  assert.deepEqual(sample.calls, [[0, 499], [500, 999], [1000, 1499]]);
});

test('Une limite serveur inférieure à 500 ne tronque pas les résultats', async () => {
  const sample = pages(1017, { cap: 200 });
  const result = await runtime().loadCompleteRows(sample.query, 'paiements');
  assert.equal(result.data.length, 1017);
  assert.equal(sample.calls.length, 6);
});

test('Une liste vide et la limite exacte de 10 000 restent valides', async () => {
  for (const count of [0, 10000]) {
    const sample = pages(count);
    const result = await runtime().loadCompleteRows(sample.query, 'paiements');
    assert.equal(result.data.length, count);
  }
});

test('Au-delà du plafond, aucun total partiel n’est retourné', async () => {
  const sample = pages(10001);
  await assert.rejects(() => runtime().loadCompleteRows(sample.query, 'paiements'), /Volume trop important/);
  assert.equal(sample.calls.length, 1);
});

test('Une cardinalité qui change pendant la pagination bloque le chargement', async () => {
  const sample = pages(501, { response(result, call) { return { ...result, count: call > 1 ? 502 : 501 }; } });
  await assert.rejects(() => runtime().loadCompleteRows(sample.query, 'paiements'), /Données modifiées/);
});

test('Une page manquante, un doublon ou un décompte absent bloque le chargement', async () => {
  const broken = [
    pages(501, { response(result, call) { return call > 1 ? { ...result, data: [] } : result; } }),
    pages(501, { response(result, call) { return call > 1 ? { ...result, data: [{ id: '00000000' }] } : result; } }),
    pages(1, { response(result) { return { ...result, count: null }; } }),
  ];
  for (const sample of broken) await assert.rejects(() => runtime().loadCompleteRows(sample.query, 'paiements'), /Chargement incomplet|Lecture incohérente/);
});

test('L’action data transmet un solde cohérent même avec plus de 1 000 paiements', async () => {
  const payments = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(8, '0'), status: 'recorded', amount: 10, recorded_at: '2026-01-01' }));
  const allocations = payments.map((payment, i) => ({ id: String(i).padStart(8, '0'), payment_id: payment.id, installment_id: 'installment-test', amount: 10, created_at: '2026-01-01' }));
  const client = mockClient({ rental_payments: payments, rental_payment_allocations: allocations, rental_installments: [{ id: 'installment-test', total_due: 10010, status: 'scheduled' }] });
  const result = await request(runtime(client), 'data', undefined, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.body.payments.length, 1001);
  assert.equal(result.body.payment_allocations.length, 1001);
  const valid = new Set(result.body.payments.map(row => row.id));
  const paid = result.body.payment_allocations.filter(row => valid.has(row.payment_id)).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(paid, result.body.installments[0].total_due);
});

test('L’action data renvoie 503 si une liste dépasse la limite vérifiée', async () => {
  const client = mockClient({}, { queryResult(table, result) { return table === 'rental_payments' ? { ...result, count: 10001 } : result; } });
  const result = await request(runtime(client), 'data', undefined, 'GET');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /aucun total partiel/);
  assert.equal(result.body.payments, undefined);
});

for (const [label, lastUid, pending] of [['en cours', 30, true], ['terminé', 80, false], ['non démarré', null, null]]) {
  test('Le rattrapage des mails est ' + label + ' sans exposer le verrou interne', async () => {
    const account = 'fixture@free.fr', progressedAt = '2026-11-23T08:00:00Z';
    const cursor = { account_email: account, folder: 'INBOX', last_uid: lastUid, target_uid: 80,
      last_progress_at: progressedAt, lock_token: 'synthetic-private-lock', locked_until: '2026-11-23T09:00:00Z' };
    const client = mockClient({
      rental_settings: [{ setting_key: 'sender_email', value: account }],
      rental_mail_sync_state: [{ account_email: account, imap_verified_at: progressedAt }],
      rental_mail_sync_cursors: [
        { ...cursor, account_email: 'other@free.fr', last_uid: 80 },
        ...(lastUid === null ? [] : [cursor]),
      ],
    });
    const result = await request(runtime(client), 'data', undefined, 'GET');
    assert.equal(result.status, 200);
    assert.equal(result.body.mail_sync_state.catchup_pending, pending);
    assert.equal(result.body.mail_sync_state.last_progress_at, lastUid === null ? null : progressedAt);
    assert.doesNotMatch(JSON.stringify(result.body), /lock_token|locked_until|last_uid|target_uid|synthetic-private-lock/);
  });
}

test('Un compte sans droit de messagerie ne lit pas les curseurs IMAP', async () => {
  const client = mockClient();
  const result = await request(runtime(client, { username: 'fixture-reader', role: 'marne_invest', permissions: {} }), 'data', undefined, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.body.mail_sync_state, null);
  assert.equal(client.calls.some(call => call.table === 'rental_mail_sync_cursors'), false);
});
