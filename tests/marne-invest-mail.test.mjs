import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const path=process.env.MARNE_MAIL_SOURCE||new URL('../supabase/functions/marne-mail-transport/index.ts',import.meta.url);
const source=stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\r?\n/gm,''));
const account='fixture@free.fr';
const makeMessages=(n,start=1)=>Array.from({length:n},(_,i)=>({uid:start+i,text:'Message de test '+(start+i),size:80}));
const tokenFor=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

function database(clock,options={}){
 const state={epoch:'1',last:0,target:0,token:null,until:0,serial:0,messages:new Map(),...options.initial};
 const calls=[];
 return {state,calls,async rpc(name,p){
  calls.push({name,p:structuredClone(p)});
  if(options.beforeRpc)await options.beforeRpc(name,p,state,clock);
  if(name==='marne_mail_sync_claim'){
   if(state.token&&state.until>clock.now)return {data:{claimed:false},error:null};
   if(state.epoch!==String(p.p_uidvalidity)){state.epoch=String(p.p_uidvalidity);state.last=0;}
   if(state.last>p.p_target_uid)return {data:null,error:{code:'22023'}};
   state.target=p.p_target_uid;state.token=tokenFor(++state.serial);state.until=clock.now+120000;
   return {data:{claimed:true,token:state.token,last_uid:state.last,target_uid:state.target,uidvalidity:state.epoch},error:null};
  }
  if(name==='marne_mail_sync_checkpoint'){
   if(state.token!==p.p_token||state.until<=clock.now||state.epoch!==String(p.p_uidvalidity)||state.last!==p.p_expected_last_uid)
    return {data:null,error:{code:'55000'}};
   if(p.p_scanned_through_uid<=state.last||p.p_scanned_through_uid>state.target)return {data:null,error:{code:'22023'}};
   if(options.failCheckpoint===p.p_scanned_through_uid)return {data:null,error:{code:'TEST_DB'}};
   let inserted=false;
   if(p.p_message){
    assert.equal(p.p_message.uid,p.p_scanned_through_uid);
    const key=state.epoch+':'+p.p_message.uid;
    if(!state.messages.has(key)){state.messages.set(key,structuredClone(p.p_message));inserted=true;}
   }
   state.last=p.p_scanned_through_uid;
   if(options.loseAck===state.last)throw Error('Simulated lost response after commit');
   return {data:{last_uid:state.last,inserted},error:null};
  }
  if(name==='marne_mail_sync_release'){
   const released=state.token===p.p_token;
   if(released){state.token=null;state.until=0;}
   return {data:{released},error:null};
  }
  throw Error('Unexpected database operation '+name);
 }};
}

