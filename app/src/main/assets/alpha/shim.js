/* Alpha WA — minimal chrome.* extension API for a WebView.
   Replaces what the original background.js / popup did, so content.js and inject.js run unchanged. */
(function () {
  const N = window.AlphaNative;
  if (!N) return;

  const BASE = location.origin + "/__alpha__/";
  const LICENSE_SERVER = "https://alphamicbackend-production-d20a.up.railway.app";
  const MANIFEST = { manifest_version: 3, name: "Alpha", version: "30.0", version_name: "V30" };

  // ------------------------------------------------------------ key/value storage (SharedPreferences)
  function kvGet(k) {
    try { const s = N.kvGet(k); return s == null ? undefined : JSON.parse(s); } catch (_) { return undefined; }
  }
  function kvSet(k, v) {
    try { if (v === undefined) N.kvRemove(k); else N.kvSet(k, JSON.stringify(v)); } catch (_) {}
  }

  // ------------------------------------------------------------ async HTTP through native (licence server only)
  const pendingHttp = {};
  let httpSeq = 0;
  window.__alphaHttpDone = function (id, json) {
    const cb = pendingHttp[id]; delete pendingHttp[id];
    if (cb) { try { cb(JSON.parse(json)); } catch (_) { cb({ status: 0, body: "" }); } }
  };
  function http(method, url, body) {
    return new Promise((resolve) => {
      const id = "h" + (++httpSeq) + "_" + Date.now();
      pendingHttp[id] = resolve;
      try { N.http(id, method, url, body || ""); } catch (_) { delete pendingHttp[id]; resolve({ status: 0, body: "" }); }
      setTimeout(() => { if (pendingHttp[id]) { delete pendingHttp[id]; resolve({ status: 0, body: "" }); } }, 30000);
    });
  }

  // ------------------------------------------------------------ licence (same logic as the extension's background.js)
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); })); }
  async function getBuyerId() {
    const t = kvGet("jmbBuyerId");
    if (t) return t;
    const e = uuid();
    kvSet("jmbBuyerId", e);
    return e;
  }
  function setStatus(s) { kvSet("jmbLicenseStatus", s); kvSet("jmbLicenseCheckedAt", Date.now()); }
  async function activate() {
    const t = await getBuyerId();
    try {
      const r = await http("POST", LICENSE_SERVER + "/api/activate", JSON.stringify({ buyerUuid: t, extVersion: MANIFEST.version }));
      if (r.status < 200 || r.status >= 300) throw new Error("activate failed: " + r.status);
      setStatus(JSON.parse(r.body).status);
    } catch (e) { console.warn("[ALPHA] activate failed", e); }
  }
  async function checkLicense() {
    const t = await getBuyerId();
    try {
      const r = await http("GET", LICENSE_SERVER + "/api/check?buyerUuid=" + encodeURIComponent(t));
      if (r.status === 404) return activate();
      if (r.status < 200 || r.status >= 300) throw new Error("check failed: " + r.status);
      setStatus(JSON.parse(r.body).status);
    } catch (e) { console.warn("[ALPHA] license check failed", e); }
  }
  // First launch: register this install. Later launches: refresh status (cached status is used right away).
  const licenseReady = kvGet("jmbBuyerId") ? checkLicense() : activate();
  setInterval(checkLicense, 30 * 60 * 1000);

  // ------------------------------------------------------------ media library (IndexedDB in the page origin)
  const MEDIA_DB = "alpha-media-db", MEDIA_STORE = "media";
  function mediaDb() { return new Promise((res, rej) => { const r = indexedDB.open(MEDIA_DB, 1); r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: "id" }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function mediaSave(item) { const db = await mediaDb(); return new Promise((res, rej) => { const tx = db.transaction(MEDIA_STORE, "readwrite"); tx.objectStore(MEDIA_STORE).put(item); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
  async function mediaList() { const db = await mediaDb(); return new Promise((res, rej) => { const tx = db.transaction(MEDIA_STORE, "readonly"); const r = tx.objectStore(MEDIA_STORE).getAll(); r.onsuccess = () => res(r.result.map((x) => ({ id: x.id, kind: x.kind, name: x.name, type: x.type || "audio/webm", size: (x.blob && x.blob.size) || 0, createdAt: x.createdAt }))); r.onerror = () => rej(r.error); }); }
  async function mediaGet(id) { const db = await mediaDb(); return new Promise((res, rej) => { const tx = db.transaction(MEDIA_STORE, "readonly"); const r = tx.objectStore(MEDIA_STORE).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
  async function mediaDelete(id) { const db = await mediaDb(); return new Promise((res, rej) => { const tx = db.transaction(MEDIA_STORE, "readwrite"); tx.objectStore(MEDIA_STORE).delete(id); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
  async function blobToB64(b) { const u = new Uint8Array(await b.arrayBuffer()); let s = ""; const CH = 0x8000; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); }
  function b64ToU8(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  async function handleMessage(m) {
    if (!m) return undefined;
    try {
      switch (m.type) {
        case "JMB_GET_BUYER_ID": return { buyerUuid: await getBuyerId() };
        case "JMB_LICENSE_RECHECK": await checkLicense(); return { status: kvGet("jmbLicenseStatus") || "pending" };
        case "ALPHA_MEDIA_SAVE": {
          const blob = new Blob([b64ToU8(m.b64)], { type: m.mimeType || "audio/webm" });
          await mediaSave({ id: m.id, kind: m.kind, name: m.name || m.id, type: blob.type, blob, createdAt: Date.now() });
          return { ok: true };
        }
        case "ALPHA_MEDIA_LIST": return { items: await mediaList() };
        case "ALPHA_MEDIA_GET": { const x = await mediaGet(m.id); return x ? { id: x.id, name: x.name, type: x.type, b64: await blobToB64(x.blob) } : {}; }
        case "ALPHA_MEDIA_DELETE": await mediaDelete(m.id); return { ok: true };
      }
    } catch (e) { return { ok: false, error: String(e) }; }
    return undefined;
  }

  // ------------------------------------------------------------ chrome.* objects
  function respond(work, cb) {
    const p = Promise.resolve().then(work);
    if (typeof cb === "function") { p.then((r) => { try { cb(r); } catch (e) { console.error(e); } }); return undefined; }
    return p;
  }

  const listeners = [];
  const storageLocal = {
    get(keys, cb) {
      return respond(async () => {
        const out = {};
        let list;
        if (keys == null) return out;
        if (typeof keys === "string") list = [keys];
        else if (Array.isArray(keys)) list = keys;
        else list = Object.keys(keys);
        // no cached licence status yet (first run): wait for the first check to finish
        if (list.indexOf("jmbLicenseStatus") >= 0 && kvGet("jmbLicenseStatus") === undefined) {
          await Promise.race([licenseReady, new Promise((r) => setTimeout(r, 8000))]);
        }
        for (const k of list) {
          const v = kvGet(k);
          if (v !== undefined) out[k] = v;
          else if (keys && typeof keys === "object" && !Array.isArray(keys)) out[k] = keys[k];
        }
        return out;
      }, cb);
    },
    set(obj, cb) {
      return respond(() => { for (const k of Object.keys(obj || {})) kvSet(k, obj[k]); }, cb);
    },
    remove(keys, cb) {
      return respond(() => { for (const k of [].concat(keys)) kvSet(k, undefined); }, cb);
    }
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: "alpha-wa",
    getURL: (p) => BASE + String(p).replace(/^\//, ""),
    getManifest: () => MANIFEST,
    sendMessage(msg, cb) { return respond(() => handleMessage(msg), cb); },
    onMessage: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } },
    lastError: undefined
  };
  window.chrome.storage = { local: storageLocal };

  // content.js loads inject.js with a <script src=...>. WhatsApp's CSP can block that, so hand it to native instead
  // (it is only ever requested after the licence is approved, so the licence lock still applies).
  const INJECT_URL = BASE + "inject.js";
  const origAppend = Node.prototype.appendChild;
  Node.prototype.appendChild = function (node) {
    try {
      if (node && node.tagName === "SCRIPT" && node.src === INJECT_URL) {
        N.injectEngine();
        setTimeout(() => { try { if (typeof node.onload === "function") node.onload(); } catch (_) {} }, 30);
        return node;
      }
    } catch (_) {}
    return origAppend.call(this, node);
  };

  // Desktop layout: lay the page out ~1000px wide (pinch to zoom).
  function fixViewport() {
    try {
      let m = document.querySelector("meta[name=viewport]");
      if (!m) { m = document.createElement("meta"); m.name = "viewport"; (document.head || document.documentElement).appendChild(m); }
      m.content = "width=1000, minimum-scale=0.2, maximum-scale=5, user-scalable=yes";
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fixViewport); else fixViewport();
})();
