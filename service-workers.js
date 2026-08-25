// ======================================================
// TRAVEL EXPLORER - SERVICE WORKER V6
// Offline-first per app shell e dati editoriali
// Runtime cache per mappe/API/risorse esterne già viste
// ======================================================

const VERSION = "travel-explorer-v6.0";

const CORE_CACHE =
    VERSION + "-core";

const RUNTIME_CACHE =
    VERSION + "-runtime";

const API_CACHE =
    VERSION + "-api";

const TILE_CACHE =
    VERSION + "-tiles";


const CORE_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.json",
    "./offline.html",
    "./pwa-register.js",
    "./assets/mauritius-hero.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/maskable-512.png",
    "./icons/apple-touch-icon.png",
    "./icons/favicon-64.png"
];


const OPTIONAL_ASSETS = [
    "./map.html",
    "./itinerary.html",
    "./here.html",
    "./budget.html",
    "./documents.html",
    "./checklist.html",
    "./diary.html",
    "./dede.html",
    "./mauritius-info.html",
    "./pages/place.html",

    "./script.js",
    "./itinerary.js",
    "./itinerary-flex.js",
    "./here.js",
    "./live-data.js",
    "./travel-store.js",
    "./budget.js",
    "./documents.js",
    "./checklist.js",
    "./diary.js",

    "./data/places.json",
    "./data/culture.json",
    "./data/food.json",
    "./data/adventure.json",
    "./data/routes.json",
    "./data/route-templates.json"
];


self.addEventListener(
    "install",
    event => {

        event.waitUntil(
            installCaches()
        );

        self.skipWaiting();

    }
);


self.addEventListener(
    "activate",
    event => {

        event.waitUntil(
            cleanupOldCaches()
        );

        self.clients.claim();

    }
);


self.addEventListener(
    "message",
    event => {

        if (
            event.data?.type ===
            "SKIP_WAITING"
        ) {
            self.skipWaiting();
        }

    }
);


self.addEventListener(
    "fetch",
    event => {

        const request =
            event.request;

        if (
            request.method !==
            "GET"
        ) {
            return;
        }

        const url =
            new URL(
                request.url
            );

        // Navigazioni HTML:
        // prima rete, poi pagina esatta in cache, infine offline.html.
        if (
            request.mode ===
            "navigate"
        ) {

            event.respondWith(
                networkFirstNavigation(
                    request
                )
            );

            return;
        }

        // API Open-Meteo: rete prima, cache come fallback.
        if (
            url.hostname.includes(
                "open-meteo.com"
            )
        ) {

            event.respondWith(
                networkFirst(
                    request,
                    API_CACHE
                )
            );

            return;
        }

        // OSM tiles: vengono salvate SOLO quando l'utente le visualizza.
        if (
            url.hostname ===
            "tile.openstreetmap.org"
        ) {

            event.respondWith(
                cacheFirst(
                    request,
                    TILE_CACHE,
                    350
                )
            );

            return;
        }

        // CDN (Leaflet, Tesseract, ecc.): cache dopo il primo uso.
        if (
            url.origin !==
            self.location.origin
        ) {

            event.respondWith(
                staleWhileRevalidate(
                    request,
                    RUNTIME_CACHE
                )
            );

            return;
        }

        // File locali dell'app: cache-first.
        event.respondWith(
            cacheFirst(
                request,
                CORE_CACHE
            )
        );

    }
);


async function installCaches() {

    const cache =
        await caches.open(
            CORE_CACHE
        );

    // Core obbligatorio.
    await Promise.all(
        CORE_ASSETS.map(
            async path => {

                try {

                    const url =
                        new URL(
                            path,
                            self.location.href
                        );

                    const response =
                        await fetch(
                            url,
                            {
                                cache:
                                    "reload"
                            }
                        );

                    if (
                        response.ok
                    ) {

                        await cache.put(
                            url,
                            response
                        );

                    }

                }

                catch (error) {

                    console.warn(
                        "Core non precaricato:",
                        path,
                        error
                    );

                }

            }
        )
    );

    // Moduli opzionali: un file mancante NON impedisce l'installazione.
    await Promise.allSettled(
        OPTIONAL_ASSETS.map(
            async path => {

                const url =
                    new URL(
                        path,
                        self.location.href
                    );

                const response =
                    await fetch(
                        url,
                        {
                            cache:
                                "reload"
                        }
                    );

                if (
                    response.ok
                ) {

                    await cache.put(
                        url,
                        response
                    );

                }

            }
        )
    );

}


