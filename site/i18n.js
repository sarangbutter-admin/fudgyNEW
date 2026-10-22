/* Delidome: English / Bahasa Indonesia for the customer shop.
   The shop is written in English. When the visitor picks Indonesian, every piece of text on the page that has a translation
   in i18n-dict.js is swapped (and swapped back for English), including text the shop draws later. Text the owner typed
   themselves (flavor names, landing page words...) has no translation, so it stays exactly as written. */
(function () {
  var KEY = "delidome-lang", TIPKEY = "delidome-lang-tip", lang = "en";
  try { lang = localStorage.getItem(KEY) === "id" ? "id" : "en"; } catch (e) {}
  var D = window.DD_ID || {}, P = window.DD_ID_PATTERNS || [];
  window.DDLANG = function () { return lang; };
  window.DDLOC = function () { return lang === "id" ? "id-ID" : "en-US"; };

  window.DD_TR = function (s) { return tr(s); };
  var norm = function (s) { return s.replace(/\s+/g, " ").trim(); };
  function tr(s) {
    var core = norm(s);
    if (core.length < 2 || !/[A-Za-z]/.test(core)) return null;
    var hit = Object.prototype.hasOwnProperty.call(D, core) ? D[core] : null;
    if (hit === null) for (var i = 0; i < P.length; i++) {
      var m = core.match(P[i][0]);
      if (m) { hit = typeof P[i][1] === "function" ? P[i][1].apply(null, m) : core.replace(P[i][0], P[i][1]); break; }
    }
    if (hit === null && window.DD_POST) { var q = window.DD_POST(core); if (q !== core) hit = q; }
    else if (hit !== null && window.DD_POST) hit = window.DD_POST(hit);
    if (hit === null) return null;
    var lead = (s.match(/^\s*/) || [""])[0], trail = (s.match(/\s*$/) || [""])[0];
    return lead + hit + trail;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var skip = function (el) { return !el || SKIP[el.tagName] || (el.closest && el.closest("[data-notr]")); };

  function doText(n) {
    var cur = n.nodeValue;
    if (lang === "id") {
      var orig = n.__en !== undefined && cur === n.__id ? n.__en : cur;
      var t = tr(orig);
      if (t !== null) { if (t !== cur) n.nodeValue = t; n.__en = orig; n.__id = t; }
      else if (n.__en !== undefined && cur === n.__id) { n.nodeValue = n.__en; delete n.__en; delete n.__id; }
    } else if (n.__en !== undefined) {
      if (cur === n.__id) n.nodeValue = n.__en;
      delete n.__en; delete n.__id;
    }
  }
  function doAttrs(el) {
    var st = el.__ea || (el.__ea = {});
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], cur = el.getAttribute(a);
      if (cur === null) continue;
      var rec = st[a];
      if (lang === "id") {
        var orig = rec && cur === rec.id ? rec.en : cur, t = tr(orig);
        if (t !== null) { if (t !== cur) el.setAttribute(a, t); st[a] = { en: orig, id: t }; }
        else if (rec && cur === rec.id) { el.setAttribute(a, rec.en); delete st[a]; }
      } else if (rec) { if (cur === rec.id) el.setAttribute(a, rec.en); delete st[a]; }
    }
    if (el.tagName === "INPUT" && /^(button|submit)$/.test(el.type) && el.value) {
      var rv = el.__ev, cv = el.value;
      if (lang === "id") { var o2 = rv && cv === rv.id ? rv.en : cv, t2 = tr(o2); if (t2 !== null) { if (t2 !== cv) el.value = t2; el.__ev = { en: o2, id: t2 }; } }
      else if (rv) { if (cv === rv.id) el.value = rv.en; el.__ev = null; }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skip(root.parentNode)) doText(root); return; }
    if (root.nodeType !== 1 || (root.closest && root.closest("[data-notr]"))) return;
    doAttrs(root);
    if (SKIP[root.tagName]) return;
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
  }

  var queue = new Set(), raf = 0;
  function flush() {
    raf = 0; var q = Array.from(queue); queue.clear();
    obs.disconnect();
    try {
      for (var i = 0; i < q.length; i++) { var n = q[i]; if (n.isConnected) walk(n); }
      setTitle();
    } finally { obs.observe(document.body, cfg); }
  }
  var cfg = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["value"]) };
  var obs = new MutationObserver(function (recs) {
    if (lang !== "id" && !changing) return;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === "childList") r.addedNodes.forEach(function (n) { queue.add(n); });
      else queue.add(r.target);
    }
    if (!raf) raf = requestAnimationFrame(flush);
  });
  var changing = false, enTitle = "";
  function setTitle() {
    if (!enTitle) enTitle = document.title;
    var cur = document.title;
    if (lang === "id") { var t = tr(enTitle); if (t !== null && cur !== t) document.title = t; } else if (cur !== enTitle && enTitle) document.title = enTitle;
  }

  var FLAG = {
    en: '<svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="13"/><path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="8"/></svg>',
    id: '<svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="20" fill="#E70011"/><rect y="20" width="60" height="20" fill="#fff"/><rect width="60" height="40" fill="none" stroke="#d8d8e8" stroke-width="2"/></svg>'
  };
  function drawBtn() {
    var b = document.getElementById("langBtn"); if (!b) return;
    b.innerHTML = FLAG[lang] + "<b>" + (lang === "id" ? "ID" : "ENG") + "</b>";
    b.setAttribute("aria-label", lang === "id" ? "Bahasa: Indonesia. Ketuk untuk ganti ke English" : "Language: English. Tap to switch to Bahasa Indonesia");
    b.title = lang === "id" ? "Ganti ke English" : "Switch to Bahasa Indonesia";
    document.documentElement.lang = lang;
  }
  function apply() {
    changing = true; obs.disconnect(); walk(document.body); setTitle(); drawBtn(); obs.observe(document.body, cfg); changing = false;
  }
  window.DDsetLang = function (l) {
    lang = l === "id" ? "id" : "en";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply(); hideTip(true);
    try { window.dispatchEvent(new Event("ddlang")); } catch (e) {}
  };

  /* first visit: a small speech bubble under the button that says the language can be switched */
  function hideTip(seen) {
    var t = document.getElementById("langTip"); if (t) t.hidden = true;
    if (seen) try { localStorage.setItem(TIPKEY, "1"); } catch (e) {}
  }
  function showTip() {
    var seen = false; try { seen = localStorage.getItem(TIPKEY) === "1"; } catch (e) {}
    var t = document.getElementById("langTip"), b = document.getElementById("langBtn"); if (seen || !t || !b) return;
    t.innerHTML = "<b>🌐 Language</b><span>Tap to switch to Bahasa Indonesia</span><span>Ketuk untuk ganti ke Bahasa Indonesia</span>";
    t.setAttribute("data-notr", "1"); t.hidden = false;
    setTimeout(function () { hideTip(true); }, 9000);
  }

  function init() {
    var b = document.getElementById("langBtn");
    if (b) b.addEventListener("click", function () { window.DDsetLang(lang === "id" ? "en" : "id"); });
    document.addEventListener("click", function (e) { var t = document.getElementById("langTip"); if (t && !t.hidden && !(e.target.closest && e.target.closest("#langBtn"))) hideTip(true); }, true);
    drawBtn();
    if (lang === "id") apply(); else { obs.observe(document.body, cfg); }
    setTimeout(showTip, 1400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
