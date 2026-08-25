// ======================================================
// TRAVEL EXPLORER - "SONO QUI" V1
// GPS + ranking 400 POI + Very Local + mini itinerario
// ======================================================

const HERE_DATABASES = {
    place: "places.json",
    culture: "culture.json",
    food: "food.json",
    adventure: "adventure.json"
};

const HERE_PRIORITY = {
    "must-see": {
        label: "Imperdibile",
        icon: "🔥",
        weight: 4
    },
    "very-interesting": {
        label: "Molto interessante",
        icon: "⭐",
        weight: 3
    },
    "local-gem": {
        label: "Locale particolare",
        icon: "💎",
        weight: 2
    },
    "nearby-detour": {
        label: "Se sei vicino",
        icon: "↪️",
        weight: 1
    }
};

let herePOIs = [];
let userPosition = null;
let selectedMinutes = 60;
let selectedCategory = "all";
let hereMap = null;
let hereLayers = [];
let currentRecommendations = [];
let currentMiniTour = [];
let hereLiveSnapshot = null;

document.addEventListener(
    "DOMContentLoaded",
    initHere
);


async function initHere() {

    await loadAllHerePOIs();

    initHereMap();
    bindHereControls();

}


async function loadAllHerePOIs() {

    for (
        const [type, filename]
        of Object.entries(
            HERE_DATABASES
        )
    ) {

        const response =
            await fetch(
                "data/" + filename
            );

        if (!response.ok) {

            throw new Error(
                "Impossibile caricare " +
                filename
            );

        }

        const data =
            await response.json();

        data.forEach(raw => {

            const poi =
                normalizeHerePOI(
                    raw,
                    type
                );

            if (
                Number.isFinite(poi.lat) &&
                Number.isFinite(poi.lon)
            ) {
                herePOIs.push(
                    poi
                );
            }

        });

    }

}


function normalizeHerePOI(
    raw,
    type
) {

    const coordinates =
        raw.coordinates || {};

    const priorityRaw =
        raw.priority || {};

    let level =
        priorityRaw.level ||
        "very-interesting";

    if (!HERE_PRIORITY[level]) {
        level =
            "very-interesting";
    }

    return {
        id: raw.id,
        type,
        name:
            raw.name ||
            raw.id,
        area:
            raw.area ||
            "",
        lat:
            Number(
                coordinates.lat ??
                raw.lat
            ),
        lon:
            Number(
                coordinates.lon ??
                coordinates.lng ??
                raw.lon ??
                raw.lng
            ),
        categories:
            Array.isArray(
                raw.categories
            )
                ? raw.categories
                    .map(
                        item =>
                            String(item)
                                .toLowerCase()
                    )
                : [],
        tags:
            Array.isArray(raw.tags)
                ? raw.tags
                    .map(
                        item =>
                            String(item)
                                .toLowerCase()
                    )
                : [],
        priorityLevel:
            level,
        priority:
            HERE_PRIORITY[level],
        veryLocal:
            raw.very_local === true ||
            raw.veryLocal === true,
        description:
            raw.description || "",
        practical:
            raw.practical || {}
    };

}


function bindHereControls() {

    document
        .getElementById(
            "gps-now"
        )
        .addEventListener(
            "click",
            useGPS
        );

    document
        .getElementById(
            "test-tamarin"
        )
        .addEventListener(
            "click",
            () => {

                setUserPosition(
                    -20.327,
                    57.381,
                    "🧪 Modalità test: Veranda Tamarin"
                );

            }
        );

    document
        .querySelectorAll(
            "#time-chips .chip"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            "#time-chips .chip"
                        )
                        .forEach(
                            element =>
                                element
                                    .classList
                                    .remove(
                                        "active"
                                    )
                        );

                    button.classList.add(
                        "active"
                    );

                    selectedMinutes =
                        Number(
                            button.dataset
                                .minutes
                        );

                    refreshRecommendations();

                }
            );

        });

    document
        .querySelectorAll(
            "#category-chips .chip"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            "#category-chips .chip"
                        )
                        .forEach(
                            element =>
                                element
                                    .classList
                                    .remove(
                                        "active"
                                    )
                        );

                    button.classList.add(
                        "active"
                    );

                    selectedCategory =
                        button.dataset
                            .category;

                    refreshRecommendations();

                }
            );

        });

    document
        .getElementById(
            "open-mini-tour"
        )
        .addEventListener(
            "click",
            openMiniTour
        );

}


