// Shared helpers for the Biteship Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";

export const BITESHIP = "https://api.biteship.com";
// couriers that quote by coordinates (instant / same-day); the others quote by postal code
export const INSTANT = ["gojek", "grab", "lalamove", "borzo", "deliveree"];

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

export async function kv(db: ReturnType<typeof admin>, key: string): Promise<any> {
  const { data } = await db.from("private_kv").select("data").eq("key", key).maybeSingle();
  return data ? data.data : null;
}

export async function settings(db: ReturnType<typeof admin>): Promise<any> {
  const { data } = await db.from("docs").select("data").eq("key", "settings").maybeSingle();
  return data ? data.data : {};
}

// calls Biteship; returns {ok, status, body}
export async function bs(key: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BITESHIP + path, {
    method,
    headers: { "authorization": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let j: any = null;
  try { j = txt ? JSON.parse(txt) : null; } catch { j = { raw: txt.slice(0, 300) }; }
  return { ok: r.ok, status: r.status, body: j };
}
export const bsErr = (r: { status: number; body: any }) =>
  String((r.body && (r.body.error || r.body.message)) || ("Biteship error " + r.status)).slice(0, 200);

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// is the caller a signed-in team member (owner or staff)?
export async function teamRole(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data, error } = await c.rpc("biteship_who");
  if (error || !data) return null;
  return String(data);
}

// tiny per-instance rate limit (best effort)
const hits = new Map<string, number[]>();
export function limited(ip: string, max: number, ms: number): boolean {
  const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < ms);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > max;
}
// the visitor's address: Cloudflare's header can't be faked by the visitor, the forwarded one is the fallback
export const ipOf = (req: Request) => (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0]).trim() || "x";
// limits kept in the database, so they hold across every server instance (true = allowed). If the check itself fails, shoppers are not blocked.
export async function allow(db: any, key: string, max: number, ms: number): Promise<boolean> {
  const { data, error } = await db.rpc("throttle_ok", { p_key: key, p_max: max, p_window_ms: ms });
  return error ? true : data === true;
}
export async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
// short-lived answers kept so repeated lookups don't cost Biteship or Google calls
export async function cacheGet(db: any, k: string): Promise<any | null> {
  const { data } = await db.from("quote_cache").select("exp,data").eq("k", k).maybeSingle();
  return data && +data.exp > Date.now() ? data.data : null;
}
export async function cacheSet(db: any, k: string, ttlMs: number, val: unknown) {
  await db.from("quote_cache").upsert({ k, exp: Date.now() + ttlMs, data: val });
  if (Math.random() < 0.05) await db.from("quote_cache").delete().lt("exp", Date.now());
}

// map Biteship status codes to words the owner and customer understand
export const STATUS_TXT: Record<string, string> = {
  confirmed: "Courier booked", scheduled: "Pickup scheduled", allocated: "Courier assigned", picking_up: "Courier on the way to pick up",
  picked: "Picked up", dropping_off: "On the way to you", return_in_transit: "Returning", on_hold: "On hold", delivered: "Delivered",
  rejected: "Rejected", disposed: "Disposed", courier_not_found: "No courier found", returned: "Returned", cancelled: "Booking cancelled",
};

/* ---------------- courier updates (shared by the shop function and the webhook) ---------------- */
const cl = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const nm = (v: unknown, d = 0) => (Number.isFinite(+(v as number)) ? +(v as number) : d);
export const FAILED = ["courier_not_found", "rejected", "cancelled", "returned", "disposed"];

