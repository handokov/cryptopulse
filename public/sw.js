/**
 * CryptoPulse service worker — hand-rolled, zero dependencies.
 *
 * Caching strategies (GET only, same-origin only — external CoinGecko
 * requests pass straight through to the network):
 *
 *  - App shell ("/", manifest, icons)  → precached at install
 *  - Navigations                       → network-first, offline fallback to the cached shell
 *  - Build assets (/_next/static, /_next/image)
 *                                      → network-first with cache fallback. Network-first is
 *                                        deliberate: dev servers (Turbopack) rewrite chunks at
 *                                        stable URLs, so cache-first here would pin stale code.
 *  - Brand icons (/icons, /logo.svg)   → cache-first (immutable files)
 *  - Data APIs (/api/market, /api/portfolio, /api/news, /api/alerts, …)
 *                                      → network-first with "last good response" fallback,
 *                                        so an offline CryptoPulse still shows the latest
 *                                        cached market data instead of an error page.
 *
 * Bump VERSION whenever the shell asset list changes.
 */
const VERSION = "v2";
const SHELL_CACHE = `cp-shell-${VERSION}`;
const RUNTIME_CACHE = `cp-runtime-${VERSION}`;

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // external requests (CoinGecko avatars/API, fonts, …): browser handles them
  if (url.origin !== self.location.origin) return;

  // 1) document navigations: try the network, fall back to the cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      networkFirst(req, { fallbackUrl: "/" })
    );
    return;
  }

  // 2) build assets: fresh when online, cached copy offline (dev-server safe)
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image")
  ) {
    event.respondWith(networkFirst(req, {}));
    return;
  }

  // 3) brand assets: truly immutable → cache-first
  if (url.pathname.startsWith("/icons/") || url.pathname === "/logo.svg") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 4) data APIs: fresh when online, last-good snapshot when offline
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req, {}));
    return;
  }

  // everything else (RSC payloads, misc.): let the browser handle it
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok && (res.type === "basic" || res.type === "default")) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirst(req, { fallbackUrl } = {}) {
  try {
    const res = await fetch(req);
    if (res.ok && (res.type === "basic" || res.type === "default")) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}
