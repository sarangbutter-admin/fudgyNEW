// BakeByCulture: optional Biteship courier integration.
// Deploy:  supabase functions deploy biteship
// The API key is saved by the owner in Shop settings -> Courier delivery (stored in a private table, never sent to the website).
import { tsGate, admin, applyUpdate, bookOrder, boxOf, bs, bsErr, cacheGet, cacheSet, cors, driverOf, findProofs, hmacHex, INSTANT, ipOf, json, kv, limited, settings, sha, teamRole } from "../_shared/common.ts";

const num = (v: unknown, d = 0) => (Number.isFinite(+(v as number)) ? +(v as number) : d);
const clean = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

async function load(db: ReturnType<typeof admin>) {
  const [set, cfg, keyRow, sec] = await Promise.all([settings(db), kv(db, "biteship_cfg"), kv(db, "biteship_key"), kv(db, "security")]);
  return { set, cfg: cfg || {}, key: keyRow && keyRow.v ? String(keyRow.v) : "", sec: (sec || {}) as Record<string, unknown> };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const action = String(body.action || "");
  const db = admin();

  try {
    /* ---------- public (shop checkout) ---------- */
    if (action === "geocode" || action === "rates") { const tg = await tsGate(db, "courier", body.pass); if (tg) return json({ error: tg }, 403); }
    if (action === "areas" || action === "geocode" || action === "rates") {
      const { set, cfg, key, sec } = await load(db);
      // the owner's Security tab: limits and daily caps (missing = default, 0 = no limit), and an emergency stop
      const L = (k: string, d: number) => { const v = sec[k]; return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : d; };
      if (!set?.biteship?.on || !key || sec.courierOff === true) return json({ error: "Courier prices are not available right now." }, 503);
      // a banned customer gets no courier prices (they cost money); the shop shows the owner's ban message
      if (action !== "areas") {
        const g = await db.rpc("cust_ban_gate", { p_phone: String(body.phone || "").slice(0, 30), p_email: String(body.email || "").slice(0, 120) });
        if (!g.error) {
          if (g.data === "banned") return json({ error: "BANNED" }, 403);
          if (g.data === "nophone") return json({ error: "Type your WhatsApp number first." }, 400);
        }
      }
      const ip = ipOf(req);
      if (limited(ip, Math.max(40, L("bsAreasIpM", 40) || 1000), 60_000)) return json({ error: "Too many tries. Please wait a minute." }, 429);
      // limits per visitor, kept in the database so they hold on every server; and a daily cap on the calls that cost money
      const DAY = 86_400_000;
      const perIp: [string, number, number][] = action === "areas" ? [["bs-areas", L("bsAreasIpM", 40), 60_000], ["bs-areas-d", L("bsAreasIpD", 200), DAY]]
        : action === "geocode" ? [["bs-geo-m", L("bsGeoIpM", 12), 60_000], ["bs-geo-h", L("bsGeoIpH", 60), 3_600_000], ["bs-geo-d", L("bsGeoIpD", 30), DAY]]
        : [["bs-rates-m", L("bsRatesIpM", 10), 60_000], ["bs-rates-h", L("bsRatesIpH", 60), 3_600_000], ["bs-rates-d", L("bsRatesIpD", 40), DAY]];
      // used so far (with this one), or -1 when the limit is reached; if the check itself fails, shoppers are not blocked
      const used = async (k: string, m: number, ms: number) => { const { data, error } = await db.rpc("throttle_n", { p_key: k, p_max: m, p_window_ms: ms }); return error ? 0 : +data; };
      const wp = L("warnPct", 70);
      let warn = false;
      for (const [k, m, ms] of perIp) {
        if (m <= 0) continue;
        const n = await used(k + ":" + ip, m, ms);
        if (n < 0) return json({ error: ms === DAY ? "Too many tries today. Please try again later." : "Too many tries. Please wait a minute." }, 429);
        if (wp > 0 && wp < 100 && n >= Math.ceil(m * wp / 100)) warn = true;
      }
      // past the warning point the answer is marked, so the shop shows its friendly "slow down" warning
      const J = (b: any, status = 200) => json(warn && status === 200 ? { ...b, _warn: 1 } : b, status);
      const cap = action === "rates" ? L("capRates", num(cfg.dailyCap, 800)) : action === "geocode" ? L("capGeo", num(cfg.dailyCap, 400)) : L("capAreas", num(cfg.dailyCap, 1500));
      const capName = action === "rates" ? "capRates" : action === "geocode" ? "capGeo" : "capAreas", ap = L("alertPct", 70);
      // the whole shop's daily cap; the owner is told when it passes the alert point and when it is reached
      const dayOk = async (k: string) => {
        if (cap <= 0) return true;
        const n = await used(k, cap, DAY);
        if (n < 0) { await db.rpc("sec_alert", { p_name: capName, p_lvl: 100, p_every_ms: 6 * 3_600_000 }); return false; }
        if (ap > 0 && ap < 100 && n >= Math.ceil(cap * ap / 100)) await db.rpc("sec_alert", { p_name: capName, p_lvl: ap, p_every_ms: DAY });
        return true;
      };
      const cacheMs = L("cacheMin", 10) * 60_000;
      const busy = () => json({ error: "Courier prices are busy right now. Please try again later." }, 429);

      if (action === "areas") {
        const q = clean(body.q, 80);
        if (q.length < 3) return J({ areas: [] });
        const ak = "qa:" + await sha(q.toLowerCase()), ac = await cacheGet(db, ak);
        if (ac) return J({ areas: ac });
        if (!(await dayOk("bs-day-areas"))) return busy();
        let r = await bs(key, "GET", "/v1/maps/areas?countries=ID&type=single&input=" + encodeURIComponent(q));
        console.log("areas", q, r.status, r.ok ? (r.body?.areas || []).length : bsErr(r));
        if (r.ok && !(r.body?.areas || []).length) {
          // retry with just the most specific part (e.g. "Cisauk" from "Cisauk, Tangerang, Banten 15345")
          const first = q.split(/[,.]/)[0].trim();
          if (first && first !== q) { r = await bs(key, "GET", "/v1/maps/areas?countries=ID&type=single&input=" + encodeURIComponent(first)); console.log("areas retry", first, r.status, (r.body?.areas || []).length); }
        }
        if (!r.ok) return json({ error: bsErr(r) }, 502);
        const areas = ((r.body && r.body.areas) || []).slice(0, 8).map((a: any) => ({
          id: clean(a.id, 60), name: clean(a.name, 160), postal: clean(a.postal_code, 12),
        }));
        if (areas.length) await cacheSet(db, ak, 86_400_000, areas);
        return J({ areas });
      }

      if (action === "geocode") {
        // Google Maps when the owner saved a key (most exact), otherwise the free Photon (OpenStreetMap) service
        const gkey = (await kv(db, "google_key"))?.v as string | undefined;
        type Hit = { lat: number; lng: number; label: string; rough: boolean };
        const google = async (q: string): Promise<Hit | null> => {
          const r = await fetch("https://maps.googleapis.com/maps/api/geocode/json?region=id&components=country:ID&language=id&address=" + encodeURIComponent(q) + "&key=" + encodeURIComponent(gkey!));
          const j: any = r.ok ? await r.json().catch(() => ({})) : {};
          console.log("geocode google", r.status, j.status, (j.results || []).length, j.error_message || "");
          const x = (j.results || [])[0];
          if (!x) return null;
          return { lat: x.geometry.location.lat, lng: x.geometry.location.lng, label: clean(x.formatted_address, 200), rough: !["ROOFTOP", "RANGE_INTERPOLATED"].includes(x.geometry.location_type) };
        };
        const photon = async (q: string): Promise<Hit | null> => {
          const r = await fetch("https://photon.komoot.io/api/?limit=1&bbox=94.9,-11.1,141.1,6.1&q=" + encodeURIComponent(q), { headers: { "User-Agent": "bakebyculture-shop/1.0 (delivery quote)" } });
          const j: any = r.ok ? await r.json().catch(() => ({})) : {};
          console.log("geocode photon", r.status, (j.features || []).length);
          const f = (j.features || [])[0];
          if (!f) return null;
          const pr = f.properties || {};
          return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: clean([pr.name, pr.street, pr.district || pr.locality, pr.city, pr.state].filter(Boolean).join(", "), 200), rough: !pr.housenumber };
        };
        const find = gkey ? google : photon;
        const addr = clean(body.address, 200), area = clean(body.area, 160).replace(/\b\d{5}\b/g, "").trim();
        const gk = "qg:" + await sha((gkey ? "g|" : "p|") + addr.toLowerCase() + "|" + area.toLowerCase()), gc = await cacheGet(db, gk);
        if (gc) return J(gc);
        if (!(await dayOk("bs-day-geocode"))) return busy();
        let hit = await find([addr, area].filter(Boolean).join(", ")), approx = false;
        if (!hit && area) { hit = await find(area); approx = true; }
        if (!hit && gkey) { hit = await photon([addr, area].filter(Boolean).join(", ")); }
        if (!hit) { await cacheSet(db, gk, 3_600_000, { found: false }); return J({ found: false }); }
        const out = { found: true, approx: approx || hit.rough, lat: (+hit.lat).toFixed(5), lng: (+hit.lng).toFixed(5), label: hit.label };
        await cacheSet(db, gk, 86_400_000, out);
        return J(out);
      }

      // rates
      const size = Math.round(num(body.size));
      const d = body.dest || {};
      const lat = num(d.lat, NaN), lng = num(d.lng, NaN), postal = clean(d.postal, 12);
      const o = cfg.origin || {};
      if (!(Number.isFinite(lat) && Number.isFinite(lng)) && !postal) return json({ error: "Choose your delivery area or location first." }, 400);
      const { data: sz } = await db.from("coll").select("data").eq("coll", "sizes").eq("id", String(size)).maybeSingle();
      let base = sz && sz.data ? num((sz.data as any).price) : 0;
      // a custom box (for example 14 cookies) is not in the sizes list: price it like the shop does, when the size is allowed
      const cmin = num(set?.customMin), cstep = Math.max(1, num(set?.customStep, 1));
      if (!base && set?.customOn && size >= cmin && size <= num(set?.customMax) && (size - cmin) % cstep === 0) base = Math.round(size * num(set?.customPer));
      if (!base) return json({ error: "Unknown box size." }, 400);
      const box = boxOf(cfg, size);
      const items = [{ name: "Cookie box of " + size, description: "Fragile baked goods", value: Math.round(base), length: box.length, width: box.width, height: box.height, weight: box.weight, quantity: 1 }];
      const allowed: string[] = (Array.isArray(cfg.couriers) ? cfg.couriers : ["gojek", "grab", "lalamove"]).map((c: string) => String(c).toLowerCase().trim()).filter(Boolean);
      const inst = allowed.filter((c) => INSTANT.includes(c)), reg = allowed.filter((c) => !INSTANT.includes(c));
      const pricing: any[] = [];
      let lastErr = "";
      // the same box to the same place within a few minutes (Security tab, default 10) reuses the last courier answer (no new Biteship call)
      const rk = "qr:" + await sha([size, lat.toFixed(3), lng.toFixed(3), postal, allowed.join(","), num(o.lat), num(o.lng), num(o.postal)].join("|")), rc = cacheMs > 0 ? await cacheGet(db, rk) : null;
      if (rc) pricing.push(...rc);
      else if (!(await dayOk("bs-day-rates"))) return busy();
      if (!rc && inst.length && Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(num(o.lat, NaN)) && Number.isFinite(num(o.lng, NaN))) {
        const r = await bs(key, "POST", "/v1/rates/couriers", {
          origin_latitude: num(o.lat), origin_longitude: num(o.lng), destination_latitude: lat, destination_longitude: lng, couriers: inst.join(","), items,
        });
        console.log("rates instant", r.status, r.ok ? (r.body?.pricing || []).length : bsErr(r));
        if (r.ok && r.body && Array.isArray(r.body.pricing)) pricing.push(...r.body.pricing); else lastErr = bsErr(r);
      } else if (!rc && inst.length) console.log("rates instant skipped: missing coordinates", Number.isFinite(lat), Number.isFinite(num(o.lat, NaN)));
      if (!rc && reg.length && postal && o.postal) {
        const r = await bs(key, "POST", "/v1/rates/couriers", {
          origin_postal_code: Math.round(num(o.postal)), destination_postal_code: Math.round(num(postal)), couriers: reg.join(","), items,
        });
        if (r.ok && r.body && Array.isArray(r.body.pricing)) pricing.push(...r.body.pricing); else lastErr = lastErr || bsErr(r);
      }
      if (!rc && pricing.length && cacheMs > 0) await cacheSet(db, rk, cacheMs, pricing);
      if (!pricing.length && !lastErr && inst.length && !(Number.isFinite(lat) && Number.isFinite(lng)))
        return J({ options: [], error: "Press \"Find my address on the map\" so we can show Gojek and Grab prices." });
      if (!pricing.length && !lastErr && inst.length && !Number.isFinite(num(o.lat, NaN)))
        return J({ options: [], error: "The shop's pickup location isn't set yet." });
      if (!pricing.length) return J({ options: [], error: lastErr || "No courier is available for this address." });

      const markup = Math.max(0, num(cfg.markup, 0)), step = Math.max(1, num(cfg.roundTo, 500));
      const secret = (await kv(db, "quote_secret"))?.v as string;
      const exp = Date.now() + 15 * 60_000;
      const latS = Number.isFinite(lat) ? lat.toFixed(5) : "", lngS = Number.isFinite(lng) ? lng.toFixed(5) : "";
      const options: any[] = [];
      for (const p of pricing) {
        const code = clean(p.courier_code, 30).toLowerCase(), svc = clean(p.courier_service_code, 40);
        if (!code || !svc || !allowed.includes(code) || !(num(p.price) > 0)) continue;
        const price = Math.ceil((num(p.price) + markup) / step) * step;
        const sig = await hmacHex(secret, `${size}|${code}|${svc}|${price}|${exp}|${latS}|${lngS}|${postal}`);
        options.push({
          size, courier: code, service: svc, courierName: clean(p.courier_name, 40), serviceName: clean(p.courier_service_name, 60),
          type: clean(p.service_type || p.type, 20), eta: clean(p.shipment_duration_range ? p.shipment_duration_range + " " + (p.shipment_duration_unit || "") : p.duration, 30),
          price, exp, lat: latS, lng: lngS, postal, areaId: clean(d.areaId, 60), areaName: clean(d.areaName, 160), sig,
        });
      }
      options.sort((a, b) => a.price - b.price);
      return J({ options });
    }

    /* ---------- team only ---------- */
    const role = await teamRole(req);
    if (!role) return json({ error: "Please sign in to the team area." }, 401);
    const { set, cfg, key } = await load(db);

    if (action === "test") {
      if (!key) return json({ error: "Save your Biteship API key first." });
      const r = await bs(key, "GET", "/v1/couriers");
      console.log("test", r.status, r.ok ? "ok" : bsErr(r));
      if (!r.ok) return json({ ok: false, error: bsErr(r) });
      const list = ((r.body && r.body.couriers) || []).map((c: any) => String(c.courier_code || "").toLowerCase());
      return json({ ok: true, mode: key.startsWith("biteship_test") ? "test" : key.startsWith("biteship_live") ? "live" : "unknown", couriers: [...new Set(list)].slice(0, 60) });
    }

    if (action === "book" || action === "cancel" || action === "refresh" || action === "proof" || action === "nohold") {
      const id = clean(body.orderId, 40);
      const { data: row } = await db.from("orders").select("id,data").eq("id", id).maybeSingle();
      if (!row) return json({ error: "Order not found." }, 404);
      const o: any = row.data, sh: any = o.bship || {};

      // owner adds or replaces a pickup / delivery proof photo (empty url removes the override)
      if (action === "proof") {
        if (role !== "owner") return json({ error: "Only an owner can change proof photos." }, 403);
        const kind = body.kind === "delivery" ? "delivery" : "pickup", url = clean(body.url, 500);
        if (url && !/^https:\/\//i.test(url)) return json({ error: "Bad picture link." }, 400);
        const nsh = { ...sh, proofOverride: { ...(sh.proofOverride || {}), [kind]: url } };
        await db.from("orders").update({ data: { ...o, bship: nsh }, updated_at: Date.now() }).eq("id", id);
        return json({ ok: true, bship: nsh });
      }

      // the team turns off tomorrow's automatic driver search for this order (they book it themselves)
      if (action === "nohold") {
        const nsh = { ...sh, nightHold: false };
        await db.from("orders").update({ data: { ...o, bship: nsh }, updated_at: Date.now() }).eq("id", id);
        return json({ ok: true, bship: nsh });
      }

      if (!key) return json({ error: "Save your Biteship API key first." }, 400);
      if (action === "book") {
        const r = await bookOrder(db, key, cfg, row);
        if ((r as any).error) return json({ error: (r as any).error }, 400);
        return json({ ok: true, bship: (r as any).bship, status: (r as any).order.status });
      }

      if (action === "refresh") {
        if (!sh.biteshipId) return json({ error: "No courier booked right now." }, 400);
        const r = await bs(key, "GET", "/v1/orders/" + encodeURIComponent(sh.biteshipId));
        console.log("refresh", o.code, r.status, r.ok ? r.body?.status : bsErr(r));
        if (!r.ok || !r.body) return json({ error: bsErr(r) }, 502);
        const b = r.body, cr = b.courier || {};
        const next = await applyUpdate(db, row, { status: b.status, waybill: cr.waybill_id, link: cr.link, trackingId: cr.tracking_id, price: b.price, driver: driverOf(b) || undefined, proofs: findProofs(b) }, true);
        return json({ ok: true, bship: next.bship, status: next.status, completedAt: next.completedAt || null, msgs: next.msgs });
      }

      // cancel (by the shop)
      if (!sh.biteshipId) return json({ error: "No courier booked." }, 400);
      const why = { cancellation_reason_code: "others", cancellation_reason: clean(body.reason || "Cancelled by the shop", 120) };
      let r = await bs(key, "DELETE", "/v1/orders/" + encodeURIComponent(sh.biteshipId), why);
      if (!r.ok && (r.status === 404 || r.status === 405)) r = await bs(key, "POST", "/v1/orders/" + encodeURIComponent(sh.biteshipId) + "/cancel", why);
      console.log("cancel", o.code, r.status, r.ok ? "ok" : bsErr(r));
      if (!r.ok) return json({ error: bsErr(r) }, 502);
      const now = Date.now();
      const nsh = { ...sh, status: "cancelled", statusAt: now, cancelledAt: now, prevIds: [...(sh.prevIds || []), sh.biteshipId].slice(-10), biteshipId: "", failed: false, nightHold: false,
        history: [...(sh.history || []), { s: "cancelled", at: now, by: "shop" }].slice(-25) };
      await db.from("orders").update({ data: { ...o, bship: nsh }, updated_at: now }).eq("id", id);
      return json({ ok: true, bship: nsh });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
