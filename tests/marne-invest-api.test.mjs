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
    rental_properties: [{ id: propertyId, is_example: false, data: { Adresse: 'Adresse du logement de test' } }],
    rental_tenant_rows: [{ id: tenantId, property_id: propertyId, data: { Locataire: 'Locataire de test' } }],
    ...overrides,
  });
  const calls = [], mutations = [];
  const client = {
    calls, mutations, data,
    from(table) {
      let operation = 'select', payload, conflictKeys = [], single = false, head = false, selectedFields = '';
      const filters = [], orders = [];
      let from = 0, to = Infinity, wantsCount = false;
      const query = {
        select(fields, config) { selectedFields = fields; head = !!config?.head; wantsCount = config?.count === 'exact'; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        gte(key, value) { filters.push(row => row[key] >= value); return query; },
        order(key, config) { orders.push([key, config?.ascending !== false]); return query; },
        limit(size) { to = size - 1; return query; },
        range(start, end) { from = start; to = end; return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        insert(value) { operation = 'insert'; payload = value; return query; },
        upsert(value, config) { operation = 'upsert'; payload = value; conflictKeys = String(config?.onConflict || '').split(',').filter(Boolean); return query; },
        async then(resolve, reject) {
          try {
            calls.push({ table, operation, from, to, wantsCount, fields: selectedFields });
            if(operation === 'upsert'){
              const values=Array.isArray(payload)?payload:[payload];
              mutations.push({table,operation,payload});
              const rows=values.map(value=>{
                const existing=(data[table]||[]).find(row=>conflictKeys.length&&conflictKeys.every(key=>row[key]===value[key]));
                if(existing){Object.assign(existing,value);return existing;}
                (data[table]||=[]).push(value);return value;
              });
              return resolve({data:single?rows[0]:rows,error:null});
            }
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
      if(name === 'marne_save_irl_rule'){
        const payload={lease_id:params.p_lease_id,...params.p_rule,verified_by:params.p_by};
        const previous=(data.rental_irl_lease_rules||[]).find(row=>row.lease_id===params.p_lease_id);
        if(previous)Object.assign(previous,payload);else(data.rental_irl_lease_rules||=[]).push(payload);
        mutations.push({table:'rental_irl_lease_rules',operation:'rpc',payload});
        return {data:{ok:true,rule:structuredClone(payload)},error:null};
      }
      if(name === 'marne_save_lease'){
        if(options.beforeUpdate)options.beforeUpdate('rental_leases',data);
        const lease=data.rental_leases.find(row=>row.id===params.p_lease_id);
        if(!lease||lease.status!=='draft')return {data:null,error:{code:'22023',message:'Bail modifié simultanément : actualisez.'}};
        const tenant=data.rental_tenant_rows.find(row=>row.id===lease.tenant_row_id);
        const payload={...params.p_patch,status:params.p_activate?'active':'draft',tenant_name:tenant?.data?.Locataire||lease.tenant_name,
          verified_at:params.p_activate?'2026-01-01T00:00:00Z':null,verified_by:params.p_activate?params.p_by:null};
        mutations.push({table:'rental_leases',operation:'rpc',payload});
        Object.assign(lease,payload);
        return {data:{lease:structuredClone(lease),installments_created:params.p_activate?2:0,skipped_partial_months:0,partial_periods:[]},error:null};
      }
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

function runtime(client = mockClient(), account = admin, options = {}) {
  const errors = [], environmentReads=[];
  const context = vm.createContext({
    Request, Response, URL, TextEncoder, TextDecoder, Uint8Array, AbortSignal,
    console: { error(...args) { errors.push(args); } }, errors, environmentReads, fixtureClient: client, fixtureAccount: account,
    fetch() { throw new Error('Network is forbidden in isolated API tests'); },
    Deno: { serve(handler) { context.handler = handler; }, env: { get(name) { environmentReads.push(name); return options.environment?.[name]; } } },
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

test('Les coordonnées des Paramètres sont reprises côté serveur avant activation', async () => {
  const client=mockClient({rental_settings:[
    {setting_key:'landlord_name',value:'Bailleur paramétré'},
    {setting_key:'landlord_address',value:'Adresse paramétrée'},
  ]});
  const result=await request(runtime(client),'save-lease',{...validLeaseBody,issuer_name:'',issuer_address:''});
  assert.equal(result.status,200);
  const call=client.calls.find(x=>x.rpc==='marne_save_lease');
  assert.equal(call.params.p_patch.issuer_name,'Bailleur paramétré');
  assert.equal(call.params.p_patch.issuer_address,'Adresse paramétrée');
  assert.equal(result.body.lease.issuer_name,'Bailleur paramétré');
});

test('L’activation conserve un émetteur contractuel explicite et utilise une seule transaction métier', async () => {
  const client=mockClient({rental_settings:[{setting_key:'landlord_name',value:'Autre bailleur'}]});
  const result=await request(runtime(client),'save-lease',{...validLeaseBody,verified_by:'intrus',status:'closed',tenant_name:'Identité injectée'});
  assert.equal(result.status,200);
  const calls=client.calls.filter(x=>x.rpc==='marne_save_lease');
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_by,admin.username);
  assert.equal(calls[0].params.p_activate,true);
  assert.equal(calls[0].params.p_patch.issuer_name,validLeaseBody.issuer_name);
  for(const key of ['status','verified_by','tenant_name'])assert.equal(key in calls[0].params.p_patch,false);
  assert.equal(client.calls.some(x=>x.table==='rental_leases'&&x.operation==='update'),false);
  assert.equal(client.calls.some(x=>x.rpc==='marne_create_installment'||x.rpc==='marne_generate_installments_daily'),false);
  assert.equal(result.body.installments_created,2);
});

test('Un brouillon conserve l’identité actuelle de sa fiche même si son ancien nom était vide', async () => {
  const client=mockClient({rental_leases:[{...draftLease,tenant_name:''}]});
  const result=await request(runtime(client),'save-lease',validLeaseBody);
  assert.equal(result.status,200);
  assert.equal(result.body.lease.tenant_name,'Locataire de test');
});

test('Une activation sans adresse de logement ou émetteur complet reste bloquée avant la RPC', async () => {
  for(const [overrides,body,message] of [
    [{rental_properties:[{id:propertyId,is_example:false,data:{}}]},validLeaseBody,/adresse du logement/],
    [{},{...validLeaseBody,issuer_name:'',issuer_address:''},/nom et l’adresse du bailleur/],
  ]){
    const client=mockClient(overrides);
    const result=await request(runtime(client),'save-lease',body);
    assert.equal(result.status,409);
    assert.match(result.body.error,message);
    assert.equal(client.calls.some(x=>x.rpc==='marne_save_lease'),false);
    assert.equal(client.mutations.length,0);
  }
});

test('La préparation du bail est déléguée à une RPC idempotente avec l’acteur authentifié', async () => {
  let calls=0;
  const client=mockClient({}, {rpcResult(name){return name==='marne_prepare_lease'?{data:{lease:draftLease,created:++calls===1,reused:calls>1},error:null}:null;}});
  const context=runtime(client);
  const first=await request(context,'prepare-lease',{tenant_row_id:tenantId,p_by:'intrus'});
  const second=await request(context,'prepare-lease',{tenant_row_id:tenantId});
  assert.equal(first.status,200);
  assert.equal(first.body.already_exists,false);
  assert.equal(second.body.already_exists,true);
  assert.equal(second.body.lease.id,first.body.lease.id);
  const rpcCalls=client.calls.filter(x=>x.rpc==='marne_prepare_lease');
  assert.equal(rpcCalls.length,2);
  assert.deepEqual(rpcCalls.map(x=>({...x.params})),[
    {p_tenant_row_id:tenantId,p_by:admin.username},{p_tenant_row_id:tenantId,p_by:admin.username},
  ]);
  assert.equal(client.calls.some(x=>x.table==='rental_leases'&&x.operation!=='select'),false);
});

test('La préparation retrouve un bail historique sans réécrire son contrat', async () => {
  for(const status of ['active','closed']){
    const client=mockClient({}, {rpcResult(name){return name==='marne_prepare_lease'?{data:{lease:{...draftLease,status},created:false,reused:true},error:null}:null;}});
    const result=await request(runtime(client),'prepare-lease',{tenant_row_id:tenantId});
    assert.equal(result.status,200);
    assert.equal(result.body.lease.status,status);
    assert.equal(result.body.already_exists,true);
    assert.equal(client.calls.some(x=>x.rpc==='marne_save_lease'),false);
  }
});

test('Une clôture confirmée transmet uniquement le bail, la date réelle et l’acteur', async () => {
  const closed={...draftLease,status:'closed',end_date:'2026-01-31'};
  const client=mockClient({}, {rpcResult(name){return name==='marne_close_lease'?{data:{lease:closed,already_closed:false,cancelled_installments:1},error:null}:null;}});
  const result=await request(runtime(client),'close-lease',{id:leaseId,end_date:'2026-01-31',confirmed:true,final_month_confirmed:true,p_by:'intrus'});
  assert.equal(result.status,200);
  assert.equal(result.body.lease.status,'closed');
  assert.equal(result.body.cancelled_installments,1);
  assert.deepEqual({...client.calls.find(x=>x.rpc==='marne_close_lease').params},{p_lease_id:leaseId,p_end_date:'2026-01-31',p_by:admin.username,p_final_month_confirmed:true});
  assert.equal(client.calls.some(x=>x.table==='rental_leases'&&x.operation!=='select'),false);
});

test('La clôture refuse les dates impossibles, futures et les confirmations absentes', async () => {
  for(const body of [
    {id:leaseId,end_date:'2026-02-31',confirmed:true,final_month_confirmed:true},
    {id:leaseId,end_date:'9999-12-31',confirmed:true,final_month_confirmed:true},
    {id:leaseId,end_date:'2026-01-31'},
    {id:leaseId,end_date:'2026-01-31',confirmed:true},
    {id:'invalid',end_date:'2026-01-31',confirmed:true},
  ]){
    const client=mockClient();
    assert.equal((await request(runtime(client),'close-lease',body)).status,400);
    assert.equal(client.calls.some(x=>x.rpc==='marne_close_lease'),false);
    assert.equal(client.mutations.length,0);
  }
});

test('Les nouvelles actions de bail respectent les droits et la lecture seule', async () => {
  for(const [action,body] of [['prepare-lease',{tenant_row_id:tenantId}],['close-lease',{id:leaseId,end_date:'2026-01-31',confirmed:true,final_month_confirmed:true}],['save-partial-installment',{lease_id:leaseId,period:'2026-01',rent_amount:100,charges_amount:0,confirmed:true}]]){
    for(const [account,status] of [[null,401],[{role:'staff',permissions:{marne_tenants:true}},403],[{role:'marne_invest',permissions:{readonly:true}},403]]){
      const client=mockClient();
      assert.equal((await request(runtime(client,account),action,body)).status,status);
      assert.equal(client.calls.length,0);
    }
  }
});

test('Les conflits SQL du cycle bail sont présentés sans nouvelle écriture de secours', async () => {
  for(const [action,rpc,body] of [
    ['prepare-lease','marne_prepare_lease',{tenant_row_id:tenantId}],
    ['save-lease','marne_save_lease',validLeaseBody],
    ['close-lease','marne_close_lease',{id:leaseId,end_date:'2026-01-31',confirmed:true,final_month_confirmed:true}],
    ['save-partial-installment','marne_set_partial_installment',{lease_id:leaseId,period:'2026-01',rent_amount:100,charges_amount:0,confirmed:true}],
  ]){
    for(const code of ['22023','23503','23505','40001','55000']){
      const client=mockClient({}, {rpcResult(name){return name===rpc?{data:null,error:{code,message:'Situation du bail modifiée'}}:null;}});
      const result=await request(runtime(client),action,body);
      assert.equal(result.status,409);
      assert.match(result.body.error,/Situation du bail modifiée/);
      assert.equal(client.mutations.length,0);
      assert.equal(client.calls.filter(x=>x.rpc===rpc).length,1);
    }
  }
});

test('Un locataire relié à un autre logement bloque l’activation', async () => {
  const client = mockClient({ rental_tenant_rows: [{ id: tenantId, property_id: otherPropertyId, data: { Locataire: 'Locataire de test' } }] });
  assert.equal((await request(runtime(client), 'save-lease', validLeaseBody)).status, 409);
  assert.equal(client.mutations.length, 0);
});

test('Une période partielle transmet les montants explicites sans les recalculer', async () => {
  const installmentId='55555555-5555-4555-8555-555555555555';
  const client=mockClient({}, {rpcResult(name,params){return name==='marne_set_partial_installment'?{
    data:{item:{id:installmentId,period:params.p_period,rent_amount:params.p_rent,charges_amount:params.p_charges},created:true,updated:false},error:null}:null;}});
  const result=await request(runtime(client),'save-partial-installment',{lease_id:leaseId,period:'2026-01',rent_amount:'123,45',charges_amount:0,confirmed:true});
  assert.equal(result.status,200);
  assert.equal(result.body.item.rent_amount,123.45);
  assert.equal(result.body.item.charges_amount,0);
  assert.deepEqual({...client.calls.find(x=>x.rpc==='marne_set_partial_installment').params},{p_lease_id:leaseId,p_period:'2026-01-01',p_rent:123.45,p_charges:0,p_by:admin.username,p_confirmed:true});
  assert.equal(client.calls.some(x=>x.table==='rental_installments'&&x.operation!=='select'),false);
});

test('Une période partielle exige un mois valide, des montants explicites et une confirmation', async () => {
  const valid={lease_id:leaseId,period:'2026-01',rent_amount:'100.00',charges_amount:'0',confirmed:true};
  for(const body of [
    {...valid,period:'2026-13'}, {...valid,period:'2026-01-01'}, {...valid,rent_amount:-1},
    {...valid,rent_amount:''}, {...valid,charges_amount:null}, {...valid,charges_amount:'0.001'},
    {...valid,rent_amount:true}, {...valid,confirmed:false},
  ]){
    const client=mockClient();
    assert.equal((await request(runtime(client),'save-partial-installment',body)).status,400);
    assert.equal(client.calls.some(x=>x.rpc==='marne_set_partial_installment'),false);
    assert.equal(client.mutations.length,0);
  }
});

test('Les reçus restent accessibles après clôture et reflètent les dates de la période réellement occupée', async () => {
  const installmentId='55555555-5555-4555-8555-555555555555';
  for(const [status,start,end,from,to] of [
    ['active','2026-01-15',null,'2026-01-15','2026-01-31'],
    ['closed','2025-01-01','2026-01-20','2026-01-01','2026-01-20'],
    ['closed','2026-01-15','2026-01-20','2026-01-15','2026-01-20'],
  ]){
    const client=mockClient({
      rental_leases:[{...draftLease,...validLeaseBody,status,start_date:start,end_date:end,verified_at:'2026-01-01T00:00:00Z'}],
      rental_installments:[{id:installmentId,lease_id:leaseId,property_id:propertyId,period:'2026-01-01',status:'scheduled',rent_amount:100,charges_amount:10,total_due:110}],
    },{rpcResult(name){return name==='marne_installment_status'?{data:{allocated:110,due:110},error:null}:null;}});
    const result=await request(runtime(client),'receipt-preview',{installment_id:installmentId});
    assert.equal(result.status,200);
    assert.equal(result.body.period_from,from);
    assert.equal(result.body.period_to,to);
    assert.equal(result.body.document_type,'quittance');
    assert.equal(result.body.paid,110);
    assert.equal(result.body.rent,100);
    assert.equal(client.calls.some(x=>x.table==='rental_payments'&&x.operation!=='select'),false);
  }
});

test('Un reçu refuse toujours un bail non vérifié ou une échéance hors de sa période', async () => {
  const installmentId='55555555-5555-4555-8555-555555555555';
  for(const patch of [{status:'closed',verified_at:null},{status:'draft',verified_at:'2026-01-01T00:00:00Z'},{status:'closed',verified_at:'2026-01-01T00:00:00Z',end_date:'2025-12-31'}]){
    const client=mockClient({
      rental_leases:[{...draftLease,...validLeaseBody,start_date:'2025-01-01',...patch}],
      rental_installments:[{id:installmentId,lease_id:leaseId,property_id:propertyId,period:'2026-01-01',status:'scheduled',rent_amount:100,charges_amount:10,total_due:110}],
    },{rpcResult(name){return name==='marne_installment_status'?{data:{allocated:110,due:110},error:null}:null;}});
    assert.equal((await request(runtime(client),'receipt-preview',{installment_id:installmentId})).status,409);
    assert.equal(client.mutations.length,0);
  }
});

test('Le reçu assemble l’adresse postale du bien et refuse un nom de bien comme seule adresse', async () => {
  const installmentId='55555555-5555-4555-8555-555555555555';
  for(const [propertyData,tenantData,expected,status] of [
    [{Adresse:'12 rue QA','Code postal':'51000',Ville:'Ville QA'},{},'12 rue QA\n51000 Ville QA',200],
    [{Adresse:'12 rue QA',Ville:'Ville QA'},{},'12 rue QA\nVille QA',200],
    [{},{'Adresse logement':'Adresse contractuelle complète'},'Adresse contractuelle complète',200],
    [{'Code postal':'51000',Ville:'Ville QA'},{},null,409],
  ]){
    const client=mockClient({
      rental_leases:[{...draftLease,...validLeaseBody,status:'active',verified_at:'2026-01-01T00:00:00Z'}],
      rental_properties:[{id:propertyId,name:'Nom de bien distinct',data:propertyData}],
      rental_tenant_rows:[{id:tenantId,property_id:propertyId,data:tenantData}],
      rental_installments:[{id:installmentId,lease_id:leaseId,property_id:propertyId,period:'2026-01-01',status:'scheduled',rent_amount:100,charges_amount:10}],
    },{rpcResult(name){return name==='marne_installment_status'?{data:{allocated:110,due:110},error:null}:null;}});
    const result=await request(runtime(client),'receipt-preview',{installment_id:installmentId});
    assert.equal(result.status,status);
    if(expected)assert.equal(result.body.address,expected);
  }
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

const basicSettings={landlord_name:'Bailleur de test',landlord_address:'Adresse de test',owner_email:'',sender_email:'',bank_account_label:''};

test('Les paramètres du bailleur peuvent être enregistrés avant toute configuration Free', async () => {
  const client=mockClient({rental_settings:[]});
  const result=await request(runtime(client),'save-site-config',{settings:basicSettings});
  assert.equal(result.status,200);
  assert.equal(client.data.rental_settings.find(row=>row.setting_key==='landlord_name').value,basicSettings.landlord_name);
  assert.equal(client.data.rental_settings.find(row=>row.setting_key==='sender_email').value,'');
  assert.equal(client.calls.some(call=>call.rpc?.startsWith('marne_mail_')),false);
});

test('Une adresse jamais connectée peut être effacée sans reprendre un compte historique', async () => {
  const client=mockClient({rental_settings:[{setting_key:'sender_email',value:'nouveau@free.fr'}]});
  const context=runtime(client,admin,{environment:{MARNE_FREE_MAIL_PASSWORD:'synthetic-legacy-credential'}});
  assert.equal((await request(context,'save-site-config',{settings:basicSettings})).status,200);
  const status=await request(context,'mail-status',undefined,'GET');
  assert.equal(status.status,200);
  assert.equal(status.body.account,'');
  assert.equal(status.body.credential_configured,false);
  assert.equal(context.environmentReads.includes('MARNE_FREE_MAIL_PASSWORD'),false);
  const checks=client.calls.filter(call=>call.rpc==='marne_mail_password_exists');
  assert.deepEqual(checks.map(call=>call.params.p_account),['nouveau@free.fr']);
});

test('Une boîte possédant un identifiant ou une connexion vérifiée ne peut pas être effacée implicitement', async () => {
  for(const setup of [
    {credential:true}, {state:{imap_verified_at:'2026-01-01T00:00:00Z'}}, {state:{smtp_verified_at:'2026-01-01T00:00:00Z'}},
  ]){
    const client=mockClient({rental_settings:[{setting_key:'sender_email',value:'fixture@free.fr'}],rental_mail_sync_state:[{account_email:'fixture@free.fr',...setup.state}]},
      {rpcResult(name){return name==='marne_mail_password_exists'?{data:!!setup.credential,error:null}:null;}});
    const result=await request(runtime(client),'save-site-config',{settings:basicSettings});
    assert.equal(result.status,409);
    assert.match(result.body.error,/ne peut pas être effacée/);
    assert.equal(client.mutations.length,0);
    assert.equal(client.data.rental_settings[0].value,'fixture@free.fr');
  }
});

test('Un échec de vérification bloque l’effacement du compte sans assimiler l’inconnu à une absence', async () => {
  const failures=[
    {rpcResult(name){return name==='marne_mail_password_exists'?{data:null,error:{code:'TEST_LOOKUP',message:'synthetic-sensitive-detail'}}:null;}},
    {rpcResult(name){return name==='marne_mail_password_exists'?{data:null,error:null}:null;}},
    {queryResult(table,result){return table==='rental_mail_sync_state'?{data:null,error:{code:'TEST_LOOKUP'}}:result;}},
    {queryResult(table,result){return table==='rental_settings'?{data:null,error:{code:'TEST_LOOKUP'}}:result;}},
  ];
  for(const options of failures){
    const client=mockClient({rental_settings:[{setting_key:'sender_email',value:'fixture@free.fr'}]},options);
    const context=runtime(client),result=await request(context,'save-site-config',{settings:basicSettings});
    assert.equal(result.status,503);
    assert.match(result.body.error,/ne peut pas être vérifi/);
    assert.equal(client.mutations.length,0);
    assert.doesNotMatch(JSON.stringify([result.body,context.errors]),/synthetic-sensitive-detail/);
  }
});

test('Une adresse absente ne charge aucune boîte ni identifiant et reste visible comme non configurée', async () => {
  for(const settings of [[],[{setting_key:'sender_email',value:''}],[{setting_key:'sender_email',value:'   '}]]){
    const client=mockClient({rental_settings:settings,rental_mail_messages:[{id:'old-mail',account_email:'ph.danglade@free.fr'}]});
    const context=runtime(client,admin,{environment:{MARNE_FREE_MAIL_PASSWORD:'synthetic-legacy-credential'}});
    const result=await request(context,'data',undefined,'GET');
    assert.equal(result.status,200);
    assert.equal(result.body.current_user.mail_account,'');
    assert.equal(result.body.current_user.mail_configured,false);
    assert.deepEqual(result.body.mail_inbox,[]);
    assert.equal(result.body.mail_sync_state,null);
    const status=await request(context,'mail-status',undefined,'GET');
    assert.equal(status.body.account,'');
    assert.equal(status.body.credential_configured,false);
    assert.equal(client.calls.some(call=>call.table?.startsWith('rental_mail_')||call.rpc?.startsWith('marne_mail_')),false);
    assert.equal(context.environmentReads.includes('MARNE_FREE_MAIL_PASSWORD'),false);
  }
});

test('Toutes les opérations de messagerie exigent une adresse explicite avant tout accès à la boîte', async () => {
  for(const [action,body,method] of [
    ['mail-configure',{password:'synthetic-credential'},'POST'],['mail-test',{},'POST'],['mail-sync',{},'POST'],
    ['mail-send',{id:leaseId,confirmed:true},'POST'],['mail-create-draft',{client_key:leaseId},'POST'],
    ['mail-cancel-draft',{id:leaseId},'POST'],['mail-mark-read',{id:leaseId},'POST'],['mail-message&id='+leaseId,undefined,'GET'],
  ]){
    const client=mockClient({rental_settings:[]}),context=runtime(client,admin,{environment:{MARNE_FREE_MAIL_PASSWORD:'synthetic-legacy-credential'}});
    const result=await request(context,action,body,method);
    assert.equal(result.status,409,action);
    assert.match(result.body.error,/Renseignez une adresse @free.fr/);
    assert.equal(client.calls.some(call=>call.table?.startsWith('rental_mail_')||call.rpc?.startsWith('marne_mail_')),false);
    assert.equal(client.mutations.length,0);
    assert.equal(context.environmentReads.includes('MARNE_FREE_MAIL_PASSWORD'),false);
  }
});

test('Une adresse Free renseignée reste contrôlée et normalisée', async () => {
  for(const address of ['sans-adresse','fixture@example.invalid']){
    const client=mockClient();
    assert.equal((await request(runtime(client),'save-site-config',{settings:{...basicSettings,sender_email:address}})).status,400);
    assert.equal(client.mutations.length,0);
  }
  const client=mockClient();
  assert.equal((await request(runtime(client),'save-site-config',{settings:{...basicSettings,sender_email:'FIXTURE@FREE.FR'}})).status,200);
  assert.equal(client.data.rental_settings.find(row=>row.setting_key==='sender_email').value,'fixture@free.fr');
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

test('Une fiche locataire accepte les modifications partielles et les effacements explicites sans perdre l’historique', async () => {
  const client=tenantFixture({rental_tenant_rows:[{id:tenantId,row_number:2,property_id:propertyId,data:{
    Locataire:'Locataire de test',Logement:'Logement initial','Mail locataire':'ancien@example.invalid',
    Notes:'Note conservée','Date entrée locataire':'date historique à vérifier','Solde précédent':42,
  }}]});
  const result=await request(runtime(client),'save-tenant',{id:tenantId,property_id:propertyId,data:{'Mail locataire':'',Charge:'0'}});
  assert.equal(result.status,200);
  assert.equal(result.body.item.data['Mail locataire'],'');
  assert.equal(result.body.item.data.Charge,0);
  assert.equal(result.body.item.data.Notes,'Note conservée');
  assert.equal(result.body.item.data['Solde précédent'],42);
  assert.equal(result.body.item.data['Date entrée locataire'],'date historique à vérifier');
});

test('Le lien explicite au bien reste stable après renommage et normalise le nom affiché', async () => {
  const client=tenantFixture({rental_properties:[{id:propertyId,name:'Logement renommé',is_example:false}]});
  const result=await request(runtime(client),'save-tenant',{id:tenantId,property_id:propertyId,data:{Notes:'Coordonnées vérifiées'}});
  assert.equal(result.status,200);
  assert.equal(result.body.item.property_id,propertyId);
  assert.equal(result.body.item.data.Logement,'Logement renommé');
  assert.equal(result.body.item.data.Locataire,'Locataire de test');
});

test('Un nouveau locataire lié par identifiant reprend seulement l’adresse renseignée du bien', async () => {
  const client=tenantFixture({rental_properties:[{id:propertyId,name:'Logement initial',is_example:false,data:{Adresse:'1 rue de test'}}]},
    {rpcResult(name,params){return name==='marne_create_tenant'?{data:{id:tenantId,row_number:3,property_id:params.p_property_id,data:params.p_data},error:null}:null;}});
  const result=await request(runtime(client),'save-tenant',{property_id:propertyId,data:{Locataire:'Nouveau locataire','Loyer de base':'500,25',Charge:0}});
  assert.equal(result.status,200);
  assert.equal(result.body.item.data.Logement,'Logement initial');
  assert.equal(result.body.item.data['Adresse logement'],'1 rue de test');
  assert.equal(result.body.item.data['Loyer de base'],500.25);
  assert.equal(result.body.item.data.Charge,0);
});

test('Les informations locataires invalides sont refusées avant toute écriture', async () => {
  for(const data of [
    {'Mail locataire':'sans-adresse'}, {'Mail locataire':'a@example.invalid,b@example.invalid'},
    {'Date entrée locataire':'2026-02-31'}, {'Date fin de bail':'2026-00-10'},
    {'Date entrée locataire':'2026-03-01','Date fin de bail':'2026-02-28'},
    {'Loyer de base':-1}, {Charge:'0.001'}, {Locataire:{name:'incorrect'}}, {'Téléphone locataire':'1'.repeat(41)},
  ]){
    const client=tenantFixture();
    assert.equal((await request(runtime(client),'save-tenant',{id:tenantId,property_id:propertyId,data})).status,400);
    assert.equal(client.mutations.length,0);
  }
  for(const body of [{id:'invalid',data:{}},{id:tenantId,data:[]},{id:tenantId,property_id:'invalid',data:{}}]){
    const client=tenantFixture();
    assert.equal((await request(runtime(client),'save-tenant',body)).status,400);
    assert.equal(client.mutations.length,0);
  }
});

test('Une propriété absente ou exemple ne peut pas être liée à un locataire', async () => {
  for(const properties of [[],[{id:propertyId,name:'Exemple',is_example:true}]]){
    const client=tenantFixture({rental_properties:properties});
    assert.equal((await request(runtime(client),'save-tenant',{id:tenantId,property_id:propertyId,data:{Notes:'Mise à jour'}})).status,400);
    assert.equal(client.mutations.length,0);
  }
});

test('Les modifications du bien préservent les sections historiques et les clés absentes du formulaire', async () => {
  const property={id:propertyId,name:'Logement initial',is_example:false,
    data:{'Nom du logement':'Ancien libellé',Adresse:'Ancienne adresse',Notes:'Conserver','IRL de base':100},
    current_tenant:{Locataire:'Historique'},tenant_history:[{annee:2020}],payment_schedule:[{periode:'2020-01'}]};
  const client=tenantFixture({rental_properties:[property]});
  const result=await request(runtime(client),'save-property',{id:propertyId,name:'Nouveau nom',data:{Adresse:'Adresse corrigée',Ville:'Paris'}});
  assert.equal(result.status,200);
  assert.equal(result.body.item.name,'Nouveau nom');
  assert.equal(result.body.item.data['Nom du logement'],'Nouveau nom');
  assert.equal(result.body.item.data.Adresse,'Adresse corrigée');
  assert.equal(result.body.item.data.Notes,'Conserver');
  assert.equal(result.body.item.data['IRL de base'],100);
  for(const key of ['current_tenant','tenant_history','payment_schedule'])assert.deepEqual(result.body.item[key],property[key]);
  const update=client.mutations.find(x=>x.table==='rental_properties').payload;
  for(const key of ['current_tenant','tenant_history','payment_schedule'])assert.equal(key in update,false);
});

test('Le bien conserve son nom en mise à jour partielle et permet de vider un champ optionnel', async () => {
  const client=tenantFixture({rental_properties:[{id:propertyId,name:'Logement initial',is_example:false,data:{Ville:'Ancienne ville'}}]});
  const result=await request(runtime(client),'save-property',{id:propertyId,data:{Ville:''}});
  assert.equal(result.status,200);
  assert.equal(result.body.item.name,'Logement initial');
  assert.equal(result.body.item.data.Ville,'');
});

test('Les erreurs de fiche bien sont explicites et ne provoquent aucune écriture', async () => {
  for(const body of [{id:'invalid',data:{}},{id:propertyId,name:''},{id:propertyId,data:[]},{id:propertyId,data:{Adresse:'x'.repeat(501)}}]){
    const client=tenantFixture();
    assert.equal((await request(runtime(client),'save-property',body)).status,400);
    assert.equal(client.mutations.length,0);
  }
  const missing=tenantFixture({rental_properties:[]});
  assert.equal((await request(runtime(missing),'save-property',{id:propertyId,name:'Test'})).status,404);
  const duplicate=tenantFixture({}, {updateResult(table){return table==='rental_properties'?{data:null,error:{code:'23505'}}:null;}});
  assert.equal((await request(runtime(duplicate),'save-property',{id:propertyId,name:'Autre logement'})).status,409);
  assert.equal(duplicate.mutations.length,0);
});

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

const reminderInstallmentId='55555555-5555-4555-8555-555555555555';
const reminderId='66666666-6666-4666-8666-666666666666';
const reminderVersion='2026-01-15T12:34:56.123456+00:00';
function reminderClient(result,overrides={},options={}){
  return mockClient({
    rental_leases:[{...draftLease,status:'active',start_date:'2020-01-01',verified_at:'2020-01-01T00:00:00Z'}],
    rental_properties:[{id:propertyId,name:'Bien QA',data:{Adresse:'Adresse QA'}}],
    rental_tenant_rows:[{id:tenantId,property_id:propertyId,data:{'Mail locataire':'qa@example.invalid'}}],
    rental_installments:[{id:reminderInstallmentId,lease_id:leaseId,property_id:propertyId,period:'2020-02-01',due_on:'2020-02-05',status:'scheduled'}],
    ...overrides,
  },{...options,rpcResult(name,params){
    if(options.rpcResult){const value=options.rpcResult(name,params);if(value)return value;}
    if(name==='marne_installment_status')return {data:{remaining:165,unallocated_on_lease:0},error:null};
    if(['marne_prepare_reminder_draft','marne_declare_reminder_sent'].includes(name))return result;
    return null;
  }});
}

test('La reprise d’une relance annulée transmet le solde attendu à une seule RPC transactionnelle',async()=>{
  const client=reminderClient({data:{ok:true,already_exists:false,reprepared:true,item:{id:reminderId,status:'prepared',prepared_at:reminderVersion}},error:null},
    {rental_reminder_drafts:[{id:reminderId,installment_id:reminderInstallmentId,stage:7,status:'cancelled'}]});
  const result=await request(runtime(client),'prepare-reminder',{installment_id:reminderInstallmentId,stage:7,prepared_by:'untrusted'});
  assert.equal(result.status,200);
  assert.equal(result.body.reprepared,true);
  const params=client.calls.find(call=>call.rpc==='marne_prepare_reminder_draft').params;
  assert.equal(params.p_expected_remaining,165);
  assert.equal(params.p_installment_id,reminderInstallmentId);
  assert.equal(params.p_stage,7);
  assert.equal(params.p_recipient_email,'qa@example.invalid');
  assert.equal(params.p_by,admin.username);
  assert.match(params.p_body,/165,00/);
  assert.equal(client.mutations.some(call=>call.table==='rental_reminder_drafts'),false);
  assert.equal(client.mutations.filter(call=>call.table==='admin_audit_log').length,1);
});

test('Un rappel déjà préparé ou déclaré reste idempotent sans nouvel audit',async()=>{
  for(const status of ['prepared','declared_sent']){
    const client=reminderClient({data:{ok:true,already_exists:true,reprepared:false,item:{id:reminderId,status}},error:null});
    const result=await request(runtime(client),'prepare-reminder',{installment_id:reminderInstallmentId,stage:7});
    assert.equal(result.status,200);
    assert.equal(result.body.item.status,status);
    assert.equal(client.mutations.length,0);
  }
});

test('Un changement financier intervenu avant le verrou renvoie409 sans écriture API de secours',async()=>{
  for(const code of ['22023','23505','40001','55000']){
    const client=reminderClient({data:null,error:{code,message:'Solde modifié sous verrou'}});
    const result=await request(runtime(client),'prepare-reminder',{installment_id:reminderInstallmentId,stage:7});
    assert.equal(result.status,409);
    assert.equal(result.body.error,'Solde modifié sous verrou');
    assert.equal(client.mutations.length,0);
  }
});

test('Un solde nul ou des sommes non affectées bloquent la préparation avant la RPC',async()=>{
  for(const balance of [{remaining:0,unallocated_on_lease:0},{remaining:165,unallocated_on_lease:10}]){
    const client=reminderClient(null,{}, {rpcResult(name){return name==='marne_installment_status'?{data:balance,error:null}:null;}});
    assert.equal((await request(runtime(client),'prepare-reminder',{installment_id:reminderInstallmentId,stage:7})).status,409);
    assert.equal(client.calls.some(call=>call.rpc==='marne_prepare_reminder_draft'),false);
    assert.equal(client.mutations.length,0);
  }
});

test('La confirmation transmet la version affichée avec ses microsecondes et l’acteur authentifié',async()=>{
  const client=reminderClient({data:{ok:true,already_exists:false},error:null});
  const result=await request(runtime(client),'declare-reminder-sent',{id:reminderId,prepared_at:reminderVersion,confirmed:true,declared_sent_by:'untrusted'});
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls.find(call=>call.rpc==='marne_declare_reminder_sent').params)),{
    p_reminder_id:reminderId,p_expected_prepared_at:reminderVersion,p_by:admin.username,
  });
  assert.equal(client.calls.some(call=>call.rpc==='marne_installment_status'),false);
  assert.equal(client.mutations.some(call=>call.table==='rental_reminder_drafts'),false);
});

test('Une annulation transactionnelle pour relance périmée reste un conflit explicite et sans audit d’envoi',async()=>{
  const data={ok:false,code:'reminder_stale',error:'Situation financière modifiée',cancelled:true};
  const client=reminderClient({data,error:null});
  const result=await request(runtime(client),'declare-reminder-sent',{id:reminderId,prepared_at:reminderVersion,confirmed:true});
  assert.equal(result.status,409);
  assert.deepEqual(result.body,data);
  assert.equal(client.mutations.length,0);
});

test('Une ancienne version, une absence et un retry de déclaration conservent leurs états précis',async()=>{
  for(const [rpcResult,status] of [
    [{data:null,error:{code:'55000',message:'Relance reconstruite'}},409],
    [{data:{ok:false,code:'reminder_missing',error:'Relance introuvable'},error:null},404],
    [{data:{ok:true,already_exists:true},error:null},200],
  ]){
    const client=reminderClient(rpcResult);
    assert.equal((await request(runtime(client),'declare-reminder-sent',{id:reminderId,prepared_at:reminderVersion,confirmed:true})).status,status);
    assert.equal(client.mutations.length,0);
  }
});

test('Une déclaration sans confirmation ou sans version exploitable ne touche pas la base',async()=>{
  for(const patch of [{confirmed:false},{prepared_at:null},{prepared_at:''},{prepared_at:'2026-02-30T12:00:00Z'},
    {prepared_at:'2026-01-01T25:00:00Z'},{prepared_at:'2026-01-01T12:00:00.1234567Z'},
    {prepared_at:'2026-01-01T12:00:00+23:00'},{id:'bad'}]){
    const client=mockClient();
    const result=await request(runtime(client),'declare-reminder-sent',{id:reminderId,prepared_at:reminderVersion,confirmed:true,...patch});
    assert.equal(result.status,400);
    assert.equal(client.calls.length,0);
  }
});

const irlRuleBody={lease_id:leaseId,revision_due_on:'2026-03-01',reference_quarter:4,target_year:2025,
  has_revision_clause:true,dpe_rating:'D',geographic_scope:'metropole',is_mobility_lease:false,confirmed:true};
function irlClient(overrides={},options={}){
  return mockClient({rental_leases:[{...draftLease,status:'active',lease_kind:'residential',start_date:'2020-01-01',verified_at:'2020-01-01T00:00:00Z'}],...overrides},options);
}

test('La règle IRL exige une année cible explicite et transmet celle choisie sans l’inférer de l’échéance',async()=>{
  const client=irlClient();
  assert.equal((await request(runtime(client),'save-irl-rule',irlRuleBody)).status,200);
  assert.equal(client.data.rental_irl_lease_rules[0].target_year,2025);
  for(const target_year of [undefined,null,'',2000,2101,2025.5,'année']){
    const invalid=irlClient();
    assert.equal((await request(runtime(invalid),'save-irl-rule',{...irlRuleBody,target_year})).status,400);
    assert.equal(invalid.mutations.length,0);
  }
});

test('Un brouillon IRL peut corriger ses règles et sa date sans réécrire l’ancienne proposition',async()=>{
  const previous={...irlRuleBody,target_year:2024,revision_due_on:'2026-01-01'};
  const proposal={id:reminderId,lease_id:leaseId,revision_due_on:previous.revision_due_on,status:'draft',draft_revision:1};
  const client=irlClient({rental_irl_lease_rules:[previous],rental_irl_proposals:[proposal]});
  assert.equal((await request(runtime(client),'save-irl-rule',irlRuleBody)).status,200);
  assert.equal(client.data.rental_irl_lease_rules[0].target_year,2025);
  assert.equal(client.data.rental_irl_lease_rules[0].revision_due_on,'2026-03-01');
  assert.deepEqual(client.data.rental_irl_proposals,[proposal]);
});

test('Les règles associées à une révision programmée ou annulée gardent leur année cible',async()=>{
  for(const status of ['scheduled','cancelled']){
    const previous={...irlRuleBody,target_year:2024};
    const client=irlClient({rental_irl_lease_rules:[previous],rental_irl_proposals:[{id:reminderId,lease_id:leaseId,revision_due_on:previous.revision_due_on,status}]});
    assert.equal((await request(runtime(client),'save-irl-rule',irlRuleBody)).status,409);
    assert.equal(client.mutations.length,0);
  }
});

test('La règle IRL est sauvegardée sous verrou par RPC sans pouvoir écraser une programmation concurrente',async()=>{
  const client=irlClient();
  assert.equal((await request(runtime(client),'save-irl-rule',{...irlRuleBody,verified_by:'untrusted',status:'scheduled'})).status,200);
  const params=client.calls.find(call=>call.rpc==='marne_save_irl_rule').params;
  assert.equal(params.p_by,admin.username);
  assert.equal(params.p_lease_id,leaseId);
  assert.deepEqual(Object.keys(params.p_rule).sort(),['dpe_rating','geographic_scope','has_revision_clause','is_mobility_lease','reference_quarter','revision_due_on','target_year']);
  assert.equal(client.calls.some(call=>call.table==='rental_irl_lease_rules'&&call.operation!=='select'),false);
  const conflict=irlClient({}, {rpcResult(name){return name==='marne_save_irl_rule'?{data:null,error:{code:'55000',message:'Révision programmée simultanément'}}:null;}});
  const result=await request(runtime(conflict),'save-irl-rule',irlRuleBody);
  assert.equal(result.status,409);
  assert.equal(result.body.error,'Révision programmée simultanément');
  assert.equal(conflict.mutations.length,0);
});

test('La programmation IRL transmet la révision exacte du brouillon et présente les conflits historiques',async()=>{
  const body={proposal_id:reminderId,notice_sent_on:'2026-01-01',notice_method:'registered_post',expected_revision:2,confirmed:true};
  const client=irlClient({}, {rpcResult(name){return name==='marne_schedule_irl_application'?{data:{application_id:'application-qa'},error:null}:null;}});
  assert.equal((await request(runtime(client),'schedule-irl',body)).status,200);
  assert.equal(client.calls.find(call=>call.rpc==='marne_schedule_irl_application').params.p_expected_revision,2);
  for(const expected_revision of [undefined,null,0,-1,1.5,true,[2],2147483648]){
    const invalid=irlClient();
    assert.equal((await request(runtime(invalid),'schedule-irl',{...body,expected_revision})).status,400);
    assert.equal(invalid.mutations.length,0);
  }
  for(const action of ['prepare-irl','schedule-irl']){
    const conflict=irlClient({}, {rpcResult(){return {data:null,error:{code:'55000',message:'Historique protégé'}};}});
    const payload=action==='prepare-irl'?{lease_id:leaseId,confirmed:true}:body;
    assert.equal((await request(runtime(conflict),action,payload)).status,409);
    assert.equal(conflict.mutations.length,0);
  }
});

test('La lecture expose les vérifications des montants et les versions IRL sans laisser les champs au hasard',async()=>{
  const client=mockClient();
  assert.equal((await request(runtime(client),'data',undefined,'GET')).status,200);
  const installmentFields=client.calls.find(call=>call.table==='rental_installments').fields.split(',');
  assert.ok(installmentFields.includes('amount_verified_at'));
  assert.ok(installmentFields.includes('amount_verified_by'));
  const proposalFields=client.calls.find(call=>call.table==='rental_irl_proposals').fields.split(',');
  assert.ok(proposalFields.includes('draft_revision'));
  assert.ok(proposalFields.includes('draft_history'));
  assert.ok(client.calls.find(call=>call.table==='rental_irl_lease_rules').fields.split(',').includes('target_year'));
});

const irlIndexBody={year:2025,quarter:4,value:'145,78',published_on:'2026-01-15',source_url:'https://www.insee.fr/fr/statistiques/1234567',confirmed:true};
test('Un indice officiel attesté passe à une RPC insert-only avec les valeurs explicites',async()=>{
  const client=mockClient({}, {rpcResult(name){return name==='marne_register_irl_index'?{data:{ok:true,item:{year:2025,quarter:4,value:145.78},already_exists:false},error:null}:null;}});
  const result=await request(runtime(client),'irl-register',irlIndexBody);
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls.find(call=>call.rpc==='marne_register_irl_index').params)),{
    p_year:2025,p_quarter:4,p_value:145.78,p_published_on:'2026-01-15',p_source_url:irlIndexBody.source_url,p_by:admin.username,p_confirmed:true,
  });
  assert.equal(client.mutations.some(call=>call.table==='rental_irl_indices'),false);
});

test('Une source IRL externe, une publication impossible ou des décimales excessives ne sont jamais enregistrées',async()=>{
  for(const patch of [{year:2000,quarter:1,published_on:'2000-03-31'},{year:1e50},{quarter:5},{value:0},{value:-1},{value:'145.781'},
    {value:100000},{published_on:'2026-02-30'},{published_on:'2999-01-01'},{source_url:'https://evil.invalid/123'},
    {source_url:'https://www.insee.fr.evil.invalid/fr/statistiques/123'},{source_url:'https://www.insee.fr/fr/statistiques/123?redirect=bad'},{confirmed:false}]){
    const client=mockClient();
    assert.equal((await request(runtime(client),'irl-register',{...irlIndexBody,...patch})).status,400);
    assert.equal(client.calls.length,0);
  }
});

test('Un indice existant identique est idempotent et une divergence ne déclenche aucune écriture de secours',async()=>{
  for(const [rpcResult,status] of [
    [{data:{ok:true,already_exists:true,item:{}},error:null},200],
    [{data:null,error:{code:'23505',message:'Indice existant différent'}},409],
  ]){
    const client=mockClient({}, {rpcResult(){return rpcResult;}});
    assert.equal((await request(runtime(client),'irl-register',irlIndexBody)).status,status);
    assert.equal(client.mutations.length,0);
  }
});

test('Les relances et l’import IRL respectent les droits et la lecture seule',async()=>{
  for(const account of [
    {username:'qa-no-finance',role:'staff',permissions:{marne_tenants:true}},
    {username:'qa-readonly',role:'marne_invest',permissions:{readonly:true,marne_admin:true}},
  ])for(const [action,body] of [
    ['prepare-reminder',{installment_id:reminderInstallmentId,stage:7}],
    ['declare-reminder-sent',{id:reminderId,prepared_at:reminderVersion,confirmed:true}],
    ['irl-register',irlIndexBody],
  ]){
    const client=mockClient();
    assert.equal((await request(runtime(client,account),action,body)).status,403);
    assert.equal(client.calls.length,0);
  }
  const accountant=mockClient();
  assert.equal((await request(runtime(accountant,{username:'qa-accounting',role:'marne_invest',permissions:{}}),'irl-register',irlIndexBody)).status,403);
  assert.equal(accountant.calls.length,0);
});