function useGPS() {

    const status =
        document.getElementById(
            "here-status"
        );

    if (
        !navigator.geolocation
    ) {

        status.textContent =
            "Questo browser non supporta la geolocalizzazione.";

        return;

    }

    status.textContent =
        "Sto cercando la tua posizione GPS…";

    navigator.geolocation
        .getCurrentPosition(
            position => {

                setUserPosition(
                    position.coords
                        .latitude,
                    position.coords
                        .longitude,
                    `GPS acquisito · precisione ±${Math.round(position.coords.accuracy)} m`
                );

            },
            error => {

                status.textContent =
                    "Non riesco ad accedere alla posizione. Su iPhone la geolocalizzazione richiede il permesso e, fuori da localhost, una pagina HTTPS.";

                console.error(error);

            },
            {
                enableHighAccuracy:
                    true,
                timeout:
                    12000,
                maximumAge:
                    30000
            }
        );

}


function setUserPosition(
    lat,
    lon,
    label
) {

    userPosition = {
        lat:
            Number(lat),
        lon:
            Number(lon)
    };

    document
        .getElementById(
            "here-status"
        )
        .innerHTML = `
            <strong>${escapeHereHTML(label)}</strong><br>
            ${userPosition.lat.toFixed(5)},
            ${userPosition.lon.toFixed(5)}
        `;

    hereMap.setView(
        [
            userPosition.lat,
            userPosition.lon
        ],
        12
    );

    refreshRecommendations();
    updateHereLiveData();

}


async function updateHereLiveData() {

    const container =
        document.getElementById(
            "live-now-content"
        );

    if (
        !container ||
        !userPosition
    ) {
        return;
    }

    container.className =
        "empty-state";

    container.textContent =
        navigator.onLine
            ? "Sto leggendo meteo, vento e mare…"
            : "Sei offline. Provo a usare l'ultimo dato live salvato.";

    try {

        hereLiveSnapshot =
            await TravelLive
                .getNowSnapshot(
                    userPosition.lat,
                    userPosition.lon,
                    {
                        includeMarine:
                            true
                    }
                );

        renderHereLiveData();

        refreshRecommendations();

    }

    catch (error) {

        console.error(error);

        hereLiveSnapshot =
            null;

        container.className =
            "empty-state";

        container.textContent =
            "Dati live non disponibili. I suggerimenti continuano a funzionare offline usando distanza, priorità e Very Local.";

    }

}


function renderHereLiveData() {

    const container =
        document.getElementById(
            "live-now-content"
        );

    if (
        !container ||
        !hereLiveSnapshot
    ) {
        return;
    }

    const current =
        hereLiveSnapshot.current ||
        {};

    const marine =
        hereLiveSnapshot.marine ||
        null;

    const assessment =
        hereLiveSnapshot.assessment;

    const label =
        assessment.condition ===
        "good"
            ? "Buon momento per stare fuori"
            : assessment.condition ===
                "mixed"
                ? "Scegli con attenzione"
                : "Meglio privilegiare attività riparate";

    container.className = "";

    container.innerHTML = `
        <div class="live-now-grid">

            <div class="live-now-stat">
                <span>METEO</span>
                <strong>
                    ${escapeHereHTML(
                        TravelLive.weatherCodeLabel(
                            current.weather_code
                        )
                    )}
                </strong>
            </div>

            <div class="live-now-stat">
                <span>TEMPERATURA</span>
                <strong>
                    ${Math.round(current.temperature_2m ?? 0)} °C
                </strong>
            </div>

            <div class="live-now-stat">
                <span>VENTO</span>
                <strong>
                    ${Math.round(current.wind_speed_10m ?? 0)} km/h
                </strong>
            </div>

            <div class="live-now-stat">
                <span>RAFFICHE</span>
                <strong>
                    ${Math.round(current.wind_gusts_10m ?? 0)} km/h
                </strong>
            </div>

            <div class="live-now-stat">
                <span>PIOGGIA PROB.</span>
                <strong>
                    ${hereLiveSnapshot.precipitation_probability ?? "—"}%
                </strong>
            </div>

            ${
                marine
                    ? `
                    <div class="live-now-stat">
                        <span>ONDA MODELLO</span>
                        <strong>
                            ${Number(marine.wave_height ?? 0).toFixed(1)} m
                        </strong>
                    </div>
                    `
                    : ""
            }

        </div>

        <div class="live-now-message ${assessment.condition}">
            <strong>${label} · ${assessment.score}/100</strong><br>
            ${escapeHereHTML(
                assessment.reasons.join(
                    " · "
                )
            )}
        </div>

        <div class="live-now-note">
            I suggerimenti qui sotto sono già riordinati usando anche queste condizioni.
            ${hereLiveSnapshot.stale ? "Dato recuperato dalla cache recente. " : ""}
            Dati Open-Meteo; le onde sono un modello indicativo e non per navigazione.
        </div>
    `;

}


