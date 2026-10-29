/* Delidome: the standalone "Join us" page for affiliators (no shop code, no libraries).
   The owner edits the texts and colors in Admin -> Affiliates -> Join page; this file only draws them. */
(function () {
  "use strict";
  var K = window.SBK, root = document.getElementById("jn"), AP_KEY = "delidome-affapp";
  try { if (localStorage.getItem("delidome-motion") === "on") document.documentElement.classList.add("motion-on"); } catch (e) {}   // same choice as on the shop
  // keep in step with AFJ_DEFAULT in app.js (the owner's editor)
  var D = {
    title: "Join our affiliate team", sub: "Share our cookies with your followers and earn money on every order you bring.", heroIcon: "🍪", rate: "10%",
    bg: "#000096", ink: "#ffffff", accent: "#FFD43B", pageBg: "#F4F5FF",
    marquee: { on: true, text: "💸 Join and earn! Share our cookies and get paid on every order 🍪 It is free to join ✨ Sign up in 2 minutes 🚀", bg: "#FFD43B", ink: "#000096", speed: "normal" },
    cta: "Join us now", ctaIcon: "🚀", formTitle: "Apply in 2 minutes", formSub: "We read every application and answer by WhatsApp or email.", btn: "Send my application",
    thanks: "Thank you! We will answer by WhatsApp or email very soon.",
    show: { perks: true, earn: true, example: true },
    perksTitle: "Why join?",
    perks: [
      { icon: "🆓", t: "Free to join", d: "No fee, no stock, no risk." },
      { icon: "🔗", t: "Your own link and coupon", d: "Every order that uses them is counted for you." },
      { icon: "💸", t: "Paid by transfer", d: "Your commission goes to your bank or e-wallet." }],
    earnTitle: "How you earn commission",
    earn: [
      { icon: "📝", t: "Apply and get approved", d: "Fill in the form below. When we approve you, you sign in to your own dashboard." },
      { icon: "🔗", t: "Get your link and coupon", d: "You get a personal share link and a coupon code you can name yourself." },
      { icon: "📣", t: "Share it", d: "Post it on Instagram, TikTok, Threads or WhatsApp." },
      { icon: "🛒", t: "Customers order", d: "An order from your link or your coupon is yours. If a customer does both, the coupon wins. Your own orders do not count." },
      { icon: "💰", t: "You earn {rate} of what they pay for the cookies", d: "The delivery fee is never included. A coupon or flash sale is taken off first." },
      { icon: "⏳", t: "Wait 7 days after delivery", d: "The 7 days start when the order is delivered, not when it was ordered. If it is cancelled, refunded or has a complaint, the commission is cancelled or recounted." },
      { icon: "🏦", t: "Get paid", d: "Approved commission is paid by transfer, with a proof, once it reaches the minimum payout." }],
    exTitle: "Example with 10% commission",
    example: "Cookies: Rp 85.000\nDelivery fee: Rp 15.000\nFlash sale: − Rp 5.000\nCoupon: − Rp 5.000\nCustomer pays: Rp 90.000\n\nCommission is counted on Rp 90.000 − Rp 15.000 delivery = Rp 75.000\nYour commission: Rp 75.000 × 10% = Rp 7.500"
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hex(v, d) { return /^#[0-9a-f]{6}$/i.test(String(v || "")) ? v : d; }
  function merge(a, b) {   // the owner's saved values over the defaults (one level of objects, whole lists)
    var o = {}, k; for (k in a) o[k] = a[k];
    for (k in (b || {})) {
      if (b[k] == null) continue;
      if (a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) && typeof b[k] === "object") o[k] = merge(a[k], b[k]);
      else if (Array.isArray(a[k])) { if (Array.isArray(b[k])) o[k] = b[k]; } else o[k] = b[k];
    }
    return o;
  }
  var S = { cfg: D, shop: "", ts: { on: false, key: "" }, f: { name: "", phone: "", email: "", username: "", password: "", ig: "", tt: "", th: "", why: "" }, errs: {}, err: "", busy: false, done: null, status: null, show: false, tsTok: "", tsW: null };
  var q = new URLSearchParams(location.search);

  function fill(t) { return esc(t).replace(/\{rate\}/g, esc(S.cfg.rate)); }
  function stepHTML(x) { return '<li><i aria-hidden="true">' + esc(x.icon || "⭐") + '</i><div><b>' + fill(x.t) + '</b><span>' + fill(x.d) + '</span></div></li>'; }
  function fld(k, label, o) {
    o = o || {}; var bad = S.errs[k], v = S.f[k];
    var input = o.rows ? '<textarea data-f="' + k + '" rows="' + o.rows + '" maxlength="' + (o.max || 300) + '" placeholder="' + esc(o.ph || "") + '">' + esc(v) + '</textarea>'
      : '<input data-f="' + k + '" type="' + (o.type || "text") + '" maxlength="' + (o.max || 80) + '" value="' + esc(v) + '" placeholder="' + esc(o.ph || "") + '" autocomplete="' + (o.ac || "off") + '" autocapitalize="none" spellcheck="false"' + (o.mode ? ' inputmode="' + o.mode + '"' : "") + '>';
    if (o.pw) input = '<div class="pw">' + input.replace('type="password"', 'type="' + (S.show ? "text" : "password") + '"') + '<button type="button" data-show aria-label="' + (S.show ? "Hide" : "Show") + ' password">' + (S.show ? "🙈" : "👁️") + '</button></div>';
    return '<div class="fld' + (bad ? " bad" : "") + '"><label>' + label + '</label>' + input + (bad ? '<div class="e">' + esc(bad) + '</div>' : "") + '</div>';
  }
  function statusHTML() {
    var s = S.status; if (!s || !s.ok) return "";
    if (s.status === "approved") return '<div class="st approved"><b>✅ Approved!</b> Hi ' + esc(s.name) + '. You can sign in now' + (s.username ? ' as <b>' + esc(s.username) + '</b>' : "") + ' with the password you chose. <a href="./#partner">Sign in</a></div>';
    if (s.status === "rejected") return '<div class="st rejected"><b>Sorry, not this time.</b> Hi ' + esc(s.name) + '. ' + (s.reason ? "Reason: " + esc(s.reason) : "We cannot accept your application.") + '</div>';
    return '<div class="st pending"><b>⏳ We are looking at your application.</b> Hi ' + esc(s.name) + '. We will answer by WhatsApp or email.</div>';
  }
  function formHTML() {
    var C = S.cfg;
    if (S.done) return '<div class="card ok" id="apply"><i class="big" aria-hidden="true">🎉</i><h2>Application sent!</h2><p>' + esc(C.thanks) + '</p><p class="fine" style="margin-top:4px">Keep this private link to check your result:</p><input readonly value="' + esc(location.origin + location.pathname + "?status=" + S.done) + '" onclick="this.select()"></div>';
    if (!K || !K.on) return '<div class="card" id="apply"><p>The form works on the live shop.</p></div>';
    return '<form class="card form" id="apply" novalidate><h2>' + esc(C.formTitle) + '</h2><p class="sub">' + esc(C.formSub) + '</p>' + statusHTML() +
      fld("name", "Your name", { ac: "name", max: 80 }) + fld("phone", "WhatsApp number", { type: "tel", ac: "tel", max: 30, mode: "tel", ph: "0812…" }) +
      fld("email", 'Email <small>(we use it if you forget your password)</small>', { type: "email", ac: "email", max: 120 }) +
      fld("username", 'Username <small>(you sign in with it)</small>', { max: 30, ph: "like alpha", ac: "username" }) +
      fld("password", 'Password <small>(at least 8 characters)</small>', { type: "password", max: 72, ac: "new-password", pw: true }) +
      '<div class="grp"><b>Your social media <small>(at least one)</small></b>' + (S.errs.social ? '<div class="e" style="color:#C8102E;font-weight:700;font-size:13px;margin-bottom:6px">' + esc(S.errs.social) + '</div>' : "") +
      fld("ig", "📸 Instagram", { max: 80, ph: "@yourname" }) + fld("tt", "🎵 TikTok", { max: 80, ph: "@yourname" }) + fld("th", "🧵 Threads", { max: 80, ph: "@yourname" }) + '</div>' +
      fld("why", 'How will you share us? <small>(optional)</small>', { rows: 3, max: 600 }) +
      (S.ts.on ? '<div id="jnTs" style="margin:6px 0"></div>' : "") +
      (S.err ? '<p class="err" role="alert">' + esc(S.err) + '</p>' : "") +
      '<button class="join send" type="submit"' + (S.busy ? " disabled" : "") + '><i aria-hidden="true">' + esc(C.ctaIcon) + '</i>' + (S.busy ? "Sending…" : esc(C.btn)) + '</button>' +
      '<p class="fine">By sending, you agree we may contact you by WhatsApp and email.</p></form>';
  }
  function draw() {
    var C = S.cfg, st = document.documentElement.style, M = C.marquee || {};
    st.setProperty("--bg", hex(C.bg, D.bg)); st.setProperty("--ink", hex(C.ink, D.ink)); st.setProperty("--ac", hex(C.accent, D.accent)); st.setProperty("--pg", hex(C.pageBg, D.pageBg));
    st.setProperty("--mq-bg", hex(M.bg, D.marquee.bg)); st.setProperty("--mq-ink", hex(M.ink, D.marquee.ink)); st.setProperty("--mq-t", ({ slow: 48, normal: 30, fast: 18 }[M.speed] || 30) + "s");
    document.title = C.title + (S.shop ? " | " + S.shop : "");
    var txt = '<span>' + esc(M.text) + '</span>', fl = ["🍪", "💸", "✨", "🎉", "⭐", "🍪"];
    var keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : "", pos = keep ? document.activeElement.selectionStart : 0, sy = scrollY;
    root.innerHTML = (M.on && M.text ? '<div class="mq" role="marquee" aria-label="' + esc(M.text) + '"><div class="mq-in" aria-hidden="true">' + txt + txt + txt + txt + txt + txt + txt + txt + '</div></div>' : "") +
      '<header class="hero"><div class="wrap"><div class="bar"><span class="shop">' + esc(S.shop) + '</span><a href="./">← Back to the shop</a></div>' +
      '<div class="hero-ic" aria-hidden="true">' + esc(C.heroIcon) + '</div><h1>' + esc(C.title) + '</h1><p>' + esc(C.sub) + '</p>' +
      '<a class="join" href="#apply" data-go><i aria-hidden="true">' + esc(C.ctaIcon) + '</i>' + esc(C.cta) + '</a></div>' +
      fl.map(function (e, i) { return '<i class="float" aria-hidden="true" style="left:' + (6 + i * 17) + '%;top:' + (i % 2 ? 62 : 24) + '%;animation-delay:' + (i * .7) + 's">' + e + '</i>'; }).join("") + '</header>' +
      '<main class="wrap">' +
      (C.show.perks && C.perks.length ? '<section><h2>' + esc(C.perksTitle) + '</h2><div class="perks">' + C.perks.map(function (x) { return '<div class="card perk"><i aria-hidden="true">' + esc(x.icon) + '</i><h3>' + esc(x.t) + '</h3><p>' + esc(x.d) + '</p></div>'; }).join("") + '</div></section>' : "") +
      (C.show.earn && C.earn.length ? '<section><h2>' + esc(C.earnTitle) + '</h2><ol class="steps">' + C.earn.map(stepHTML).join("") + '</ol>' + (C.show.example && C.example ? '<div class="ex"><b>' + esc(C.exTitle) + '</b>' + esc(C.example) + '</div>' : "") + '</section>' : "") +
      '<section>' + formHTML() + '</section>' +
      '<p class="foot">Already an affiliator? <a href="./#partner">Sign in</a></p></main>' +
      '<div class="sticky" id="jnSticky"><a class="join" href="#apply" data-go><i aria-hidden="true">' + esc(C.ctaIcon) + '</i>' + esc(C.cta) + '</a></div>';
    if (keep) { var el = root.querySelector('[data-f="' + keep + '"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    scrollTo(0, sy); watch(); mountTs();
  }
  // the floating "Join us now" shows only while the form is out of view
  var io = null;
  function watch() {
    var f = document.getElementById("apply"), s = document.getElementById("jnSticky"); if (!f || !s || !window.IntersectionObserver) { if (s) s.classList.add("on"); return; }
    if (io) io.disconnect(); io = new IntersectionObserver(function (e) { s.classList.toggle("on", !e[0].isIntersecting); }, { threshold: 0.05 }); io.observe(f);
  }
  function mountTs() {
    var box = document.getElementById("jnTs"); if (!box || !S.ts.on) return;
    function go() { try { S.tsW = window.turnstile.render(box, { sitekey: S.ts.key, callback: function (t) { S.tsTok = t; }, "expired-callback": function () { S.tsTok = ""; }, "error-callback": function () { S.tsTok = ""; } }); } catch (e) {} }
    if (window.turnstile) { go(); return; }
    if (document.getElementById("tsjs")) { document.getElementById("tsjs").addEventListener("load", go); return; }
    var s = document.createElement("script"); s.id = "tsjs"; s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = go; document.head.appendChild(s);
  }
  function party() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches && !document.documentElement.classList.contains("motion-on")) return;
    var em = ["🎉", "✨", "🍪", "⭐", "🥳", "💸"]; for (var i = 0; i < 18; i++) { (function (i) { var f = document.createElement("i"); f.className = "fly"; f.textContent = em[i % em.length]; f.style.left = (4 + Math.random() * 90) + "%"; f.style.fontSize = (22 + Math.random() * 20) + "px"; f.style.animationDelay = (Math.random() * 0.9) + "s"; document.body.appendChild(f); setTimeout(function () { f.remove(); }, 3600); })(i); }
  }
  function check() {
    var F = S.f, e = {}, ph = String(F.phone).replace(/\D/g, "");
    if (String(F.name).trim().length < 2) e.name = "Please type your name.";
    if (ph.length < 7) e.phone = "Please type a valid WhatsApp number.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(F.email).trim())) e.email = "Please type a valid email.";
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(String(F.username).trim().toLowerCase())) e.username = "3 to 30 letters or numbers (dots, dashes and _ are fine), no spaces.";
    if (String(F.password).length < 8) e.password = "At least 8 characters.";
    if (!String(F.ig).trim() && !String(F.tt).trim() && !String(F.th).trim()) e.social = "Please add your Instagram, TikTok or Threads.";
    return e;
  }
  async function submit() {
    if (S.busy) return; S.errs = check(); S.err = "";
    if (Object.keys(S.errs).length) { S.err = "Please fix the marked fields."; draw(); var b = root.querySelector(".fld.bad,.grp .e"); if (b) b.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (S.ts.on && !S.tsTok) { S.err = "Please complete the security check."; draw(); return; }
    S.busy = true; draw();
    try {
      if (S.ts.on) { var v = await K.fn("turnstile", { action: "apply", token: S.tsTok }); if (!v || v.error || !v.pass) throw new Error((v && v.error) || "The security check failed. Please try again."); window.__tsPass = v.pass; }
      var F = S.f, r = await K.rpc("aff_apply", { p: { name: F.name, phone: F.phone, email: F.email, username: F.username, password: F.password, ig: F.ig, tt: F.tt, th: F.th, why: F.why } }, false);
      if (r && r.token) { try { localStorage.setItem(AP_KEY, r.token); } catch (x) {} S.done = r.token; S.f.password = ""; party(); }
    } catch (ex) { S.err = ex.message || "Couldn't send. Please try again."; if (S.ts.on && window.turnstile && S.tsW != null) { try { window.turnstile.reset(S.tsW); } catch (y) {} S.tsTok = ""; } }
    window.__tsPass = undefined; S.busy = false; draw();
    if (S.done) { var a = document.getElementById("apply"); if (a) a.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
  root.addEventListener("input", function (e) { var k = e.target.dataset && e.target.dataset.f; if (k) { S.f[k] = e.target.value; if (S.errs[k]) { delete S.errs[k]; var f = e.target.closest(".fld"); if (f) { f.classList.remove("bad"); var m = f.querySelector(".e"); if (m) m.remove(); } } if ((k === "ig" || k === "tt" || k === "th") && S.errs.social) delete S.errs.social; } });
  root.addEventListener("click", function (e) { if (e.target.closest("[data-show]")) { S.show = !S.show; draw(); return; } var g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); var a = document.getElementById("apply"); if (a) { a.scrollIntoView({ behavior: "smooth", block: "start" }); var i = a.querySelector("input"); if (i) setTimeout(function () { i.focus({ preventScroll: true }); }, 500); } } });
  root.addEventListener("submit", function (e) { e.preventDefault(); submit(); });

  async function boot() {
    S.cfg = D; draw();
    if (!K || !K.on) return;
    try { var r = await K.rpc("aff_join_page", {}, false); if (r) { S.cfg = merge(D, r.cfg || {}); S.shop = r.shop || ""; S.ts = r.ts || S.ts; if (r.brand && !(r.cfg && r.cfg.bg)) S.cfg.bg = hex(r.brand, D.bg); } } catch (e) {}
    var tok = q.get("status") || ""; if (!tok) { try { tok = localStorage.getItem(AP_KEY) || ""; } catch (e) {} }
    if (tok) { try { var s = await K.rpc("aff_app_status", { p_token: tok }, false); if (s && s.ok) S.status = s; } catch (e) {} }
    draw();
  }
  boot();
})();
