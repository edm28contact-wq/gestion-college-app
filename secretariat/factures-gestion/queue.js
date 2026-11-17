"use strict";
(() => {
  const API = "https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-invoice-queue";
  const $ = id => document.getElementById(id);
  let invoices = [], currentTab = "todo", busy = false, previewUrl = null;
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
    $("countTodo").textContent = invoices.filter(x => x.state === "todo").length;
    $("countDone").textContent = invoices.filter(x => x.state === "done").length;
    $("ocrState").textContent = result.ocr_connected ? "Connecté" : "Non connecté";
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
        invoice.state === "done" ? "Classée manuellement" : "OCR en attente de connexion");
      detail.append(tag);
      const actions = element("div", "actions");
      const view = element("button", null, "Voir PDF");
      view.type = "button"; view.onclick = () => void openInvoice(invoice);
      actions.append(view);
      const change = element("button", null, invoice.state === "todo" ? "Classer comme faite" : "Remettre à faire");
      change.type = "button";
      change.onclick = () => void changeState(invoice);
      actions.append(change);
      item.append(detail, actions); list.append(item);
    }
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
  async function changeState(invoice) {
    if (busy) return;
    const done = invoice.state === "todo";
    if (done && !confirm("Classer cette facture comme faite ? Cette action est administrative : aucun OCR, aucun produit ni aucun stock ne sera validé.")) return;
    if (!done && !confirm("Remettre cette facture dans la liste À faire ?")) return;
    setBusy(true);
    try {
      await api(done ? "finish" : "reopen", "POST", {id:invoice.id, acknowledge:true});
      await fetchInvoices();
      notice(done ? "Facture classée sans écriture en stock." : "Facture remise à faire.");
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
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
  void fetchInvoices().then(() => notice("Liste prête. Les OCR automatiques restent à connecter."))
    .catch(error => notice(error.message, true));
})();
