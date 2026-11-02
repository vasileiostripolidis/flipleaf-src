// Flipleaf service worker: app shell cached up front, PDF.js extras (fonts, cmaps, wasm) cached on first use.
const VERSION = "flipleaf-v8";
const SHELL = [
  "./", "index.html", "app.js", "i18n.js", "icons.js", "platform.js", "editor.js", "pdfium.js", "pro.js", "pro-strings.js", "zip.js", "licensing.js", "signature.js", "style.css", "icon.svg", "manifest.webmanifest",
  "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "vendor/pdfjs/web/pdf_viewer.mjs", "vendor/pdfjs/web/pdf_viewer.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // App files: network first (so updates arrive), cache as fallback. Vendor files: cache first.
  const vendor = req.url.includes("/vendor/");
  e.respondWith(
    vendor
      ? caches.match(req).then((hit) => hit || fetchAndCache(req))
      : fetchAndCache(req).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

async function fetchAndCache(req) {
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}
