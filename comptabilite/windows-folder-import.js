let windowsInvoiceFolder=null;
let windowsFolderTimer=null;
let windowsFolderBusy=false;
let windowsFolderLastScan=null;
const WINDOWS_FOLDER_DB='gestion-college-accounting';
const WINDOWS_FOLDER_STORE='folder-handles';
const WINDOWS_FOLDER_KEY='invoice-folder';
const WINDOWS_SEEN_KEY='college_accounting_folder_seen_v1';

function windowsFolderSupported(){return !!window.showDirectoryPicker&&window.isSecureContext}
function windowsSeen(){try{return JSON.parse(localStorage.getItem(WINDOWS_SEEN_KEY)||'{}')}catch{return {}}}
function saveWindowsSeen(seen){const entries=Object.entries(seen).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,2000);localStorage.setItem(WINDOWS_SEEN_KEY,JSON.stringify(Object.fromEntries(entries)))}
function windowsFileKey(file){return `${file.name}|${file.size}|${file.lastModified}`}
function openWindowsFolderDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(WINDOWS_FOLDER_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(WINDOWS_FOLDER_STORE))r.result.createObjectStore(WINDOWS_FOLDER_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function storeWindowsFolder(handle){const d=await openWindowsFolderDb();await new Promise((resolve,reject)=>{const t=d.transaction(WINDOWS_FOLDER_STORE,'readwrite');t.objectStore(WINDOWS_FOLDER_STORE).put(handle,WINDOWS_FOLDER_KEY);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});d.close()}
async function readWindowsFolder(){const d=await openWindowsFolderDb();const h=await new Promise((resolve,reject)=>{const t=d.transaction(WINDOWS_FOLDER_STORE,'readonly'),r=t.objectStore(WINDOWS_FOLDER_STORE).get(WINDOWS_FOLDER_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});d.close();return h}
async function clearWindowsFolder(){try{const d=await openWindowsFolderDb();await new Promise((resolve,reject)=>{const t=d.transaction(WINDOWS_FOLDER_STORE,'readwrite');t.objectStore(WINDOWS_FOLDER_STORE).delete(WINDOWS_FOLDER_KEY);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});d.close()}catch{}windowsInvoiceFolder=null;stopWindowsFolderWatcher();renderWindowsFolderStatus()}
async function folderPermission(handle,request=false){if(!handle)return false;let p=await handle.queryPermission({mode:'read'});if(p==='granted')return true;if(request)p=await handle.requestPermission({mode:'read'});return p==='granted'}

const originalImportPage=importPage;
importPage=function(){
  originalImportPage();
  const content=$('content');
  if(!content)return;
  const supported=windowsFolderSupported();
  content.insertAdjacentHTML('afterbegin',`<div class="card"><div class="actions" style="justify-content:space-between;align-items:flex-start"><div><h2>Dossier Windows automatique</h2><p class="muted">Choisis un dossier avec l’Explorateur Windows. Les nouveaux PDF seront recherchés automatiquement toutes les 30 secondes tant que cette page est ouverte dans Edge ou Chrome.</p></div><span class="badge ${supported?'okb':'errb'}">${supported?'Compatible':'Non compatible'}</span></div>${supported?`<div class="actions"><button class="btn primary" onclick="chooseWindowsInvoiceFolder()">Choisir / changer le dossier</button><button id="wfAuth" class="btn secondary hide" onclick="authorizeWindowsInvoiceFolder()">Réautoriser le dossier</button><button id="wfScan" class="btn secondary" onclick="scanWindowsInvoiceFolder(true)">Rechercher maintenant</button><button id="wfStop" class="btn secondary" onclick="toggleWindowsFolderWatcher()">Suspendre</button><button class="btn secondary" onclick="clearWindowsFolder()">Oublier le dossier</button></div><div id="wfStatus" class="status"></div><div id="wfLog" class="muted"></div>`:`<div class="status err">Cette fonction nécessite Microsoft Edge ou Google Chrome sur Windows, avec le site ouvert en HTTPS.</div>`}</div>`);
  renderWindowsFolderStatus();
}

async function chooseWindowsInvoiceFolder(){
  try{
    const h=await window.showDirectoryPicker({id:'gestion-college-factures',mode:'read'});
    windowsInvoiceFolder=h;
    await storeWindowsFolder(h);
    if(!await folderPermission(h,true))throw new Error('Autorisation de lecture refusée.');
    startWindowsFolderWatcher();
    renderWindowsFolderStatus('Dossier sélectionné. Première recherche en cours…');
    await scanWindowsInvoiceFolder(true);
  }catch(e){if(e?.name!=='AbortError')renderWindowsFolderStatus(e.message||'Impossible d’ouvrir le dossier.',true)}
}
async function authorizeWindowsInvoiceFolder(){
  try{
    if(!windowsInvoiceFolder)windowsInvoiceFolder=await readWindowsFolder();
    if(!windowsInvoiceFolder)return renderWindowsFolderStatus('Choisis d’abord un dossier.',true);
    if(!await folderPermission(windowsInvoiceFolder,true))return renderWindowsFolderStatus('Autorisation refusée.',true);
    startWindowsFolderWatcher();
    renderWindowsFolderStatus('Dossier autorisé.');
    await scanWindowsInvoiceFolder(true);
  }catch(e){renderWindowsFolderStatus(e.message||'Autorisation impossible.',true)}
}
function startWindowsFolderWatcher(){if(windowsFolderTimer)clearInterval(windowsFolderTimer);windowsFolderTimer=setInterval(()=>scanWindowsInvoiceFolder(false),30000);renderWindowsFolderStatus()}
function stopWindowsFolderWatcher(){if(windowsFolderTimer){clearInterval(windowsFolderTimer);windowsFolderTimer=null}renderWindowsFolderStatus()}
function toggleWindowsFolderWatcher(){if(windowsFolderTimer)stopWindowsFolderWatcher();else{startWindowsFolderWatcher();scanWindowsInvoiceFolder(true)}}
function renderWindowsFolderStatus(message='',isError=false){
  const s=$('wfStatus'),a=$('wfAuth'),stop=$('wfStop');if(!s)return;
  const folder=windowsInvoiceFolder?.name||'Aucun dossier sélectionné';
  const state=windowsFolderTimer?'Surveillance active':'Surveillance suspendue';
  s.className='status '+(isError?'err':'');
  s.innerHTML=message?esc(message):`Dossier : <b>${esc(folder)}</b> · ${state}${windowsFolderLastScan?` · Dernière recherche : ${windowsFolderLastScan.toLocaleTimeString('fr-FR')}`:''}`;
  if(stop)stop.textContent=windowsFolderTimer?'Suspendre':'Activer la surveillance';
  if(a)a.classList.toggle('hide',!windowsInvoiceFolder);
}
function setWindowsFolderLog(text){const e=$('wfLog');if(e)e.textContent=text}

async function importWindowsPdf(file){
  const t=await textPdf(file),a=amounts(t),f=new FormData();
  f.append('file',file);f.append('raw_text',t);f.append('supplier',supplier(t));f.append('invoice_number',invNo(t));f.append('invoice_date',invDate(t));f.append('amount_ht',a.ht??'');f.append('amount_vat',a.vat??'');f.append('amount_ttc',a.ttc??'');f.append('vat_rate',a.rate??'');
  const r=await api('upload','POST',f,true);
  return await r.json();
}
async function scanWindowsInvoiceFolder(manual=false){
  if(windowsFolderBusy||!windowsFolderSupported())return;
  windowsFolderBusy=true;
  try{
    if(!windowsInvoiceFolder)windowsInvoiceFolder=await readWindowsFolder();
    if(!windowsInvoiceFolder){if(manual)renderWindowsFolderStatus('Choisis d’abord un dossier Windows.',true);return}
    const ok=await folderPermission(windowsInvoiceFolder,false);
    if(!ok){stopWindowsFolderWatcher();renderWindowsFolderStatus('Le navigateur demande de réautoriser ce dossier.',true);const b=$('wfAuth');if(b)b.classList.remove('hide');return}
    const seen=windowsSeen(),files=[];
    for await(const [name,handle] of windowsInvoiceFolder.entries()){
      if(handle.kind!=='file'||!name.toLowerCase().endsWith('.pdf'))continue;
      const file=await handle.getFile(),key=windowsFileKey(file);
      if(!seen[key])files.push({file,key});
    }
    files.sort((a,b)=>a.file.lastModified-b.file.lastModified);
    if(!files.length){windowsFolderLastScan=new Date();renderWindowsFolderStatus();setWindowsFolderLog('Aucun nouveau PDF à importer.');return}
    let imported=0,duplicates=0,errors=0;
    setWindowsFolderLog(`${files.length} nouveau(x) PDF détecté(s).`);
    for(let i=0;i<files.length;i++){
      const {file,key}=files[i];
      try{
        if($('imsg'))$('imsg').textContent=`Dossier Windows : ${file.name} (${i+1}/${files.length})`;
        await importWindowsPdf(file);
        seen[key]=Date.now();imported++;
      }catch(e){
        const msg=String(e?.message||e||'');
        if(/déjà été importée|deja ete importee|already/i.test(msg)){seen[key]=Date.now();duplicates++}else{errors++;console.error('Import dossier Windows',file.name,e)}
      }
      saveWindowsSeen(seen);
    }
    windowsFolderLastScan=new Date();
    await refresh();
    if(page!=='import')page='import';
    render();
    renderWindowsFolderStatus();
    setWindowsFolderLog(`${imported} facture(s) importée(s) · ${duplicates} déjà présente(s) · ${errors} erreur(s).`);
  }catch(e){renderWindowsFolderStatus(e.message||'Erreur pendant la lecture du dossier.',true)}finally{windowsFolderBusy=false}
}

async function restoreWindowsInvoiceFolder(){
  if(!windowsFolderSupported())return;
  try{
    windowsInvoiceFolder=await readWindowsFolder();
    if(!windowsInvoiceFolder)return;
    if(await folderPermission(windowsInvoiceFolder,false)){startWindowsFolderWatcher();setTimeout(()=>scanWindowsInvoiceFolder(false),1500)}
  }catch(e){console.warn('Restauration dossier factures impossible',e)}
}
setTimeout(restoreWindowsInvoiceFolder,800);
