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

  // WebView has no Notification API (Chrome does). WhatsApp's calling check needs it, so provide a quiet stand-in.
  try {
    if (typeof window.Notification === "undefined") {
      class AlphaNotification extends EventTarget {
        constructor(title, opts) { super(); this.title = title; Object.assign(this, opts || {}); }
        close() {}
        static get permission() { return "granted"; }
        static get maxActions() { return 2; }
        static requestPermission(cb) { if (typeof cb === "function") cb("granted"); return Promise.resolve("granted"); }
      }
      window.Notification = AlphaNotification;
    }
  } catch (_) {}

  // EXPERIMENT: WebView cannot be cross-origin isolated, so SharedArrayBuffer is missing and WhatsApp may disable calling.
  // A stand-in lets the feature check pass (it is NOT truly shared memory), and storage.persist() is answered "yes".
  try {
    if (typeof window.SharedArrayBuffer === "undefined") window.SharedArrayBuffer = ArrayBuffer;
    if (navigator.storage) {
      navigator.storage.persist = function () { return Promise.resolve(true); };
      navigator.storage.persisted = function () { return Promise.resolve(true); };
    }
  } catch (_) {}

  // ------------------------------------------------------------ diagnostics (the "diag" button in the app)
  const errLog = [];
  function pushErr(t) { errLog.push(String(t).slice(0, 160)); if (errLog.length > 15) errLog.shift(); }
  window.addEventListener("error", (e) => pushErr("err: " + e.message));
  window.addEventListener("unhandledrejection", (e) => pushErr("rej: " + (e.reason && (e.reason.message || e.reason))));
  const oce = console.error;
  console.error = function () { try { pushErr("console: " + [].slice.call(arguments).join(" ")); } catch (_) {} return oce.apply(console, arguments); };
  window.__alphaDiag = function () {
    const L = [];
    L.push("UA: " + navigator.userAgent);
    L.push("size: " + innerWidth + "x" + innerHeight + " dpr " + devicePixelRatio + " touch " + navigator.maxTouchPoints);
    const f = {
      RTCPeerConnection: typeof RTCPeerConnection, getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      AudioWorklet: typeof AudioWorklet, SharedArrayBuffer: typeof SharedArrayBuffer, crossOriginIsolated: window.crossOriginIsolated,
      WebAssembly: typeof WebAssembly, RTCRtpScriptTransform: typeof RTCRtpScriptTransform,
      encodedStreams: !!(window.RTCRtpSender && RTCRtpSender.prototype.createEncodedStreams), Notification: typeof Notification,
      MediaRecorder: typeof MediaRecorder, secure: window.isSecureContext,
      OffscreenCanvas: typeof OffscreenCanvas, VideoEncoder: typeof VideoEncoder, VideoDecoder: typeof VideoDecoder, AudioDecoder: typeof AudioDecoder,
      TrackProcessor: typeof MediaStreamTrackProcessor, serviceWorker: !!navigator.serviceWorker, wakeLock: !!navigator.wakeLock, permissions: !!navigator.permissions
    };
    L.push("features: " + JSON.stringify(f));
    try {
      const els = document.querySelectorAll('[aria-label*="call" i],[data-icon*="call" i],[title*="call" i],[data-icon*="phone" i],[data-icon*="video" i]');
      L.push("call elements: " + els.length);
      [].slice.call(els, 0, 6).forEach((e) => {
        const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        const cs = getComputedStyle(e);
        L.push("- " + e.tagName + " [" + (e.getAttribute("aria-label") || e.getAttribute("data-icon") || e.title) + "] rect " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) +
          " disabled=" + (e.getAttribute("aria-disabled") || e.disabled) + " pe=" + cs.pointerEvents + " top=" + (top ? top.tagName + "." + String(top.className).slice(0, 30) + "[" + (top.getAttribute("aria-label") || "") + "]" : "none") + (top === e || (top && e.contains(top)) ? " (same)" : " (COVERED)"));
      });
    } catch (e) { L.push("probe error " + e); }
    L.push("errors: " + (errLog.length ? "\n" + errLog.join("\n") : "none"));
    return L.join("\n");
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