async function cleanupOldCaches() {

    const keep =
        new Set([
            CORE_CACHE,
            RUNTIME_CACHE,
            API_CACHE,
            TILE_CACHE
        ]);

    const keys =
        await caches.keys();

    await Promise.all(
        keys
            .filter(
                key =>
                    key.startsWith(
                        "travel-explorer-"
                    ) &&
                    !keep.has(key)
            )
            .map(
                key =>
                    caches.delete(
                        key
                    )
            )
    );

}


async function networkFirstNavigation(
    request
) {

    try {

        const response =
            await fetch(
                request
            );

        if (
            response &&
            response.ok
        ) {

            const cache =
                await caches.open(
                    RUNTIME_CACHE
                );

            cache.put(
                request,
                response.clone()
            );

        }

        return response;

    }

    catch (_) {

        const exact =
            await caches.match(
                request
            );

        if (exact) {
            return exact;
        }

        const pathname =
            new URL(
                request.url
            )
            .pathname
            .split("/")
            .pop();

        if (pathname) {

            const scope =
                self.registration.scope;

            const candidate =
                new URL(
                    pathname,
                    scope
                );

            const cachedCandidate =
                await caches.match(
                    candidate
                );

            if (
                cachedCandidate
            ) {
                return cachedCandidate;
            }

        }

        return (
            await caches.match(
                new URL(
                    "./offline.html",
                    self.registration.scope
                )
            )
        );

    }

}


async function networkFirst(
    request,
    cacheName
) {

    try {

        const response =
            await fetch(
                request
            );

        if (
            response &&
            response.ok
        ) {

            const cache =
                await caches.open(
                    cacheName
                );

            await cache.put(
                request,
                response.clone()
            );

        }

        return response;

    }

    catch (_) {

        const cached =
            await caches.match(
                request
            );

        if (cached) {
            return cached;
        }

        throw _;
    }

}


async function cacheFirst(
    request,
    cacheName,
    maxItems = null
) {

    const cached =
        await caches.match(
            request
        );

    if (cached) {
        return cached;
    }

    const response =
        await fetch(
            request
        );

    if (
        response &&
        (
            response.ok ||
            response.type ===
            "opaque"
        )
    ) {

        const cache =
            await caches.open(
                cacheName
            );

        await cache.put(
            request,
            response.clone()
        );

        if (maxItems) {
            trimCache(
                cacheName,
                maxItems
            );
        }

    }

    return response;

}


async function staleWhileRevalidate(
    request,
    cacheName
) {

    const cache =
        await caches.open(
            cacheName
        );

    const cached =
        await cache.match(
            request
        );

    const fetchPromise =
        fetch(
            request
        )
        .then(
            async response => {

                if (
                    response &&
                    (
                        response.ok ||
                        response.type ===
                        "opaque"
                    )
                ) {

                    await cache.put(
                        request,
                        response.clone()
                    );

                }

                return response;

            }
        )
        .catch(
            () => null
        );

    if (cached) {
        return cached;
    }

    const response =
        await fetchPromise;

    if (response) {
        return response;
    }

    return new Response(
        "",
        {
            status:
                504,
            statusText:
                "Offline"
        }
    );

}


async function trimCache(
    cacheName,
    maxItems
) {

    const cache =
        await caches.open(
            cacheName
        );

    const keys =
        await cache.keys();

    if (
        keys.length <=
        maxItems
    ) {
        return;
    }

    const removeCount =
        keys.length -
        maxItems;

    for (
        let i = 0;
        i < removeCount;
        i++
    ) {

        await cache.delete(
            keys[i]
        );

    }

}