function refreshRecommendations() {

    if (!userPosition) {
        return;
    }

    const radius =
        radiusForMinutes(
            selectedMinutes
        );

    currentRecommendations =
        herePOIs
            .map(poi => {

                const distance =
                    haversineHereKM(
                        userPosition.lat,
                        userPosition.lon,
                        poi.lat,
                        poi.lon
                    );

                const visitMinutes =
                    durationHereMinutes(
                        poi
                    );

                const driveMinutes =
                    estimateHereDriveMinutes(
                        distance
                    );

                const totalCommitment =
                    visitMinutes +
                    driveMinutes * 2;

                const score =
                    rankingHereScore(
                        poi,
                        distance,
                        totalCommitment
                    );

                return {
                    ...poi,
                    distance,
                    visitMinutes,
                    driveMinutes,
                    totalCommitment,
                    score
                };

            })
            .filter(
                poi =>
                    poi.distance <=
                    radius
            )
            .filter(
                matchesHereCategory
            )
            .filter(
                poi =>
                    poi.totalCommitment <=
                    selectedMinutes * 1.35
            )
            .sort(
                (a, b) =>
                    b.score - a.score
            )
            .slice(
                0,
                20
            );

    renderHereList();
    renderHereMap();
    buildMiniTour();

}


function radiusForMinutes(
    minutes
) {

    if (minutes <= 30) {
        return 4;
    }

    if (minutes <= 60) {
        return 8;
    }

    if (minutes <= 120) {
        return 15;
    }

    return 28;

}


function matchesHereCategory(
    poi
) {

    if (
        selectedCategory ===
        "all"
    ) {
        return true;
    }

    if (
        selectedCategory ===
        "very-local"
    ) {
        return poi.veryLocal;
    }

    if (
        selectedCategory ===
        "food"
    ) {
        return poi.type ===
            "food" ||
            poi.categories.includes(
                "food"
            );
    }

    if (
        selectedCategory ===
        "adventure"
    ) {
        return poi.type ===
            "adventure" ||
            poi.categories.includes(
                "adventure"
            );
    }

    if (
        selectedCategory ===
        "culture"
    ) {
        return poi.type ===
            "culture" ||
            poi.categories.some(
                item =>
                    [
                        "culture",
                        "history",
                        "religion"
                    ].includes(item)
            );
    }

    if (
        selectedCategory ===
        "beach"
    ) {
        return poi.categories.some(
            item =>
                [
                    "beach",
                    "sea",
                    "ocean",
                    "lagoon"
                ].includes(item)
        ) ||
        poi.tags.some(
            item =>
                item.includes(
                    "beach"
                )
        );
    }

    if (
        selectedCategory ===
        "nature"
    ) {
        return poi.categories.some(
            item =>
                [
                    "nature",
                    "waterfall",
                    "forest",
                    "viewpoint"
                ].includes(item)
        );
    }

    if (
        selectedCategory ===
        "geology"
    ) {
        return poi.categories.includes(
            "geology"
        ) ||
        poi.tags.some(
            item =>
                item.includes(
                    "geolog"
                )
        );
    }

    return true;

}


