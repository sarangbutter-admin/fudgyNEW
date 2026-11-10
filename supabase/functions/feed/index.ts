// Delidome: public read-only files for search engines, AI assistants and shopping catalogs, built live from the shop data.
//   ?f=google   product feed (RSS 2.0 + g: fields). Works for Google Merchant Center, the Meta (Facebook / Instagram) catalog and the TikTok catalog.
//   ?f=csv      the same products as CSV (Meta / TikTok "data feed" columns)
//   ?f=llms     llms.txt: plain description of the shop, menu, prices, delivery and FAQ for AI assistants (GEO)
//   ?f=sitemap  sitemap.xml      ?f=robots  robots.txt (with the sitemap line)      ?f=og  the share picture (redirect)
// The shop (Netlify) proxies /feeds/google.xml, /feeds/products.csv, /llms.txt, /sitemap.xml, /robots.txt and /og-image here.
// Only public shop data is read (the same the shop page shows). No sign-in. Deploy with verify_jwt = false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FALLBACK_SITE = "https://delidomeorder.netlify.app";
const xml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const csv = (s: unknown) => { const t = String(s ?? "").replace(/\r?\n/g, " "); return /[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const httpsImg = (u: unknown) => { const s = String(u || ""); return /^https:\/\//.test(s) ? s : ""; };
const clean = (s: unknown, n = 5000) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, n);

function hdr(type: string, maxAge = 900) {
  return { "Content-Type": type, "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`, "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
}

async function load() {
  const d = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [{ data: docs }, { data: coll }] = await Promise.all([
    d.from("docs").select("key,data").in("key", ["settings", "page"]),
    d.from("coll").select("coll,id,data").in("coll", ["sizes", "products", "sales"]),
  ]);
  const doc = (k: string) => (docs || []).find((x: any) => x.key === k)?.data || {};
  const rows = (c: string) => (coll || []).filter((x: any) => x.coll === c).map((x: any) => ({ id: x.id, ...x.data }));
  const s: any = doc("settings"), pg: any = doc("page");
  const site = (/^https:\/\/[^\s/]+/.exec(String(s.siteUrl || "").trim())?.[0] || FALLBACK_SITE).replace(/\/+$/, "");
  const cur = String(s.currencyCode || "").toUpperCase() || (/^rp/i.test(String(s.currency || "")) ? "IDR" : /^\$/.test(String(s.currency || "")) ? "USD" : "IDR");
  const brand = clean(s.seoBrand || pg.name || "Delidome", 70);
  const flavors = rows("products").filter((p: any) => p.status !== "hidden" && p.name);
  const avail = flavors.filter((p: any) => p.status !== "soldout" && (!p.track || (+p.stock || 0) > 0));
  const sizes = rows("sizes").filter((z: any) => z.active !== false && +z.n > 0 && +z.price > 0).sort((a: any, b: any) => a.n - b.n);
  const now = Date.now();
  const sales = rows("sales").filter((x: any) => x.type !== "freedelivery" && x.type !== "gifts" && +x.start <= now && now < +x.end);
  const sale = (n: number, base: number) => {
    let best: any = null, off = 0;
    for (const x of sales) {
      if (!(x.appliesTo === "all" || +x.appliesTo === n)) continue;
      const v = x.type === "percent" ? base * (+x.value || 0) / 100 : Math.min(+x.value || 0, base);
      if (v > off) { off = v; best = x; }
    }
    return best ? { price: Math.max(0, Math.round((base - off) * 100) / 100), x: best } : null;
  };
  const img = httpsImg(s.seoImg) || httpsImg(avail.find((p: any) => httpsImg(p.img))?.img) || httpsImg(pg.logo);
  const desc = clean(s.seoDesc || `Freshly baked cookie boxes from ${brand}. Pick your box size and fill it with your favourite flavors.`, 300);
  const area = clean(s.seoArea || s.address || "", 160);
  const amt = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} ${cur}`;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const items = sizes.map((z: any) => {
    const sl = sale(+z.n, +z.price);
    const names = avail.map((p: any) => p.name);
    return {
      id: `box-${z.n}`, n: +z.n, link: `${site}/?size=${z.n}`, price: +z.price, sale: sl,
      title: clean(`${brand} Cookie Box of ${z.n}`, 150),
      description: clean(`${desc} Box of ${z.n} cookies, you choose the flavors${names.length ? ": " + names.join(", ") : ""}.${area ? " " + area : ""}`, 5000),
      available: avail.length > 0,
    };
  });
  const cutoff = Number.isFinite(+s.cutoffHour) ? `${String(+s.cutoffHour).padStart(2, "0")}:00` : "";
  const faq = (Array.isArray(pg.faq) ? pg.faq : []).filter((f: any) => f && f.q && f.a)
    .map((f: any) => ({ q: clean(f.q, 300), a: clean(String(f.a).replace(/\{cutoff\}/g, cutoff), 1200) }));
  return { s, pg, site, cur, brand, desc, area, img, items, flavors, avail, amt, iso, faq };
}

function google(D: any) {
  const cat = clean(D.s.seoGCat || "Food, Beverages & Tobacco > Food Items > Bakery > Cookies", 250);
  const it = D.items.map((p: any) => `<item>
<g:id>${xml(p.id)}</g:id>
<g:title>${xml(p.title)}</g:title>
<g:description>${xml(p.description)}</g:description>
<g:link>${xml(p.link)}</g:link>
${D.img ? `<g:image_link>${xml(D.img)}</g:image_link>\n` : ""}<g:availability>${p.available ? "in_stock" : "out_of_stock"}</g:availability>
<g:price>${xml(D.amt(p.price))}</g:price>
${p.sale ? `<g:sale_price>${xml(D.amt(p.sale.price))}</g:sale_price>\n<g:sale_price_effective_date>${D.iso(+p.sale.x.start)}/${D.iso(+p.sale.x.end)}</g:sale_price_effective_date>\n` : ""}<g:brand>${xml(D.brand)}</g:brand>
<g:condition>new</g:condition>
<g:identifier_exists>no</g:identifier_exists>
<g:google_product_category>${xml(cat)}</g:google_product_category>
<g:product_type>Cookies &gt; Cookie boxes</g:product_type>
<g:item_group_id>cookie-box</g:item_group_id>
<g:size>${p.n} cookies</g:size>
</item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${xml(D.brand)}</title>
<link>${xml(D.site)}/</link>
<description>${xml(D.desc)}</description>
${it}
</channel>
</rss>
`;
}

function csvFeed(D: any) {
  const head = ["id", "title", "description", "availability", "condition", "price", "sale_price", "sale_price_effective_date", "link", "image_link", "brand", "google_product_category", "item_group_id", "size"];
  const cat = D.s.seoGCat || "Food, Beverages & Tobacco > Food Items > Bakery > Cookies";
  const lines = D.items.map((p: any) => [p.id, p.title, p.description, p.available ? "in stock" : "out of stock", "new", D.amt(p.price),
    p.sale ? D.amt(p.sale.price) : "", p.sale ? `${D.iso(+p.sale.x.start)}/${D.iso(+p.sale.x.end)}` : "", p.link, D.img, D.brand, cat, "cookie-box", `${p.n} cookies`].map(csv).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

function llms(D: any) {
  const s = D.s, money = (v: number) => /^rp/i.test(String(s.currency || "")) ? `Rp${Math.ceil(v).toLocaleString("id-ID")}` : `${s.currency || ""}${v.toFixed(2)}`;
  const hours = (Array.isArray(s.hours) ? s.hours : []).map((h: any) => Array.isArray(h) ? `${clean(h[0], 40)}: ${clean(h[1], 40)}` : "").filter(Boolean);
  const out = [`# ${D.brand}`, "", `> ${D.desc}`, "",
    `Website: ${D.site}/`, D.area ? `Area: ${D.area}` : "", s.seoPhone ? `WhatsApp / phone: ${clean(s.seoPhone, 30)}` : "",
    hours.length ? `Opening hours: ${hours.join("; ")}` : "", s.deliveryKm ? `Delivery: within about ${s.deliveryKm} km of the shop, by courier (sameday, instant or scheduled), or pickup.` : "",
    ...["seoIg", "seoTiktok", "seoFb"].map((k) => /^https:\/\//.test(String(s[k] || "")) ? `${k === "seoIg" ? "Instagram" : k === "seoTiktok" ? "TikTok" : "Facebook"}: ${s[k]}` : ""),
    "", "## How to order", "", `1. Open ${D.site}/ and pick a box size.`, "2. Fill the box with the flavors you like (one cookie per slot).", "3. Choose delivery or pickup, a day and a time, then place the order and pay.", "",
    "## Box sizes and prices", "", ...D.items.map((p: any) => `- Box of ${p.n} cookies: ${p.sale ? `${money(p.sale.price)} (flash sale, normally ${money(p.price)})` : money(p.price)} - ${p.link}`), "",
    "## Flavors", "", ...D.flavors.map((f: any) => `- ${clean(f.name, 60)}${f.desc ? ": " + clean(f.desc, 200) : ""}${(+f.surcharge || 0) > 0 ? ` (+${money(+f.surcharge)} per cookie)` : ""}${D.avail.includes(f) ? "" : " (sold out right now)"}`),
    ...(D.faq.length ? ["", "## Questions and answers", "", ...D.faq.flatMap((f: any) => [`### ${f.q}`, "", f.a, ""])] : []),
    "", "## Machine-readable", "", `- Product feed: ${D.site}/feeds/google.xml`, `- Sitemap: ${D.site}/sitemap.xml`, ""];
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("GET only", { status: 405 });
  const f = new URL(req.url).searchParams.get("f") || "";
  let D: any;
  try { D = await load(); } catch { return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "120" } }); }
  switch (f) {
    case "google": return new Response(google(D), { headers: hdr("application/xml; charset=utf-8") });
    case "csv": return new Response(csvFeed(D), { headers: hdr("text/csv; charset=utf-8") });
    case "llms": return new Response(llms(D), { headers: hdr("text/plain; charset=utf-8") });
    case "sitemap": {
      const lm = new Date().toISOString().slice(0, 10);
      const urls = [`${D.site}/`, `${D.site}/join`].map((u, i) => `<url><loc>${xml(u)}</loc><lastmod>${lm}</lastmod><changefreq>${i ? "monthly" : "daily"}</changefreq><priority>${i ? "0.3" : "1.0"}</priority></url>`).join("\n");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: hdr("application/xml; charset=utf-8", 3600) });
    }
    case "robots": return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${D.site}/sitemap.xml\n`, { headers: hdr("text/plain; charset=utf-8", 3600) });
    case "og": return D.img ? new Response(null, { status: 302, headers: { Location: D.img, "Cache-Control": "public, max-age=3600" } }) : new Response("No picture", { status: 404 });
    default: return new Response("Unknown file", { status: 404 });
  }
});
