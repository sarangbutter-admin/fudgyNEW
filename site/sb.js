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
      proofpop: d.proofpop, prelaunch: d.prelaunch, revrew: d.revrew, page: d.page, marquee: d.marquee, announcer: d.announcer, thanks: d.thanks, badges: d.badges, sold: res.sold || {}, slotUse: res.slotUse || {}, orders: []
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
      H.loaded = true; document.body.classList.remove("dd-load"); banner(!(DB.sizes.length && DB.products.length) ? "The shop is being set up. Please check back soon." : "");
      if (first) { view = null; route(); H.refreshOrders(); }
      else if (ch && view === "store" && $q("#sheet").hidden) { sanitizeCart(); renderStoreStatic(); renderStore(); renderEditBar(); }
    } catch (e) {
      document.body.classList.remove("dd-load");
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
    // pre-launch gift code: attach the gift to the new order (the server checks the code belongs to this WhatsApp number)
    if (!existing && r.token && p.preCode) { try { var pg = await K.rpc("pre_gift_claim", { p_id: r.order.id, p_token: r.token, p_code: p.preCode });
      var po = DB.orders.find(function (x) { return x.id === r.order.id; }); if (po && pg) { if (pg.ok) po.preGift = pg.gift; else po._preErr = pg.err; } } catch (e) {} }
    return DB.orders.find(function (x) { return x.id === r.order.id; });
  };
  H.rvClaim = async function (id, choice) { var d = await K.rpc("rv_claim", { p_id: id, p_token: tk(id), p_choice: choice || "" }); return d; };
  H.rvStatus = function () { return K.rpc("admin_rv_status", {}, true); };
  H.dokuCreate = async function (id, group, pass) { var d = await K.fn("doku", { action: "create", id: id, token: tk(id), group: group, pass: pass || "" }); if (d && d.error) throw new Error(d.error); return d; };
  H.rpcPub = function (name, args) { return K.rpc(name, args, false); };
  // the server checks the old password itself, so this works even when Supabase asks sign-in forms for a security token
  H.changePassword = function (o, n) { return K.rpc("aff_change_pw", { p_old: o, p_new: n }, true); };
  H.tsVerify = async function (token, action) { var d = await K.fn("turnstile", { action: action, token: token }); if (!d || d.error || !d.pass) throw new Error((d && d.error) || "The security check failed. Please try again."); return d; };
  H.tsGet = function () { return K.rpc("admin_ts_get", {}, true); };
  H.tsSave = function (p) { return K.rpc("admin_ts_save", { p: p }, true); };
  H.dokuStatus = async function (id) { var d = await K.fn("doku", { action: "status", id: id, token: tk(id) }); return d; };
  H.dokuGet = function () { return K.rpc("admin_doku_get", {}, true); };
  H.dokuSave = function (p) { return K.rpc("admin_doku_save", { p: p }, true); };
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
    if (document.hidden || !H.loaded) return;
    var t = Date.now(), live = DB.orders.some(function (o) { return ["awaiting", "review", "new", "baking", "ready"].indexOf(o.status) >= 0; });
    if (!$q("#moSheet").hidden || live) H.refreshOrders();
    else if (Math.floor(t / 1000) % 60 === 0) H.refreshOrders();
    if (Math.floor(t / 1000) % 45 === 0) H.loadShop(true);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && H.loaded) { H.refreshOrders(); H.loadShop(true); } });

  // Edge Functions (courier prices etc.); admin = true sends the team sign-in
  H.preStatus = function () { return K.rpc("prelaunch_public", {}); };
  H.preReg = function (n, p, e) { return K.rpc("prelaunch_register", { p_name: n, p_phone: p, p_email: e || "" }); };
  H.gameTops = function () { return K.rpc("game_tops", {}); };
  H.gameSubmit = function (lv, score, name, av) { return K.rpc("game_submit", { p_lv: lv, p_score: score, p_name: name, p_av: av }); };
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
    var tsh = null; tsLoginMount(el.querySelector("form")).then(function (h) { tsh = h; }); loginHelp(el.querySelector("form"));
    el.querySelector("form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var em = $q("#adlEmail").value.trim(), pw = $q("#adlPass").value, b = $q("#adlGo");
      if (!em || !pw) { err.textContent = "Enter your username and password."; err.hidden = false; return; }
      if (em.indexOf("@") < 0) em = em.toLowerCase() + "@team.delidome.local";
      b.disabled = true; b.textContent = "Signing in…"; err.hidden = true;
      var cap = tsh ? tsh.token() : "";
      if (tsh && tsh.key && !cap) { err.textContent = tsh.failed ? "The security check could not load. Please reload the page." : "Please complete the security check."; err.hidden = false; b.disabled = false; b.textContent = "Sign in"; return; }
      try { await K.login(em, pw, cap); await go(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Sign in"; if (tsh) tsh.reset(); }
    });
  };

  /* ================= Cloudflare Turnstile on the sign-in forms ================= */
  // Supabase Auth checks the token itself once "CAPTCHA protection" is switched on in the Supabase dashboard (Authentication -> Attack Protection)
  var TSL = { key: undefined, loading: null, help: "" };
  async function tsLoginKey() {
    if (TSL.key !== undefined) return TSL.key;
    try {
      var pub = await K.rpc("shop_public", {}), st = pub && pub.docs && pub.docs.settings;
      if (typeof st === "string") st = JSON.parse(st);
      TSL.help = st && st.affHelpEmail ? String(st.affHelpEmail) : "";
      var T = st && st.turnstile;
      TSL.key = (T && T.on && T.siteKey && !(T.where && T.where.login === false)) ? String(T.siteKey) : "";
    } catch (e) { TSL.key = ""; }
    return TSL.key;
  }
  function tsLoginScript() {
    if (window.turnstile) return Promise.resolve();
    return TSL.loading || (TSL.loading = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { TSL.loading = null; rej(new Error("The security check could not load.")); };
      document.head.appendChild(s);
    }));
  }
  // under the sign-in button: "Forgot your password? Email us" and the link to apply as an affiliator
  async function loginHelp(form) {
    await tsLoginKey();
    var C = window.DELIDOME_CONFIG || {}, shop = String(C.shopUrl || "").replace(/\/+$/, ""), p = document.createElement("p");
    p.className = "adl-sub"; p.style.cssText = "margin-top:12px;display:grid;gap:6px";
    var mail = TSL.help ? '<a href="mailto:' + TSL.help.replace(/"/g, "") + '?subject=' + encodeURIComponent("Forgot password reset") + '&body=' + encodeURIComponent("Hello, I forgot my password. Please reset it.\n\nMy username: (type your username here)\n\nI am writing from the email address I registered with you.") + '">Forgot your password? Email us</a><br><small>Write from your registered email and type your username.</small>' : "Forgot your password? Ask the owner to reset it.";
    p.innerHTML = '<span><button type="button" class="adl-fgb" data-fg>Forgot your password?</button></span>' +
      '<div class="adl-fgf" hidden><small>Affiliators: type your username and the email you registered with. We check it and send you a new password by WhatsApp or email.</small>' +
      '<input class="in" id="fgUser" maxlength="40" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">' +
      '<input class="in" id="fgMail" type="email" maxlength="120" placeholder="Registered email" autocomplete="email">' +
      '<p class="adl-err" id="fgErr" hidden></p><button class="btn btn-ghost-blue btn-sm" type="button" data-fgsend>Send my request</button>' +
      (TSL.help ? '<small>No answer? <a href="mailto:' + TSL.help.replace(/"/g, "") + '?subject=' + encodeURIComponent("Forgot password reset") + '">Email us</a></small>' : '') + '</div>' +
      (shop ? '<span>Want to become an affiliator? <a href="' + shop + '/join" target="_blank" rel="noopener">Apply here</a></span>' : "");
    form.appendChild(p);
    var box = p.querySelector(".adl-fgf"), errEl = p.querySelector("#fgErr"), send = p.querySelector("[data-fgsend]"), busy = false;
    var go = async function () {
      if (busy) return; errEl.hidden = true;
      var u = p.querySelector("#fgUser").value.trim(), m = p.querySelector("#fgMail").value.trim();
      if (u.length < 3) { errEl.textContent = "Please type your username."; errEl.hidden = false; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { errEl.textContent = "Please type the email you registered with."; errEl.hidden = false; return; }
      busy = true; send.disabled = true; send.textContent = "Sending…";
      try { await K.rpc("aff_forgot", { p_username: u, p_email: m }, false); box.innerHTML = '<p class="adl-ok">✅ Request sent. If your details match, the shop will send you a new password by WhatsApp or email soon.</p>'; }
      catch (e) { errEl.textContent = e.message || "Couldn't send. Please try again."; errEl.hidden = false; busy = false; send.disabled = false; send.textContent = "Send my request"; }
    };
    p.addEventListener("click", function (e) { if (e.target.closest("[data-fg]")) { box.hidden = !box.hidden; if (!box.hidden) { var i = p.querySelector("#fgUser"); if (i) i.focus(); } } else if (e.target.closest("[data-fgsend]")) go(); });
    p.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.closest(".adl-fgf")) { e.preventDefault(); go(); } });
  }
  // adds the widget above the sign-in button; returns { key, token(), reset() }
  async function tsLoginMount(form) {
    var h = { key: "", token: function () { return ""; }, reset: function () {} }, key = await tsLoginKey();
    if (!key) return h;
    try {
      await tsLoginScript();
      var box = document.createElement("div"); box.className = "tslogin"; box.style.cssText = "display:flex;justify-content:center;margin:10px 0 2px";
      var btn = form.querySelector("button[type=submit]"); btn.parentNode.insertBefore(box, btn);
      var tok = "", id = window.turnstile.render(box, { sitekey: key, callback: function (t) { tok = t; }, "expired-callback": function () { tok = ""; }, "error-callback": function () { tok = ""; } });
      h.key = key; h.token = function () { return tok; }; h.reset = function () { tok = ""; try { window.turnstile.reset(id); } catch (e) {} };
    } catch (e) { h.key = key; h.failed = true; }
    return h;
  }

})();