// photo links anywhere in a Biteship answer whose key looks like a proof (pickup / delivery photo, signature); driver photos are not proofs
export function findProofs(x: any, out: string[] = [], depth = 0, keyHit = false): string[] {
  if (!x || depth > 6 || out.length > 8) return out;
  if (typeof x === "string") { if (keyHit && /^https:\/\//i.test(x)) out.push(x.slice(0, 500)); return out; }
  if (Array.isArray(x)) { x.forEach((v) => findProofs(v, out, depth + 1, keyHit)); return out; }
  if (typeof x === "object") for (const [k, v] of Object.entries(x)) {
    if (/driver|avatar|logo/i.test(k)) continue;
    findProofs(v, out, depth + 1, keyHit || /proof|pod|photo|image|signature|evidence/i.test(k));
  }
  return [...new Set(out)];
}
export function driverOf(b: any) {
  const c = (b && b.courier) || {};
  const d = {
    name: cl(b.courier_driver_name || c.driver_name || c.name, 60), phone: cl(b.courier_driver_phone || c.driver_phone || c.phone, 30),
    plate: cl(b.courier_driver_plate_number || c.driver_plate_number, 20), photo: cl(b.courier_driver_photo_url || c.driver_photo_url, 400),
  };
  return d.name || d.phone || d.plate ? d : null;
}
const CUST_TXT: Record<string, (sh: any) => string> = {
  allocated: (sh) => `Driver found${sh.driver && sh.driver.name ? ": " + sh.driver.name : ""} (${sh.courierName || sh.courier}). They're coming to pick up your cookies.`,
  picking_up: () => "Your courier is on the way to pick up your order.",
  picked: () => "Your cookies were picked up by the courier.",
  dropping_off: () => "Your order is on the way to you!",
  delivered: () => "Your order was delivered. Enjoy your cookies!",
  courier_not_found: () => "No courier was free yet. We're arranging another one for you.",
  rejected: () => "The courier couldn't take your order. We're arranging another one for you.",
  cancelled: () => "The courier cancelled. We're arranging another one for you.",
  returned: () => "Your order is being returned to the shop. We'll contact you.",
};

// the courier's live tracking page can show a map with the pickup point, so the link is kept private unless the owner allows customers to see it
export const showLinkOn = async (db: any) => !!((await settings(db))?.biteship?.showLink);
async function keepPrivate(db: any, orderId: string, link: string, trackingId: string) {
  const row: any = { order_id: orderId, at: Date.now() };
  if (link) row.link = link;
  if (trackingId) row.tracking_id = trackingId;
  if (row.link || row.tracking_id) await db.from("courier_private").upsert(row);
}
// merges a courier update into the order: courier details, proofs, main order status (forward only), a customer message
export async function applyUpdate(db: any, row: { id: string; data: any }, up: { status?: string; waybill?: string; link?: string; trackingId?: string; price?: number; driver?: any; proofs?: string[] }, fromCourier: boolean) {
  const o: any = row.data, sh: any = { ...(o.bship || {}) }, now = Date.now(), prevSt = sh.status;
  const showLink = await showLinkOn(db);
  const s = up.status ? cl(up.status, 30).toLowerCase() : "";
  if (s && s !== prevSt) { sh.status = s; sh.statusAt = now; sh.history = [...(sh.history || []), { s, at: now }].slice(-25); }
  if (up.waybill) sh.waybill = cl(up.waybill, 60);
  let privLink = "", privTrack = "";
  if (up.link) { if (showLink) sh.link = cl(up.link, 300); else privLink = cl(up.link, 300); }
  if (up.trackingId) { if (showLink) sh.trackingId = cl(up.trackingId, 60); else privTrack = cl(up.trackingId, 60); }
  if (!showLink) { delete sh.link; delete sh.trackingId; }
  if (up.price !== undefined && Number.isFinite(+up.price) && +up.price > 0) sh.bookedPrice = +up.price;
  if (up.driver) sh.driver = up.driver;
  if (up.proofs && up.proofs.length) {
    const kind = s === "delivered" || sh.status === "delivered" ? "delivery" : "pickup";
    sh.proofs = { ...(sh.proofs || {}) };
    sh.proofs[kind] = [...new Set([...(sh.proofs[kind] || []), ...up.proofs])].slice(0, 6);
  }
  const next: any = { ...o, bship: sh };
  if (sh.waybill) next.awb = String(sh.waybill).slice(0, 40);
  // main order status follows the courier, forward only (the owner can still change it by hand)
  if (s === "picked" || s === "dropping_off") { if (["new", "baking"].includes(o.status)) next.status = "ready"; }
  if (s === "delivered") { if (["new", "baking", "ready"].includes(o.status)) { next.status = "completed"; if (!next.completedAt) next.completedAt = now; } }
  // a failed booking can be booked again
  if (fromCourier && FAILED.includes(s) && sh.biteshipId) {
    sh.prevIds = [...(sh.prevIds || []), sh.biteshipId].slice(-10); sh.biteshipId = ""; sh.failed = true; sh.failAt = now;
  }
  // tell the customer (shows in their bell and order page)
  if (s && s !== prevSt && CUST_TXT[s]) {
    const ch = o.notify === "email" ? "email" : "whatsapp";
    next.msgs = [...(o.msgs || []), { at: now, channel: ch, status: next.status, text: CUST_TXT[s](sh), by: "system", courier: true }].slice(-80);
  }
  await db.from("orders").update({ data: next, updated_at: now }).eq("id", row.id);
  await keepPrivate(db, row.id, privLink, privTrack);
  return next;
}

// the driver search stops in the evening and (when switched on) starts again the next morning (Delivery & courier settings)
export function courierHours(set: any, cfg: any) {
  let h = new Date().getUTCHours(), m = new Date().getUTCMinutes();
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: String(set?.tz || "Asia/Jakarta"), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    h = +(p.find((x) => x.type === "hour")?.value || 0); m = +(p.find((x) => x.type === "minute")?.value || 0);
  } catch { /* unknown time zone: UTC */ }
  const hr = (v: unknown, d: number) => Math.min(23, Math.max(0, Math.round(nm(v ?? d, d))));
  const stopH = hr(cfg.stopHour, 19), startH = hr(cfg.resumeHour, 9), on = cfg.nightStop !== false && stopH !== startH;
  const night = on && (stopH > startH ? (h >= stopH || h < startH) : (h >= stopH && h < startH));
  const sinceStop = (((h * 60 + m) - stopH * 60) % 1440 + 1440) % 1440;
  return { night, stopH, startH, autoNext: cfg.autoNext !== false, stopAt: Date.now() - sinceStop * 60_000 };
}
export const nightText = (c: { stopH: number; startH: number; autoNext: boolean }) => c.autoNext
  ? `No driver was free before ${c.stopH}:00 today. We'll look for a courier again tomorrow from ${c.startH}:00.`
  : `No driver was free before ${c.stopH}:00 today. We'll arrange your courier and let you know.`;

// weight (grams) and size (cm) of a box
export function boxOf(cfg: any, size: number) {
  const w = cfg.weights && nm(cfg.weights[String(size)]) > 0 ? nm(cfg.weights[String(size)]) : size * nm(cfg.gramsPerCookie, 100) + nm(cfg.boxGrams, 200);
  const d = cfg.dims || {};
  return { weight: Math.max(100, Math.round(w)), length: nm(d.l, 25), width: nm(d.w, 25), height: nm(d.h, 10) };
}

// private link to the customer's place photo (served by the webhook function, works until the photo is deleted)
export async function placeLink(db: any, id: string) {
  const sec = (await kv(db, "quote_secret"))?.v as string;
  if (!sec) return "";
  return Deno.env.get("SUPABASE_URL") + "/functions/v1/biteship-webhook?ph=" + encodeURIComponent(id) + "&s=" + (await hmacHex(sec, "place|" + id)).slice(0, 32);
}
// what the driver reads: the customer's note for the driver, the order note, the order code and the place photo link
async function driverNote(db: any, o: any, id: string) {
  const pl = o.place || {}, parts: string[] = [];
  if (pl.note) parts.push(cl(pl.note, 200));
  if (o.note) parts.push(cl(o.note, 120));
  parts.push("Order " + o.code);
  if (pl.photo) { const l = await placeLink(db, id); if (l) parts.push("Photo of the place: " + l); }
  return parts.join(". ");
}
// books (or books again) the courier for a paid order; returns {bship} or {error}
export async function bookOrder(db: any, key: string, cfg: any, row: { id: string; data: any }) {
  const o: any = row.data, sh: any = o.bship;
  if (!sh || !sh.courier) return { error: "This order has no courier chosen." };
  if (sh.biteshipId) return { error: "A courier is already booked for this order." };
  // like the order steps: the pickup comes after Baking (booking again after a failed courier is fine at Out for delivery too)
  if (!(o.status === "baking" || (o.status === "ready" && (sh.failed || sh.cancelledAt)))) return { error: "Move the order to Baking first. The courier pickup comes after Baking." };
  const org = cfg.origin || {};
  if (!org.name || !org.phone || !org.address) return { error: "Fill in your pickup details in Shop settings first." };
  const box = boxOf(cfg, nm(o.size)), c = o.customer || {};
  const payload: any = {
    shipper_contact_name: cl(org.name, 60), shipper_contact_phone: cl(org.phone, 20), shipper_organization: cl(org.business || org.name, 60),
    origin_contact_name: cl(org.name, 60), origin_contact_phone: cl(org.phone, 20), origin_address: cl(org.address, 250), origin_note: cl(org.note, 200),
    destination_contact_name: cl(c.name, 60), destination_contact_phone: cl(c.phone, 20), destination_contact_email: cl(c.email, 100),
    destination_address: cl(c.address, 250), destination_note: cl(await driverNote(db, o, row.id), 500),
    courier_company: sh.courier, courier_type: sh.service, delivery_type: "now",
    order_note: "BakeByCulture order " + o.code + " (cookies, handle with care)", metadata: { orderCode: o.code },
    items: [{ name: "Cookie box of " + o.size, description: "Fragile baked goods", value: Math.round(nm(o.base)), quantity: 1, weight: box.weight, length: box.length, width: box.width, height: box.height }],
  };
  if (org.lat !== "" && org.lng !== "" && Number.isFinite(nm(org.lat, NaN)) && Number.isFinite(nm(org.lng, NaN))) payload.origin_coordinate = { latitude: nm(org.lat), longitude: nm(org.lng) };
  else if (org.postal) payload.origin_postal_code = Math.round(nm(org.postal));
  if (sh.lat && sh.lng) payload.destination_coordinate = { latitude: nm(sh.lat), longitude: nm(sh.lng) };
  if (sh.postal) payload.destination_postal_code = Math.round(nm(sh.postal));
  const r = await bs(key, "POST", "/v1/orders", payload);
  console.log("book", o.code, r.status, r.ok ? cl(r.body?.status, 30) : bsErr(r));
  if (!r.ok || !r.body) return { error: bsErr(r) };
  const b = r.body, cr = b.courier || {}, now = Date.now(), showLink = await showLinkOn(db);
  const nsh: any = {
    ...sh, biteshipId: cl(b.id, 60), trackingId: showLink ? cl(cr.tracking_id, 60) : "", waybill: cl(cr.waybill_id, 60), link: showLink ? cl(cr.link, 300) : "",
    status: cl(b.status, 30) || "confirmed", statusAt: now, bookedAt: now, bookedPrice: nm(b.price, nm(sh.price)), failed: false, nightHold: false, nightErr: "",
    retries: sh.failed ? (sh.retries || 0) + 1 : (sh.retries || 0),
    history: [...(sh.history || []), { s: cl(b.status, 30) || "confirmed", at: now }].slice(-25),
  };
  const next: any = { ...o, bship: nsh, courier: cl((sh.courierName || sh.courier) + " " + (sh.serviceName || sh.service), 40), awb: cl(cr.waybill_id, 40) || o.awb || "" };
  // tell the customer the courier search has started (shows in their bell)
  next.msgs = [...(o.msgs || []), {
    at: now, channel: o.notify === "email" ? "email" : "whatsapp", status: o.status, by: "system", courier: true,
    text: sh.failed ? "We booked another courier for your order. Searching for a driver now. Follow it in My orders." : "We're looking for a courier to pick up your order. You'll see the driver in My orders as soon as one accepts.",
  }].slice(-80);
  await db.from("orders").update({ data: next, updated_at: now }).eq("id", row.id);
  await keepPrivate(db, row.id, showLink ? "" : cl(cr.link, 300), showLink ? "" : cl(cr.tracking_id, 60));
  return { bship: nsh, order: next };
}

// Cloudflare Turnstile: when the owner turned the check on for this action, a valid pass (from the "turnstile" function) is required
export async function tsGate(d: any, act: string, pass: unknown): Promise<string | null> {
  const { data: s } = await d.from("docs").select("data").eq("key", "settings").maybeSingle();
  const c = s?.data?.turnstile;
  if (!c || !c.on || !c.siteKey || !c.where || !c.where[act]) return null;
  const [{ data: kr }, { data: qr }] = await Promise.all([d.from("private_kv").select("data").eq("key", "turnstile_key").maybeSingle(), d.from("private_kv").select("data").eq("key", "quote_secret").maybeSingle()]);
  if (!kr?.data?.secret || !qr?.data?.v) return null;
  const p = String(pass || ""), i = p.lastIndexOf("."), msg = p.slice(0, i), parts = msg.split("|"), bad = "Please complete the security check and try again.";
  if (i < 0 || parts[0] !== act || !(+parts[1] > Date.now())) return bad;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(qr.data.v)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hx = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return hx === p.slice(i + 1) ? null : bad;
}
