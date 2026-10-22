/* Delidome: Supabase wiring (loaded before app.js, used by it through window.SBH).
   - Visitors: load the public shop, place / edit / cancel / track orders, pay, complain, rate, review (all through database functions)
   - Owner: sign in, load everything, auto-save every change, poll for new orders
   When Supabase is not configured, SBH.on is false and none of this runs (demo mode). */
(function () {
  "use strict";
  var K = window.SBK;
  var H = window.SBH = { on: !!(K && K.on), loaded: false, admin: false };
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
      proofpop: d.proofpop, prelaunch: d.prelaunch, page: d.page, marquee: d.marquee, announcer: d.announcer, thanks: d.thanks, badges: d.badges, sold: res.sold || {}, slotUse: res.slotUse || {}, orders: []
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
    if (shopBusy || H.admin) return;
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
    if (ordBusy || H.admin) return;
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
    // pre-launch gift code: attach the gift to the new order (the server checks the code belongs to this WhatsApp number)
    if (!existing && r.token && p.preCode) { try { var pg = await K.rpc("pre_gift_claim", { p_id: r.order.id, p_token: r.token, p_code: p.preCode });
      var po = DB.orders.find(function (x) { return x.id === r.order.id; }); if (po && pg) { if (pg.ok) po.preGift = pg.gift; else po._preErr = pg.err; } } catch (e) {} }
    return DB.orders.find(function (x) { return x.id === r.order.id; });
  };
  H.preGift = function (code, phone) { return K.rpc("pre_gift_check", { p_code: code, p_phone: phone || "" }); };
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
    if (H.admin || document.hidden || !H.loaded) return;
    var t = Date.now(), live = DB.orders.some(function (o) { return ["awaiting", "review", "new", "baking", "ready"].indexOf(o.status) >= 0; });
    if (!$q("#moSheet").hidden || live) H.refreshOrders();
    else if (Math.floor(t / 1000) % 60 === 0) H.refreshOrders();
    if (Math.floor(t / 1000) % 45 === 0) H.loadShop(true);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !H.admin && H.loaded) { H.refreshOrders(); H.loadShop(true); } });

  // Edge Functions (courier prices etc.); admin = true sends the team sign-in
  H.preStatus = function () { return K.rpc("prelaunch_public", {}); };
  H.preReg = function (n, p, e) { return K.rpc("prelaunch_register", { p_name: n, p_phone: p, p_email: e || "" }); };
  H.banMsg = function () { return K.rpc("ban_msg", {}); };
  H.fn = function (name, body, admin) { return K.fn(name, body, !!admin); };

  // affiliators: their own sign-in on the shop address (/#partner); a team account is turned away here
  if (!H.rpc) H.rpc = function (name, args) { return K.rpc(name, args, true); };
  if (!H.signOut) H.signOut = function () { K.logout(); location.reload(); };
  H.partner = function (msg) {
    if (H.aff) return;
    var go = async function () {
      var af = await K.rpc("aff_me", {}, true);
      if (af && af.aff && typeof window.affStart === "function") { var l = $q("#adLogin"); if (l) l.remove(); H.aff = af; window.affStart(af); return; }
      K.logout(); throw new Error(af && af.disabled ? "This affiliate account is switched off. Please contact the shop." : "This isn't an affiliate account.");
    };
    if (K.signedIn && K.signedIn() && !msg) { go().catch(function (e) { H.partner(e.message); }); return; }
    var el = $q("#adLogin"); if (el) el.remove();
    el = document.createElement("div"); el.id = "adLogin";
    el.innerHTML = '<form class="adl-card" novalidate><h2>Affiliate sign in</h2><p class="adl-sub">Use the username and password the shop gave you.</p>' +
      '<label>Username<input class="in" id="adlEmail" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label>Password<input class="in" id="adlPass" type="password" autocomplete="current-password" required></label>' +
      '<p class="adl-err" id="adlErr" role="alert" hidden></p><button class="btn btn-blue" type="submit" id="adlGo">Sign in</button>' +
      '<p class="adl-sub" style="margin-top:12px"><a href="./">← Back to the shop</a></p></form>';
    document.body.appendChild(el);
    var err = $q("#adlErr"); if (msg) { err.textContent = msg; err.hidden = false; }
    el.querySelector("a").addEventListener("click", function () { el.remove(); });
    el.querySelector("form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var em = $q("#adlEmail").value.trim(), pw = $q("#adlPass").value, b = $q("#adlGo");
      if (!em || !pw) { err.textContent = "Enter your username and password."; err.hidden = false; return; }
      if (em.indexOf("@") < 0) em = em.toLowerCase() + "@team.delidome.local";
      b.disabled = true; b.textContent = "Signing in…"; err.hidden = true;
      try { await K.login(em, pw); await go(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Sign in"; }
    });
  };

  /* ================= owner: sign-in ================= */
  var DOCS = ["settings", "page", "marquee", "announcer", "thanks", "proofpop", "payMethods", "alerts", "label", "badges", "prelaunch"];
  var COLLS = { sizes: function (o) { return String(o.n); }, categories: function (o) { return o.id; }, addons: function (o) { return o.id; }, sales: function (o) { return o.id; }, coupons: function (o) { return o.id; }, broadcasts: function (o) { return o.id; } };
  var OFIELDS = ["status", "expiresAt", "cancelReason", "paidAt", "completedAt", "labelAt", "courier", "awb", "rejected", "items", "total", "surcharge", "notify"];

  function loginUI(msg) {
    var el = $q("#adLogin");
    if (el) el.remove();
    el = document.createElement("div"); el.id = "adLogin";
    el.innerHTML = '<form class="adl-card" novalidate><h2>Team sign in</h2><p class="adl-sub">For the owner, staff and affiliators.</p>' +
      '<label>Username or email<input class="in" id="adlEmail" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label>Password<input class="in" id="adlPass" type="password" autocomplete="current-password" required></label>' +
      '<p class="adl-err" id="adlErr" role="alert" hidden></p>' +
      '<button class="btn btn-blue" type="submit" id="adlGo">Sign in</button></form>';
    document.body.appendChild(el);
    var err = $q("#adlErr");
    if (msg) { err.textContent = msg; err.hidden = false; }
    $q("#adlEmail").focus();
    el.querySelector("form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var em = $q("#adlEmail").value.trim(), pw = $q("#adlPass").value, b = $q("#adlGo");
      if (!em || !pw) { err.textContent = "Enter your username (or email) and password."; err.hidden = false; return; }
      if (em.indexOf("@") < 0) em = em.toLowerCase() + "@team.delidome.local";   // staff sign in with a username
      b.disabled = true; b.textContent = "Signing in…"; err.hidden = true;
      try { await K.login(em, pw); await startAdmin(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Sign in"; }
    });
  }

  var starting = false;
  H.adminReady = function () { return H.admin; };
  H.rpc = function (name, args) { return K.rpc(name, args, true); };
  H.enterAdmin = function () {
    if (H.admin) return;
    if (!K.signedIn()) { loginUI(); return; }
    startAdmin().catch(function (e) { K.logout(); loginUI(e.message); });
  };
  H.leaveAdmin = function () {
    var el = $q("#adLogin"); if (el) el.remove();
    if (!H.admin) return;
    flush().finally(function () { stopAdmin(); });
  };
  H.signOut = async function () {
    try { await flush(); } catch (e) {}
    K.logout(); stopAdmin(); location.reload();
  };
  function stopAdmin() {
    H.admin = false; clearInterval(pollT); pollT = null; dirty = false;
    H.initDB(); shopSig = ""; H.loaded = false; ["#syncSt", "#signOut"].forEach(function (s) { var e = $q(s); if (e) e.hidden = true; });
    if (view === "store") { H.loadShop(); }
  }

  /* ================= owner: load ================= */
  var HELD = { settings: 1, marquee: 1, page: 1, thanks: 1, proofpop: 1, payMethods: 1, badges: 1, prelaunch: 1 }, FORCE = {};
  var SN = { docs: {}, rows: {}, prods: {}, orders: {} }, SINCE = 0, pollT = null, dirty = false, flushing = false, again = false, flushT = null, failN = 0;

  function snapOrder(o) {
    var f = {}; OFIELDS.forEach(function (k) { f[k] = J(o[k] === undefined ? null : o[k]); });
    return { f: f, ml: (o.msgs || []).length, cs: o.complaint ? o.complaint.status : null, cr: o.complaint ? (o.complaint.reply || "") : null };
  }
  function diffOrder(o, sn) {
    if (!sn) return null;
    var p = {}, any = false;
    OFIELDS.forEach(function (k) { var v = o[k] === undefined ? null : o[k]; if (J(v) !== sn.f[k]) { p[k] = v; any = true; } });
    var ms = o.msgs || [];
    if (ms.length > sn.ml) {
      var add = ms.slice(sn.ml).filter(function (m) { return m && (m.channel === "whatsapp" || m.channel === "email" || m.channel === "bell") && (m.by === "staff" || m.by === "system"); })
        .map(function (m) { return { at: m.at, channel: m.channel, status: m.status, text: String(m.text || "").slice(0, 800), by: m.by }; });
      if (add.length) { p.msgsAdd = add; any = true; }
    }
    if (o.complaint && (o.complaint.status !== sn.cs || (o.complaint.reply || "") !== sn.cr)) { p.complaint = { status: o.complaint.status, reply: o.complaint.reply || "" }; any = true; }
    return any ? p : null;
  }
  function snapAll() {
    SN = { docs: {}, rows: {}, prods: {}, orders: {} };
    DOCS.forEach(function (k) { SN.docs[k] = DB[k] === undefined ? null : J(DB[k]); });
    Object.keys(COLLS).forEach(function (c) { SN.rows[c] = {}; (DB[c] || []).forEach(function (o, i) { SN.rows[c][COLLS[c](o)] = { pos: i, j: J(o) }; }); });
    DB.products.forEach(function (p, i) { SN.prods[p.id] = snapProd(p, i); });
    DB.orders.forEach(function (o) { SN.orders[o.id] = snapOrder(o); });
  }
  function snapProd(p, i) {
    var rest = Object.assign({}, p); delete rest.stock; delete rest.reviews;
    return { pos: i, j: J(rest), stock: p.stock, revs: (p.reviews || []).map(function (r) { return r.id + "|" + J(r); }) };
  }

  function buildAdminDB(r) {
    var docs = r.docs || {}, colls = r.colls || {};
    var rows = function (c) { return (colls[c] || []).map(function (x) { return x.data; }); };
    var seed = seedDB();
    var raw = { v: 1, settings: Object.assign({}, seed.settings, docs.settings || {}), sizes: rows("sizes"), products: rows("products"), addons: rows("addons"), sales: rows("sales"),
      categories: rows("categories"), coupons: rows("coupons"), broadcasts: rows("broadcasts"), orders: r.orders || [],
      payMethods: Array.isArray(docs.payMethods) ? docs.payMethods : undefined, proofpop: docs.proofpop, page: docs.page, marquee: docs.marquee, announcer: docs.announcer,
      thanks: docs.thanks, alerts: docs.alerts, label: docs.label, badges: docs.badges, prelaunch: docs.prelaunch };
    return raw;
  }
  function cleanStarter() {
    var d = seedDB();
    d.orders = []; d.sales = []; d.coupons = [];
    d.products.forEach(function (p) { p.reviews = []; });
    return d;
  }

  async function startAdmin() {
    if (starting) return; starting = true;
    try {
      var me = await K.rpc("admin_me", {}, true);
      if (!me || !me.admin) {
        // an affiliator signs in here too and gets only their own dashboard
        var af = await K.rpc("aff_me", {}, true).catch(function () { return null; });
        if (af && af.aff && typeof window.affStart === "function") { H.aff = af; var l0 = $q("#adLogin"); if (l0) l0.remove(); window.affStart(af); return; }
        K.logout();
        throw new Error(af && af.disabled ? "This affiliate account is switched off. Please contact the shop." : "This account isn't on the team. Ask the owner to add your email.");
      }
      H.role = me.role === "staff" ? "staff" : "owner"; H.email = me.email || K.email() || "";
      H.perms = Array.isArray(me.perms) ? me.perms : []; H.title = me.title || ""; H.username = me.username || ""; H.name = me.name || "";
      var r = await K.rpc("admin_load", {}, true);
      var fresh = !(r.docs && r.docs.settings);
      if (fresh && H.role !== "owner") { K.logout(); throw new Error("The shop hasn't been set up yet. The owner needs to sign in first."); }
      var raw = fresh ? cleanStarter() : buildAdminDB(r);
      DB = migrate(raw);
      VIS = (r.visits || []).slice();
      SINCE = (r.now || Date.now()) - 3000;
      H.admin = true; H.loaded = true;
      snapAll();
      if (fresh) { SN = { docs: {}, rows: { sizes: {}, categories: {}, addons: {}, sales: {}, coupons: {}, broadcasts: {} }, prods: {}, orders: {} }; }
      try { if (!localStorage.getItem("delidome-aadmin-v1")) { ABOOT = Date.now(); localStorage.setItem(ABOOT_KEY, String(ABOOT)); localStorage.setItem("delidome-aadmin-v1", "1"); } } catch (e) {}
      var el = $q("#adLogin"); if (el) el.remove();
      ["#syncSt", "#signOut"].forEach(function (s) { var e = $q(s); if (e) e.hidden = false; });
      setSync(fresh ? "saving" : "saved");
      view = null; route();
      if (fresh) { toast("Your shop is set up with starter flavors. Edit anything from the menu."); schedule(); }
      clearInterval(pollT); pollT = setInterval(poll, 5000);
    } finally { starting = false; }
  }

  /* ================= owner: save ================= */
  function setSync(st, msg) {
    var e = $q("#syncSt"); if (!e) return;
    e.textContent = st === "saving" ? "Saving…" : st === "error" ? "Not saved, retrying…" : (H.pending && H.pending().length ? "Draft saved · not published yet" : "All changes saved");
    e.title = msg || ""; e.dataset.st = st;
  }
  H.save = function () { if (!H.admin) return true; dirty = true; setSync("saving"); schedule(); return true; };
  function schedule(ms) { clearTimeout(flushT); flushT = setTimeout(flush, ms == null ? 500 : ms); }
  addEventListener("beforeunload", function (e) { if (H.admin && (dirty || flushing || H.pending().length)) { e.preventDefault(); e.returnValue = ""; } });

  var upCache = {};
  async function walk(o) {
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) o[i] = await item(o[i]); }
    else if (o && typeof o === "object") { for (var k in o) o[k] = await item(o[k]); }
  }
  async function item(v) {
    if (typeof v === "string") {
      if (v.length > 1500 && /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i.test(v)) {
        var key = v.length + ":" + v.slice(-60) + v.slice(30, 90);
        if (!upCache[key]) upCache[key] = await K.upload(v);
        return upCache[key];
      }
      return v;
    }
    if (v && typeof v === "object") await walk(v);
    return v;
  }

  async function flush() {
    if (!H.admin) return;
    if (flushing) { again = true; return; }
    flushing = true; again = false; clearTimeout(flushT);
    try {
      var ops = [];
      // 1) settings-like documents
      for (var di = 0; di < DOCS.length; di++) {
        var k = DOCS[di], v = DB[k];
        if (v === undefined) continue;
        if (J(v) === SN.docs[k]) continue;
        if (HELD[k] && !FORCE[k] && SN.docs[k] !== undefined) continue;                    // draft: stays on this screen until the owner publishes it
        await walk(v);
        (function (k, v) { var js = J(v); ops.push({ fn: "admin_put_doc", args: { p_key: k, p_data: v }, done: function () { SN.docs[k] = js; delete FORCE[k]; } }); })(k, v);
      }
      // 2) simple collections
      var cn = Object.keys(COLLS);
      for (var ci = 0; ci < cn.length; ci++) {
        var c = cn[ci], idOf = COLLS[c], sn = SN.rows[c] || (SN.rows[c] = {}), up = [], seen = {}, newSn = {};
        var arr = DB[c] || [];
        for (var i = 0; i < arr.length; i++) {
          var row = arr[i], id = idOf(row);
          if (id === undefined || id === "undefined" || id === "") continue;
          seen[id] = 1;
          var j0 = J(row);
          if (!sn[id] || sn[id].pos !== i || sn[id].j !== j0) { await walk(row); j0 = J(row); up.push({ id: id, pos: i, data: row }); }
          newSn[id] = { pos: i, j: j0 };
        }
        var del = Object.keys(sn).filter(function (id) { return !seen[id]; });
        if (up.length) (function (c, up, newSn) { ops.push({ fn: "admin_put_rows", args: { p_coll: c, p_rows: up }, done: function () { up.forEach(function (u) { SN.rows[c][u.id] = newSn[u.id]; }); } }); })(c, up, newSn);
        if (del.length) (function (c, del) { ops.push({ fn: "admin_del_rows", args: { p_coll: c, p_ids: del }, done: function () { del.forEach(function (id) { delete SN.rows[c][id]; }); } }); })(c, del);
      }
      // 3) flavors
      var prow = [], pseen = {}, psn = {};
      for (var pi = 0; pi < DB.products.length; pi++) {
        var p = DB.products[pi], was = SN.prods[p.id];
        pseen[p.id] = 1;
        var rest = Object.assign({}, p); delete rest.stock; delete rest.reviews;
        if (was && was.pos === pi && J(rest) === was.j && p.stock === was.stock && (p.reviews || []).map(function (r) { return r.id + "|" + J(r); }).join("\n") === was.revs.join("\n")) { continue; }
        await walk(p);
        rest = Object.assign({}, p); delete rest.stock; delete rest.reviews;
        var out = { id: p.id, pos: pi };
        if (!was) { out.create = Object.assign({}, p); }
        else {
          // send only the fields that changed here, so two people editing different things don't undo each other
          var old = {}; try { old = JSON.parse(was.j); } catch (e) {}
          var set = {}, unset = [];
          Object.keys(rest).forEach(function (k) { if (J(rest[k]) !== J(old[k])) set[k] = rest[k]; });
          Object.keys(old).forEach(function (k) { if (!(k in rest)) unset.push(k); });
          out.set = set; if (unset.length) out.unset = unset;
          if (p.stock !== was.stock) out.stockAdd = (p.stock | 0) - (was.stock | 0);
          var nowRev = (p.reviews || []).map(function (r) { return r.id + "|" + J(r); }), oldIds = {}, newIds = {};
          was.revs.forEach(function (s) { oldIds[s] = 1; }); nowRev.forEach(function (s) { newIds[s] = 1; });
          var rd = was.revs.filter(function (s) { return !newIds[s]; }).map(function (s) { return s.split("|")[0]; });
          var ra = (p.reviews || []).filter(function (r) { return !oldIds[r.id + "|" + J(r)]; });
          if (rd.length || ra.length) { out.revDel = rd.concat(ra.map(function (r) { return r.id; })); out.revAdd = ra; }
        }
        prow.push(out);
        psn[p.id] = snapProd(p, pi);
      }
      var pdel = Object.keys(SN.prods).filter(function (id) { return !pseen[id]; });
      if (prow.length) ops.push({ fn: "admin_put_products", args: { p_rows: prow }, done: function () { Object.keys(psn).forEach(function (id) { SN.prods[id] = psn[id]; }); } });
      if (pdel.length) ops.push({ fn: "admin_del_rows", args: { p_coll: "products", p_ids: pdel }, done: function () { pdel.forEach(function (id) { delete SN.prods[id]; }); } });

      // 4) orders (only the fields the owner can change)
      var patched = false;
      DB.orders.forEach(function (o) {
        var s = SN.orders[o.id];
        if (!s) { SN.orders[o.id] = snapOrder(o); return; }
        var patch = diffOrder(o, s); if (!patch) return;
        var sent = snapOrder(o);
        ops.push({ fn: "admin_patch_order", args: { p_id: o.id, p_patch: patch }, done: function (d) {
          if (J(snapOrder(o)) === J(sent)) { setOrderIn(DB.orders, d); SN.orders[o.id] = snapOrder(DB.orders.find(function (x) { return x.id === o.id; })); }
          else SN.orders[o.id] = sent;
          patched = true;
        } });
      });

      for (var oi = 0; oi < ops.length; oi++) { var op = ops[oi]; var res = await K.rpc(op.fn, op.args, true); op.done(res); }
      failN = 0; dirty = false;
      setSync("saved");
      if (patched) { poll(); if (view === "admin" && !typingNow() && !A.modal) renderAdmin(); }
    } catch (e) {
      failN++; setSync("error", e.message);
      if (failN === 1 || failN % 6 === 0) toast("Couldn't save: " + e.message);
      if (/Owner password needed/i.test(e.message) && window.needOwner) {
        window.needOwner("save this change").then(function () { schedule(50); })
          .catch(function () { toast("Change not saved. Reloading…"); dirty = false; setTimeout(function () { location.reload(); }, 1200); });
      }
      else if (/don.t have access/i.test(e.message)) { toast(e.message + " Reloading…"); dirty = false; setTimeout(function () { location.reload(); }, 1800); }
      else if (/sign in|session|jwt|42501/i.test(e.message)) { H.admin = false; clearInterval(pollT); loginUI("Please sign in again to save your changes."); }
      else again = true;
    } finally {
      flushing = false;
      if (again && H.admin) schedule(Math.min(30000, 2000 * Math.max(1, failN)));
    }
  }

  /* ================= owner: pull new orders ================= */
  function typingNow() { var f = document.activeElement; return !!(f && /INPUT|TEXTAREA|SELECT/.test(f.tagName)); }
  var polling = false;
  async function poll() {
    if (!H.admin || polling || document.hidden && false) return;
    polling = true;
    try {
      var r = await K.rpc("admin_poll", { p_since: SINCE }, true);
      var changed = false;
      (r.orders || []).forEach(function (d) {
        var o = DB.orders.find(function (x) { return x.id === d.id; });
        if (!o) { DB.orders.unshift(d); SN.orders[d.id] = snapOrder(d); changed = true; return; }
        if (diffOrder(o, SN.orders[o.id])) return;                       // unsaved local edit wins until it's sent
        if (J(o) === J(d)) return;
        setOrderIn(DB.orders, d); SN.orders[d.id] = snapOrder(DB.orders.find(function (x) { return x.id === d.id; })); changed = true;
      });
      DB.orders.sort(function (a, b) { return b.createdAt - a.createdAt; });
      (r.products || []).forEach(function (pp) {
        var p = DB.products.find(function (x) { return x.id === pp.id; }), was = SN.prods[pp.id];
        if (!p || !was) return;
        if (p.stock === was.stock && typeof pp.stock === "number") { if (p.stock !== pp.stock) changed = true; p.stock = pp.stock; was.stock = pp.stock; }
        var localRevs = (p.reviews || []).map(function (x) { return x.id + "|" + J(x); }).join("\n");
        if (localRevs === was.revs.join("\n")) {
          var nr = pp.reviews || [], ns = nr.map(function (x) { return x.id + "|" + J(x); });
          if (ns.join("\n") !== localRevs) { p.reviews = nr; was.revs = ns; changed = true; }
        }
      });
      if ((r.visits || []).length) {
        var have = {}; VIS.forEach(function (v) { have[v.t + "|" + v.v] = 1; });
        r.visits.forEach(function (v) { if (!have[v.t + "|" + v.v]) { VIS.push(v); changed = true; } });
      }
      SINCE = (r.now || Date.now()) - 3000;
      if (changed && view === "admin" && !typingNow() && !A.modal && ["orders", "dashboard", "complaints", "products"].indexOf(A.tab) >= 0) renderAdmin();
      else if (changed && view === "admin") { try { renderAlerts(); } catch (e) {} }
    } catch (e) {
      if (/sign in|session|jwt/i.test(e.message)) { H.admin = false; clearInterval(pollT); loginUI("Your session ended. Please sign in again."); }
    } finally { polling = false; }
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && H.admin) poll(); });

  // payment-proof and complaint pictures are fetched when the owner opens them
  H.adminFiles = async function (o) {
    var need = (o.proof && !o.proof.img) || (o.complaint && o.complaint.photoCount > 0 && !(o.complaint.photos || []).length) || (o.place && o.place.photo && !o.place.img) || (o.refund && o.refund.proof && !o.refund.img) || (o.bship && o.bship.biteshipId && !o._clinkTried);
    if (!need) return;
    try {
      var f = await K.rpc("admin_order_files", { p_id: o.id }, true);
      if (o.proof && f.proof) o.proof.img = f.proof;
      if (o.complaint && f.photos) o.complaint.photos = f.photos;
      if (o.place && f.place) o.place.img = f.place;
      if (o.refund && f.refund) o.refund.img = f.refund;
      if (o.bship) { o._clinkTried = 1; if (f.courier && f.courier.link) o._clink = f.courier.link; }
    } catch (e) { toast("Couldn't load the picture: " + e.message); }
  };
  // change one order right away (used for staff payment checks and owner approvals)
  H.patchOrder = async function (id, patch) {
    var d = await K.rpc("admin_patch_order", { p_id: id, p_patch: patch }, true);
    setOrderIn(DB.orders, d);
    var o = DB.orders.find(function (x) { return x.id === id; }); if (o) SN.orders[id] = snapOrder(o);
    return d;
  };
  H.flush = flush;
  // how many of each limited gift were handed out (the owner's gift stock counter)
  H.giftUsed = function () { return K.rpc("admin_gift_used", {}, true); };
  // owner records a refund (full or part) on a paid order
  H.refundOrder = async function (id, amount, note, msgs, img) {
    var d = await K.rpc("admin_refund_order", { p_id: id, p_amount: amount, p_note: note || "", p_msgs: msgs || [], p_img: img || "" }, true);
    setOrderIn(DB.orders, d);
    var o = DB.orders.find(function (x) { return x.id === id; }); if (o) SN.orders[id] = snapOrder(o);
    return d;
  };
  /* drafts: these screens only go live when the owner presses Publish */
  // which top-level fields of a draft differ from the published version ("*" = the whole document is new)
  function changedFields(k) {
    if (!HELD[k] || DB[k] === undefined || SN.docs[k] === undefined) return [];
    if (SN.docs[k] === null) return ["*"];
    var cur = DB[k], pub = JSON.parse(SN.docs[k]);
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || !pub || typeof pub !== "object" || Array.isArray(pub)) return J(cur) === SN.docs[k] ? [] : ["*"];
    var out = [], seen = {};
    Object.keys(cur).concat(Object.keys(pub)).forEach(function (f) { if (seen[f]) return; seen[f] = 1; if (J(cur[f]) !== J(pub[f])) out.push(f); });
    return out;
  }
  H.changed = function (k) { return H.admin ? changedFields(k) : []; };
  H.pending = function () { return H.admin ? Object.keys(HELD).filter(function (k) { return changedFields(k).length > 0; }) : []; };
  // publish only some fields of a draft (the ones changed on the screen the owner is on); the rest stays a draft
  H.publishFields = function (k, fields) {
    return new Promise(function (res) {
      (function go() {
        if (flushing) return setTimeout(go, 150);
        flushing = true; setSync("saving");
        (async function () {
          try {
            var cur = DB[k];
            await walk(cur);   // big pictures go to storage first, like a normal save
            var all = fields.indexOf("*") >= 0 || SN.docs[k] == null, pub = all ? JSON.parse(J(cur)) : JSON.parse(SN.docs[k]);
            if (!all) fields.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(cur, f) && cur[f] !== undefined) pub[f] = JSON.parse(J(cur[f])); else delete pub[f]; });
            await K.rpc("admin_put_doc", { p_key: k, p_data: pub }, true);
            SN.docs[k] = J(pub); delete FORCE[k];
            setSync("saved"); res(true);
          } catch (e) { setSync("error", e.message); toast(e.message || "Couldn't publish. Please try again."); res(false); }
          finally { flushing = false; if (again && H.admin) schedule(2000); }
        })();
      })();
    });
  };
  // put some fields of a draft back to the published version
  H.discardFields = function (k, fields) {
    if (!HELD[k] || SN.docs[k] == null) return;
    var pub = JSON.parse(SN.docs[k]);
    if (fields.indexOf("*") >= 0) { DB[k] = pub; return; }
    fields.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(pub, f)) DB[k][f] = pub[f]; else delete DB[k][f]; });
  };
  H.publish = function (keys) {
    keys = (keys || H.pending()).filter(function (k) { return HELD[k]; });
    keys.forEach(function (k) { FORCE[k] = 1; });
    dirty = true; setSync("saving"); clearTimeout(flushT);
    return new Promise(function (res) {
      (function go() {
        if (flushing) { return setTimeout(go, 150); }
        flush().then(function () { res(keys.every(function (k) { return J(DB[k]) === SN.docs[k]; })); });
      })();
    });
  };
  H.discard = function (keys) {
    (keys || H.pending()).forEach(function (k) { if (HELD[k] && SN.docs[k] != null) { delete FORCE[k]; DB[k] = JSON.parse(SN.docs[k]); } });
  };
})();
