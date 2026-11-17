import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const ORIGIN = "https://edm28contact-wq.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
const MAX_BYTES = 6 * 1024 * 1024;
const BUCKET = "secretariat-ocr-queue";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const decode = (input: string) => Uint8Array.from(atob(
  input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - input.length % 4) % 4)
), c => c.charCodeAt(0));
function client() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) throw new Error("Configuration serveur manquante");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function user(c: ReturnType<typeof client>, req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (!data?.u || !Number.isFinite(Number(data.exp)) || Date.now() > Number(data.exp)) return null;
    if (data.r && data.r !== "comptabilite") return null;
    const admin = await c.from("system_settings").select("admin_token").eq("id", 1).single();
    if (admin.error || !admin.data?.admin_token) return null;
    const secret = String(admin.data.admin_token) + (data.r === "comptabilite" ? ":accounting" : "");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const account = await c.from("admin_accounts").select("username,role,permissions,active,session_version,must_change_password").eq("username", data.u).maybeSingle();
    const a = account.data;
    if (account.error || !a?.active || a.must_change_password || Number(a.session_version) !== Number(data.v)) return null;
    const allowed = a.role === "admin" || a.role === "secretariat" ||
      a.permissions?.["secretariat.read"] === true || a.permissions?.["secretariat.invoices.write"] === true ||
      a.permissions?.secretariat === true;
    return allowed ? a : null;
  } catch { return null; }
}
function canWrite(a: any) {
  if (a.permissions?.readonly === true) return false;
  return a.role === "admin" || a.role === "secretariat" ||
    a.permissions?.["secretariat.invoices.write"] === true;
}
async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const queryFields = "id,file_hash,file_name,file_bytes,state,ocr_status,ocr_attempts,green_lines,orange_lines,excluded_red_lines,uploaded_by,reviewed_by,completed_by,completed_at,notes,created_at,updated_at";
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return response({ error: "Origine non autorisée" }, 403);
  if (!["GET", "POST"].includes(req.method)) return response({ error: "Méthode invalide" }, 405);
  try {
    const c = client();
    const a = await user(c, req);
    if (!a) return response({ error: "Session Secrétariat invalide ou non autorisée" }, 401);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";
    if (action === "list" && req.method === "GET") {
      const q = await c.from("secretariat_invoice_queue").select(queryFields).order("created_at", { ascending: false }).limit(1000);
      if (q.error) throw q.error;
      return response({ ok: true, invoices: q.data || [], ocr_connected: false, processing_mode: "manual_pending_worker" });
    }
    if (action === "ocr-results" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return response({ error: "Identifiant invalide" }, 400);
      const invoice = await c.from("secretariat_invoice_queue").select("id,ocr_status,ocr_attempts").eq("id",id).maybeSingle();
      if (invoice.error || !invoice.data) return response({ error: "Facture introuvable" }, 404);
      const scans = await c.from("secretariat_ocr_scan_results")
        .select("provider,attempt,engine,status,ocr_text,page_count,error_code,created_at,structured_result")
        .eq("invoice_id",id).order("attempt",{ascending:true}).limit(3);
      if (scans.error) throw scans.error;
      return response({ ok:true,invoice:invoice.data,readings:scans.data||[],stock_unchanged:true });
    }
    if (action === "view" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return response({ error: "Identifiant invalide" }, 400);
      const q = await c.from("secretariat_invoice_queue").select("storage_path").eq("id", id).maybeSingle();
      if (q.error || !q.data) return response({ error: "Facture introuvable" }, 404);
      const link = await c.storage.from(BUCKET).createSignedUrl(q.data.storage_path, 60);
      if (link.error || !link.data?.signedUrl) return response({ error: "Document indisponible" }, 503);
      return response({ ok: true, url: link.data.signedUrl, expires_in: 60 });
    }
    if (action === "upload" && req.method === "POST") {
      if (!canWrite(a)) return response({ error: "Dépôt non autorisé" }, 403);
      if (Number(req.headers.get("content-length") || "0") > MAX_BYTES + 30000) return response({ error: "PDF supérieur à 6 Mo" }, 413);
      const form = await req.formData();
      const pdf = form.get("file");
      if (!(pdf instanceof File) || pdf.size < 5 || pdf.size > MAX_BYTES ||
          !/\.pdf$/i.test(pdf.name) || pdf.name.length > 160) return response({ error: "PDF invalide ou supérieur à 6 Mo" }, 400);
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return response({ error: "En-tête PDF invalide" }, 400);
      const hash = await sha256(bytes);
      const old = await c.from("secretariat_invoice_queue").select("id,file_name,state").eq("file_hash", hash).maybeSingle();
      if (old.error) throw old.error;
      if (old.data) return response({ ok: true, duplicate: true, invoice: old.data });
      const path = hash + ".pdf";
      const uploaded = await c.storage.from(BUCKET).upload(path, bytes, {
        contentType: "application/pdf", upsert: false, cacheControl: "3600",
      });
      if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) throw uploaded.error;
      const saved = await c.from("secretariat_invoice_queue").insert({
        file_hash: hash, file_name: pdf.name, file_bytes: bytes.length,
        storage_path: path, uploaded_by: a.username, state: "todo", ocr_status: "not_connected",
      }).select(queryFields).single();
      if (saved.error) {
        if (saved.error.code === "23505") {
          const existing = await c.from("secretariat_invoice_queue").select("id,file_name,state").eq("file_hash", hash).maybeSingle();
          if (existing.data) return response({ ok: true, duplicate: true, invoice: existing.data });
        }
        // Preserve PDF if a transient database error occurs; it can be reconciled from its hash.
        throw saved.error;
      }
      return response({ ok: true, duplicate: false, invoice: saved.data });
    }
    if (action === "finish" && req.method === "POST") {
      if (!canWrite(a)) return response({ error: "Modification non autorisée" }, 403);
      const body = await req.json();
      if (!/^[0-9a-f-]{36}$/i.test(String(body?.id || ""))) return response({ error: "Identifiant invalide" }, 400);
      if (body?.acknowledge !== true) return response({ error: "Confirmation explicite nécessaire" }, 400);
      const updated = await c.from("secretariat_invoice_queue").update({
        state: "done", completed_by: a.username, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", String(body.id)).eq("state", "todo").select("id,state").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return response({ error: "Facture déjà terminée ou introuvable" }, 409);
      return response({ ok: true, invoice: updated.data, stock_unchanged: true });
    }
    if (action === "reopen" && req.method === "POST") {
      if (!canWrite(a)) return response({ error: "Modification non autorisée" }, 403);
      const body = await req.json();
      if (!/^[0-9a-f-]{36}$/i.test(String(body?.id || ""))) return response({ error: "Identifiant invalide" }, 400);
      const updated = await c.from("secretariat_invoice_queue").update({
        state: "todo", completed_by: null, completed_at: null, updated_at: new Date().toISOString(),
      }).eq("id", String(body.id)).eq("state", "done").select("id,state").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return response({ error: "Facture déjà à faire ou introuvable" }, 409);
      return response({ ok: true, invoice: updated.data, stock_unchanged: true });
    }
    return response({ error: "Action ou méthode non reconnue" }, 404);
  } catch (e) {
    console.error("secretariat-invoice-queue", e instanceof Error ? e.message : String(e));
    return response({ error: "Service indisponible, aucune écriture en stock" }, 500);
  }
});
