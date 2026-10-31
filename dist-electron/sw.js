const CACHE_NAME = "tracksim-zero-shell-v1";
const PRECACHE_URLS = ["/", "/index.html", "/favicon.ico", "/Logo.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Network timeout")), timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // No interceptar llamadas de API de Firebase, Firestore, Google Auth ni extensiones
  if (
    url.protocol !== "http:" && url.protocol !== "https:" ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.includes("google.com") ||
    url.hostname.includes("github.com")
  ) {
    return;
  }

  // 1. Navegaciones (HTML / SPA routes): Network-first con timeout corto (2.5s) y fallback a index.html en caché
  if (request.mode === "navigate") {
    event.respondWith(
      fetchWithTimeout(request, 2500)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put("/index.html", copy).catch(() => {});
            });
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = (await cache.match(request)) || (await cache.match("/index.html")) || (await cache.match("/"));
          return cached || Response.error();
        })
    );
    return;
  }

  // 2. Recursos estáticos con hash (/assets/*), íconos, imágenes y fuentes: Stale-While-Revalidate / Cache-First
  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf)$/i.test(url.pathname) ||
    url.hostname.includes("fonts.gstatic.com");

  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetchWithTimeout(request, 4000)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});
