// Flowlet service worker: keeps the app shell (HTML, CSS, JS, icons) available offline.
// Never caches chain state: RPC calls go to other origins and are not intercepted, and deployments/*.json is always fetched live.
const VERSION = "flowlet-shell-v6";
const SHELL = ["./", "index.html", "style.css", "app-shell.css", "app.js", "shell.js", "control.js", "flows.js", "trace.js", "recorded-loops.json", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "favicon.svg", "3d/f-bubbles.webp", "3d/f-bolt.webp", "3d/f-nodes.webp", "3d/f-loop.webp", "brand/metamask-fox.svg",
  "fonts/fonts.css", "fonts/switzer-400.woff2", "fonts/switzer-500.woff2", "fonts/switzer-600.woff2", "fonts/cabinet-grotesk-700.woff2", "fonts/geist-mono-var.woff2"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // RPC, explorers, wallet: always live, never cached
  if (/\/deployments\//.test(url.pathname)) return; // contract config: live only
  if (/\/fonts\/.+\.woff2$/.test(url.pathname)) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }))); return; }
  // Network first, so a new build shows at once; the cached copy only when offline.
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(key, copy)); } return r; }).catch(() => caches.match(key)));
});