function mailbox(messages,clock,options={}){
 const data=messages.map(message=>({...message})).sort((a,b)=>a.uid-b.uid);
 const listeners=new Map(),calls=[];
 const client={data,calls,closed:false,released:false,
  mailbox:{path:'INBOX',uidValidity:BigInt(options.epoch??1),uidNext:options.uidNext??((data.at(-1)?.uid||0)+1),exists:data.length,readOnly:true},
  on(event,callback){if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(callback);},
  emit(event,payload){for(const fn of listeners.get(event)||[])fn(payload);},
  remove(uid){const index=data.findIndex(message=>message.uid===uid);if(index<0)return;data.splice(index,1);client.mailbox.exists=data.length;client.emit('expunge',{path:'INBOX',seq:index+1});},
  add(message){const previous=data.length;data.push(message);data.sort((a,b)=>a.uid-b.uid);client.mailbox.exists=data.length;client.mailbox.uidNext=message.uid+1;client.emit('exists',{path:'INBOX',prevCount:previous,count:data.length});},
  async connect(){calls.push({action:'connect'});},
  async getMailboxLock(folder,config){assert.equal(folder,'INBOX');assert.equal(config.readOnly,true);calls.push({action:'lock'});return {release(){client.released=true;}};},
  async fetchOne(number,query,config){
   const uidMode=config?.uid===true;
   calls.push({action:uidMode?'source':'probe',number:Number(number),query,config});
   if(options.beforeFetchOne)await options.beforeFetchOne(client,number,query,config,clock);
   const index=uidMode?data.findIndex(message=>message.uid===Number(number)):Number(number)-1;
   const message=data[index];
   if(!message)return false;
   if(uidMode){
    assert.equal(query.source.maxLength,700001);
    if(message.networkFailure)throw Error('Simulated IMAP read failure');
    if(message.noSource)return {seq:index+1,uid:message.uid};
    const bytes=new Uint8Array(message.sourceLength??message.size);
    if(bytes.length>=4)new DataView(bytes.buffer).setUint32(0,message.uid);
    return {seq:index+1,uid:message.uid,source:bytes};
   }
   return {seq:index+1,uid:message.uid};
  },
  async fetchAll(range,query,config){
   calls.push({action:'batch',range,query,config});
   assert.equal(config.uid,false);
   const [from,to]=range.split(':').map(Number);
   assert.ok(to-from<30);
   if(options.beforeFetchAll)await options.beforeFetchAll(client,clock);
   let entries=data.slice(from-1,to).map((message,i)=>({
    seq:from+i,uid:message.uid,size:message.size,flags:new Set(),internalDate:'2026-11-23T09:00:00Z',
    envelope:{subject:'Objet '+message.uid,from:[{address:'sender@example.invalid'}],to:[{address:account}],messageId:'<fixture-'+message.uid+'@example.invalid>'},
   }));
   if(options.alterBatch)entries=options.alterBatch(entries,client);
   return entries;
  },
  async logout(){calls.push({action:'logout'});client.closed=true;},
  close(){client.closed=true;client.mailbox=false;client.emit('mailboxClose',{});},
 };
 return client;
}

function runtime(messages,options={}){
 const clock=options.clock||{now:0};
 const db=options.db||database(clock,options.dbOptions);
 const client=mailbox(messages,clock,options.mailOptions);
 const timers=new Map();let timerId=0;
 class TestDate extends Date {static now(){return clock.now;}}
 const context=vm.createContext({
  Date:TestDate,Request,Response,URL,Uint8Array,TextEncoder,TextDecoder,
  setTimeout(fn,ms){assert.equal(ms,55000);timers.set(++timerId,fn);return timerId;},
  clearTimeout(id){timers.delete(id);},
  console:{error(){}},
  fetch(){throw Error('Network forbidden in isolated mail tests');},
  Deno:{serve(fn){context.handler=fn;},env:{get(){throw Error('Real secrets are unavailable in isolated tests');}}},
  fixtureClient:client,fixtureDb:db,
  PostalMime:{async parse(bytes){
   const uid=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
   const message=client.data.find(item=>item.uid===uid);
   if(message?.parseFailed)throw Error('Simulated invalid MIME');
   return {text:message?.text??'',html:message?.html,subject:'Objet '+uid,from:{address:'sender@example.invalid'},to:[{address:account}],attachments:message?.attachments||[]};
  }},
 });
 vm.runInContext(source+'\nimapConnection=()=>fixtureClient; database=()=>fixtureDb;',context);
 return {context,client,db,clock,timers,run:()=>context.syncInbox('fixture-only-password',account)};
}

test('80 courriels sont rattrapés en trois lots sans sauter les plus anciens',async()=>{
 const clock={now:0},db=database(clock),messages=makeMessages(80),results=[];
 for(let i=0;i<3;i++)results.push(await runtime(messages,{clock,db}).run());
 assert.deepEqual(results.map(result=>result.imported),[30,30,20]);
 assert.deepEqual(results.map(result=>result.has_more),[true,true,false]);
 assert.equal(db.state.last,80);assert.equal(db.state.messages.size,80);
 assert.deepEqual([...db.state.messages.values()].map(message=>message.uid),messages.map(message=>message.uid));
});

