"use strict";
(() => {
  const API = "https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-invoice-queue";
  const $ = id => document.getElementById(id);
  let invoices = [], currentTab = "todo", busy = false, previewUrl = null, providers = [];
  const OCR_API = "https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-ocrspace-reader";
  const VERYFI_READER = "../../lecteur-veryfi/?origine=secretariat&queue_id=";
  const session = () => localStorage.getItem("college_secretariat_token") || localStorage.getItem("edm_admin_token") || "";
  const notice = (value, error = false) => {
    $("notice").textContent = String(value);
    $("notice").className = "notice" + (error ? " error" : "");
  };
  async function api(action, method = "GET", payload, params = {}) {
    const token = session();
    if (!token) throw Error("Connectez-vous d'abord au Secrétariat.");
    const headers = { authorization: "Bearer " + token };
    let body;
    if (payload instanceof FormData) body = payload;
    else if (payload !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(payload);
    }
    const query = new URLSearchParams({ action, ...params });
    const response = await fetch(API + "?" + query.toString(), {
      method, headers, body, cache: "no-store", signal: AbortSignal.timeout(85000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw Error(result.error || "Erreur de connexion (HTTP " + response.status + ")");
    return result;
  }
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("fr-FR", {dateStyle:"short",timeStyle:"short"}).format(date);
  }
  function setBusy(value) {
    busy = value; $("upload").disabled = value; $("refresh").disabled = value;
    $("invoices").disabled = value;
  }
  function element(tag, klass, value) {
    const node = document.createElement(tag);
    if (klass) node.className = klass;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  async function fetchInvoices() {
    const result = await api("list");
    invoices = result.invoices || [];
    providers = Array.isArray(result.providers) ? result.providers : [];
    $("countTodo").textContent = invoices.filter(x => x.state === "todo").length;
    $("countDone").textContent = invoices.filter(x => x.state === "done").length;
    const backup=providers.some(p=>p.provider==="ocrspace"&&p.ready);
    $("ocrState").textContent=backup?"Veryfi principal · OCR.space secours":"Veryfi principal";
    render();
  }
  function render() {
    $("todoTab").classList.toggle("active", currentTab === "todo");
    $("doneTab").classList.toggle("active", currentTab === "done");
    const list = $("list"); list.replaceChildren();
    const selected = invoices.filter(x => x.state === currentTab);
    if (!selected.length) {
      list.append(element("p", "subtle", currentTab === "todo" ? "Aucune facture en attente." : "Aucune facture classée."));
      return;
    }
    for (const invoice of selected) {
      const item = element("article", "entry"), detail = element("div");
      detail.append(element("strong", null, invoice.file_name));
      detail.append(element("div", "meta", dateLabel(invoice.created_at) + " · " +
        (invoice.file_bytes / 1024 / 1024).toFixed(2) + " Mo · Déposée par " + invoice.uploaded_by));
      const tag = element("span", "state " + (invoice.state === "done" ? "done" : ""),
        invoice.state === "done" ? "Facture traitée" : "À traiter avec Veryfi");
      detail.append(tag);
      const actions = element("div", "actions");
      if (invoice.state === "todo") {
        const scan = element("button", null, "Lire avec OCR.space");
        scan.type = "button"; scan.disabled = invoice.ocr_status === "processing" || invoice.ocr_attempts >= 3 ||
          !providers.some(p=>p.provider==="ocrspace"&&p.ready);
        scan.title=scan.disabled?"OCR.space désactivé, facture en traitement ou maximum de lectures atteint":"Lecture OCR.space";
        scan.onclick = () => void runOcr(invoice);
        actions.append(scan);
        const veryfi=element("button","primary","Traiter avec Veryfi");
        veryfi.type="button";veryfi.onclick=()=>GenVeryfi(invoice);
        actions.prepend(veryfi);
        const sync=element("button",null,"Vérifier la réception Veryfi");
        sync.type="button";sync.onclick=()=>void syncReceipt(invoice);
        actions.append(sync);
      }
      if (invoice.ocr_attempts > 0) {
        const results = element("button", null, "Résultats OCR (" + invoice.ocr_attempts + ")");
        results.type = "button"; results.onclick = () => void showOcr(invoice);
        actions.append(results);
        // L'ancienne préanalyse Azure reste conservée au serveur pour audit, sans action en interface.
      }
      const view = element("button", null, "Voir PDF");
      view.type = "button"; view.onclick = () => void openInvoice(invoice);
      actions.append(view);
      if(invoice.state==="done"){
        const done=element("span","state done","Réception/traitement terminé");
        actions.append(done);
      }
      item.append(detail, actions); list.append(item);
    }
  }
  function GenVeryfi(invoice){
    window.top.location.assign(new URL(VERYFI_READER+encodeURIComponent(invoice.id),window.location.href).href);
  }
  async function syncReceipt(invoice){
    if(busy)return;
    setBusy(true);
    try{
      await api("sync-receipt","POST",{id:invoice.id});
      await fetchInvoices();
      notice("Réception Veryfi vérifiée par le serveur. Facture déplacée dans « Faites ».");
    }catch(e){notice("Réception non synchronisée : "+e.message,true)}
    finally{setBusy(false)}
  }
  async function runOcr(invoice) {
    if (busy) return;
    const label="OCR.space";
    const limit=1000000;
    if (invoice.file_bytes>limit)
      return notice(label+" : facture supérieure à "+(limit/1000000)+" Mo. Essayez un autre lecteur.",true);
    if (!confirm("Envoyer cette facture à "+label+" pour lecture externe ? Aucun stock ne sera modifié.")) return;
    setBusy(true);
    notice("Lecture "+label+" en cours sur "+invoice.file_name+"…");
    try {
      const current = session();
      if (!current) throw Error("Reconnectez-vous au Secrétariat.");
      const res=await fetch(OCR_API,{
        method:"POST",headers:{"authorization":"Bearer "+current,"content-type":"application/json"},
        body:JSON.stringify({invoice_id:invoice.id}),cache:"no-store",signal:AbortSignal.timeout(90000),
      });
      const data=await res.json().catch(()=>({}));
      if (!res.ok||data.ok!==true)throw Error(data.error||"Lecture OCR impossible");
      await fetchInvoices();
      notice("Lecture n°"+data.attempt+" avec "+label+" terminée : "+data.page_count+" page(s). Résultats à vérifier.");
      await showOcr(invoice);
    }catch(e){
      notice(label+" : "+e.message,true);
      try {await fetchInvoices()} catch {}
    }finally {setBusy(false)}
  }
  async function showOcr(invoice) {
    try {
      const data = await api("ocr-results", "GET", undefined, {id:invoice.id});
      $("ocrTitle").textContent = "Lectures OCR : " + invoice.file_name;
      const out = $("ocrResults"); out.replaceChildren();
      if (!data.readings.length) out.append(element("p","subtle","Aucune lecture enregistrée."));
      for (const reading of data.readings) {
        const wrapper=element("section","panel");
        wrapper.append(element("strong",null,"Lecture "+reading.attempt+" · "+(reading.provider==="azure_invoice"?"Azure Document Intelligence":"OCR.space (moteur "+reading.engine+")")+
          " · "+(reading.status==="review"?"Texte à vérifier":"Échec")));
        wrapper.append(element("p","subtle","Pages retournées : "+reading.page_count+
          (reading.error_code?" · Code : "+reading.error_code:"")));
        const text = element("textarea","ocr-text");
        text.readOnly=true; text.rows=12; text.value=reading.ocr_text||"";
        text.style.cssText="display:block;max-width:100%;width:100%;margin-top:10px;min-height:150px";
        wrapper.append(text);
        if (reading.provider==="azure_invoice" && reading.structured_result) {
          const fields=reading.structured_result;
          wrapper.append(element("p","subtle","Fournisseur : "+(fields.supplier||"—")+" · Facture : "+(fields.invoice_number||"—")+" · Total : "+(fields.total||"—")));
          const items=Array.isArray(fields.items)?fields.items:[];
          wrapper.append(element("strong",null,items.length+" ligne(s) reconnue(s) par Azure, à vérifier"));
          for (const item of items) {
            wrapper.append(element("p","subtle",(item.index||"")+" · "+(item.description||"Produit non reconnu")+
              " · Qté : "+(item.quantity||"—")+" · PU : "+(item.unit_price||"—")+" · Montant : "+(item.amount||"—")));
          }
          if(fields.partial_document_possible)
            wrapper.append(element("p","subtle","Attention : l’offre Azure F0 peut limiter l’analyse aux deux premières pages. Vérifier le PDF complet."));
        }
        out.append(wrapper);
      }
      $("ocrPanel").hidden=false;
      $("ocrPanel").scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){notice(e.message,true)}
  }
  async function showReview(invoice) {
    try {
      const data=await api("ocr-review","GET",undefined,{id:invoice.id});
      const result=data.review;
      const out=$("reviewResults");out.replaceChildren();
      $("reviewTitle").textContent="Rapprochement catalogue — "+invoice.file_name;
      const summary=element("p","subtle",
        "Pré-analyse : "+result.green_lines+" ligne(s) verte(s), "+
        result.orange_lines+" orange(s), "+result.red_lines+" rouge(s) exclue(s) · "+
        data.scan_attempts+" lecture(s). Aucun mouvement de stock.");
      out.append(summary);
      if(!result.ready){
        out.append(element("p","notice error",result.reasons.join(" · ")));
      }
      for(const reason of result.reasons||[]){
        out.append(element("p","subtle",reason));
      }
      if(result.comparison_complete)
        out.append(element("p","subtle","Deux fournisseurs ont fourni des données. Le texte OCR.space sert à signaler des concordances, pas à approuver les quantités."));
      for(const line of result.lines||[]){
        const item=element("article","entry review-line");
        const detail=element("div");
        detail.append(element("strong",null,"Ligne "+line.index+" · "+(line.description||"Désignation absente")));
        detail.append(element("div","meta","Réf. : "+(line.reference||"—")+
          " · Produit : "+(line.matched_product_name||"Non rapproché")+
          " · Qté stock suggérée : "+(line.stock_quantity??"À confirmer")));
        if(line.reasons?.length)detail.append(element("p","subtle",line.reasons.join(" · ")));
        const status=element("span","state "+line.status,
          line.status==="green"?"Vert · Précontrôlé":line.status==="red"?"Rouge · Exclu, récupérable":"Orange · À corriger");
        item.append(detail,status);out.append(item);
      }
      if(!result.lines?.length)out.append(element("p","subtle","Aucune ligne structurée disponible. Un résultat OCR texte seul ne permet pas d'identifier et de valider les produits automatiquement."));
      $("reviewPanel").hidden=false;
      $("reviewPanel").scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){notice("Rapprochement catalogue : "+e.message,true)}
  }
  async function openInvoice(invoice) {
    try {
      const result = await api("view", "GET", undefined, {id:invoice.id});
      previewUrl = result.url;
      $("previewTitle").textContent = invoice.file_name;
      $("previewPanel").hidden = false;
      $("preview").src = previewUrl;
      $("previewPanel").scrollIntoView({behavior:"smooth",block:"start"});
    } catch (error) { notice(error.message, true); }
  }
  async function upload() {
    if (busy) return;
    const files = Array.from($("invoices").files || []);
    if (!files.length) return notice("Sélectionnez une ou plusieurs factures PDF.", true);
    setBusy(true);
    let newCount = 0, duplicates = 0, failures = 0;
    try {
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name) || file.size < 5 || file.size > 6 * 1024 * 1024) {
          failures++; notice("Fichier ignoré (PDF requis, 6 Mo maximum) : " + file.name, true); continue;
        }
        const data = new FormData(); data.append("file", file, file.name);
        try {
          const result = await api("upload", "POST", data);
          if (result.duplicate) duplicates++; else newCount++;
        } catch (error) {
          failures++; notice("Échec du dépôt de " + file.name + " : " + error.message, true);
        }
      }
      $("invoices").value = "";
      currentTab = "todo";
      await fetchInvoices();
      notice(newCount + " nouvelle(s) facture(s) déposée(s), " + duplicates +
        " doublon(s), " + failures + " échec(s). Aucun mouvement de stock.");
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
  }
  $("upload").addEventListener("click", () => void upload());
  $("refresh").addEventListener("click", () => {
    if (busy) return;
    void fetchInvoices().then(() => notice("Liste actualisée.")).catch(error => notice(error.message, true));
  });
  $("todoTab").addEventListener("click", () => {currentTab = "todo"; render();});
  $("doneTab").addEventListener("click", () => {currentTab = "done"; render();});
  $("closePreview").addEventListener("click", () => {
    $("preview").removeAttribute("src"); $("previewPanel").hidden = true; previewUrl = null;
  });
  $("closeOcr").addEventListener("click",()=>{$("ocrPanel").hidden=true;$("ocrResults").replaceChildren();});
  $("closeReview").addEventListener("click",()=>{$("reviewPanel").hidden=true;$("reviewResults").replaceChildren();});
  void fetchInvoices().then(() => notice("Liste prête. Veryfi est le lecteur principal ; utilisez OCR.space uniquement si la facture exige un secours."))
    .catch(error => notice(error.message, true));
})();
