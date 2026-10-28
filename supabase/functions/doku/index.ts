// Delidome: DOKU online payment (DOKU Checkout, hosted payment page).
// Deploy:  supabase functions deploy doku
// The Client ID + Secret Key are saved by the owner in Shop settings -> Online payment (private table, never sent to the website).
// actions: "create" {id, token, group} -> {url, amount, fee}      "status" {id, token} -> {paid}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BASE: Record<string, string> = { sandbox: "https://api-sandbox.doku.com", production: "https://api.doku.com" };
// method group -> DOKU Checkout payment method types
const GROUPS: Record<string, string[]> = {
  va: ["VIRTUAL_ACCOUNT_BCA", "VIRTUAL_ACCOUNT_BANK_MANDIRI", "VIRTUAL_ACCOUNT_BANK_SYARIAH_MANDIRI", "VIRTUAL_ACCOUNT_DOKU", "VIRTUAL_ACCOUNT_BANK_PERMATA", "VIRTUAL_ACCOUNT_BRI", "VIRTUAL_ACCOUNT_BNI", "VIRTUAL_ACCOUNT_BANK_CIMB"],
  qris: ["QRIS"],
  ewallet: ["EMONEY_SHOPEEPAY", "EMONEY_OVO", "EMONEY_DANA"],
  card: ["CREDIT_CARD"],
  retail: ["ONLINE_TO_OFFLINE_ALFA", "ONLINE_TO_OFFLINE_INDOMARET"],
  paylater: ["PEER_TO_PEER_AKULAKU", "PEER_TO_PEER_KREDIVO", "PEER_TO_PEER_INDODANA"],
};
const b64 = (u: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(u)));
async function digest(body: string) { return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))); }
async function sign(secret: string, clientId: string, rid: string, ts: string, target: string, dg: string) {
  const comp = `Client-Id:${clientId}\nRequest-Id:${rid}\nRequest-Timestamp:${ts}\nRequest-Target:${target}` + (dg ? `\nDigest:${dg}` : "");
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "HMACSHA256=" + b64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(comp)));
}
async function call(key: any, method: string, target: string, body?: unknown) {
  const rid = crypto.randomUUID(), ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), raw = body ? JSON.stringify(body) : "";
  const sig = await sign(key.secret, key.clientId, rid, ts, target, body ? await digest(raw) : "");
  const r = await fetch((BASE[key.env] || BASE.sandbox) + target, { method, headers: { "Content-Type": "application/json", "Client-Id": key.clientId, "Request-Id": rid, "Request-Timestamp": ts, Signature: sig }, body: body ? raw : undefined });
  let b: any = null; try { b = await r.json(); } catch { /* empty */ }
  return { ok: r.ok, status: r.status, body: b };
}
const clean = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const d = db(), action = String(body.action || "");
  const { data: kr } = await d.from("private_kv").select("data").eq("key", "doku_key").maybeSingle();
  const key: any = kr ? kr.data : null;
  if (!key || !key.clientId || !key.secret) return json({ error: "Online payment is not set up yet." }, 503);
  try {
    if (action === "create") {
      const group = clean(body.group, 20);
      if (!GROUPS[group]) return json({ error: "That payment method is not available." }, 400);
      const { data: p, error } = await d.rpc("doku_prepare", { p_id: clean(body.id, 40), p_token: clean(body.token, 200), p_group: group });
      if (error) return json({ error: error.message }, 400);
      const origin = req.headers.get("origin") || "";
      const minutes = Math.max(10, Math.min(60 * 24, Math.ceil(((+p.expires || Date.now() + 3_600_000) - Date.now()) / 60_000)));
      const payload: any = {
        order: { amount: Math.round(+p.amount), invoice_number: p.invoice, currency: "IDR", ...(origin.startsWith("https://") ? { callback_url: `${origin}/?paid=${encodeURIComponent(p.code)}`, auto_redirect: true } : {}) },
        payment: { payment_due_date: minutes, payment_method_types: GROUPS[group] },
        customer: { id: p.code, name: clean(p.name, 50) || "Customer", ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? { email: p.email } : {}), phone: clean(p.phone, 20).replace(/[^\d+]/g, "") || undefined },
      };
      const r = await call(key, "POST", "/checkout/v1/payment", payload);
      const url = r.body?.response?.payment?.url;
      if (!r.ok || !url) { console.log("doku create failed", r.status, JSON.stringify(r.body).slice(0, 400)); return json({ error: "DOKU did not accept this payment. Please try another way." }, 502); }
      await d.rpc("doku_set_url", { p_invoice: p.invoice, p_url: url });
      return json({ url, amount: p.amount, fee: p.fee });
    }
    if (action === "status") {
      const { data: inv } = await d.rpc("doku_last", { p_id: clean(body.id, 40), p_token: clean(body.token, 200) });
      if (!inv) return json({ paid: false });
      const r = await call(key, "GET", "/orders/v1/status/" + encodeURIComponent(inv));
      const st = String(r.body?.transaction?.status || "").toUpperCase();
      if (r.ok && st === "SUCCESS") {
        const { data: res } = await d.rpc("doku_paid", { p_invoice: inv, p_amount: +r.body?.order?.amount || 0, p_ref: clean(r.body?.transaction?.original_request_id || inv, 80) });
        return json({ paid: !!res?.ok });
      }
      return json({ paid: false, status: st });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.log("doku error", String((e as Error).message || e).slice(0, 300));
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