function rankingHereScore(
    poi,
    distance,
    totalCommitment
) {

    let score =
        poi.priority.weight *
        14;

    if (poi.veryLocal) {
        score += 8;
    }

    if (
        poi.priorityLevel ===
        "must-see"
    ) {
        score += 8;
    }

    score -=
        distance * 1.2;

    score -=
        Math.max(
            0,
            totalCommitment -
            selectedMinutes
        ) * .2;

    score +=
        liveWeatherAdjustment(
            poi
        );

    score +=
        openingAdjustment(
            poi
        );

    return score;

}


function liveWeatherAdjustment(
    poi
) {

    if (
        !hereLiveSnapshot
    ) {
        return 0;
    }

    const assessment =
        hereLiveSnapshot
            .assessment;

    let score = 0;

    const sea =
        poiIsSeaRelated(
            poi
        );

    const outdoor =
        poiIsOutdoor(
            poi
        );

    if (
        assessment.badSea &&
        sea
    ) {
        score -= 22;
    }

    if (
        assessment.badWind &&
        sea
    ) {
        score -= 14;
    }

    if (
        assessment.badRain &&
        outdoor
    ) {
        score -= 14;
    }

    if (
        assessment.badRain &&
        (
            poi.type ===
                "culture" ||
            poi.type ===
                "food"
        )
    ) {
        score += 9;
    }

    if (
        assessment.condition ===
        "good" &&
        outdoor
    ) {
        score += 5;
    }

    return score;

}


function poiIsSeaRelated(
    poi
) {

    const terms = [
        ...poi.categories,
        ...poi.tags
    ];

    return terms.some(
        item =>
            [
                "beach",
                "sea",
                "ocean",
                "lagoon",
                "snork",
                "surf",
                "marine",
                "kayak"
            ].some(
                keyword =>
                    String(item)
                        .includes(
                            keyword
                        )
            )
    );

}


function poiIsOutdoor(
    poi
) {

    if (
        poi.type ===
        "adventure"
    ) {
        return true;
    }

    return [
        ...poi.categories,
        ...poi.tags
    ]
    .some(
        item =>
            [
                "nature",
                "forest",
                "waterfall",
                "viewpoint",
                "geology",
                "beach",
                "sea",
                "hike",
                "trek"
            ].some(
                keyword =>
                    String(item)
                        .includes(
                            keyword
                        )
            )
    );

}


function openingAdjustment(
    poi
) {

    const opening =
        poi.practical
            ?.opening;

    const closing =
        poi.practical
            ?.closing;

    if (
        !opening ||
        !closing
    ) {
        return 0;
    }

    const now =
        TravelLive
            .mauritiusMinutesNow();

    const openMinutes =
        parseClockMinutes(
            opening
        );

    const closeMinutes =
        parseClockMinutes(
            closing
        );

    if (
        openMinutes === null ||
        closeMinutes === null
    ) {
        return 0;
    }

    if (
        now >= openMinutes &&
        now <
        closeMinutes - 30
    ) {
        return 3;
    }

    if (
        now >=
        closeMinutes
    ) {
        return -16;
    }

    if (
        now >=
        closeMinutes - 30
    ) {
        return -10;
    }

    return -4;

}


function parseClockMinutes(
    value
) {

    const match =
        String(value || "")
            .match(
                /^(\d{1,2}):(\d{2})$/
            );

    if (!match) {
        return null;
    }

    return (
        Number(match[1]) *
        60 +
        Number(match[2])
    );

}


