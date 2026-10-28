// Delidome: Cloudflare Turnstile check. The shop shows the widget, sends the token here, and gets back a short "pass"
// that the protected actions (WhatsApp / place order, coupon input, payment proof, courier check, DOKU checkout) need.
// The Turnstile secret key is saved by the owner in Shop settings -> Security check (private table, never sent to the website).
// Deploy:  supabase functions deploy turnstile
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ACTIONS = ["whatsapp", "coupon", "proof", "courier", "doku"];
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const act = String(b.action || ""), token = String(b.token || "").slice(0, 4096);
  if (!ACTIONS.includes(act) || !token) return json({ error: "Bad request" }, 400);
  const d = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [{ data: kr }, { data: qr }] = await Promise.all([d.from("private_kv").select("data").eq("key", "turnstile_key").maybeSingle(), d.from("private_kv").select("data").eq("key", "quote_secret").maybeSingle()]);
  const secret = String(kr?.data?.secret || ""), sig = String(qr?.data?.v || "");
  if (!secret || !sig) return json({ error: "The security check is not set up." }, 503);
  const ip = (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
  const form = new URLSearchParams({ secret, response: token }); if (ip) form.set("remoteip", ip);
  let r: any = null;
  try { r = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })).json(); } catch { return json({ error: "Could not reach the security check. Please try again." }, 502); }
  if (!r || !r.success) { console.log("turnstile failed", JSON.stringify(r && r["error-codes"] || [])); return json({ error: "The security check failed. Please try again." }, 403); }
  const msg = act + "|" + (Date.now() + 10 * 60_000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(sig), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return json({ pass: msg + "." + hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))), ttl: 600 });
});