test('Le bootstrap repart de zéro même si seuls les 30 derniers UID avaient été importés',async()=>{
 const clock={now:0},db=database(clock),messages=makeMessages(80);
 for(const message of messages.slice(50))db.state.messages.set('1:'+message.uid,{uid:message.uid});
 let imported=0;
 for(let i=0;i<3;i++)imported+=(await runtime(messages,{clock,db}).run()).imported;
 assert.equal(imported,50);assert.equal(db.state.messages.size,80);assert.equal(db.state.last,80);
});

test('Des UID proches de 2^32 et très espacés ne déclenchent aucun balayage de milliards de valeurs',async()=>{
 const messages=[{uid:1,size:80,text:'A'},{uid:2147483648,size:80,text:'B'},{uid:4294967294,size:80,text:'C'}];
 const run=runtime(messages),result=await run.run();
 assert.equal(result.imported,3);assert.equal(result.has_more,false);assert.equal(run.db.state.last,4294967294);
 assert.equal(run.client.calls.filter(call=>call.action==='batch').length,1);
 assert.equal(run.client.calls.filter(call=>call.action==='probe').length,0);
});

test('La recherche binaire reste bornée à32 sondes pour le nombre maximal de séquences',async()=>{
 const max=4294967295;let probes=0,batches=0;
 const client={mailbox:{exists:max,uidValidity:1n},async fetchOne(seq){probes++;return {seq,uid:seq};},async fetchAll(range){batches++;const [a,b]=range.split(':').map(Number);return Array.from({length:b-a+1},(_,i)=>({seq:a+i,uid:a+i}));}};
 const r=runtime([]);
 const batch=await r.context.nextInboxBatch(client,max-2,max,'1',()=>0,40000);
 assert.ok(probes<=32);assert.equal(batches,1);assert.equal(batch.entries.length,2);assert.equal(batch.atEnd,true);
});

test('Un EXPUNGE pendant le repérage invalide le lot sans avancer le curseur',async()=>{
 let changed=false;
 const run=runtime(makeMessages(80),{dbOptions:{initial:{last:30,target:80}},mailOptions:{beforeFetchOne(client,number,query,config){if(!config.uid&&!changed){changed=true;client.remove(1);}}}});
 await assert.rejects(run.run(),error=>error.code==='mailbox_changed');
 assert.equal(run.db.state.last,30);assert.equal(run.db.state.messages.size,0);
 assert.equal(run.db.calls.some(call=>call.name==='marne_mail_sync_checkpoint'),false);
 assert.equal(run.client.released,true);assert.equal(run.timers.size,0);
});

test('Suppression puis arrivée avec le même compteur final restent détectées',async()=>{
 let changed=false;
 const run=runtime(makeMessages(80),{dbOptions:{initial:{last:30,target:80}},mailOptions:{beforeFetchOne(client,number,query,config){if(!config.uid&&!changed){changed=true;client.remove(1);client.add({uid:81,size:80,text:'Nouveau'});}}}});
 await assert.rejects(run.run(),error=>error.code==='mailbox_changed');
 assert.equal(run.client.mailbox.exists,80);assert.equal(run.db.state.last,30);
});

test('Un lot de métadonnées incomplet ne permet aucune avance',async()=>{
 const run=runtime(makeMessages(3),{mailOptions:{alterBatch(entries){return entries.slice(1);}}});
 await assert.rejects(run.run(),error=>error.code==='imap_incomplete_batch');
 assert.equal(run.db.state.last,0);assert.equal(run.db.state.messages.size,0);
});

test('Une suppression après la stabilisation ne dépasse pas un message encore non traité',async()=>{
 let changed=false;
 const run=runtime(makeMessages(3),{mailOptions:{beforeFetchOne(client,number,query,config,clock){if(config.uid&&!changed){changed=true;client.remove(3);clock.now=40001;}}}});
 const first=await run.run();
 assert.equal(first.has_more,true);assert.equal(run.db.state.last,1);assert.equal(run.db.state.messages.has('1:2'),false);
 run.clock.now=0;
 const next=await runtime(run.client.data,{clock:run.clock,db:run.db,mailOptions:{uidNext:4}}).run();
 assert.equal(next.has_more,false);assert.equal(run.db.state.last,3);assert.equal(run.db.state.messages.has('1:2'),true);
});

