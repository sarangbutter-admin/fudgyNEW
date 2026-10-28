// DOKU -> shop: payment notification. Deploy without JWT:  supabase functions deploy doku-webhook --no-verify-jwt
// In DOKU Back Office set the Notification URL of the payment method to
//   https://<project>.supabase.co/functions/v1/doku-webhook
// The signature is checked with the owner's Secret Key; a paid notification marks the order paid (once).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const b64 = (u: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(u)));
const ok = (b: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok();
  const raw = await req.text();
  const d = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: kr } = await d.from("private_kv").select("data").eq("key", "doku_key").maybeSingle();
  const key: any = kr ? kr.data : null;
  if (!key || !key.secret) return ok({ error: "not set up" }, 503);
  const h = (n: string) => req.headers.get(n) || "";
  const rid = h("request-id"), ts = h("request-timestamp"), cid = h("client-id"), sig = h("signature");
  if (!sig || cid !== key.clientId) return ok({ error: "bad signature" }, 401);
  const dg = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // the path DOKU signed is the one configured in the dashboard; the platform may strip the /functions/v1 prefix, so both are accepted
  const path = new URL(req.url).pathname, targets = [...new Set([path, "/functions/v1" + path, path.replace(/^\/functions\/v1/, "")])];
  let good = false;
  for (const t of targets) {
    const comp = `Client-Id:${cid}\nRequest-Id:${rid}\nRequest-Timestamp:${ts}\nRequest-Target:${t}\nDigest:${dg}`;
    if ("HMACSHA256=" + b64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(comp))) === sig) { good = true; break; }
  }
  if (!good) { console.log("doku webhook: signature mismatch", path); return ok({ error: "bad signature" }, 401); }
  let b: any = {}; try { b = JSON.parse(raw); } catch { return ok(); }
  const inv = String(b?.order?.invoice_number || ""), st = String(b?.transaction?.status || "").toUpperCase();
  console.log("doku webhook", inv, st);
  if (inv && st === "SUCCESS") {
    const { data } = await d.rpc("doku_paid", { p_invoice: inv, p_amount: +b?.order?.amount || 0, p_ref: String(b?.transaction?.original_request_id || rid).slice(0, 80) });
    console.log("doku paid", inv, JSON.stringify(data));
  }
  return ok();
});
