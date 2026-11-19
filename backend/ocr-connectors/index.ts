import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const ORIGIN = "https://edm28contact-wq.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const ALLOWED = ["ocrspace"] as const;
function db() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !key) throw new Error("Configuration serveur indisponible");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
const decode = (v: string) => Uint8Array.from(atob(
  v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - v.length % 4) % 4)
), ch => ch.charCodeAt(0));
async function authorize(c: ReturnType<typeof db>, req: Request) {
  try {
    const raw = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (!payload?.u || !Number.isFinite(Number(payload.exp)) || Date.now() > Number(payload.exp) || payload.r) return null;
    const settings = await c.from("system_settings").select("admin_token").eq("id", 1).single();
    if (settings.error || !settings.data?.admin_token) return null;
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(String(settings.data.admin_token)),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if (!await crypto.subtle.verify("HMAC",key,decode(parts[1]),new TextEncoder().encode(parts[0]))) return null;
    const account = await c.from("admin_accounts").select("username,role,is_super_admin,active,session_version,must_change_password,permissions").eq("username",payload.u).maybeSingle();
    const a = account.data;
    if (account.error || !a?.active || a.must_change_password || a.role !== "admin" || a.is_super_admin !== true || a.permissions?.readonly === true || Number(a.session_version) !== Number(payload.v)) return null;
    return a;
  } catch { return null; }
}
async function status(c: ReturnType<typeof db>) {
  const query = await c.from("secretariat_ocr_connectors").select("provider,secret_id,endpoint,enabled,consent_at,monthly_request_cap,updated_at").order("provider");
  if (query.error) throw query.error;
  const month = new Date().toISOString().slice(0,7)+"-01";
  const usage = await c.from("secretariat_ocr_provider_usage").select("provider,requests").eq("month_date", month);
  if (usage.error) throw usage.error;
  const counts = new Map((usage.data || []).map((x: any) => [x.provider,Number(x.requests)]));
  return ALLOWED.map(provider => {
    const r = (query.data || []).find((x: any) => x.provider === provider);
    return {
      provider,
      connected: Boolean(r?.secret_id),
      enabled: r?.enabled === true,
      consent_granted: Boolean(r?.consent_at),
      endpoint: provider === "azure_invoice" ? String(r?.endpoint || "") : "",
      monthly_request_cap: Number(r?.monthly_request_cap ?? 25),
      used_this_month: counts.get(provider) ?? 0,
      updated_at: r?.updated_at ?? null,
    };
  });
}
Deno.serve(async (req: Request) => {
  if(req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if(req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return json({error:"Origine non autorisée"},403);
  if(!["GET","POST"].includes(req.method)) return json({error:"Méthode non autorisée"},405);
  try {
    const c = db();
    const user = await authorize(c,req);
    if(!user) return json({error:"Configuration réservée au super-administrateur"},403);
    if(req.method === "GET") return json({ok:true,providers:await status(c),ocr_processing_connected:false});
    const body = await req.json().catch(() => null);
    if(!body || typeof body !== "object") return json({error:"Requête invalide"},400);
    if(body.action !== "configure" || !ALLOWED.includes(body.provider)) return json({error:"Connecteur non reconnu"},400);
    if(typeof body.enabled !== "boolean" || typeof body.consent !== "boolean" || typeof body.monthly_request_cap !== "number" || !Number.isInteger(body.monthly_request_cap) || body.monthly_request_cap < 1 || body.monthly_request_cap > 100 ||
       (body.credential !== undefined && typeof body.credential !== "string") ||
       (body.endpoint !== undefined && typeof body.endpoint !== "string") ||
       (body.erase_credential !== undefined && typeof body.erase_credential !== "boolean"))
       return json({error:"Paramètres invalides"},400);
    const rpc = await c.rpc("secretariat_ocr_connector_configure",{
      p_provider:body.provider,
      p_secret:body.credential ?? "",
      p_endpoint:body.endpoint ?? "",
      p_enabled:body.enabled,
      p_consent:body.consent,
      p_monthly_cap:body.monthly_request_cap,
      p_actor:user.username,
      p_erase:body.erase_credential === true,
    });
    if(rpc.error) {
      const known = /invalid|unsupported|credentials|consent|required|endpoint|erase|too long/i.test(rpc.error.message || "");
      return json({error:known?"Configuration refusée : vérifiez les informations et l'autorisation d'envoi.":"Enregistrement impossible."},400);
    }
    return json({ok:true,providers:await status(c),ocr_processing_connected:false});
  } catch(e) {
    console.error("secretariat-ocr-connectors",e instanceof Error?e.message:String(e));
    return json({error:"Configuration OCR indisponible"},500);
  }
});