test('Un message supprimé avant sa lecture UID est traité comme absent, sans bloquer le suivant',async()=>{
 let removed=false;
 const run=runtime(makeMessages(3),{mailOptions:{beforeFetchOne(client,number,query,config){if(config.uid&&Number(number)===2&&!removed){removed=true;client.remove(2);}}}});
 const result=await run.run();
 assert.equal(result.has_more,false);assert.equal(run.db.state.last,3);
 assert.deepEqual([...run.db.state.messages.values()].map(message=>message.uid),[1,3]);
});

test('Une panne de lecture reprend au dernier message durablement enregistré',async()=>{
 const messages=makeMessages(50);messages[16].networkFailure=true;
 const run=runtime(messages);
 await assert.rejects(run.run(),/Simulated IMAP read failure/);
 assert.equal(run.db.state.last,16);assert.equal(run.db.state.messages.size,16);
 messages[16].networkFailure=false;
 await runtime(messages,{clock:run.clock,db:run.db}).run();
 const last=await runtime(messages,{clock:run.clock,db:run.db}).run();
 assert.equal(last.has_more,false);assert.equal(run.db.state.messages.size,50);
});

test('Une erreur de checkpoint ne saute pas le message dont l’écriture a échoué',async()=>{
 const run=runtime(makeMessages(5),{dbOptions:{failCheckpoint:3}});
 await assert.rejects(run.run(),error=>error.code==='sync_checkpoint_failed');
 assert.equal(run.db.state.last,2);assert.equal(run.db.state.messages.size,2);
});

test('Une réponse perdue après commit ne crée pas de doublon lors de la reprise',async()=>{
 const run=runtime(makeMessages(5),{dbOptions:{loseAck:3}});
 await assert.rejects(run.run(),/lost response/);
 assert.equal(run.db.state.last,3);assert.equal(run.db.state.messages.size,3);
 const next=await runtime(makeMessages(5),{clock:run.clock,db:run.db}).run();
 assert.equal(next.imported,2);assert.equal(run.db.state.messages.size,5);
});

test('UIDVALIDITY différent reprend à zéro dans un espace de UID distinct',async()=>{
 const clock={now:0},db=database(clock,{initial:{epoch:'1',last:100,target:100}});
 db.state.messages.set('1:1',{uid:1,uidvalidity:'1'});
 const result=await runtime(makeMessages(2),{clock,db,mailOptions:{epoch:2}}).run();
 assert.equal(result.imported,2);assert.equal(db.state.epoch,'2');assert.equal(db.state.last,2);
 assert.equal(db.state.messages.has('1:1'),true);assert.equal(db.state.messages.has('2:1'),true);
});

test('Le worker occupé ne lance ni téléchargement ni checkpoint',async()=>{
 const run=runtime(makeMessages(5),{dbOptions:{initial:{token:tokenFor(99),until:100000}}});
 const result=await run.run();
 assert.equal(result.busy,true);assert.equal(result.has_more,null);assert.equal(result.imported,0);
 assert.equal(run.client.calls.some(call=>['probe','batch','source'].includes(call.action)),false);
 assert.equal(run.db.calls.length,1);assert.equal(run.db.state.token,tokenFor(99));
});

test('Un jeton remplacé ou expiré empêche toute écriture tardive',async()=>{
 for(const expire of [false,true]){
  const run=runtime(makeMessages(2),{dbOptions:{beforeRpc(name,p,state,clock){if(name==='marne_mail_sync_checkpoint'){if(expire)state.until=clock.now;else state.token=tokenFor(77);}}}});
  await assert.rejects(run.run(),error=>error.code==='sync_lock_lost');
  assert.equal(run.db.state.messages.size,0);assert.equal(run.db.state.last,0);
  if(!expire)assert.equal(run.db.state.token,tokenFor(77));
 }
});

