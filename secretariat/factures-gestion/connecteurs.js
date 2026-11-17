"use strict";
(() => {
  const API = "https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/secretariat-ocr-connectors";
  const qs = (el, selector) => el.querySelector(selector);
  let temporaryAdminToken = "";
  let authorized = false;
  const token = () => temporaryAdminToken || localStorage.getItem("edm_admin_token") || "";
  const showAdminLogin = (reason) => {
    authorized = false;
    temporaryAdminToken = "";
    document.getElementById("adminLoginForm").hidden = false;
    for (const button of document.querySelectorAll("[data-save]")) button.disabled = true;
    if (reason) message(reason, true);
  };
  const showAuthorized = () => {
    authorized = true;
    document.getElementById("adminLoginForm").hidden = true;
    for (const button of document.querySelectorAll("[data-save]")) button.disabled = false;
  };
  const message = (value, error = false) => {
    const node = document.getElementById("message");
    node.textContent = String(value);
    node.style.color = error ? "#a32626" : "#284964";
  };
  async function request(method, payload) {
    const current = token();
    if (!current) throw Error("Connexion administrateur requise.");
    const headers = { authorization: "Bearer " + current };
    if (method === "POST") headers["content-type"] = "application/json";
    const response = await fetch(API, {
      method, headers, body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw Error(data.error || "Connexion impossible (" + response.status + ")");
    return data;
  }
  function render(providers) {
    for (const data of providers) {
      const root = document.querySelector('[data-provider="' + data.provider + '"]');
      if (!root) continue;
      qs(root, "[data-status]").textContent = (data.connected ? "Clé enregistrée" : "Clé absente") +
        " · " + (data.enabled ? "activé" : "désactivé") +
        " · " + data.used_this_month + "/" + data.monthly_request_cap + " requêtes du mois" +
        (data.updated_at ? " · modifié le " + new Date(data.updated_at).toLocaleDateString("fr-FR") : "");
      const endpoint = qs(root, "[data-endpoint]");
      if (endpoint) endpoint.value = data.endpoint || "";
      qs(root, "[data-cap]").value = String(data.monthly_request_cap);
      qs(root, "[data-enabled]").checked = Boolean(data.enabled);
      qs(root, "[data-consent]").checked = Boolean(data.consent_granted);
      qs(root, "[data-credential]").value = "";
      qs(root, "[data-erase]").checked = false;
    }
  }
  async function save(root) {
    if (!authorized) {
      showAdminLogin("Reconnectez-vous avec le compte super-administrateur avant d'enregistrer la clé.");
      return;
    }
    const provider = root.dataset.provider;
    const keyInput = qs(root, "[data-credential]");
    const body = {
      action: "configure",
      provider,
      credential: keyInput.value.trim(),
      endpoint: qs(root, "[data-endpoint]")?.value.trim() || "",
      enabled: qs(root, "[data-enabled]").checked,
      consent: qs(root, "[data-consent]").checked,
      monthly_request_cap: Number(qs(root, "[data-cap]").value),
      erase_credential: qs(root, "[data-erase]").checked,
    };
    if (!Number.isInteger(body.monthly_request_cap) ||
        body.monthly_request_cap < 1 || body.monthly_request_cap > 100) {
      message("Le plafond mensuel doit être un entier de 1 à 100.",true);
      return;
    }
    if (body.erase_credential && body.credential) {
      message("Ne combinez pas suppression et remplacement de clé.",true);
      return;
    }
    if (body.erase_credential) body.enabled = false;
    if (body.enabled && !body.consent) {
      message("L'autorisation explicite d'envoi externe est indispensable.",true);
      return;
    }
    if (body.enabled && !confirm("Autoriser les futurs transferts de PDF vers " +
        provider + " ? Les lectures ne sont pas encore activées dans le site.")) return;
    const button = qs(root, "[data-save]");
    button.disabled = true;
    try {
      const data = await request("POST", body);
      render(data.providers);
      message("Configuration enregistrée. Aucune facture n'a été envoyée et aucun stock n'a été modifié.");
    } catch (e) {
      if (/super-administrateur|session|connexion administrateur|HTTP 403|HTTP 401/i.test(e.message))
        showAdminLogin("Session administrateur refusée. Reconnectez-vous ci-dessus.");
      else message(e.message,true);
    } finally {
      button.disabled = !authorized;
    }
  }
  for (const button of document.querySelectorAll("[data-save]")) {
    button.addEventListener("click", () => void save(button.closest("[data-provider]")));
  }
  async function loginSuperAdmin(event) {
    event.preventDefault();
    const form = document.getElementById("adminLoginForm");
    const user = document.getElementById("adminUser").value.trim();
    const password = document.getElementById("adminPass").value;
    const button = document.getElementById("adminLoginButton");
    if (!user || !password) return;
    button.disabled = true;
    document.getElementById("adminLoginMessage").textContent = "Authentification en cours…";
    try {
      const response = await fetch(
        "https://zreegtzfpwrjgdhhunxx.supabase.co/functions/v1/admin-api?action=login",
        {method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({username:user,password}),cache:"no-store",signal:AbortSignal.timeout(20000)}
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || data.role !== "admin" || !data.token)
        throw Error(data.error || "Ce compte ne dispose pas des droits administrateur requis.");
      temporaryAdminToken = data.token;
      const state = await request("GET");
      render(state.providers);
      showAuthorized();
      message("Connecté en super-administrateur. Vous pouvez enregistrer la clé OCR.space.");
      document.getElementById("adminLoginMessage").textContent = "";
    } catch (e) {
      temporaryAdminToken = "";
      authorized = false;
      document.getElementById("adminLoginMessage").textContent = String(e.message || "Connexion refusée.");
      message("Connexion super-administrateur requise.",true);
    } finally {
      document.getElementById("adminPass").value = "";
      button.disabled = false;
    }
  }
  document.getElementById("adminLoginForm").addEventListener("submit",loginSuperAdmin);
  void request("GET").then(data => {
    render(data.providers);
    showAuthorized();
    message("Connecteurs chargés. OCR.space peut être utilisé depuis « Factures à faire » une fois configuré.");
  }).catch(() => showAdminLogin("Session du super-administrateur requise. Connectez-vous dans le formulaire ci-dessus."));
})();