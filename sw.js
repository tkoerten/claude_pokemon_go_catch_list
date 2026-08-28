/* Offline support.
 *   Shell (index.html, styles, scripts, manifest, icon): cache-first — instant,
 *     works with no signal, which is the point of a field tool.
 *   data.json: network-first — a phone must not get stuck on last week's list;
 *     the nightly rebuild is worthless if the cache never lets it through.
 * Bump CACHE whenever the shell changes so the old one is evicted on activate. */
var CACHE = "catch-list-v4";
var SHELL = [
  "./", "index.html", "styles.css", "logic.js", "app.js", "manifest.json", "icon.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== CACHE) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/data.json")) {
    e.respondWith(networkFirst(req));
  } else if (req.mode === "navigate") {
    e.respondWith(caches.match("index.html").then(function (r) {
      return r || fetch(req);
    }));
  } else {
    e.respondWith(caches.match(req).then(function (r) {
      return r || fetch(req);
    }));
  }
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) {
      return r || new Response('{"error":"offline"}',
        { headers: { "Content-Type": "application/json" }, status: 503 });
    });
  });
}