function renderHereList() {

    const list =
        document.getElementById(
            "poi-list"
        );

    const title =
        document.getElementById(
            "results-title"
        );

    title.textContent =
        `Posti consigliati · ${currentRecommendations.length}`;

    list.innerHTML = "";

    if (
        !currentRecommendations.length
    ) {

        list.innerHTML = `
            <div class="empty-state">
                Nessun POI abbastanza sensato con questi filtri e questo tempo.
                Prova ad aumentare il tempo disponibile o cambiare categoria.
            </div>
        `;

        return;

    }

    currentRecommendations
        .forEach(
            (poi, index) => {

                const card =
                    document.createElement(
                        "div"
                    );

                card.className =
                    "near-card";

                card.innerHTML = `
                    <div class="near-top">
                        <h3>
                            ${index + 1}.
                            ${poi.priority.icon}
                            ${escapeHereHTML(
                                poi.name
                            )}
                        </h3>

                        <div class="near-distance">
                            ${poi.distance.toFixed(1)} km
                            · ≈ ${poi.driveMinutes} min
                        </div>
                    </div>

                    <p>
                        ${escapeHereHTML(
                            poi.description ||
                            poi.area
                        )}
                    </p>

                    <div class="badges">
                        <span class="badge">
                            ${poi.priority.label}
                        </span>

                        ${
                            poi.veryLocal
                                ? `
                                <span class="badge">
                                    🏘️ Very Local
                                </span>
                                `
                                : ""
                        }

                        <span class="badge">
                            ⏱ visita ≈ ${poi.visitMinutes} min
                        </span>

                        ${
                            hereLiveSnapshot
                                ? `
                                <span class="badge">
                                    ${weatherFitLabel(poi)}
                                </span>
                                `
                                : ""
                        }

                        ${
                            openingBadge(poi)
                                ? `
                                <span class="badge">
                                    ${openingBadge(poi)}
                                </span>
                                `
                                : ""
                        }

                        <a
                            class="badge"
                            href="pages/place.html?id=${encodeURIComponent(poi.id)}&type=${encodeURIComponent(poi.type)}"
                        >
                            Scheda →
                        </a>

                        <a
                            class="badge"
                            href="${googleHereSearchURL(poi.lat, poi.lon)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Naviga
                        </a>
                    </div>
                `;

                list.appendChild(
                    card
                );

            }
        );

}


function weatherFitLabel(
    poi
) {

    if (!hereLiveSnapshot) {
        return "";
    }

    const assessment =
        hereLiveSnapshot
            .assessment;

    if (
        assessment.badSea &&
        poiIsSeaRelated(poi)
    ) {
        return "🌊 mare sfavorito";
    }

    if (
        assessment.badRain &&
        (
            poi.type === "culture" ||
            poi.type === "food"
        )
    ) {
        return "☔ buona alternativa";
    }

    if (
        assessment.badRain &&
        poiIsOutdoor(poi)
    ) {
        return "🌧️ penalizzato";
    }

    if (
        assessment.condition ===
        "good" &&
        poiIsOutdoor(poi)
    ) {
        return "☀️ favorito";
    }

    return "🌦️ neutro";

}


function openingBadge(
    poi
) {

    const opening =
        poi.practical
            ?.opening;

    const closing =
        poi.practical
            ?.closing;

    if (
        !opening ||
        !closing
    ) {
        return "";
    }

    const now =
        TravelLive
            .mauritiusMinutesNow();

    const openMinutes =
        parseClockMinutes(
            opening
        );

    const closeMinutes =
        parseClockMinutes(
            closing
        );

    if (
        openMinutes === null ||
        closeMinutes === null
    ) {
        return "";
    }

    if (
        now >= openMinutes &&
        now <
        closeMinutes
    ) {

        const left =
            closeMinutes - now;

        if (left <= 45) {
            return `⏰ chiude tra ${left} min*`;
        }

        return `🕘 fino alle ${closing}*`;

    }

    if (
        now <
        openMinutes
    ) {
        return `🕘 apre ${opening}*`;
    }

    return `⚠️ oltre ${closing}*`;

}