test('Les messages volumineux gardent leurs en-têtes avec un statut incomplet explicite',async()=>{
 const run=runtime([{uid:1,size:900000,text:'Trop grand'}]);
 const result=await run.run(),row=run.db.state.messages.get('1:1');
 assert.equal(result.imported,1);assert.equal(result.metadata_only,1);assert.equal(result.has_more,false);
 assert.equal(row.body_status,'metadata_only');assert.equal(row.body_note,'size_limit');assert.equal(row.source_size,900000);
 assert.match(row.plain_body,/boîte Free/);assert.equal(run.client.calls.some(call=>call.action==='source'),false);
});

test('Une taille invalide, MIME illisible ou absence de partie texte sont signalées séparément',async()=>{
 const cases=[{uid:1,size:null,text:'inconnu'},{uid:2,size:80,parseFailed:true},{uid:3,size:80,text:'',html:'<p>HTML</p>'}];
 const run=runtime(cases),result=await run.run();
 assert.equal(result.metadata_only,3);
 assert.deepEqual([...run.db.state.messages.values()].map(row=>row.body_note),['invalid_size','parse_failed','no_text_part']);
});

test('Le texte limité à30 000 caractères est explicitement tronqué sans casser Unicode',async()=>{
 const run=runtime([{uid:1,size:130000,text:'😀'.repeat(30001)}]);
 const result=await run.run(),row=run.db.state.messages.get('1:1');
 assert.equal(row.body_status,'truncated');assert.equal(row.body_note,'text_limit');
 assert.equal(Array.from(row.plain_body).length,30000);assert.equal(row.plain_body,'😀'.repeat(30000));
 assert.equal(result.truncated,1);assert.equal(result.metadata_only,0);
});

test('Une source absente ou une epoch changée pendant le téléchargement ne valide pas de message',async()=>{
 const missing=runtime([{uid:1,size:80,noSource:true}]);
 await assert.rejects(missing.run(),error=>error.code==='imap_source_missing');assert.equal(missing.db.state.last,0);
 const changed=runtime(makeMessages(1),{mailOptions:{beforeFetchOne(client,number,query,config){if(config.uid)client.mailbox.uidValidity=2n;}}});
 await assert.rejects(changed.run(),error=>error.code==='mailbox_changed');assert.equal(changed.db.state.last,0);
});

test('Le budget interrompu pendant les sondes ne saute aucune plage',async()=>{
 const run=runtime(makeMessages(80),{dbOptions:{initial:{last:30,target:80}},mailOptions:{beforeFetchOne(client,number,query,config,clock){if(!config.uid)clock.now=40001;}}});
 const result=await run.run();
 assert.equal(result.has_more,true);assert.equal(result.checked,0);assert.equal(run.db.state.last,30);
 assert.equal(run.db.calls.some(call=>call.name==='marne_mail_sync_checkpoint'),false);
});

test('Une boîte vide peut confirmer des anciens UID désormais absents',async()=>{
 const run=runtime([],{mailOptions:{uidNext:1000000000}}),result=await run.run();
 assert.equal(result.has_more,false);assert.equal(result.imported,0);assert.equal(run.db.state.last,999999999);
 assert.equal(run.client.calls.some(call=>['source','probe','batch'].includes(call.action)),false);
});

test('Une arrivée postérieure au snapshot est importée au passage suivant',async()=>{
 let added=false;
 const run=runtime(makeMessages(2),{mailOptions:{beforeFetchOne(client,number,query,config){if(config.uid&&!added){added=true;client.add({uid:3,size:80,text:'Nouveau'});}}}});
 await run.run();assert.equal(run.db.state.last,2);assert.equal(run.db.state.messages.has('1:3'),false);
 const next=await runtime(run.client.data,{clock:run.clock,db:run.db}).run();
 assert.equal(next.imported,1);assert.equal(run.db.state.messages.has('1:3'),true);
});

test('L’endpoint busy ne prétend pas avoir réussi une synchronisation',async()=>{
 const run=runtime(makeMessages(1),{dbOptions:{initial:{token:tokenFor(99),until:100000}}});
 vm.runInContext("serviceKey=()=> 'fixture-key'; credentials=async()=>({account:'fixture@free.fr',pass:'fixture-password'});",run.context);
 const response=await run.context.handler(new Request('https://example.invalid/mail',{method:'POST',headers:{'x-marne-service-key':'fixture-key','content-type':'application/json'},body:'{"action":"sync"}'}));
 assert.equal(response.status,200);assert.equal((await response.json()).busy,true);
 assert.equal(run.db.calls.length,1);
});

