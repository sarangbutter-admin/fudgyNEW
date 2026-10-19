/* Delidome: tiny Supabase client (no libraries, no build step).
   - rpc(): calls a database function through PostgREST
   - login()/logout(): owner sign-in with email + password (Supabase Auth)
   - upload(): puts an owner picture into the public "shop-media" bucket
   When config.js is empty, SBK.on is false and the site runs in demo mode. */
(function () {
  "use strict";
  var C = window.DELIDOME_CONFIG || {};
  var URL_ = String(C.supabaseUrl || "").trim().replace(/\/+$/, "");
  var KEY = String(C.supabaseAnonKey || "").trim();
  var on = !!(URL_ && KEY);
  var SKEY = "delidome-auth-v1";
  var BUCKET = "shop-media";
  var sess = null;
  try { sess = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { sess = null; }

  function saveSess() { try { if (sess) localStorage.setItem(SKEY, JSON.stringify(sess)); else localStorage.removeItem(SKEY); } catch (e) {} }
  function nice(msg) {
    msg = String(msg || "");
    if (/Failed to fetch|NetworkError|Load failed|aborted/i.test(msg)) return "Can't reach the shop right now. Check your internet and try again.";
    return msg;
  }
  // a visitor hit one of the shop's limits: let the page show its friendly "slow down" pop-up
  function limitHit(msg, src) {
    try { if (/^(too many|we.re very busy|courier prices are busy)/i.test(msg) && window.ddSlow) window.ddSlow({ kind: "stop", src: src }); } catch (e) {}
    return msg;
  }
  // ...and when they are getting close to a limit, the friendly early warning
  function limitNear(j, src) {
    try { if (j && j._warn && window.ddSlow) window.ddSlow({ kind: "warn", src: src }); } catch (e) {}
  }
  function headers(token, extra) {
    var h = { "apikey": KEY, "Content-Type": "application/json" };
    // legacy anon keys are JWTs and may be sent as a bearer; new publishable keys must not be
    if (token) h["Authorization"] = "Bearer " + token;
    else if (/^eyJ/.test(KEY)) h["Authorization"] = "Bearer " + KEY;
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function timeout(ms) { var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, ms); return { signal: c.signal, done: function () { clearTimeout(t); } }; }

  async function refresh() {
    if (!sess || !sess.refresh_token) throw new Error("Please sign in again.");
    var r = await fetch(URL_ + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: headers(null), body: JSON.stringify({ refresh_token: sess.refresh_token })
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.access_token) { sess = null; saveSess(); throw new Error("Your session ended. Please sign in again."); }
    sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || (sess && sess.email) || "" };
    saveSess();
    return sess.access_token;
  }
  async function token() {
    if (!sess) return null;
    if (sess.expires_at - Date.now() < 60000) await refresh();
    return sess.access_token;
  }

  // admin = true: send the owner's token
  async function rpc(name, args, admin) {
    if (!on) throw new Error("Backend is not configured.");
    var tok = null;
    if (admin) { tok = await token(); if (!tok) throw new Error("Please sign in to the team area."); }
    var attempt = async function (tk) {
      var t = timeout(25000), r;
      try {
        r = await fetch(URL_ + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(tk), body: JSON.stringify(args || {}), signal: t.signal });
      } catch (e) { t.done(); throw new Error(nice(e && e.message)); }
      t.done();
      var txt = await r.text(), j = null;
      try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
      if (!r.ok) {
        var err = new Error(limitHit(nice((j && (j.message || j.error_description || j.hint)) || ("Request failed (" + r.status + ")")), name));
        err.status = r.status; err.code = j && j.code;
        throw err;
      }
      if (j && j.ok === false && typeof j.err === "string") limitHit(j.err, name);
      limitNear(j, name);
      return j;
    };
    try { return await attempt(tok); }
    catch (e) {
      if (admin && (e.status === 401 || /jwt/i.test(e.message))) { var tk = await refresh(); return attempt(tk); }
      throw e;
    }
  }

  // calls an Edge Function (admin = true: send the team member's token)
  async function fn(name, body, admin) {
    if (!on) throw new Error("Backend is not configured.");
    var tok = null;
    if (admin) { tok = await token(); if (!tok) throw new Error("Please sign in to the team area."); }
    var t = timeout(30000), r;
    try {
      r = await fetch(URL_ + "/functions/v1/" + name, { method: "POST", headers: headers(tok), body: JSON.stringify(body || {}), signal: t.signal });
    } catch (e) { t.done(); throw new Error(nice(e && e.message)); }
    t.done();
    var txt = await r.text(), j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
    var src = name === "biteship" ? "courier" : name;
    if (!r.ok) { var err = new Error(limitHit(nice((j && (j.error || j.message)) || ("Request failed (" + r.status + ")")), src)); err.status = r.status; throw err; }
    limitNear(j, src);
    return j;
  }

  async function login(email, password) {
    var t = timeout(25000), r;
    try {
      r = await fetch(URL_ + "/auth/v1/token?grant_type=password", { method: "POST", headers: headers(null), body: JSON.stringify({ email: email, password: password }), signal: t.signal });
    } catch (e) { t.done(); throw new Error(nice(e && e.message)); }
    t.done();
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.access_token) throw new Error(/invalid/i.test(j.msg || j.error_description || "") ? "That email or password isn't right." : (j.msg || j.error_description || "Couldn't sign in."));
    sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || email };
    saveSess();
    return sess.email;
  }
  function logout() {
    var s = sess; sess = null; saveSess();
    if (s && s.access_token) { try { fetch(URL_ + "/auth/v1/logout", { method: "POST", headers: headers(s.access_token) }).catch(function () {}); } catch (e) {} }
  }

  function dataToBlob(d) {
    var m = /^data:([a-z0-9.+\/-]+);base64,(.*)$/i.exec(d);
    if (!m) return null;
    var bin = atob(m[2]), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: m[1] });
  }
  async function sha1(buf) {
    var h = await crypto.subtle.digest("SHA-1", buf), a = new Uint8Array(h), s = "";
    for (var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0");
    return s;
  }
  var EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a" };
  // upload a data: URL, returns its public https URL. Same picture = same file name, so repeats cost nothing.
  async function upload(dataUrl) {
    var blob = dataToBlob(dataUrl);
    if (!blob) throw new Error("Unsupported file.");
    var ext = EXT[blob.type];
    if (!ext) throw new Error("This file type can't be uploaded (" + blob.type + ").");
    if (blob.size > 10 * 1024 * 1024) throw new Error("That file is over 10 MB. Please use a smaller one.");
    var name = (await sha1(await blob.arrayBuffer())) + "." + ext;
    var tok = await token();
    if (!tok) throw new Error("Please sign in to the team area.");
    var r = await fetch(URL_ + "/storage/v1/object/" + BUCKET + "/" + name, {
      method: "POST", headers: { "apikey": KEY, "Authorization": "Bearer " + tok, "Content-Type": blob.type, "x-upsert": "true", "cache-control": "max-age=31536000" }, body: blob
    });
    if (!r.ok) {
      var j = await r.json().catch(function () { return {}; });
      throw new Error("Couldn't upload the picture: " + (j.message || j.error || r.status));
    }
    return URL_ + "/storage/v1/object/public/" + BUCKET + "/" + name;
  }

  window.SBK = {
    on: on,
    url: URL_,
    rpc: rpc,
    fn: fn,
    login: login,
    logout: logout,
    upload: upload,
    signedIn: function () { return !!sess; },
    email: function () { return sess ? sess.email : ""; }
  };
})();
