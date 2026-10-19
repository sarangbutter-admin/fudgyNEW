/* Delidome: Supabase wiring (loaded before app.js, used by it through window.SBH).
   - Visitors: load the public shop, place / edit / cancel / track orders, pay, complain, rate, review (all through database functions)
   -    When Supabase is not configured, SBH.on is false and none of this runs (demo mode). */
(function () {
  "use strict";
  var K = window.SBK;
  var H = window.SBH = { on: !!(K && K.on), loaded: false };
  if (!H.on) return;

  var J = JSON.stringify;
  var TOK_KEY = "delidome-tok-v1";
  var TOK = {};
  try { TOK = JSON.parse(localStorage.getItem(TOK_KEY) || "{}") || {}; } catch (e) { TOK = {}; }
  function saveTok() { try { localStorage.setItem(TOK_KEY, J(TOK)); } catch (e) {} }
  var $q = function (s) { return document.querySelector(s); };

  /* ================= visitors ================= */
  function blankDB() {
    var seed = seedDB();
    return migrate({ v: 1, settings: seed.settings, sizes: [], products: [], addons: [], sales: [], orders: [], categories: [], coupons: [], broadcasts: [], payMethods: [] });
  }
  H.initDB = function () { DB = blankDB(); };

  var shopSig = "";
  function applyPublic(res) {
    var d = res.docs || {};
    var keep = DB.orders || [];
    var raw = {
      v: 1,
      settings: Object.assign({}, seedDB().settings, d.settings || {}),
      sizes: res.sizes || [], products: res.products || [], addons: res.addons || [], sales: res.sales || [],
      categories: res.categories || [], broadcasts: res.broadcasts || [],
      coupons: (res.coupons || []).map(function (c) { return Object.assign({}, c, { startsAt: "", endsAt: "", maxUses: 0 }); }),
      payMethods: Array.isArray(d.payMethods) ? d.payMethods : [],
      proofpop: d.proofpop, page: d.page, marquee: d.marquee, announcer: d.announcer, thanks: d.thanks, badges: d.badges, sold: res.sold || {}, slotUse: res.slotUse || {}, orders: []
    };
    // coupons the visitor typed in earlier stay usable until the page is reloaded
    (DB.coupons || []).forEach(function (c) { if (c._srv && !raw.coupons.some(function (x) { return x.code === c.code; })) raw.coupons.push(c); });
    DB = migrate(raw);
    DB.orders = keep;
    H.skew = (res.now || Date.now()) - Date.now();
  }
  function shopChanged(res) { var s = J([res.docs, res.sizes, res.products, res.addons, res.sales, res.categories, res.broadcasts, res.coupons, res.slotUse]); var ch = s !== shopSig; shopSig = s; return ch; }

  function banner(msg, retry) {
    var el = $q("#sbLoading");
    if (!el) { el = document.createElement("div"); el.id = "sbLoading"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    if (!msg) { el.remove(); return; }
    el.innerHTML = "";
    var sp = document.createElement("span"); sp.textContent = msg; el.appendChild(sp);
    if (retry) { var b = document.createElement("button"); b.type = "button"; b.textContent = "Try again"; b.addEventListener("click", retry); el.appendChild(b); }
  }

  var shopBusy = false;
  H.loadShop = async function (quiet) {
    if (shopBusy) return;
    shopBusy = true;
    try {
      var res = await K.rpc("shop_public", {});
      var ch = shopChanged(res) || !H.loaded;
      if (ch) applyPublic(res);
      var first = !H.loaded;
      H.loaded = true; banner(!(DB.sizes.length && DB.products.length) ? "The shop is being set up. Please check back soon." : "");
      if (first) { view = null; route(); H.refreshOrders(); }
      else if (ch && view === "store" && $q("#sheet").hidden) { sanitizeCart(); renderStoreStatic(); renderStore(); renderEditBar(); }
    } catch (e) {
      if (!H.loaded) banner("We couldn't load the shop. " + e.message, function () { banner("Loading the shop…"); H.loadShop(); });
    } finally { shopBusy = false; }
  };

  function refs() { return MINE.filter(function (id) { return TOK[id]; }).map(function (id) { return { id: id, token: TOK[id] }; }); }
  function typingInMO() {
    var f = document.activeElement, sh = $q("#moSheet");
    if (f && sh && sh.contains(f) && /INPUT|TEXTAREA|SELECT/.test(f.tagName)) return true;
    if (window.PLE_DIRTY) return true;   // unsaved delivery details
    var pf = $q("#mpFile"), pn = $q("#mpName"), ct = $q("#cpText");
    return !!((pf && pf.files && pf.files.length) || (pn && pn.value) || (ct && ct.value));
  }
  function setOrderIn(list, d) {
    var i = list.findIndex(function (x) { return x.id === d.id; });
    if (i >= 0) {
      var o = list[i], ph = o.complaint && o.complaint.photos, pi = o.proof && o.proof.img;
      Object.keys(o).forEach(function (k) { delete o[k]; });
      Object.assign(o, d);
      if (o.complaint && ph && ph.length && !(o.complaint.photos || []).length) o.complaint.photos = ph;
      if (o.proof && pi && !o.proof.img) o.proof.img = pi;
    } else list.unshift(d);
  }
  var ordBusy = false, lastOrdSig = "";
  H.refreshOrders = async function () {
    if (ordBusy) return;
    var r = refs(); if (!r.length) { if (DB.orders.length) { DB.orders = []; } return; }
    ordBusy = true;
    try {
      var list = await K.rpc("my_orders", { p_refs: r });
      var sig = J(list);
      if (sig === lastOrdSig) return;
      lastOrdSig = sig;
      var ids = {}; list.forEach(function (d) { ids[d.id] = 1; setOrderIn(DB.orders, d); });
      DB.orders = DB.orders.filter(function (o) { return ids[o.id]; });
      renderBag(); renderBell();
      if (!$q("#moSheet").hidden && !typingInMO()) renderMO();
      if (view === "store" && S.editId && !DB.orders.some(function (o) { return o.id === S.editId && o.status === "awaiting"; })) { S.editId = null; saveCart(); renderEditBar(); }
    } catch (e) { /* keep what we have */ }
    finally { ordBusy = false; }
  };

  H.place = async function (payload, existing) {
    var p = Object.assign({}, payload);
    if (existing) { p.editId = existing.id; p.editToken = TOK[existing.id] || ""; }
    var r = await K.rpc("place_order", { p: p });
    if (r.token) { TOK[r.order.id] = r.token; saveTok(); }
    setOrderIn(DB.orders, r.order);
    lastOrdSig = "";
    // affiliate link: credit the new order to the link the customer came from (within 30 days; a matching coupon wins on the server)
    if (!existing && r.token) { try { var af = JSON.parse(localStorage.getItem("delidome-aff-v1") || "null");
      if (af && af.code && Date.now() - af.at < 30 * 864e5) K.rpc("aff_claim", { p_id: r.order.id, p_token: r.token, p_code: af.code, p_src: af.src || "", p_at: af.at }).catch(function () {}); } catch (e) {} }
    return DB.orders.find(function (x) { return x.id === r.order.id; });
  };
  H.affHit = function (code, vid, src) { K.rpc("aff_hit", { p_code: code, p_vid: vid, p_src: src }).catch(function () {}); };
  function tk(id) { return TOK[id] || ""; }
  H.cancel = async function (id) { var d = await K.rpc("cancel_order", { p_id: id, p_token: tk(id) }); setOrderIn(DB.orders, d); lastOrdSig = ""; };
  H.track = async function (code, phone) {
    var r = await K.rpc("track_order", { p_code: code, p_phone: phone });
    if (!r || !r.found) return null;
    TOK[r.order.id] = r.token; saveTok();
    setOrderIn(DB.orders, r.order); lastOrdSig = "";
    return r.order.id;
  };
  H.proof = async function (id, name, img) { var d = await K.rpc("submit_proof", { p_id: id, p_token: tk(id), p_name: name, p_img: img }); setOrderIn(DB.orders, d); var o = DB.orders.find(function (x) { return x.id === id; }); if (o && o.proof) o.proof.img = img; lastOrdSig = ""; };
  H.complain = async function (id, c) { var d = await K.rpc("submit_complaint", { p_id: id, p_token: tk(id), p: c }); setOrderIn(DB.orders, d); var o = DB.orders.find(function (x) { return x.id === id; }); if (o && o.complaint) o.complaint.photos = (c.photos || []).slice(); lastOrdSig = ""; };
  H.rate = async function (id, ratings) { var d = await K.rpc("submit_rating", { p_id: id, p_token: tk(id), p_ratings: ratings }); setOrderIn(DB.orders, d); lastOrdSig = ""; shopSig = ""; H.loadShop(true); };
  H.checkCoupon = async function (code, size, phone, editId) {
    var r = await K.rpc("check_coupon", { p_code: code, p_size: size, p_phone: phone || "", p_edit_id: editId || null });
    if (r && r.ok && r.coupon) {
      var c = Object.assign({}, r.coupon, { startsAt: "", endsAt: "", maxUses: 0, _srv: true });
      var i = DB.coupons.findIndex(function (x) { return x.code === c.code; });
      if (i >= 0) DB.coupons[i] = Object.assign({}, DB.coupons[i], c); else DB.coupons.push(c);
    }
    return r;
  };
  // driver note + place photo, saved right after the order is placed
  H.placeInfo = async function (id, note, img) { var d = await K.rpc("submit_place", { p_id: id, p_token: tk(id), p_note: note || "", p_img: img || "" }); setOrderIn(DB.orders, d); lastOrdSig = ""; };
  H.visit = function (vid) { K.rpc("log_visit", { p_vid: vid }).catch(function () {}); };
  // complaint photos are stored apart from the order; fetch them when the customer opens the order
  var fileLoading = {};
  H.needFiles = function (o) {
    var needCp = o && o.complaint && o.complaint.photoCount > 0 && !(o.complaint.photos || []).length;
    var needPl = o && o.place && o.place.photo && !o.place.img;
    if (!o || !(needCp || needPl) || fileLoading[o.id]) return;
    fileLoading[o.id] = 1;
    K.rpc("order_files", { p_id: o.id, p_token: tk(o.id) }).then(function (f) {
      var ch = false;
      if (f && f.photos && f.photos.length && o.complaint) { o.complaint.photos = f.photos; ch = true; }
      if (f && f.place && o.place) { o.place.img = f.place; ch = true; }
      if (ch && !$q("#moSheet").hidden && MO.id === o.id && !typingInMO()) renderMO();
    }).catch(function () {}).finally(function () { fileLoading[o.id] = 0; });
  };

  /* visitor polling */
  setInterval(function () {
    if (document.hidden || !H.loaded) return;
    var t = Date.now(), live = DB.orders.some(function (o) { return ["awaiting", "review", "new", "baking", "ready"].indexOf(o.status) >= 0; });
    if (!$q("#moSheet").hidden || live) H.refreshOrders();
    else if (Math.floor(t / 1000) % 60 === 0) H.refreshOrders();
    if (Math.floor(t / 1000) % 45 === 0) H.loadShop(true);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && H.loaded) { H.refreshOrders(); H.loadShop(true); } });

  // Edge Functions (courier prices etc.); admin = true sends the team sign-in
  H.fn = function (name, body, admin) { return K.fn(name, body, !!admin); };

})();