function configurationRuntime(setting,options={}){
 const calls=[],environmentReads=[];
 const db={calls,
  from(table){
   assert.equal(table,'rental_settings');
   const query={select(){return query;},eq(key,value){assert.equal(key,'setting_key');assert.equal(value,'sender_email');return query;},
    async maybeSingle(){calls.push({table});return {data:setting,error:options.settingError||null};}};
   return query;
  },
  async rpc(name,p){calls.push({name,p});assert.equal(name,'marne_mail_password_get');return {data:options.credential??'synthetic-vault-credential',error:options.credentialError||null};},
 };
 const run=runtime([],{db});
 run.context.Deno.env.get=name=>{environmentReads.push(name);return name==='MARNE_FREE_MAIL_PASSWORD'?'synthetic-legacy-credential':undefined;};
 vm.runInContext("serviceKey=()=> 'fixture-service-key';",run.context);
 return {...run,calls,environmentReads};
}

test('Une adresse absente bloque le transport avant toute lecture de mot de passe ou connexion',async()=>{
 for(const setting of [null,{value:null},{value:''},{value:'   '}]){
  const run=configurationRuntime(setting);
  await assert.rejects(()=>run.context.credentials(),error=>error.code==='mail_account_missing');
  assert.equal(run.calls.some(call=>call.name),false);
  assert.deepEqual(run.environmentReads,[]);
  assert.deepEqual(run.client.calls,[]);
 }
});

test('Une erreur de lecture des paramètres ou une adresse invalide ne déclenche aucun fallback',async()=>{
 for(const [setting,options,pattern] of [
  [null,{settingError:{code:'TEST_LOOKUP'}},/Mail account not available/],
  [{value:'fixture@example.invalid'},{},/Unsupported Free mailbox account/],
 ]){
  const run=configurationRuntime(setting,options);
  await assert.rejects(()=>run.context.credentials(),pattern);
  assert.equal(run.calls.some(call=>call.name),false);
  assert.deepEqual(run.environmentReads,[]);
  assert.deepEqual(run.client.calls,[]);
 }
});

test('Seul le compte Free explicitement renseigné est recherché dans le coffre',async()=>{
 const run=configurationRuntime({value:' FIXTURE@FREE.FR '});
 const result=await run.context.credentials();
 assert.equal(result.account,account);
 assert.equal(result.pass,'synthetic-vault-credential');
 assert.deepEqual(run.calls.filter(call=>call.name).map(call=>({name:call.name,p:{...call.p}})),[{name:'marne_mail_password_get',p:{p_account:account}}]);
 assert.deepEqual(run.environmentReads,[]);
 assert.deepEqual(run.client.calls,[]);
});

test('Un échec du coffre sur le compte historique explicite ne déclenche pas le secours environnement',async()=>{
 const run=configurationRuntime({value:'ph.danglade@free.fr'},{credentialError:{code:'TEST_VAULT'}});
 await assert.rejects(()=>run.context.credentials(),/Encrypted mail credential not accessible/);
 assert.deepEqual(run.environmentReads,[]);
 assert.deepEqual(run.client.calls,[]);
});

test('Les endpoints transport sync, test et send refusent une adresse absente sans réseau',async()=>{
 for(const action of ['sync','test','send']){
  const run=configurationRuntime({value:''});
  const response=await run.context.handler(new Request('https://example.invalid/mail',{method:'POST',
   headers:{'x-marne-service-key':'fixture-service-key','content-type':'application/json'},
   body:JSON.stringify({action,id:tokenFor(1)})}));
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'mail_account_missing');
  assert.equal(run.calls.some(call=>call.name),false);
  assert.deepEqual(run.environmentReads,[]);
  assert.deepEqual(run.client.calls,[]);
 }
});