function buildMiniTour() {

    currentMiniTour = [];

    const available =
        [...currentRecommendations];

    if (!available.length) {

        renderMiniTour();
        return;

    }

    let cursor =
        {
            ...userPosition
        };

    let usedMinutes = 0;

    const targetStops =
        selectedMinutes <= 60
            ? 1
            : selectedMinutes <= 120
                ? 2
                : 3;

    while (
        available.length &&
        currentMiniTour.length <
        targetStops
    ) {

        available.sort(
            (a, b) => {

                const aDist =
                    haversineHereKM(
                        cursor.lat,
                        cursor.lon,
                        a.lat,
                        a.lon
                    );

                const bDist =
                    haversineHereKM(
                        cursor.lat,
                        cursor.lon,
                        b.lat,
                        b.lon
                    );

                const aScore =
                    a.priority.weight *
                    10 +
                    (
                        a.veryLocal
                            ? 6
                            : 0
                    ) -
                    aDist * 1.4;

                const bScore =
                    b.priority.weight *
                    10 +
                    (
                        b.veryLocal
                            ? 6
                            : 0
                    ) -
                    bDist * 1.4;

                return (
                    bScore - aScore
                );

            }
        );

        let pickedIndex =
            -1;

        for (
            let i = 0;
            i < available.length;
            i++
        ) {

            const candidate =
                available[i];

            const legDistance =
                haversineHereKM(
                    cursor.lat,
                    cursor.lon,
                    candidate.lat,
                    candidate.lon
                );

            const legMinutes =
                estimateHereDriveMinutes(
                    legDistance
                );

            const nextUsed =
                usedMinutes +
                legMinutes +
                candidate.visitMinutes;

            if (
                nextUsed <=
                selectedMinutes * .88
            ) {

                pickedIndex = i;
                break;

            }

        }

        if (pickedIndex < 0) {
            break;
        }

        const picked =
            available.splice(
                pickedIndex,
                1
            )[0];

        const legDistance =
            haversineHereKM(
                cursor.lat,
                cursor.lon,
                picked.lat,
                picked.lon
            );

        const legMinutes =
            estimateHereDriveMinutes(
                legDistance
            );

        usedMinutes +=
            legMinutes +
            picked.visitMinutes;

        currentMiniTour.push({
            ...picked,
            legMinutes
        });

        cursor = {
            lat: picked.lat,
            lon: picked.lon
        };

    }

    renderMiniTour(
        usedMinutes
    );

}


function renderMiniTour(
    usedMinutes = 0
) {

    const section =
        document.getElementById(
            "mini-tour-section"
        );

    if (
        !currentMiniTour.length
    ) {

        section.hidden = true;
        return;

    }

    section.hidden = false;

    document
        .getElementById(
            "mini-tour-summary"
        )
        .textContent =
            `${currentMiniTour.length} tappe · circa ${usedMinutes} min, senza contare eventuali attese o traffico live.`;

    const container =
        document.getElementById(
            "mini-tour-steps"
        );

    container.innerHTML = "";

    currentMiniTour
        .forEach(
            (poi, index) => {

                const row =
                    document.createElement(
                        "div"
                    );

                row.className =
                    "tour-step";

                row.innerHTML = `
                    <div class="tour-number">
                        ${index + 1}
                    </div>

                    <div>
                        <strong>
                            ${poi.priority.icon}
                            ${escapeHereHTML(
                                poi.name
                            )}
                        </strong>

                        <span>
                            ≈ ${poi.legMinutes} min di spostamento
                            · ${poi.visitMinutes} min sul posto
                            ${
                                poi.veryLocal
                                    ? " · 🏘️ Very Local"
                                    : ""
                            }
                        </span>
                    </div>
                `;

                container.appendChild(
                    row
                );

            }
        );

}


function initHereMap() {

    hereMap =
        L.map(
            "here-map",
            {
                zoomControl: true
            }
        )
        .setView(
            [-20.28, 57.55],
            9
        );

    L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "© OpenStreetMap contributors"
        }
    )
    .addTo(hereMap);

}


function renderHereMap() {

    hereLayers
        .forEach(
            layer =>
                hereMap
                    .removeLayer(layer)
        );

    hereLayers = [];

    if (!userPosition) {
        return;
    }

    const userMarker =
        L.circleMarker(
            [
                userPosition.lat,
                userPosition.lon
            ],
            {
                radius: 10,
                weight: 4,
                color: "#ffffff",
                fillColor: "#1976d2",
                fillOpacity: 1
            }
        )
        .addTo(hereMap);

    userMarker.bindTooltip(
        "📍 Sei qui"
    );

    hereLayers.push(
        userMarker
    );

    currentRecommendations
        .slice(0, 12)
        .forEach(
            (poi, index) => {

                const marker =
                    L.circleMarker(
                        [
                            poi.lat,
                            poi.lon
                        ],
                        {
                            radius:
                                index < 3
                                    ? 8
                                    : 6,
                            weight: 2,
                            color: "#ffffff",
                            fillColor: "#1d1d1f",
                            fillOpacity: .92
                        }
                    )
                    .addTo(hereMap);

                marker.bindTooltip(
                    `${index + 1}. ${poi.name}`
                );

                hereLayers.push(
                    marker
                );

            }
        );

    const coords = [
        [
            userPosition.lat,
            userPosition.lon
        ],
        ...currentRecommendations
            .slice(0, 8)
            .map(
                poi => [
                    poi.lat,
                    poi.lon
                ]
            )
    ];

    if (coords.length > 1) {

        hereMap.fitBounds(
            L.latLngBounds(
                coords
            ),
            {
                padding:
                    [25, 25],
                maxZoom:
                    13
            }
        );

    }

}


function openMiniTour() {

    if (
        !userPosition ||
        !currentMiniTour.length
    ) {
        return;
    }

    const destination =
        currentMiniTour[
            currentMiniTour.length - 1
        ];

    const middle =
        currentMiniTour.slice(
            0,
            -1
        );

    let url =
        "https://www.google.com/maps/dir/?api=1";

    url +=
        "&origin=" +
        encodeURIComponent(
            `${userPosition.lat},${userPosition.lon}`
        );

    url +=
        "&destination=" +
        encodeURIComponent(
            `${destination.lat},${destination.lon}`
        );

    if (middle.length) {

        url +=
            "&waypoints=" +
            encodeURIComponent(
                middle
                    .map(
                        poi =>
                            `${poi.lat},${poi.lon}`
                    )
                    .join("|")
            );

    }

    url +=
        "&travelmode=driving";

    window.open(
        url,
        "_blank"
    );

}


function durationHereMinutes(
    poi
) {

    const practical =
        poi.practical || {};

    const numeric =
        practical.duration_recommended ??
        practical.duration_min;

    if (
        Number.isFinite(
            Number(numeric)
        )
    ) {
        return Number(numeric);
    }

    const text =
        String(
            practical.duration ||
            ""
        );

    const minuteMatch =
        text.match(
            /(\d+)\s*[-–]\s*(\d+)\s*min/i
        );

    if (minuteMatch) {
        return Math.round(
            (
                Number(minuteMatch[1]) +
                Number(minuteMatch[2])
            ) / 2
        );
    }

    const hourMatch =
        text.match(
            /(\d+)\s*[-–]\s*(\d+)\s*ore?/i
        );

    if (hourMatch) {
        return Math.round(
            (
                Number(hourMatch[1]) +
                Number(hourMatch[2])
            ) / 2 * 60
        );
    }

    if (poi.type === "food") {
        return 40;
    }

    if (
        poi.type ===
        "adventure"
    ) {
        return 100;
    }

    return 40;

}


function estimateHereDriveMinutes(
    straightDistanceKM
) {

    if (
        straightDistanceKM <
        .3
    ) {
        return 3;
    }

    return Math.max(
        4,
        Math.round(
            3 +
            straightDistanceKM *
            2.4
        )
    );

}


function googleHereSearchURL(
    lat,
    lon
) {

    return (
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(
            `${lat},${lon}`
        )
    );

}


function haversineHereKM(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const radius = 6371;

    const toRad =
        degrees =>
            degrees *
            Math.PI /
            180;

    const dLat =
        toRad(
            lat2 - lat1
        );

    const dLon =
        toRad(
            lon2 - lon1
        );

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(
            toRad(lat1)
        ) *
        Math.cos(
            toRad(lat2)
        ) *
        Math.sin(dLon / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return radius * c;

}


function escapeHereHTML(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}