// ======================================================
// TRAVEL EXPLORER — ITINERARY V1.2 STABLE
// Base itinerary engine + Smart Planner V1.2
// File unico per evitare conflitti tra versioni.
// ======================================================

// ======================================================
// TRAVEL EXPLORER - ITINERARY ENGINE V2
// Modifica tappe + lucchetti + IndexedDB + Ricalcolo AI
// ======================================================

const IT_DATABASES = {
    place: "places.json",
    culture: "culture.json",
    food: "food.json",
    adventure: "adventure.json"
};

const IT_PRIORITY_META = {
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

const ROUTE_STORE_KEY =
    "mauritius-2026-route-overrides-v2";

let masterItineraryData = null;
let itineraryData = null;
let poiIndex = new Map();
let currentDayIndex = 0;
let itineraryMap = null;
let itineraryMapLayers = [];
let pendingRecalcDay = null;
let currentLiveSnapshot = null;
let liveRequestToken = 0;

document.addEventListener(
    "DOMContentLoaded",
    initItinerary
);


async function initItinerary() {

    try {

        const [routes] =
            await Promise.all([
                loadItineraryJSON(
                    "data/routes.json"
                ),
                loadAllPOIs()
            ]);

        masterItineraryData =
            deepClone(routes);

        const saved =
            await TravelStore.get(
                ROUTE_STORE_KEY
            );

        itineraryData =
            saved &&
            saved.trip?.id === routes.trip?.id
                ? saved
                : deepClone(routes);

        ensureEditableMetadata();

        renderTripSummary();
        renderDaySelector();
        bindGlobalActions();
        initMap();
        renderDay(0);

    }

    catch (error) {

        console.error(error);

        document.getElementById(
            "day-overview"
        ).innerHTML = `
            <strong>Errore caricamento itinerario</strong>
            <p>Apri il progetto con Live Server e controlla data/routes.json.</p>
        `;

    }

}


function bindGlobalActions() {

    document
        .getElementById("navigate-day")
        .addEventListener(
            "click",
            openDayDirections
        );

    document
        .getElementById("open-full-map")
        .addEventListener(
            "click",
            () => {
                window.location.href =
                    "map.html";
            }
        );

    document
        .getElementById("add-stop")
        .addEventListener(
            "click",
            openAddPOIModal
        );

    document
        .getElementById("recalculate-ai")
        .addEventListener(
            "click",
            () => {
                document
                    .getElementById(
                        "recalc-result"
                    )
                    .innerHTML = "";

                openModal(
                    "recalc-modal"
                );

                renderRecalcLiveContext();
            }
        );

    document
        .getElementById("reset-day")
        .addEventListener(
            "click",
            resetCurrentDay
        );

    document
        .getElementById("complete-day")
        .addEventListener(
            "click",
            toggleDayCompleted
        );

    document
        .getElementById("refresh-live-day")
        .addEventListener(
            "click",
            () => {
                currentLiveSnapshot = null;
                refreshDayLiveData(
                    itineraryData.days[
                        currentDayIndex
                    ],
                    true
                );
            }
        );

    document
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {
                    closeModal(
                        button.dataset
                            .closeModal
                    );
                }
            );

        });

    document
        .querySelectorAll(
            "[data-recalc-mode]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () =>
                    previewRecalculation(
                        button.dataset
                            .recalcMode
                    )
            );

        });

    document
        .getElementById(
            "poi-search"
        )
        .addEventListener(
            "input",
            event =>
                renderPOISearchResults(
                    event.target.value
                )
        );

}


function ensureEditableMetadata() {

    itineraryData.days
        .forEach(day => {

            if (
                typeof day._completed
                !== "boolean"
            ) {
                day._completed = false;
            }

            day.blocks
                .forEach(
                    (block, index) => {

                        if (!block._uid) {

                            block._uid =
                                createUID(
                                    day.date,
                                    index
                                );

                        }

                        if (
                            typeof block._locked
                            !== "boolean"
                        ) {

                            block._locked =
                                block.kind ===
                                "arrival" ||
                                block.kind ===
                                "departure";

                        }

                    }
                );

        });

}


async function persistItinerary() {

    await TravelStore.set(
        ROUTE_STORE_KEY,
        itineraryData
    );

}


async function loadItineraryJSON(path) {

    const response =
        await fetch(path);

    if (!response.ok) {

        throw new Error(
            "Impossibile caricare " +
            path
        );

    }

    return response.json();

}


async function loadAllPOIs() {

    for (
        const [type, filename]
        of Object.entries(IT_DATABASES)
    ) {

        const data =
            await loadItineraryJSON(
                "data/" + filename
            );

        data.forEach(raw => {

            const poi =
                normalizeItineraryPOI(
                    raw,
                    type
                );

            poiIndex.set(
                poi.id,
                poi
            );

        });

    }

}


function normalizeItineraryPOI(
    raw,
    type
) {

    const coordinates =
        raw.coordinates || {};

    const priority =
        raw.priority || {};

    let level =
        priority.level ||
        "very-interesting";

    if (!IT_PRIORITY_META[level]) {

        const label =
            String(
                priority.label || ""
            ).toLowerCase();

        if (
            label.includes(
                "imperdibile"
            )
        ) {
            level = "must-see";
        }

        else if (
            label.includes(
                "locale"
            )
        ) {
            level = "local-gem";
        }

        else if (
            label.includes(
                "deviazione"
            )
        ) {
            level = "nearby-detour";
        }

        else {
            level =
                "very-interesting";
        }

    }

    return {
        id: raw.id,
        type,
        name:
            raw.name ||
            raw.nome ||
            raw.id,
        area:
            raw.area ||
            raw.zona ||
            "",
        lat:
            coordinates.lat ??
            raw.lat,
        lon:
            coordinates.lon ??
            coordinates.lng ??
            raw.lon ??
            raw.lng,
        categories:
            Array.isArray(
                raw.categories
            )
                ? raw.categories
                : [],
        tags:
            Array.isArray(raw.tags)
                ? raw.tags
                : [],
        priorityLevel: level,
        priority:
            IT_PRIORITY_META[level],
        veryLocal:
            raw.very_local === true ||
            raw.veryLocal === true,
        description:
            raw.description || "",
        practical:
            raw.practical || {},
        reviews:
            raw.reviews || {}
    };

}


function renderTripSummary() {

    const days =
        itineraryData.days;

    const driving =
        days.reduce(
            (total, day) =>
                total +
                (
                    day.manual_driving_minutes ||
                    0
                ),
            0
        );

    const activeDays =
        days.filter(
            day =>
                day.theme !==
                "Aeroporto"
        ).length;

    const locked =
        days.reduce(
            (total, day) =>
                total +
                day.blocks.filter(
                    block =>
                        block._locked
                ).length,
            0
        );

    const container =
        document.getElementById(
            "trip-summary"
        );

    container.innerHTML = `
        <div class="trip-summary-card">
            <span>GIORNI</span>
            <strong>${days.length}</strong>
        </div>

        <div class="trip-summary-card">
            <span>GIORNI DI VIAGGIO</span>
            <strong>${activeDays}</strong>
        </div>

        <div class="trip-summary-card">
            <span>GUIDA STIMATA</span>
            <strong>${formatMinutes(driving)}</strong>
        </div>

        <div class="trip-summary-card">
            <span>TAPPE BLOCCATE</span>
            <strong>${locked} 🔒</strong>
        </div>
    `;

}


function renderDaySelector() {

    const container =
        document.getElementById(
            "day-selector"
        );

    container.innerHTML = "";

    itineraryData.days
        .forEach(
            (day, index) => {

                const button =
                    document.createElement(
                        "button"
                    );

                button.className =
                    "day-pill";

                if (
                    index ===
                    currentDayIndex
                ) {
                    button.classList.add(
                        "active"
                    );
                }

                const date =
                    parseISODate(
                        day.date
                    );

                button.innerHTML =
                    `${day._completed ? "✅ " : ""}${date.dayName}<br>${date.dayNumber}`;

                button.addEventListener(
                    "click",
                    () => {

                        document
                            .querySelectorAll(
                                ".day-pill"
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

                        renderDay(index);

                    }
                );

                container.appendChild(
                    button
                );

            }
        );

}


function renderDay(index) {

    currentDayIndex = index;

    const day =
        itineraryData.days[index];

    renderDayOverview(day);
    renderTimeline(day);
    renderAlternatives(day);
    renderNearbySuggestions(day);
    renderDayMap(day);
    renderTripSummary();
    renderCompletionButton(day);
    refreshDayLiveData(day);

}


function renderDayOverview(day) {

    const score =
        calculateFeasibility(day);

    const date =
        parseISODate(day.date);

    const visitMinutes =
        day.blocks
            .filter(
                block =>
                    block.kind !==
                    "transfer"
            )
            .reduce(
                (sum, block) =>
                    sum +
                    (
                        block.duration_minutes ||
                        0
                    ),
                0
            );

    const lockedCount =
        day.blocks.filter(
            block =>
                block._locked
        ).length;

    const container =
        document.getElementById(
            "day-overview"
        );

    container.innerHTML = `

        <div class="day-title-row">

            <div>
                <div class="day-date">
                    ${date.longLabel}
                </div>

                <h2>
                    ${escapeItineraryHTML(day.title)}
                </h2>

                <div class="day-theme">
                    ${escapeItineraryHTML(day.theme)}
                </div>
            </div>

            <div class="feasibility-score">
                <strong>${score}/100</strong>
                <span>FATTIBILITÀ</span>
            </div>

        </div>

        <div class="day-stats">

            <div class="day-stat">
                <span>GUIDA</span>
                <strong>
                    ${formatMinutes(
                        day.manual_driving_minutes || 0
                    )}
                </strong>
            </div>

            <div class="day-stat">
                <span>ATTIVITÀ / SOSTE</span>
                <strong>
                    ${formatMinutes(
                        visitMinutes
                    )}
                </strong>
            </div>

            <div class="day-stat">
                <span>LUcchetti</span>
                <strong>
                    ${lockedCount} 🔒
                </strong>
            </div>

        </div>

        ${
            day.weather_dependency ===
                "high" ||
            day.weather_dependency ===
                "very_high"
                ? `
                <div class="weather-warning">
                    🌦️ <strong>
                    ${weatherLabel(
                        day.weather_dependency
                    )}
                    </strong>.
                    Il Ricalcolo AI locale non inventa il meteo:
                    quando collegheremo il servizio online userà anche
                    vento, pioggia, mare e traffico reali.
                </div>
                `
                : ""
        }

    `;

}


function dayHasSeaSensitivity(day) {

    const text =
        (
            String(day.title || "") +
            " " +
            String(day.theme || "")
        )
        .toLowerCase();

    if (
        text.includes("mare") ||
        text.includes("snork") ||
        text.includes("oceano") ||
        text.includes("blue bay")
    ) {
        return true;
    }

    return day.blocks.some(
        block => {

            const poi =
                block.poi_id
                    ? poiIndex.get(
                        block.poi_id
                    )
                    : null;

            return poi
                ? isSeaSensitivePOI(
                    poi
                )
                : false;

        }
    );

}


function isSeaSensitivePOI(poi) {

    if (!poi) {
        return false;
    }

    const terms = [
        ...poi.categories,
        ...poi.tags
    ]
    .map(
        item =>
            String(item)
                .toLowerCase()
    );

    return terms.some(
        item =>
            item.includes("beach") ||
            item.includes("sea") ||
            item.includes("ocean") ||
            item.includes("lagoon") ||
            item.includes("snork") ||
            item.includes("surf") ||
            item.includes("kayak") ||
            item.includes("marine")
    );

}


function isOutdoorPOI(poi) {

    if (!poi) {
        return false;
    }

    if (
        poi.type === "adventure"
    ) {
        return true;
    }

    const terms = [
        ...poi.categories,
        ...poi.tags
    ]
    .map(
        item =>
            String(item)
                .toLowerCase()
    );

    return terms.some(
        item =>
            [
                "nature",
                "waterfall",
                "forest",
                "viewpoint",
                "geology",
                "beach",
                "sea",
                "hike",
                "trek"
            ].some(
                keyword =>
                    item.includes(
                        keyword
                    )
            )
    );

}


function getLiveRepresentativePoint(day) {

    const preferSea =
        dayHasSeaSensitivity(
            day
        );

    const poiBlocks =
        day.blocks
            .map(block => {

                const poi =
                    block.poi_id
                        ? poiIndex.get(
                            block.poi_id
                        )
                        : null;

                return {
                    block,
                    poi
                };

            })
            .filter(
                item =>
                    item.poi &&
                    isFiniteCoordinate(
                        item.poi.lat,
                        item.poi.lon
                    )
            );

    if (preferSea) {

        const sea =
            poiBlocks.find(
                item =>
                    isSeaSensitivePOI(
                        item.poi
                    )
            );

        if (sea) {

            return {
                lat:
                    Number(
                        sea.poi.lat
                    ),
                lon:
                    Number(
                        sea.poi.lon
                    ),
                name:
                    sea.poi.name
            };

        }

    }

    const outdoor =
        poiBlocks.find(
            item =>
                isOutdoorPOI(
                    item.poi
                )
        );

    if (outdoor) {

        return {
            lat:
                Number(
                    outdoor.poi.lat
                ),
            lon:
                Number(
                    outdoor.poi.lon
                ),
            name:
                outdoor.poi.name
        };

    }

    const anchors =
        getDayAnchors(day);

    return anchors[0] || null;

}


function staticOpeningAlerts(day) {

    const alerts = [];

    day.blocks.forEach(
        block => {

            if (
                !block.poi_id ||
                !block.time
            ) {
                return;
            }

            const poi =
                poiIndex.get(
                    block.poi_id
                );

            if (!poi) {
                return;
            }

            const opening =
                poi.practical
                    ?.opening;

            const closing =
                poi.practical
                    ?.closing;

            if (
                !opening &&
                !closing
            ) {
                return;
            }

            const blockMinutes =
                timeToMinutes(
                    block.time
                );

            if (
                opening &&
                blockMinutes <
                timeToMinutes(
                    opening
                )
            ) {

                alerts.push(
                    `${poi.name}: previsto alle ${block.time}, apertura DB ${opening}.`
                );

            }

            if (
                closing &&
                blockMinutes >=
                timeToMinutes(
                    closing
                )
            ) {

                alerts.push(
                    `${poi.name}: previsto alle ${block.time}, chiusura DB ${closing}.`
                );

            }

        }
    );

    return alerts;

}


async function refreshDayLiveData(
    day,
    force = false
) {

    const container =
        document.getElementById(
            "live-day-content"
        );

    if (!container) {
        return;
    }

    const token =
        ++liveRequestToken;

    container.className =
        "live-unavailable";

    container.innerHTML =
        navigator.onLine
            ? "Sto leggendo meteo, vento e condizioni marine…"
            : "Sei offline. Provo a usare l'ultimo dato live salvato sul dispositivo.";

    const point =
        getLiveRepresentativePoint(
            day
        );

    if (!point) {

        container.innerHTML =
            "Non trovo una coordinata utile per questa giornata.";

        return;

    }

    try {

        const snapshot =
            await TravelLive
                .getDaySnapshot(
                    point.lat,
                    point.lon,
                    day.date,
                    {
                        includeMarine:
                            dayHasSeaSensitivity(
                                day
                            )
                    }
                );

        if (
            token !==
            liveRequestToken
        ) {
            return;
        }

        currentLiveSnapshot = {
            ...snapshot,
            dayDate:
                day.date,
            point
        };

        renderLiveDayCard(
            day,
            currentLiveSnapshot
        );

    }

    catch (error) {

        console.error(error);

        if (
            token !==
            liveRequestToken
        ) {
            return;
        }

        currentLiveSnapshot = null;

        container.className =
            "live-unavailable";

        container.innerHTML =
            "Dati live non raggiungibili. L'itinerario continua a funzionare offline con 400 POI, priorità e tempi.";

    }

}


function renderLiveDayCard(
    day,
    snapshot
) {

    const container =
        document.getElementById(
            "live-day-content"
        );

    if (!container) {
        return;
    }

    const openingAlerts =
        staticOpeningAlerts(
            day
        );

    if (
        !snapshot.available
    ) {

        container.className =
            "live-unavailable";

        container.innerHTML = `
            <strong>Previsione non ancora disponibile.</strong><br>
            Open-Meteo arriva fino a circa 16 giorni.
            Il ${escapeItineraryHTML(day.date)} verrà analizzato automaticamente quando entrerà nella finestra previsionale.
            ${
                openingAlerts.length
                    ? `<br><br>⏰ ${openingAlerts.length} possibile/i conflitto/i con gli orari salvati nel database.`
                    : ""
            }
        `;

        return;

    }

    const weather =
        snapshot.weather || {};

    const marine =
        snapshot.marine || null;

    const assessment =
        snapshot.assessment;

    const conditionLabel =
        assessment.condition ===
        "good"
            ? "Condizioni favorevoli"
            : assessment.condition ===
                "mixed"
                ? "Condizioni da valutare"
                : "Condizioni sfavorevoli";

    container.className = "";

    container.innerHTML = `
        <div class="live-grid">

            <div class="live-stat">
                <span>METEO</span>
                <strong>
                    ${escapeItineraryHTML(
                        TravelLive.weatherCodeLabel(
                            weather.weather_code
                        )
                    )}
                </strong>
            </div>

            <div class="live-stat">
                <span>PIOGGIA MAX</span>
                <strong>
                    ${weather.precipitation_probability_max ?? "—"}%
                </strong>
            </div>

            <div class="live-stat">
                <span>VENTO MAX</span>
                <strong>
                    ${Math.round(weather.wind_speed_10m_max ?? 0)} km/h
                </strong>
            </div>

            <div class="live-stat">
                <span>RAFFICHE MAX</span>
                <strong>
                    ${Math.round(weather.wind_gusts_10m_max ?? 0)} km/h
                </strong>
            </div>

            ${
                marine
                    ? `
                    <div class="live-stat">
                        <span>ONDA MAX</span>
                        <strong>
                            ${Number(marine.wave_height_max ?? 0).toFixed(1)} m
                        </strong>
                    </div>

                    <div class="live-stat">
                        <span>SWELL MAX</span>
                        <strong>
                            ${Number(marine.swell_wave_height_max ?? 0).toFixed(1)} m
                        </strong>
                    </div>
                    `
                    : ""
            }

            <div class="live-stat">
                <span>ALBA</span>
                <strong>
                    ${TravelLive.timeOnly(weather.sunrise)}
                </strong>
            </div>

            <div class="live-stat">
                <span>TRAMONTO</span>
                <strong>
                    ${TravelLive.timeOnly(weather.sunset)}
                </strong>
            </div>

        </div>

        <div class="live-assessment ${assessment.condition}">
            <strong>${conditionLabel} · ${assessment.score}/100</strong><br>
            ${escapeItineraryHTML(
                assessment.reasons.join(
                    " · "
                )
            )}
            ${
                openingAlerts.length
                    ? `<br>⏰ ${openingAlerts.length} possibile/i conflitto/i con gli orari del database.`
                    : ""
            }
        </div>

        <div class="live-source-note">
            Punto meteo: ${escapeItineraryHTML(snapshot.point.name || "tappa della giornata")}
            ${snapshot.stale ? " · dato cache recente" : ""}
            · Dati previsionali Open-Meteo. Il dato marino è indicativo e non va usato per navigazione.
        </div>
    `;

}


async function renderRecalcLiveContext() {

    const container =
        document.getElementById(
            "recalc-live-context"
        );

    if (!container) {
        return;
    }

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    if (
        currentLiveSnapshot &&
        currentLiveSnapshot
            .dayDate === day.date
    ) {

        renderRecalcSnapshotText(
            currentLiveSnapshot
        );

        return;

    }

    container.textContent =
        "Sto preparando il contesto live della giornata…";

    await refreshDayLiveData(
        day
    );

    if (
        currentLiveSnapshot &&
        currentLiveSnapshot
            .dayDate === day.date
    ) {

        renderRecalcSnapshotText(
            currentLiveSnapshot
        );

    }

    else {

        container.textContent =
            "Il contesto live non è disponibile; puoi comunque usare tutte le modalità offline.";

    }

}


function renderRecalcSnapshotText(
    snapshot
) {

    const container =
        document.getElementById(
            "recalc-live-context"
        );

    if (!container) {
        return;
    }

    if (!snapshot.available) {

        container.innerHTML =
            "🌦️ <strong>Live non ancora disponibile per questa data.</strong> La previsione si attiverà automaticamente quando la giornata entrerà nella finestra di circa 16 giorni.";

        return;

    }

    const assessment =
        snapshot.assessment;

    container.innerHTML = `
        🌦️ <strong>Contesto live pronto:</strong>
        ${escapeItineraryHTML(
            assessment.reasons.join(
                " · "
            )
        )}
        · qualità outdoor ${assessment.score}/100.
        ${
            snapshot.marine
                ? `Onda max ${Number(snapshot.marine.wave_height_max ?? 0).toFixed(1)} m.`
                : ""
        }
    `;

}


async function previewLiveRecalculation() {

    const original =
        itineraryData.days[
            currentDayIndex
        ];

    const result =
        document.getElementById(
            "recalc-result"
        );

    result.innerHTML = `
        <div class="recalc-result">
            <h3>🌦️ Analisi live</h3>
            <p>Sto confrontando il piano con meteo, vento, mare e lucchetti…</p>
        </div>
    `;

    if (
        !currentLiveSnapshot ||
        currentLiveSnapshot
            .dayDate !==
            original.date
    ) {

        await refreshDayLiveData(
            original
        );

    }

    const snapshot =
        currentLiveSnapshot;

    if (
        !snapshot ||
        !snapshot.available
    ) {

        pendingRecalcDay =
            null;

        result.innerHTML = `
            <div class="recalc-result">
                <h3>🌦️ Live non disponibile</h3>
                <p>
                    Questa data è ancora fuori dalla finestra previsionale oppure la rete non è disponibile.
                    Nessuna modifica è stata fatta.
                </p>
            </div>
        `;

        return;

    }

    const assessment =
        snapshot.assessment;

    if (
        assessment.condition ===
        "good"
    ) {

        pendingRecalcDay =
            null;

        result.innerHTML = `
            <div class="recalc-result">
                <h3>✅ Mantieni il piano</h3>
                <p>
                    Le condizioni previste sono compatibili con la giornata:
                    ${escapeItineraryHTML(
                        assessment.reasons.join(
                            " · "
                        )
                    )}.
                </p>
                <p>
                    Nessuna ragione concreta per stravolgere l'itinerario.
                </p>
            </div>
        `;

        return;

    }

    const proposal =
        deepClone(
            original
        );

    const alternative =
        original.alternatives
            ?.find(
                item =>
                    item.poi_id &&
                    poiIndex.has(
                        item.poi_id
                    )
            );

    let removedBlock =
        null;

    const sensitiveIndex =
        proposal.blocks
            .findIndex(
                block => {

                    if (
                        block._locked ||
                        !block.poi_id
                    ) {
                        return false;
                    }

                    const poi =
                        poiIndex.get(
                            block.poi_id
                        );

                    if (!poi) {
                        return false;
                    }

                    if (
                        assessment.badSea &&
                        isSeaSensitivePOI(
                            poi
                        )
                    ) {
                        return true;
                    }

                    if (
                        (
                            assessment.badRain ||
                            assessment.badWind
                        ) &&
                        isOutdoorPOI(
                            poi
                        )
                    ) {
                        return true;
                    }

                    return false;

                }
            );

    if (
        sensitiveIndex >= 0
    ) {

        removedBlock =
            proposal.blocks[
                sensitiveIndex
            ];

        proposal.blocks.splice(
            sensitiveIndex,
            1
        );

    }

    let addedAlternative =
        null;

    if (
        alternative &&
        !proposal.blocks.some(
            block =>
                block.poi_id ===
                alternative.poi_id
        )
    ) {

        const poi =
            poiIndex.get(
                alternative.poi_id
            );

        if (poi) {

            const block =
                buildBlockFromPOI(
                    poi,
                    "Piano B inserito dal Ricalcolo AI live per condizioni meteo/marine."
                );

            proposal.blocks.push(
                block
            );

            addedAlternative =
                poi;

        }

    }

    reflowDayTimes(
        proposal
    );

    proposal._completed =
        false;

    const changed =
        Boolean(
            removedBlock ||
            addedAlternative
        );

    pendingRecalcDay =
        changed
            ? proposal
            : null;

    const reasons =
        assessment.reasons.join(
            " · "
        );

    result.innerHTML = `
        <div class="recalc-result">
            <h3>
                ${assessment.condition === "poor" ? "⚠️" : "🌦️"}
                Ricalcolo live
            </h3>

            <p>
                Motivo: ${escapeItineraryHTML(reasons)}.
            </p>

            ${
                removedBlock
                    ? `<p>Propongo di togliere: <strong>${escapeItineraryHTML(removedBlock.title)}</strong>.</p>`
                    : `<p>Non ho eliminato nessuna tappa: quelle critiche risultano bloccate oppure non sono chiaramente meteo-sensibili.</p>`
            }

            ${
                addedAlternative
                    ? `<p>Propongo come alternativa: <strong>${escapeItineraryHTML(addedAlternative.name)}</strong>.</p>`
                    : ""
            }

            ${
                changed
                    ? `
                    <button
                        id="apply-live-recalc"
                        class="recalc-apply"
                    >
                        Applica proposta live
                    </button>
                    `
                    : ""
            }
        </div>
    `;

    const button =
        document.getElementById(
            "apply-live-recalc"
        );

    if (button) {

        button.addEventListener(
            "click",
            applyPendingRecalculation
        );

    }

}


function renderCompletionButton(day) {

    const button =
        document.getElementById(
            "complete-day"
        );

    if (!button) {
        return;
    }

    if (day._completed) {

        button.classList.add(
            "completed"
        );

        button.innerHTML =
            "✅ Giornata completata";

    }

    else {

        button.classList.remove(
            "completed"
        );

        button.innerHTML =
            "○ Segna giornata come completata";

    }

}


async function toggleDayCompleted() {

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    day._completed =
        !day._completed;

    await persistItinerary();

    renderDaySelector();

    document
        .querySelectorAll(
            ".day-pill"
        )
        .forEach(
            (button, index) => {

                if (
                    index ===
                    currentDayIndex
                ) {
                    button.classList.add(
                        "active"
                    );
                }

            }
        );

    renderDay(
        currentDayIndex
    );

}


function calculateFeasibility(day) {

    let score = 100;

    const engine =
        itineraryData.engine || {};

    const driving =
        day.manual_driving_minutes || 0;

    const buffer =
        day.buffer_minutes || 0;

    const stopCount =
        day.blocks.filter(
            block =>
                block.kind !==
                "transfer"
        ).length;

    if (
        driving >
        (
            engine.driving_warning_minutes ||
            210
        )
    ) {
        score -= 10;
    }

    else if (driving > 170) {
        score -= 5;
    }

    if (stopCount > 7) {
        score -=
            (stopCount - 7) * 3;
    }

    if (
        buffer <
        (
            engine.recommended_buffer_minutes ||
            60
        )
    ) {
        score -= 8;
    }

    if (
        day.weather_dependency ===
        "very_high"
    ) {
        score -= 5;
    }

    else if (
        day.weather_dependency ===
        "high"
    ) {
        score -= 2;
    }

    return Math.max(
        55,
        Math.min(
            100,
            Math.round(score)
        )
    );

}


function renderTimeline(day) {

    const container =
        document.getElementById(
            "timeline"
        );

    container.innerHTML = "";

    day.blocks.forEach(
        (block, blockIndex) => {

            const poi =
                block.poi_id
                    ? poiIndex.get(
                        block.poi_id
                    )
                    : null;

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "timeline-item";

            if (block._locked) {
                item.classList.add(
                    "is-locked"
                );
            }

            const detailURL =
                poi
                    ? `pages/place.html?id=${encodeURIComponent(poi.id)}&type=${encodeURIComponent(poi.type)}`
                    : null;

            const mapsURL =
                poi &&
                isFiniteCoordinate(
                    poi.lat,
                    poi.lon
                )
                    ? googleMapsSearchURL(
                        poi.lat,
                        poi.lon
                    )
                    : null;

            item.innerHTML = `

                <div class="timeline-time">
                    ${escapeItineraryHTML(
                        block.time || ""
                    )}
                </div>

                <div class="timeline-rail">
                    <span class="timeline-dot"></span>
                    <span class="timeline-line"></span>
                </div>

                <div class="timeline-content">

                    <div class="timeline-kind">
                        ${kindLabel(
                            block.kind
                        )}
                    </div>

                    <h3>
                        ${
                            block._locked
                                ? "🔒 "
                                : ""
                        }
                        ${escapeItineraryHTML(
                            block.title ||
                            poi?.name ||
                            ""
                        )}
                    </h3>

                    ${
                        block.description
                            ? `
                            <p>
                                ${escapeItineraryHTML(
                                    block.description
                                )}
                            </p>
                            `
                            : ""
                    }

                    <div class="timeline-meta">
                        ⏱ ${formatMinutes(
                            block.duration_minutes || 0
                        )}
                        ${
                            poi?.veryLocal
                                ? " · 🏘️ Very Local"
                                : ""
                        }
                        ${
                            poi?.priority
                                ? ` · ${poi.priority.icon} ${poi.priority.label}`
                                : ""
                        }
                    </div>

                    <div class="timeline-actions">

                        <button
                            class="mini-action ${
                                block._locked
                                    ? "locked"
                                    : ""
                            }"
                            data-action="lock"
                            data-index="${blockIndex}"
                        >
                            ${
                                block._locked
                                    ? "🔓 Sblocca"
                                    : "🔒 Blocca"
                            }
                        </button>

                        ${
                            blockIndex > 0
                                ? `
                                <button
                                    class="mini-action"
                                    data-action="up"
                                    data-index="${blockIndex}"
                                >
                                    ↑
                                </button>
                                `
                                : ""
                        }

                        ${
                            blockIndex <
                            day.blocks.length - 1
                                ? `
                                <button
                                    class="mini-action"
                                    data-action="down"
                                    data-index="${blockIndex}"
                                >
                                    ↓
                                </button>
                                `
                                : ""
                        }

                        ${
                            detailURL
                                ? `
                                <a
                                    class="mini-action"
                                    href="${detailURL}"
                                >
                                    Scheda
                                </a>
                                `
                                : ""
                        }

                        ${
                            mapsURL
                                ? `
                                <a
                                    class="mini-action"
                                    href="${mapsURL}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    📍 Mappa
                                </a>
                                `
                                : ""
                        }

                        ${
                            !block._locked
                                ? `
                                <button
                                    class="mini-action danger"
                                    data-action="delete"
                                    data-index="${blockIndex}"
                                >
                                    ✕
                                </button>
                                `
                                : ""
                        }

                    </div>

                </div>

            `;

            container.appendChild(
                item
            );

        }
    );

    container
        .querySelectorAll(
            "[data-action]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () =>
                    handleTimelineAction(
                        button.dataset.action,
                        Number(
                            button.dataset.index
                        )
                    )
            );

        });

}


async function handleTimelineAction(
    action,
    index
) {

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    const block =
        day.blocks[index];

    if (!block) {
        return;
    }

    if (action === "lock") {

        block._locked =
            !block._locked;

    }

    if (action === "up") {

        if (index <= 0) {
            return;
        }

        const previous =
            day.blocks[
                index - 1
            ];

        if (
            block._locked ||
            previous._locked
        ) {
            alert(
                "Per spostare una tappa devi prima sbloccare entrambe le tappe coinvolte."
            );
            return;
        }

        [
            day.blocks[index - 1],
            day.blocks[index]
        ] = [
            day.blocks[index],
            day.blocks[index - 1]
        ];

        reflowDayTimes(day);

    }

    if (action === "down") {

        if (
            index >=
            day.blocks.length - 1
        ) {
            return;
        }

        const next =
            day.blocks[
                index + 1
            ];

        if (
            block._locked ||
            next._locked
        ) {
            alert(
                "Per spostare una tappa devi prima sbloccare entrambe le tappe coinvolte."
            );
            return;
        }

        [
            day.blocks[index],
            day.blocks[index + 1]
        ] = [
            day.blocks[index + 1],
            day.blocks[index]
        ];

        reflowDayTimes(day);

    }

    if (action === "delete") {

        if (block._locked) {
            return;
        }

        const ok =
            confirm(
                `Eliminare "${block.title}" dalla giornata?`
            );

        if (!ok) {
            return;
        }

        day.blocks.splice(
            index,
            1
        );

        reflowDayTimes(day);

    }

    await persistItinerary();
    renderDay(
        currentDayIndex
    );

}


function openAddPOIModal() {

    document
        .getElementById(
            "poi-search"
        )
        .value = "";

    renderPOISearchResults(
        ""
    );

    openModal(
        "add-poi-modal"
    );

}


function renderPOISearchResults(
    query
) {

    const normalized =
        String(query || "")
            .trim()
            .toLowerCase();

    const planned =
        new Set(
            itineraryData.days[
                currentDayIndex
            ].blocks
                .map(
                    block =>
                        block.poi_id
                )
                .filter(Boolean)
        );

    const results =
        Array.from(
            poiIndex.values()
        )
        .filter(
            poi =>
                !planned.has(
                    poi.id
                )
        )
        .filter(poi => {

            if (!normalized) {
                return true;
            }

            const haystack = [
                poi.name,
                poi.area,
                ...poi.categories,
                ...poi.tags
            ]
            .join(" ")
            .toLowerCase();

            return haystack.includes(
                normalized
            );

        })
        .sort(
            (a, b) => {

                if (
                    b.priority.weight !==
                    a.priority.weight
                ) {
                    return (
                        b.priority.weight -
                        a.priority.weight
                    );
                }

                if (
                    Number(b.veryLocal) !==
                    Number(a.veryLocal)
                ) {
                    return (
                        Number(b.veryLocal) -
                        Number(a.veryLocal)
                    );
                }

                return a.name.localeCompare(
                    b.name,
                    "it"
                );

            }
        )
        .slice(0, 30);

    const container =
        document.getElementById(
            "poi-results"
        );

    container.innerHTML = "";

    results.forEach(poi => {

        const button =
            document.createElement(
                "button"
            );

        button.className =
            "poi-result";

        button.innerHTML = `
            <strong>
                ${poi.priority.icon}
                ${escapeItineraryHTML(
                    poi.name
                )}
                ${
                    poi.veryLocal
                        ? " · 🏘️"
                        : ""
                }
            </strong>

            <span>
                ${escapeItineraryHTML(
                    poi.area
                )}
                · ${escapeItineraryHTML(
                    poi.type
                )}
                · ${poi.priority.label}
            </span>
        `;

        button.addEventListener(
            "click",
            () => addPOIToCurrentDay(
                poi
            )
        );

        container.appendChild(
            button
        );

    });

}


async function addPOIToCurrentDay(
    poi,
    source = "manual"
) {

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    const alreadyPlanned =
        day.blocks.some(
            block =>
                block.poi_id ===
                poi.id
        );

    if (alreadyPlanned) {

        alert(
            `"${poi.name}" è già presente nella giornata.`
        );

        return;

    }

    const duration =
        getPOIDurationMinutes(
            poi
        );

    let description =
        "Tappa aggiunta manualmente.";

    if (source === "detour") {
        description =
            "Tappa aggiunta dalle deviazioni intelligenti.";
    }

    const newBlock = {
        kind:
            poi.type ===
            "adventure"
                ? "activity"
                : poi.type ===
                "food"
                    ? "meal"
                    : "visit",
        time: "00:00",
        duration_minutes:
            duration,
        poi_id:
            poi.id,
        poi_type:
            poi.type,
        title:
            poi.name,
        description,
        _uid:
            createUID(
                day.date,
                Date.now()
            ),
        _locked:
            false
    };

    ensureFlightConstraint(day);
    ensureBaseConstraint(day);

    const terminalIndex = day.blocks.findIndex(block =>
        block._base_constraint ||
        (block._flight_constraint && PLANNER_FLIGHTS[day.date]?.position === "end")
    );

    if (terminalIndex >= 0) {
        day.blocks.splice(terminalIndex, 0, newBlock);
    }
    else {
        day.blocks.push(newBlock);
    }

    reflowDayTimes(day);

    day._completed = false;

    await persistItinerary();

    closeModal(
        "add-poi-modal"
    );

    renderDay(
        currentDayIndex
    );

}


async function resetCurrentDay() {

    const current =
        itineraryData.days[
            currentDayIndex
        ];

    const original =
        masterItineraryData.days
            .find(
                day =>
                    day.date ===
                    current.date
            );

    if (!original) {
        return;
    }

    const ok =
        confirm(
            "Ripristinare questa giornata al piano originale? Le modifiche del giorno verranno perse."
        );

    if (!ok) {
        return;
    }

    itineraryData.days[
        currentDayIndex
    ] = deepClone(original);

    ensureEditableMetadata();

    await persistItinerary();

    renderDay(
        currentDayIndex
    );

}


function previewRecalculation(
    mode
) {

    if (mode === "live") {

        previewLiveRecalculation();
        return;

    }

    const original =
        itineraryData.days[
            currentDayIndex
        ];

    const proposal =
        deepClone(original);

    let title =
        "";
    let explanation =
        "";
    let changed =
        false;

    if (mode === "balanced") {

        reflowDayTimes(
            proposal
        );

        title =
            "⚖️ Piano riequilibrato";

        explanation =
            "Ho ricalcolato la timeline in sequenza mantenendo tutte le tappe. Nessuna tappa viene eliminata.";

        changed = true;

    }

    if (
        mode === "late30" ||
        mode === "late60"
    ) {

        const minutes =
            mode === "late30"
                ? 30
                : 60;

        const removed =
            recoverDelay(
                proposal,
                minutes
            );

        title =
            `⏱️ Recupero di circa ${minutes} minuti`;

        if (removed.length) {

            explanation =
                "Per recuperare tempo propongo di sacrificare: " +
                removed
                    .map(
                        block =>
                            `"${block.title}"`
                    )
                    .join(", ") +
                ". Le tappe bloccate non sono state toccate.";

        }

        else {

            explanation =
                "Non trovo abbastanza tappe sacrificabili senza toccare i lucchetti. Il piano resta quasi invariato.";

        }

        changed = true;

    }

    if (mode === "tired") {

        const removed =
            recoverDelay(
                proposal,
                90
            );

        proposal.buffer_minutes =
            Math.max(
                proposal.buffer_minutes ||
                0,
                120
            );

        title =
            "😴 Giornata alleggerita";

        explanation =
            removed.length
                ? "Ho ridotto il carico eliminando prima le tappe meno prioritarie e lasciando più margine libero."
                : "Le tappe rimaste sono quasi tutte bloccate o importanti: aumento soprattutto il buffer.";

        changed = true;

    }

    if (
        mode === "local" ||
        mode === "maximize"
    ) {

        const onlyLocal =
            mode === "local";

        const candidate =
            findBestAddableCandidate(
                proposal,
                onlyLocal
            );

        title =
            onlyLocal
                ? "🏘️ Versione più local"
                : "⚡ Versione massimizzata";

        if (candidate) {

            proposal.blocks.push(
                buildBlockFromPOI(
                    candidate,
                    onlyLocal
                        ? "Deviazione Very Local proposta dal Ricalcolo AI."
                        : "Tappa extra proposta dal Ricalcolo AI."
                )
            );

            reflowDayTimes(
                proposal
            );

            explanation =
                `Propongo di aggiungere "${candidate.name}" (${candidate.priority.icon} ${candidate.priority.label}${candidate.veryLocal ? ", Very Local" : ""}).`;

            changed = true;

        }

        else {

            explanation =
                onlyLocal
                    ? "Non trovo un Very Local abbastanza vicino alle tappe della giornata."
                    : "La giornata è già piena oppure non trovo un POI extra sensato nelle vicinanze.";

        }

    }

    pendingRecalcDay =
        changed
            ? proposal
            : null;

    const oldScore =
        calculateFeasibility(
            original
        );

    const newScore =
        changed
            ? calculateFeasibility(
                proposal
            )
            : oldScore;

    const result =
        document.getElementById(
            "recalc-result"
        );

    result.innerHTML = `
        <div class="recalc-result">
            <h3>
                ${escapeItineraryHTML(
                    title
                )}
            </h3>

            <p>
                ${escapeItineraryHTML(
                    explanation
                )}
            </p>

            <p>
                Fattibilità:
                <strong>${oldScore}/100 → ${newScore}/100</strong>
            </p>

            ${
                changed
                    ? `
                    <button
                        id="apply-recalc"
                        class="recalc-apply"
                    >
                        Applica nuovo piano
                    </button>
                    `
                    : ""
            }
        </div>
    `;

    const applyButton =
        document.getElementById(
            "apply-recalc"
        );

    if (applyButton) {

        applyButton.addEventListener(
            "click",
            applyPendingRecalculation
        );

    }

}


async function applyPendingRecalculation() {

    if (!pendingRecalcDay) {
        return;
    }

    itineraryData.days[
        currentDayIndex
    ] = pendingRecalcDay;

    pendingRecalcDay = null;

    ensureEditableMetadata();

    await persistItinerary();

    closeModal(
        "recalc-modal"
    );

    renderDay(
        currentDayIndex
    );

}


function recoverDelay(
    day,
    minutesToRecover
) {

    let recovered = 0;
    const removed = [];

    const candidates =
        day.blocks
            .map(
                (block, index) => ({
                    block,
                    index,
                    sacrifice:
                        sacrificeScore(
                            block
                        )
                })
            )
            .filter(
                item =>
                    !item.block._locked &&
                    ![
                        "arrival",
                        "departure",
                        "hotel",
                        "transfer"
                    ].includes(
                        item.block.kind
                    )
            )
            .sort(
                (a, b) =>
                    a.sacrifice -
                    b.sacrifice
            );

    const indexes =
        new Set();

    for (
        const item of candidates
    ) {

        if (
            recovered >=
            minutesToRecover
        ) {
            break;
        }

        indexes.add(
            item.index
        );

        recovered +=
            Number(
                item.block
                    .duration_minutes
            ) || 0;

        removed.push(
            item.block
        );

    }

    day.blocks =
        day.blocks.filter(
            (_, index) =>
                !indexes.has(index)
        );

    day.buffer_minutes =
        Math.max(
            0,
            (
                day.buffer_minutes ||
                0
            ) +
            recovered -
            minutesToRecover
        );

    reflowDayTimes(day);

    return removed;

}


function sacrificeScore(
    block
) {

    const poi =
        block.poi_id
            ? poiIndex.get(
                block.poi_id
            )
            : null;

    if (!poi) {

        if (
            block.kind === "meal"
        ) {
            return 8;
        }

        if (
            block.kind === "break"
        ) {
            return 4;
        }

        return 10;
    }

    let score =
        poi.priority.weight * 10;

    if (poi.veryLocal) {
        score += 4;
    }

    if (
        poi.priorityLevel ===
        "must-see"
    ) {
        score += 20;
    }

    return score;

}


function findBestAddableCandidate(
    day,
    onlyVeryLocal
) {

    const plannedIDs =
        new Set(
            day.blocks
                .map(
                    block =>
                        block.poi_id
                )
                .filter(Boolean)
        );

    const anchors =
        getDayAnchors(day);

    if (!anchors.length) {
        return null;
    }

    const candidates = [];

    poiIndex.forEach(poi => {

        if (
            plannedIDs.has(poi.id) ||
            !isFiniteCoordinate(
                poi.lat,
                poi.lon
            )
        ) {
            return;
        }

        if (
            onlyVeryLocal &&
            !poi.veryLocal
        ) {
            return;
        }

        let minDistance =
            Infinity;

        anchors.forEach(
            anchor => {

                minDistance =
                    Math.min(
                        minDistance,
                        haversineKM(
                            anchor.lat,
                            anchor.lon,
                            poi.lat,
                            poi.lon
                        )
                    );

            }
        );

        if (
            minDistance > 7
        ) {
            return;
        }

        const score =
            poi.priority.weight * 3 +
            (
                poi.veryLocal
                    ? 5
                    : 0
            ) -
            minDistance * .45;

        candidates.push({
            poi,
            score
        });

    });

    candidates.sort(
        (a, b) =>
            b.score - a.score
    );

    return (
        candidates[0]?.poi ||
        null
    );

}


function buildBlockFromPOI(
    poi,
    description
) {

    return {
        kind:
            poi.type === "adventure"
                ? "activity"
                : poi.type === "food"
                    ? "meal"
                    : "visit",
        time:
            "00:00",
        duration_minutes:
            getPOIDurationMinutes(
                poi
            ),
        poi_id:
            poi.id,
        poi_type:
            poi.type,
        title:
            poi.name,
        description,
        _uid:
            createUID(
                "ai",
                Date.now()
            ),
        _locked:
            false
    };

}


function reflowDayTimes(day) {

    if (!day.blocks.length) {
        return;
    }

    let cursor =
        timeToMinutes(
            day.blocks[0].time ||
            "08:00"
        );

    day.blocks.forEach(
        (block, index) => {

            if (index === 0) {

                cursor =
                    timeToMinutes(
                        block.time ||
                        "08:00"
                    );

            }

            block.time =
                minutesToTime(
                    cursor
                );

            cursor +=
                Number(
                    block.duration_minutes
                ) || 0;

        }
    );

}


function getPOIDurationMinutes(
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
        return 45;
    }

    if (
        poi.type === "adventure"
    ) {
        return 120;
    }

    return 50;

}


function renderAlternatives(day) {

    const container =
        document.getElementById(
            "alternative-list"
        );

    container.innerHTML = "";

    if (
        !Array.isArray(
            day.alternatives
        ) ||
        day.alternatives.length === 0
    ) {

        container.innerHTML = `
            <div class="suggestion-card">
                <strong>Nessun piano B necessario.</strong>
                <p>Giornata semplice o di trasferimento.</p>
            </div>
        `;

        return;

    }

    day.alternatives.forEach(
        alternative => {

            const poi =
                alternative.poi_id
                    ? poiIndex.get(
                        alternative.poi_id
                    )
                    : null;

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "suggestion-card";

            card.innerHTML = `
                <div class="suggestion-top">
                    <strong>
                        ${escapeItineraryHTML(
                            alternative.label
                        )}
                    </strong>

                    ${
                        poi?.veryLocal
                            ? `<span class="detour-time">🏘️ Very Local</span>`
                            : ""
                    }
                </div>

                <p>
                    ${escapeItineraryHTML(
                        alternative.description ||
                        ""
                    )}
                </p>

                ${
                    poi
                        ? `
                        <div class="suggestion-badges">
                            <span class="suggestion-badge">
                                ${poi.priority.icon}
                                ${poi.priority.label}
                            </span>

                            <a
                                class="suggestion-badge"
                                href="pages/place.html?id=${encodeURIComponent(poi.id)}&type=${encodeURIComponent(poi.type)}"
                            >
                                Apri scheda →
                            </a>
                        </div>
                        `
                        : ""
                }
            `;

            container.appendChild(
                card
            );

        }
    );

}


function renderNearbySuggestions(day) {

    const container =
        document.getElementById(
            "nearby-list"
        );

    const plannedIDs =
        new Set(
            day.blocks
                .map(
                    block =>
                        block.poi_id
                )
                .filter(Boolean)
        );

    const anchors =
        getDayAnchors(day);

    if (!anchors.length) {

        container.innerHTML = `
            <div class="suggestion-card">
                <strong>Nessuna deviazione calcolabile.</strong>
            </div>
        `;

        return;

    }

    const radius =
        itineraryData.engine
            ?.nearby_radius_km ||
        7;

    const maxResults =
        itineraryData.engine
            ?.nearby_max_results ||
        8;

    const candidates = [];

    poiIndex.forEach(poi => {

        if (
            plannedIDs.has(poi.id) ||
            !isFiniteCoordinate(
                poi.lat,
                poi.lon
            )
        ) {
            return;
        }

        let minDistance =
            Infinity;

        anchors.forEach(anchor => {

            const distance =
                haversineKM(
                    anchor.lat,
                    anchor.lon,
                    poi.lat,
                    poi.lon
                );

            if (
                distance <
                minDistance
            ) {
                minDistance =
                    distance;
            }

        });

        if (
            minDistance >
            radius
        ) {
            return;
        }

        const priorityWeight =
            poi.priority?.weight ||
            2;

        const localBoost =
            poi.veryLocal
                ? 3.5
                : 0;

        const distancePenalty =
            minDistance * 0.35;

        const score =
            priorityWeight * 2 +
            localBoost -
            distancePenalty;

        candidates.push({
            poi,
            distance:
                minDistance,
            score
        });

    });

    candidates.sort(
        (a, b) =>
            b.score - a.score
    );

    const selected =
        candidates.slice(
            0,
            maxResults
        );

    container.innerHTML = "";

    if (!selected.length) {

        container.innerHTML = `
            <div class="suggestion-card">
                <strong>Nessuna deviazione entro ${radius} km.</strong>
                <p>La giornata è già abbastanza isolata o lineare.</p>
            </div>
        `;

        return;

    }

    selected.forEach(item => {

        const poi =
            item.poi;

        const estimatedDetour =
            estimateOfflineDetourMinutes(
                item.distance
            );

        const card =
            document.createElement(
                "div"
            );

        card.className =
            "suggestion-card";

        card.innerHTML = `
            <div class="suggestion-top">

                <strong>
                    ${escapeItineraryHTML(
                        poi.name
                    )}
                </strong>

                <span class="detour-time">
                    ≈ +${estimatedDetour} min
                </span>

            </div>

            <p>
                ${escapeItineraryHTML(
                    poi.description ||
                    poi.area ||
                    ""
                )}
            </p>

            <div class="suggestion-badges">

                <span class="suggestion-badge">
                    ${poi.priority.icon}
                    ${poi.priority.label}
                </span>

                ${
                    poi.veryLocal
                        ? `
                        <span class="suggestion-badge">
                            🏘️ Very Local
                        </span>
                        `
                        : ""
                }

                <span class="suggestion-badge">
                    ${item.distance.toFixed(1)} km
                </span>

                <a
                    class="suggestion-badge"
                    href="pages/place.html?id=${encodeURIComponent(poi.id)}&type=${encodeURIComponent(poi.type)}"
                >
                    Scheda →
                </a>

                <button
                    class="suggestion-badge add-detour-button"
                    data-add-detour="${escapeItineraryHTML(poi.id)}"
                >
                    ＋ Aggiungi all'itinerario
                </button>

            </div>
        `;

        container.appendChild(
            card
        );

    });

    container
        .querySelectorAll(
            "[data-add-detour]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const poi =
                        poiIndex.get(
                            button.dataset
                                .addDetour
                        );

                    if (!poi) {
                        return;
                    }

                    addPOIToCurrentDay(
                        poi,
                        "detour"
                    );

                }
            );

        });

}


function estimateOfflineDetourMinutes(
    straightDistanceKM
) {

    return Math.max(
        8,
        Math.round(
            6 +
            straightDistanceKM * 3.2
        )
    );

}


function initMap() {

    if (typeof L === "undefined") {
        console.warn("Leaflet non disponibile: itinerario operativo senza mappa.");
        const map = document.getElementById("itinerary-map");
        if (map) {
            map.innerHTML = `<div class="empty-state">🗺️ Mappa non disponibile offline al primo avvio. I comandi dell'itinerario restano attivi.</div>`;
        }
        return;
    }

    itineraryMap =
        L.map(
            "itinerary-map",
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
    .addTo(itineraryMap);

}


function renderDayMap(day) {

    if (!itineraryMap || typeof L === "undefined") {
        return;
    }

    itineraryMapLayers
        .forEach(
            layer =>
                itineraryMap
                    .removeLayer(layer)
        );

    itineraryMapLayers = [];

    const anchors =
        getDayAnchors(day);

    if (!anchors.length) {
        return;
    }

    const coordinates = [];

    anchors.forEach(
        (anchor, index) => {

            coordinates.push(
                [
                    anchor.lat,
                    anchor.lon
                ]
            );

            const marker =
                L.circleMarker(
                    [
                        anchor.lat,
                        anchor.lon
                    ],
                    {
                        radius: 8,
                        weight: 2,
                        color: "#ffffff",
                        fillColor: "#1d1d1f",
                        fillOpacity: 1
                    }
                )
                .addTo(
                    itineraryMap
                );

            marker.bindTooltip(
                `${index + 1}. ${anchor.name}`
            );

            itineraryMapLayers.push(
                marker
            );

        }
    );

    if (
        coordinates.length > 1
    ) {

        const line =
            L.polyline(
                coordinates,
                {
                    weight: 3,
                    opacity: 0.65,
                    dashArray: "8 7"
                }
            )
            .addTo(
                itineraryMap
            );

        itineraryMapLayers.push(
            line
        );

    }

    const bounds =
        L.latLngBounds(
            coordinates
        );

    itineraryMap.fitBounds(
        bounds,
        {
            padding: [25, 25],
            maxZoom: 12
        }
    );

    setTimeout(
        () =>
            itineraryMap
                .invalidateSize(),
        80
    );

}


function getDayAnchors(day) {

    const anchors = [];

    day.blocks.forEach(block => {

        if (block.poi_id) {

            const poi =
                poiIndex.get(
                    block.poi_id
                );

            if (
                poi &&
                isFiniteCoordinate(
                    poi.lat,
                    poi.lon
                )
            ) {

                anchors.push({
                    id: poi.id,
                    name: poi.name,
                    lat: Number(
                        poi.lat
                    ),
                    lon: Number(
                        poi.lon
                    )
                });

            }

            return;
        }

        if (
            block.custom_location &&
            isFiniteCoordinate(
                block.custom_location.lat,
                block.custom_location.lon
            )
        ) {

            anchors.push({
                id: null,
                name:
                    block
                        .custom_location
                        .name ||
                    block.title,
                lat:
                    Number(
                        block
                            .custom_location
                            .lat
                    ),
                lon:
                    Number(
                        block
                            .custom_location
                            .lon
                    )
            });

        }

    });

    return anchors.filter(
        (anchor, index, array) => {

            if (index === 0) {
                return true;
            }

            const previous =
                array[index - 1];

            return !(
                anchor.id &&
                previous.id ===
                anchor.id
            );

        }
    );

}


function openDayDirections() {

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    const anchors =
        getDayAnchors(day);

    if (!anchors.length) {
        return;
    }

    if (anchors.length === 1) {

        window.open(
            googleMapsSearchURL(
                anchors[0].lat,
                anchors[0].lon
            ),
            "_blank"
        );

        return;
    }

    const origin =
        anchors[0];

    const destination =
        anchors[
            anchors.length - 1
        ];

    const middle =
        anchors.slice(
            1,
            -1
        );

    let url =
        "https://www.google.com/maps/dir/?api=1";

    url +=
        "&origin=" +
        encodeURIComponent(
            `${origin.lat},${origin.lon}`
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
                    .slice(0, 8)
                    .map(
                        point =>
                            `${point.lat},${point.lon}`
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


function openModal(id) {

    document
        .getElementById(id)
        .classList.add(
            "open"
        );

}


function closeModal(id) {

    document
        .getElementById(id)
        .classList.remove(
            "open"
        );

}


function createUID(
    prefix,
    value
) {

    return (
        String(prefix) +
        "-" +
        String(value) +
        "-" +
        Math.random()
            .toString(36)
            .slice(2, 8)
    );

}


function timeToMinutes(value) {

    const match =
        String(value)
            .match(
                /^(\d{1,2}):(\d{2})$/
            );

    if (!match) {
        return 8 * 60;
    }

    return (
        Number(match[1]) * 60 +
        Number(match[2])
    );

}


function minutesToTime(value) {

    const normalized =
        (
            Number(value) %
            1440 +
            1440
        ) % 1440;

    const hours =
        Math.floor(
            normalized / 60
        );

    const minutes =
        normalized % 60;

    return (
        String(hours)
            .padStart(2, "0") +
        ":" +
        String(minutes)
            .padStart(2, "0")
    );

}


function googleMapsSearchURL(
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


function haversineKM(
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


function isFiniteCoordinate(
    lat,
    lon
) {

    return (
        Number.isFinite(
            Number(lat)
        ) &&
        Number.isFinite(
            Number(lon)
        )
    );

}


function formatMinutes(minutes) {

    const value =
        Number(minutes) || 0;

    if (value < 60) {
        return value + " min";
    }

    const hours =
        Math.floor(
            value / 60
        );

    const remainder =
        value % 60;

    if (!remainder) {
        return hours + " h";
    }

    return (
        hours +
        " h " +
        remainder +
        " min"
    );

}


function kindLabel(kind) {

    const labels = {
        arrival: "Arrivo",
        departure: "Partenza",
        transfer: "Trasferimento",
        visit: "Visita",
        activity: "Attività",
        meal: "Food",
        hotel: "Hotel / Relax",
        break: "Pausa"
    };

    return (
        labels[kind] ||
        kind ||
        "Tappa"
    );

}


function weatherLabel(level) {

    const labels = {
        low:
            "Bassa dipendenza dal meteo",
        medium:
            "Dipendenza moderata dal meteo",
        high:
            "Alta dipendenza dal meteo",
        very_high:
            "Dipendenza molto alta dal meteo"
    };

    return (
        labels[level] ||
        level
    );

}


function parseISODate(value) {

    const parts =
        value.split("-")
            .map(Number);

    const date =
        new Date(
            parts[0],
            parts[1] - 1,
            parts[2]
        );

    const dayName =
        new Intl.DateTimeFormat(
            "it-IT",
            {
                weekday: "short"
            }
        )
        .format(date)
        .replace(".", "");

    const longLabel =
        new Intl.DateTimeFormat(
            "it-IT",
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        )
        .format(date);

    return {
        dayName:
            dayName
                .charAt(0)
                .toUpperCase() +
            dayName.slice(1),
        dayNumber:
            parts[2],
        longLabel
    };

}


function deepClone(value) {

    return JSON.parse(
        JSON.stringify(value)
    );

}


function escapeItineraryHTML(value) {

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


// ================= SMART PLANNER V1.2 =================

// ======================================================
// TRAVEL EXPLORER - SMART PLANNER V1
// Pre-partenza + libreria giornate + ricalcolo spostamenti
// Mantiene itinerary.js / live-data.js come motore base.
// ======================================================

const PLANNER_TEMPLATE_PATH = "data/route-templates.json";
const PLANNER_USER_LIBRARY_KEY = "mauritius-2026-user-day-templates-v1";
const PLANNER_TEMPLATE_ADDITIONS_KEY = "mauritius-2026-template-additions-v1";
const PLANNER_DIARY_KEY = "mauritius-2026-diary";
const PLANNER_EXPENSES_KEY = "mauritius-2026-expenses";
const PLANNER_BUDGET_SETTINGS_KEY = "mauritius-2026-budget-settings";

const PLANNER_AIRPORT = {
    name: "Sir Seewoosagur Ramgoolam International Airport",
    lat: -20.4302,
    lon: 57.6836
};

const PLANNER_BASE = {
    id: "veranda-tamarin",
    name: "Veranda Tamarin",
    lat: -20.327,
    lon: 57.381
};

const PLANNER_FLIGHTS = {
    "2026-09-13": {
        position: "start",
        time: "05:40",
        title: "✈️ Arrivo volo a Mauritius",
        description: "Vincolo fisso: arrivo previsto alle 05:40. Tutto il resto della giornata resta modificabile.",
        location: PLANNER_AIRPORT
    },
    "2026-09-20": {
        position: "end",
        time: "10:00",
        title: "✈️ Partenza volo",
        description: "Vincolo fisso: volo previsto alle 10:00. Le attività precedenti restano modificabili purché compatibili con aeroporto e riconsegna auto.",
        location: PLANNER_AIRPORT
    }
};

const PLANNER_THEME_META = {
    sea: {
        label: "🌊 Mare / Relax",
        interest: { sea: 1.15, relax: 0.95, photography: 0.25 },
        keywords: ["mare", "spiaggia", "snorkel", "laguna", "beach", "ocean", "relax", "swim"]
    },
    trekking: {
        label: "🥾 Trekking",
        interest: { adventure: 1.0, nature: 0.55, geology: 0.25 },
        keywords: ["trek", "hike", "sentiero", "trail", "cascad", "mountain", "brabant"]
    },
    nature: {
        label: "🌿 Natura",
        interest: { nature: 1.2, photography: 0.25, relax: 0.15 },
        keywords: ["natura", "forest", "park", "waterfall", "cascat", "gorge", "botanic", "island"]
    },
    geology: {
        label: "🪨 Geologia",
        interest: { geology: 1.45, nature: 0.3, photography: 0.15 },
        keywords: ["geolog", "vulcan", "crater", "lava", "coloured earth", "roche", "cliff", "cave"]
    },
    culture: {
        label: "🏛️ Cultura / Storia",
        interest: { culture: 1.1, history: 1.05, photography: 0.15 },
        keywords: ["cultura", "storia", "museum", "museo", "temple", "tempio", "unesco", "heritage", "church", "mosque"]
    },
    food: {
        label: "🍛 Food / Street food",
        interest: { food: 1.4, culture: 0.3 },
        keywords: ["food", "restaurant", "market", "mercato", "street", "cafe", "café", "rum", "tea", "bakery", "bistro"]
    },
    photography: {
        label: "📸 Fotografia",
        interest: { photography: 1.35, nature: 0.25 },
        keywords: ["viewpoint", "panorama", "sunset", "tramonto", "photography", "photo", "lookout"]
    },
    adventure: {
        label: "🧗 Avventura",
        interest: { adventure: 1.45, nature: 0.2 },
        keywords: ["adventure", "zipline", "quad", "kayak", "surf", "diving", "snorkel", "safari", "canyon"]
    },
    local: {
        label: "💎 Very Local",
        interest: { culture: 0.4, food: 0.35 },
        keywords: ["local", "village", "market", "mercato", "street"],
        veryLocal: true
    },
    market: {
        label: "🛍️ Mercati / Shopping",
        interest: { food: 0.55, culture: 0.5 },
        keywords: ["market", "mercato", "shopping", "mall", "boutique", "craft", "souvenir"]
    },
    experience: {
        label: "🍹 Rum / Tè / Esperienze",
        interest: { food: 0.65, culture: 0.55, history: 0.2 },
        keywords: ["rum", "rhumerie", "tea", "tè", "distillery", "factory", "plantation", "cooking", "experience"]
    }
};

const PLANNER_ZONE_META = {
    west: {
        label: "Ovest / Tamarin",
        patterns: ["ovest", "tamarin", "black river", "flic en flac", "cascavelle"]
    },
    southwest: {
        label: "Sud-Ovest / Le Morne-Chamarel",
        patterns: ["sud-ovest", "le morne", "chamarel", "baie du cap", "la gaulette"]
    },
    south: {
        label: "Sud / Souillac-Gris Gris",
        patterns: ["sud -", "souillac", "gris gris", "riambel", "bel ombre", "chamouny"]
    },
    southeast: {
        label: "Sud-Est / Mahébourg-Blue Bay",
        patterns: ["sud-est", "mahébourg", "mahebourg", "blue bay", "pointe d'esny", "aigrettes"]
    },
    east: {
        label: "Est / Flacq-Belle Mare",
        patterns: ["est -", "flacq", "belle mare", "trou d'eau douce", "palmar", "poste de flacq"]
    },
    north: {
        label: "Nord / Grand Baie-Cap Malheureux",
        patterns: ["nord", "grand baie", "cap malheureux", "grand gaube", "pamplemousses"]
    },
    portlouis: {
        label: "Port Louis / Centro-Nord",
        patterns: ["port louis", "moka", "beau bassin", "rose hill"]
    },
    center: {
        label: "Centro / Ganga Talao-Curepipe",
        patterns: ["centro", "curepipe", "vacoas", "ganga talao", "grand bassin", "bois chéri", "bois cheri", "plaines wilhems"]
    }
};

const PLANNER_INTENSITY = {
    relaxed: {
        label: "Rilassata",
        maxStops: 3,
        maxVisitMinutes: 330,
        maxDrivingMinutes: 150
    },
    balanced: {
        label: "Equilibrata",
        maxStops: 5,
        maxVisitMinutes: 450,
        maxDrivingMinutes: 210
    },
    intense: {
        label: "Intensa",
        maxStops: 7,
        maxVisitMinutes: 570,
        maxDrivingMinutes: 280
    }
};

let plannerTemplates = [];
let plannerUserTemplates = [];
let plannerRawPOIs = new Map();
let plannerThemeWeights = {};
let plannerSelectedZones = new Set();
let plannerPendingProposal = null;
let plannerPendingOptimizedDay = null;
let plannerRouteCache = new Map();
let plannerReady = false;
let plannerOriginalRenderDay = null;
let plannerOriginalHandleTimelineAction = null;
let plannerActiveView = "smart";
let plannerSmartMap = null;
let plannerSmartMapLayer = null;
let plannerSmartMapRenderToken = 0;


document.addEventListener("DOMContentLoaded", () => {
    waitForPlannerEngine();
});


async function waitForPlannerEngine() {

    let attempts = 0;

    while (attempts < 140) {
        attempts++;

        if (
            typeof itineraryData !== "undefined" &&
            itineraryData &&
            Array.isArray(itineraryData.days) &&
            typeof persistItinerary === "function" &&
            typeof renderDay === "function" &&
            typeof TravelStore !== "undefined"
        ) {
            await initSmartPlanner();
            return;
        }

        await plannerDelay(100);
    }

    console.error("Smart Planner: motore itinerario non pronto.");
}


async function initSmartPlanner() {

    await Promise.all([
        loadPlannerPOIs(),
        loadPlannerTemplates(),
        loadPlannerUserTemplates()
    ]);

    migratePlannerDays();
    hookPlannerEngine();
    bindPlannerUI();
    hookDiaryCompletionPlanner();

    plannerReady = true;

    await persistItinerary();

    applyPlannerInitialView();

    // La migrazione aggiunge i vincoli strutturali (es. rientro Veranda).
    // Renderizziamo una volta dopo la migrazione così sono visibili subito.
    renderDay(currentDayIndex);
    augmentTimelineActions();
    refreshPlannerUI();
}


async function loadPlannerPOIs() {

    const files = [
        ["place", "data/places.json"],
        ["culture", "data/culture.json"],
        ["food", "data/food.json"],
        ["adventure", "data/adventure.json"]
    ];

    const results = await Promise.allSettled(
        files.map(async ([type, url]) => {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`${url}: HTTP ${response.status}`);
            }
            const data = await response.json();
            return [type, Array.isArray(data) ? data : []];
        })
    );

    plannerRawPOIs.clear();

    results.forEach(result => {
        if (result.status !== "fulfilled") {
            console.warn(result.reason);
            return;
        }

        const [type, items] = result.value;

        items.forEach(raw => {
            const coordinates = raw.coordinates || {};
            plannerRawPOIs.set(raw.id, {
                ...raw,
                type,
                lat: coordinates.lat ?? raw.lat,
                lon: coordinates.lon ?? coordinates.lng ?? raw.lon ?? raw.lng,
                name: raw.name || raw.nome || raw.id,
                area: raw.area || raw.zona || "",
                categories: Array.isArray(raw.categories) ? raw.categories : [],
                tags: Array.isArray(raw.tags) ? raw.tags : [],
                interest: raw.interest || {},
                practical: raw.practical || {},
                veryLocal: raw.very_local === true || raw.veryLocal === true,
                priorityLevel: raw.priority?.level || "very-interesting",
                priorityScore: Number(raw.priority?.score || 2),
                priorityLabel: raw.priority?.label || ""
            });
        });
    });
}


async function loadPlannerTemplates() {
    try {
        const response = await fetch(PLANNER_TEMPLATE_PATH, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`route-templates: HTTP ${response.status}`);
        }
        const data = await response.json();
        plannerTemplates = Array.isArray(data.templates) ? data.templates : [];
    }
    catch (error) {
        console.error("Errore template Smart Planner:", error);
        plannerTemplates = [];
    }
}


async function loadPlannerUserTemplates() {
    try {
        const saved = await TravelStore.get(PLANNER_USER_LIBRARY_KEY);
        plannerUserTemplates = Array.isArray(saved) ? saved : [];
    }
    catch (error) {
        console.error("Errore libreria personale:", error);
        plannerUserTemplates = [];
    }
}


async function savePlannerUserTemplates() {
    await TravelStore.set(PLANNER_USER_LIBRARY_KEY, plannerUserTemplates);
}


function migratePlannerDays() {

    itineraryData.days.forEach(day => {
        ensurePlannerProfile(day);
        ensureFlightConstraint(day);
        ensureBaseConstraint(day);
    });

    // Anche il master viene adattato solo in memoria, così Ripristina giorno
    // mantiene i vincoli di volo corretti.
    if (masterItineraryData?.days) {
        masterItineraryData.days.forEach(day => {
            ensurePlannerProfile(day);
            ensureFlightConstraint(day);
            ensureBaseConstraint(day);
        });
    }
}


function ensurePlannerProfile(day) {

    if (!day._planner || typeof day._planner !== "object") {
        day._planner = {};
    }

    const defaults = plannerDefaultTimes(day.date);

    const previousPlannerVersion = Number(day._planner.version || 0);

    day._planner.startTime = day._planner.startTime || defaults.start;
    day._planner.endTime = day._planner.endTime || day.target_end || defaults.end;

    // Migrazione V1.2.2: il 20 settembre l'orario del planner indica
    // l'arrivo consigliato in aeroporto, non l'orario del volo.
    if (
        day.date === "2026-09-20" &&
        previousPlannerVersion < 2 &&
        timeToMinutes(day._planner.endTime || "10:00") > timeToMinutes("07:15")
    ) {
        day._planner.endTime = "07:00";
    }

    day._planner.intensity = day._planner.intensity || "balanced";
    day._planner.constraints = day._planner.constraints || "";
    day._planner.themeWeights = day._planner.themeWeights || inferThemeWeightsFromDay(day);
    day._planner.zones = Array.isArray(day._planner.zones) ? day._planner.zones : inferZonesFromDay(day);
    day._planner.version = 2;
}


function plannerDefaultTimes(date) {
    if (date === "2026-09-13") {
        return { start: "05:40", end: "18:00" };
    }
    if (date === "2026-09-20") {
        return { start: "05:30", end: "07:00" };
    }
    return { start: "08:00", end: "18:00" };
}


function ensureFlightConstraint(day) {

    const config = PLANNER_FLIGHTS[day.date];
    if (!config) {
        return;
    }

    if (!Array.isArray(day.blocks)) {
        day.blocks = [];
    }

    // Migra il vecchio blocco generico in una parte modificabile,
    // separandolo dal solo orario del volo che invece resta fisso.
    if (day.date === "2026-09-13") {
        const oldArrival = day.blocks.find(
            block => block.kind === "arrival" && !block._flight_constraint
        );

        if (oldArrival) {
            oldArrival.kind = "arrival_process";
            oldArrival.title = "Bagagli, immigrazione e ritiro auto";
            oldArrival.time = "05:50";
            oldArrival.description = "Blocco modificabile: tempi di uscita dall'aeroporto e ritiro auto.";
            oldArrival._locked = false;
        }
    }

    if (day.date === "2026-09-20") {
        const oldDeparture = day.blocks.find(
            block => block.kind === "departure" && !block._flight_constraint
        );

        if (oldDeparture) {
            oldDeparture.kind = "airport_process";
            oldDeparture.title = "Riconsegna auto + procedure aeroporto";
            oldDeparture.duration_minutes = Math.min(
                Number(oldDeparture.duration_minutes || 165),
                165
            );
            oldDeparture.description = "Blocco modificabile. Il solo orario del volo alle 10:00 resta fisso.";
            oldDeparture._locked = false;
        }
    }

    let flight = day.blocks.find(block => block._flight_constraint === true);

    if (!flight) {
        flight = {
            kind: "flight_constraint",
            time: config.time,
            duration_minutes: 0,
            title: config.title,
            description: config.description,
            custom_location: {
                name: config.location.name,
                lat: config.location.lat,
                lon: config.location.lon
            },
            _uid: `flight-${day.date}`,
            _locked: true,
            _flight_constraint: true,
            _planner_fixed_time: config.time
        };

        if (config.position === "start") {
            day.blocks.unshift(flight);
        }
        else {
            day.blocks.push(flight);
        }
    }

    flight.time = config.time;
    flight._planner_fixed_time = config.time;
    flight._flight_constraint = true;
    flight._locked = true;
    flight.title = config.title;
    flight.description = config.description;
    flight.custom_location = {
        name: config.location.name,
        lat: config.location.lat,
        lon: config.location.lon
    };

    // Il volo non può essere spostato per errore.
    day.blocks = day.blocks.filter((block, index, array) => {
        if (!block._flight_constraint) {
            return true;
        }
        return array.indexOf(block) === index;
    });

    const index = day.blocks.indexOf(flight);
    if (config.position === "start" && index !== 0) {
        day.blocks.splice(index, 1);
        day.blocks.unshift(flight);
    }
    if (config.position === "end" && index !== day.blocks.length - 1) {
        day.blocks.splice(index, 1);
        day.blocks.push(flight);
    }
}


function ensureBaseConstraint(day) {

    if (!day || !Array.isArray(day.blocks)) {
        return;
    }

    // Dal 13 al 19 settembre il rientro a Veranda Tamarin è una
    // tappa finale strutturale della giornata, non una semplice preferenza.
    // Il 20 settembre la destinazione finale resta invece l'aeroporto.
    const hasFixedHotelReturn =
        day.date >= "2026-09-13" &&
        day.date <= "2026-09-19";

    // Rimuove eventuali vecchi duplicati creati durante precedenti ricalcoli.
    const existing = day.blocks.filter(block => block._base_constraint === true);

    if (!hasFixedHotelReturn) {
        if (existing.length) {
            day.blocks = day.blocks.filter(block => !block._base_constraint);
        }
        return;
    }

    let base = existing[0];

    if (!base) {
        base = {
            kind: "hotel",
            time: day._planner?.lastEndTime || day._planner?.endTime || day.target_end || "18:00",
            duration_minutes: 0,
            title: "Rientro a Veranda Tamarin",
            description: "Tappa finale fissa: la giornata termina sempre al Veranda Tamarin.",
            custom_location: {
                name: PLANNER_BASE.name,
                lat: PLANNER_BASE.lat,
                lon: PLANNER_BASE.lon
            },
            _uid: `base-return-${day.date}`,
            _locked: true,
            _base_constraint: true
        };
    }

    base.kind = "hotel";
    base.duration_minutes = 0;
    base.title = "Rientro a Veranda Tamarin";
    base.description = "Tappa finale fissa: la giornata termina sempre al Veranda Tamarin.";
    base.custom_location = {
        name: PLANNER_BASE.name,
        lat: PLANNER_BASE.lat,
        lon: PLANNER_BASE.lon
    };
    base._uid = `base-return-${day.date}`;
    base._locked = true;
    base._base_constraint = true;

    // Conserva un solo blocco hotel fisso e lo mette sempre in fondo.
    day.blocks = day.blocks.filter(block => !block._base_constraint);
    day.blocks.push(base);
}


function hookPlannerEngine() {

    if (!plannerOriginalRenderDay) {
        plannerOriginalRenderDay = renderDay;

        renderDay = function(index) {
            plannerOriginalRenderDay(index);
            if (plannerReady) {
                setTimeout(() => {
                    ensureFlightConstraint(itineraryData.days[currentDayIndex]);
                    ensureBaseConstraint(itineraryData.days[currentDayIndex]);
                    augmentTimelineActions();
                    refreshPlannerUI();
                }, 0);
            }
        };
    }

    if (!plannerOriginalHandleTimelineAction) {
        plannerOriginalHandleTimelineAction = handleTimelineAction;

        handleTimelineAction = async function(action, index) {
            const day = itineraryData.days[currentDayIndex];
            const block = day?.blocks?.[index];

            if (block?._flight_constraint) {
                alert("L'orario del volo è un vincolo fisso. Puoi modificare tutto il resto della giornata.");
                return;
            }

            if (block?._base_constraint) {
                alert("Il rientro a Veranda Tamarin è una tappa finale fissa della giornata.");
                return;
            }

            await plannerOriginalHandleTimelineAction(action, index);
        };
    }
}


function bindPlannerUI() {

    document.querySelectorAll("[data-planner-theme]").forEach(button => {
        button.addEventListener("click", () => cyclePlannerTheme(button.dataset.plannerTheme));
    });

    document.querySelectorAll("[data-planner-zone]").forEach(button => {
        button.addEventListener("click", () => togglePlannerZone(button.dataset.plannerZone));
    });

    document.querySelectorAll("[data-planner-view]").forEach(button => {
        button.addEventListener("click", () => setPlannerView(button.dataset.plannerView, true));
    });

    document.getElementById("planner-edit-in-smart")?.addEventListener("click", () => setPlannerView("smart", true));

    document.getElementById("planner-generate")?.addEventListener("click", createPlannerProposal);
    document.getElementById("planner-open-library")?.addEventListener("click", openPlannerLibrary);
    document.getElementById("planner-recalculate")?.addEventListener("click", recalculateCurrentPlannerDay);
    document.getElementById("planner-optimize")?.addEventListener("click", optimizeCurrentPlannerDay);
    document.getElementById("planner-save")?.addEventListener("click", openSavePlannerDayModal);
    document.getElementById("planner-confirm-save")?.addEventListener("click", saveCurrentDayToLibrary);
    document.getElementById("planner-edit-save")?.addEventListener("click", savePlannerBlockEdit);
    document.getElementById("planner-apply-optimization")?.addEventListener("click", applyPlannerOptimization);

    ["planner-start", "planner-end", "planner-intensity", "planner-constraints"].forEach(id => {
        const element = document.getElementById(id);
        if (!element) {
            return;
        }
        element.addEventListener("change", saveCurrentPlannerProfileFromUI);
        element.addEventListener("blur", saveCurrentPlannerProfileFromUI);
    });

    document.querySelectorAll("[data-close-planner-modal]").forEach(button => {
        button.addEventListener("click", () => closePlannerModal(button.dataset.closePlannerModal));
    });

    document.querySelectorAll(".planner-modal-backdrop").forEach(backdrop => {
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                backdrop.classList.remove("open");
            }
        });
    });
}


function refreshPlannerUI() {

    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    ensurePlannerProfile(day);
    ensureFlightConstraint(day);

    plannerThemeWeights = { ...day._planner.themeWeights };
    plannerSelectedZones = new Set(day._planner.zones || []);

    const start = document.getElementById("planner-start");
    const end = document.getElementById("planner-end");
    const intensity = document.getElementById("planner-intensity");
    const constraints = document.getElementById("planner-constraints");
    const dayLabel = document.getElementById("planner-current-day-label");
    const flightNote = document.getElementById("planner-flight-note");
    const endLabel = document.getElementById("planner-end-label");

    if (start) start.value = day._planner.startTime;
    if (end) end.value = day._planner.endTime;

    if (endLabel) {
        endLabel.textContent = day.date === "2026-09-20"
            ? "Arrivo consigliato in aeroporto"
            : "Rientro a Veranda Tamarin";
    }
    if (intensity) intensity.value = day._planner.intensity;
    if (constraints) constraints.value = day._planner.constraints || "";

    if (dayLabel) {
        dayLabel.textContent = `${formatPlannerDate(day.date)} · ${day.title || "Giornata"}`;
    }

    if (flightNote) {
        const flight = PLANNER_FLIGHTS[day.date];

        if (day.date === "2026-09-13") {
            flightNote.innerHTML =
                `<strong>✈️ Vincolo volo:</strong> arrivo alle ${flight.time}. La giornata parte dall'aeroporto e termina a <strong>Veranda Tamarin</strong>.`;
        }
        else if (day.date === "2026-09-20") {
            flightNote.innerHTML =
                `<strong>✈️ Vincolo volo:</strong> partenza alle ${flight.time}. Obiettivo logistico: essere in aeroporto entro circa <strong>07:00</strong>, includendo riconsegna auto, bagagli e controlli.`;
        }
        else {
            flightNote.innerHTML =
                `🏨 <strong>Base fissa:</strong> partenza e rientro a <strong>Veranda Tamarin</strong>.`;
        }
    }

    renderPlannerThemeButtons();
    renderPlannerZoneButtons();
    renderPlannerDayHealth(day);
    decoratePlannerDetailLinks();
    renderPlannerWorkingTimeline();
    renderPlannerRouteMap();
}



function applyPlannerInitialView() {

    const params = new URLSearchParams(window.location.search);
    const requestedDay = params.get("day");
    const requestedView = params.get("view") === "final" ? "final" : "smart";

    if (requestedDay) {
        const dayIndex = itineraryData.days.findIndex(day => day.date === requestedDay);
        if (dayIndex >= 0 && dayIndex !== currentDayIndex) {
            renderDay(dayIndex);
        }
    }

    setPlannerView(requestedView, false);
}


function setPlannerView(view, updateURL = false) {

    plannerActiveView = view === "final" ? "final" : "smart";

    const smart = document.getElementById("planner-smart-view");
    const final = document.getElementById("planner-final-view");

    if (smart) {
        smart.hidden = plannerActiveView !== "smart";
    }

    if (final) {
        final.hidden = plannerActiveView !== "final";
    }

    document.querySelectorAll("[data-planner-view]").forEach(button => {
        const active = button.dataset.plannerView === plannerActiveView;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (updateURL) {
        const params = new URLSearchParams(window.location.search);
        params.set("view", plannerActiveView);

        const day = itineraryData.days[currentDayIndex];
        if (day?.date) {
            params.set("day", day.date);
        }

        history.replaceState(
            null,
            "",
            `${window.location.pathname}?${params.toString()}`
        );
    }

    if (plannerActiveView === "smart") {
        setTimeout(() => {
            renderPlannerWorkingTimeline();
            renderPlannerRouteMap();
            plannerSmartMap?.invalidateSize();
        }, 40);
    }
    else {
        decoratePlannerDetailLinks();
        setTimeout(() => {
            if (typeof itineraryMap !== "undefined" && itineraryMap?.invalidateSize) {
                itineraryMap.invalidateSize();
            }
        }, 40);
    }
}


function plannerReturnTarget(view = "smart") {
    const day = itineraryData.days[currentDayIndex];
    const params = new URLSearchParams();
    params.set("view", view);
    if (day?.date) {
        params.set("day", day.date);
    }
    return `../itinerary.html?${params.toString()}`;
}


function plannerPlaceURL(poi, view = "smart") {
    const params = new URLSearchParams();
    params.set("id", poi.id);
    params.set("type", poi.type || "place");
    params.set("returnTo", plannerReturnTarget(view));
    return `pages/place.html?${params.toString()}`;
}


function decoratePlannerDetailLinks() {

    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    document.querySelectorAll("#timeline a[href*='pages/place.html']").forEach(link => {
        try {
            const url = new URL(link.getAttribute("href"), window.location.href);
            url.searchParams.set("returnTo", plannerReturnTarget("final"));
            link.setAttribute("href", `${url.pathname.split("/").slice(-2).join("/")}?${url.searchParams.toString()}`);
        }
        catch (_) {}
    });
}


function renderPlannerWorkingTimeline() {

    const source = document.getElementById("timeline");
    const target = document.getElementById("planner-working-timeline");

    if (!source || !target) {
        return;
    }

    target.innerHTML = source.innerHTML;

    target.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => {
            handleTimelineAction(
                button.dataset.action,
                Number(button.dataset.index)
            );
        });
    });

    target.querySelectorAll("[data-planner-edit-index]").forEach(button => {
        button.addEventListener("click", () => {
            openPlannerBlockEdit(Number(button.dataset.plannerEditIndex));
        });
    });

    target.querySelectorAll("[data-planner-move-index]").forEach(button => {
        button.addEventListener("click", () => {
            openPlannerBlockEdit(Number(button.dataset.plannerMoveIndex), true);
        });
    });

    target.querySelectorAll("a[href*='pages/place.html']").forEach(link => {
        try {
            const url = new URL(link.getAttribute("href"), window.location.href);
            url.searchParams.set("returnTo", plannerReturnTarget("smart"));
            link.setAttribute("href", `${url.pathname.split("/").slice(-2).join("/")}?${url.searchParams.toString()}`);
        }
        catch (_) {}
    });

    if (!target.children.length) {
        target.innerHTML = `<div class="planner-empty">Nessuna tappa nella giornata. Usa “Proponi giornata”, la Libreria oppure “Aggiungi tappa”.</div>`;
    }
}


async function renderPlannerRouteMap() {

    const container = document.getElementById("planner-route-map");
    if (!container || typeof L === "undefined") {
        return;
    }

    if (!plannerSmartMap) {
        plannerSmartMap = L.map(container, {
            zoomControl: true
        }).setView([-20.25, 57.52], 10);

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap"
            }
        ).addTo(plannerSmartMap);

        plannerSmartMapLayer = L.layerGroup().addTo(plannerSmartMap);
    }

    plannerSmartMapLayer.clearLayers();

    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    const usingProposal =
        plannerPendingProposal &&
        plannerPendingProposal.dayDate === day.date;

    const blocks = usingProposal
        ? plannerPendingProposal.blocks
        : day.blocks.filter(block => block.kind !== "transfer");

    const locations = [];
    const startLocation = plannerStartingLocation(day.date);
    const endLocation = plannerEndingLocation(day.date);

    if (startLocation && plannerHasCoordinates(startLocation)) {
        locations.push(startLocation);
    }

    blocks.forEach(block => {
        const location = plannerBlockLocation(block);
        if (
            location &&
            plannerHasCoordinates(location) &&
            !locations.some(existing => plannerSameLocation(existing, location))
        ) {
            locations.push(location);
        }
    });

    if (
        endLocation &&
        plannerHasCoordinates(endLocation) &&
        !locations.some(existing => plannerSameLocation(existing, endLocation))
    ) {
        locations.push(endLocation);
    }

    const note = document.getElementById("planner-map-note");
    if (note) {
        const destinationText = day.date === "2026-09-20"
            ? "arrivo finale in aeroporto"
            : "rientro finale a Veranda Tamarin";

        note.textContent = usingProposal
            ? `Anteprima del percorso proposto · ${destinationText}`
            : `Percorso della giornata · ${destinationText}`;
    }

    if (!locations.length) {
        plannerSmartMap.setView([-20.25, 57.52], 10);
        return;
    }

    locations.forEach((location, index) => {
        const marker = L.marker([location.lat, location.lon]).addTo(plannerSmartMapLayer);

        const isStart = index === 0;
        const isEnd =
            index === locations.length - 1 &&
            endLocation &&
            plannerSameLocation(location, endLocation);

        let role = `${index}`;

        if (isStart && isEnd) {
            role = "Partenza / rientro";
        }
        else if (isStart) {
            role = "Partenza";
        }
        else if (isEnd) {
            role = day.date === "2026-09-20"
                ? "Arrivo aeroporto"
                : "Rientro";
        }

        marker.bindPopup(
            `<strong>${escapePlanner(role)}. ${escapePlanner(location.name || "Tappa")}</strong>`
        );
    });

    const bounds = L.latLngBounds(
        locations.map(location => [location.lat, location.lon])
    );

    if (locations.length === 1) {
        plannerSmartMap.setView([locations[0].lat, locations[0].lon], 13);
    }
    else {
        plannerSmartMap.fitBounds(bounds.pad(0.18));
    }

    const renderToken = ++plannerSmartMapRenderToken;

    let routeLatLngs = locations.map(location => [location.lat, location.lon]);

    if (navigator.onLine && locations.length >= 2) {
        try {
            const coordinates = locations
                .map(location => `${location.lon},${location.lat}`)
                .join(";");

            const response = await fetch(
                `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
                { cache: "no-store" }
            );

            if (response.ok) {
                const data = await response.json();
                const coordinatesOut = data?.routes?.[0]?.geometry?.coordinates;

                if (Array.isArray(coordinatesOut) && coordinatesOut.length) {
                    routeLatLngs = coordinatesOut.map(([lon, lat]) => [lat, lon]);
                }
            }
        }
        catch (error) {
            console.warn("Mappa Smart Planner: route online non disponibile.", error);
        }
    }

    if (renderToken !== plannerSmartMapRenderToken) {
        return;
    }

    L.polyline(
        routeLatLngs,
        {
            weight: 5,
            opacity: .78
        }
    ).addTo(plannerSmartMapLayer);

    setTimeout(() => plannerSmartMap?.invalidateSize(), 30);
}


async function saveCurrentPlannerProfileFromUI() {
    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    ensurePlannerProfile(day);

    day._planner.startTime = document.getElementById("planner-start")?.value || day._planner.startTime;
    day._planner.endTime = document.getElementById("planner-end")?.value || day._planner.endTime;
    day._planner.intensity = document.getElementById("planner-intensity")?.value || "balanced";
    day._planner.constraints = document.getElementById("planner-constraints")?.value?.trim() || "";
    day._planner.themeWeights = { ...plannerThemeWeights };
    day._planner.zones = Array.from(plannerSelectedZones);

    await persistItinerary();
}


function cyclePlannerTheme(theme) {
    const current = Number(plannerThemeWeights[theme] || 0);
    const next = current >= 3 ? 0 : current + 1;

    if (next === 0) {
        delete plannerThemeWeights[theme];
    }
    else {
        plannerThemeWeights[theme] = next;
    }

    const day = itineraryData.days[currentDayIndex];
    ensurePlannerProfile(day);
    day._planner.themeWeights = { ...plannerThemeWeights };
    persistItinerary();
    renderPlannerThemeButtons();
}


function togglePlannerZone(zone) {
    if (plannerSelectedZones.has(zone)) {
        plannerSelectedZones.delete(zone);
    }
    else {
        plannerSelectedZones.add(zone);
    }

    const day = itineraryData.days[currentDayIndex];
    ensurePlannerProfile(day);
    day._planner.zones = Array.from(plannerSelectedZones);
    persistItinerary();
    renderPlannerZoneButtons();
}


function renderPlannerThemeButtons() {
    document.querySelectorAll("[data-planner-theme]").forEach(button => {
        const key = button.dataset.plannerTheme;
        const weight = Number(plannerThemeWeights[key] || 0);
        button.classList.toggle("active", weight > 0);
        button.dataset.weight = String(weight);

        const stars = button.querySelector(".planner-theme-stars");
        if (stars) {
            stars.textContent = weight ? "★".repeat(weight) : "＋";
        }
    });
}


function renderPlannerZoneButtons() {
    document.querySelectorAll("[data-planner-zone]").forEach(button => {
        button.classList.toggle("active", plannerSelectedZones.has(button.dataset.plannerZone));
    });
}


async function createPlannerProposal() {

    await saveCurrentPlannerProfileFromUI();

    const day = itineraryData.days[currentDayIndex];
    const weights = day._planner.themeWeights || {};

    if (!Object.keys(weights).length) {
        alert("Seleziona almeno una tipologia di giornata. Puoi combinarne più di una e darle peso con 1-3 stelle.");
        return;
    }

    setPlannerStatus("Analizzo i 400 POI e costruisco una proposta coerente…", "working");

    const profile = deepClone(day._planner);
    const result = buildPlannerProposal(day, profile);

    plannerPendingProposal = result;
    renderPlannerProposal(result);

    setPlannerStatus(
        `Proposta pronta: ${result.selected.length} tappe principali + ${result.extras.length} alternative coerenti.`,
        "success"
    );
}


function buildPlannerProposal(day, profile) {

    const scored = Array.from(plannerRawPOIs.values())
        .filter(isPlannerPOIUsable)
        .map(poi => ({ poi, score: scorePlannerPOI(poi, profile) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    const intensity = PLANNER_INTENSITY[profile.intensity] || PLANNER_INTENSITY.balanced;
    const selected = [];
    const used = new Set();
    let visitMinutes = 0;

    let previous = plannerStartingLocation(day.date);

    const pool = scored.slice(0, 80);

    while (
        selected.length < intensity.maxStops &&
        pool.length
    ) {
        let bestIndex = -1;
        let bestValue = -Infinity;

        pool.forEach((item, index) => {
            if (used.has(item.poi.id)) {
                return;
            }

            const duration = plannerPOIDuration(item.poi);
            if (visitMinutes + duration > intensity.maxVisitMinutes) {
                return;
            }

            const distance = previous && plannerHasCoordinates(item.poi)
                ? plannerDistanceKM(previous, item.poi)
                : 0;

            const travelPenalty = distance * 1.45;
            const diversityBonus = plannerThemeDiversityBonus(item.poi, selected, profile);
            const value = item.score + diversityBonus - travelPenalty;

            if (value > bestValue) {
                bestValue = value;
                bestIndex = index;
            }
        });

        if (bestIndex < 0) {
            break;
        }

        const chosen = pool.splice(bestIndex, 1)[0];
        used.add(chosen.poi.id);
        selected.push(chosen);
        visitMinutes += plannerPOIDuration(chosen.poi);

        if (plannerHasCoordinates(chosen.poi)) {
            previous = chosen.poi;
        }
    }

    const extras = scored
        .filter(item => !used.has(item.poi.id))
        .slice(0, 7);

    const blocks = selected.map(item => buildPlannerBlockFromRawPOI(item.poi, "Proposto dallo Smart Planner in base a temi, zona e intensità."));

    const estimatedDriving = plannerEstimateSequenceDriving(day.date, blocks);
    const estimatedVisit = blocks.reduce((sum, block) => sum + Number(block.duration_minutes || 0), 0);

    return {
        dayDate: day.date,
        profile,
        selected,
        extras,
        blocks,
        estimatedDriving,
        estimatedVisit
    };
}


function scorePlannerPOI(poi, profile) {

    if (!poi || poi.id === PLANNER_BASE.id) {
        return -Infinity;
    }

    let score = 0;
    const haystack = plannerPOIText(poi);
    const weights = profile.themeWeights || {};

    Object.entries(weights).forEach(([themeKey, weight]) => {
        const meta = PLANNER_THEME_META[themeKey];
        if (!meta || !weight) {
            return;
        }

        let themeScore = 0;

        Object.entries(meta.interest || {}).forEach(([interestKey, multiplier]) => {
            themeScore += Number(poi.interest?.[interestKey] || 0) * multiplier;
        });

        (meta.keywords || []).forEach(keyword => {
            if (haystack.includes(normalizePlannerText(keyword))) {
                themeScore += 1.8;
            }
        });

        if (meta.veryLocal && poi.veryLocal) {
            themeScore += 5;
        }

        score += themeScore * Number(weight);
    });

    const zones = Array.isArray(profile.zones) ? profile.zones : [];
    if (zones.length) {
        const matched = zones.some(zone => plannerPOIMatchesZone(poi, zone));
        score += matched ? 28 : -32;
    }

    score += Number(poi.priorityScore || 2) * 4.5;

    if (poi.veryLocal) {
        score += 2;
    }

    const duration = plannerPOIDuration(poi);
    if (profile.intensity === "relaxed" && duration > 180) {
        score -= 14;
    }

    if (profile.intensity === "intense" && duration >= 120) {
        score += 2;
    }

    const constraints = normalizePlannerText(profile.constraints || "");
    if (constraints) {
        const tokens = constraints.split(/[^a-z0-9à-ÿ]+/i).filter(token => token.length >= 4);
        tokens.forEach(token => {
            if (haystack.includes(token)) {
                score += 3;
            }
        });
    }

    return score;
}


function plannerThemeDiversityBonus(poi, selected, profile) {
    if (!selected.length) {
        return 0;
    }

    let bonus = 0;
    const selectedTypes = new Set(selected.map(item => item.poi.type));
    if (!selectedTypes.has(poi.type)) {
        bonus += 4;
    }

    if (poi.type === "food" && Number(profile.themeWeights?.food || 0) > 0) {
        const alreadyFood = selected.some(item => item.poi.type === "food");
        if (!alreadyFood) {
            bonus += 9;
        }
    }

    return bonus;
}


function renderPlannerProposal(result) {

    const container = document.getElementById("planner-preview");
    if (!container) {
        return;
    }

    const selectedHTML = result.selected.map((item, index) => {
        const poi = item.poi;
        return `
            <div class="planner-proposal-row">
                <div class="planner-proposal-order">${index + 1}</div>
                <div class="planner-proposal-copy">
                    <strong>${escapePlanner(poi.name)}</strong>
                    <span>${escapePlanner(poi.area)} · ${plannerPOIDuration(poi)} min · punteggio ${Math.round(item.score)}</span>
                </div>
                <a class="planner-mini-link" href="${plannerPlaceURL(poi, "smart")}">Scheda</a>
            </div>
        `;
    }).join("");

    const extrasHTML = result.extras.map(item => {
        const poi = item.poi;
        return `
            <div class="planner-extra-row">
                <div>
                    <strong>${escapePlanner(poi.name)}</strong>
                    <span>${escapePlanner(poi.area)} · ${escapePlanner(poi.priorityLabel || poi.type)}</span>
                </div>
                <div class="planner-extra-actions">
                    <a class="planner-mini-link" href="${plannerPlaceURL(poi, "smart")}">Scheda</a>
                    <button class="planner-mini-button" data-planner-extra-add="${escapePlanner(poi.id)}">＋</button>
                </div>
            </div>
        `;
    }).join("");

    container.classList.add("open");
    container.innerHTML = `
        <div class="planner-preview-head">
            <div>
                <span>PROPOSTA SMART</span>
                <strong>${result.selected.length} tappe · ~${formatMinutes(result.estimatedDriving)} guida · ${formatMinutes(result.estimatedVisit)} visite</strong>
            </div>
            <button id="planner-apply-proposal" class="planner-primary-button">Usa questa giornata</button>
        </div>

        <div class="planner-proposal-list">${selectedHTML}</div>

        <div class="planner-extra-title">Altri POI coerenti con le tue indicazioni</div>
        <div class="planner-extra-list">${extrasHTML || "<span>Nessun'altra proposta significativa.</span>"}</div>
    `;

    document.getElementById("planner-apply-proposal")?.addEventListener("click", applyPlannerProposal);

    container.querySelectorAll("[data-planner-extra-add]").forEach(button => {
        button.addEventListener("click", () => addExtraToPendingProposal(button.dataset.plannerExtraAdd));
    });

    renderPlannerRouteMap();
}


function addExtraToPendingProposal(poiID) {
    if (!plannerPendingProposal) {
        return;
    }

    const item = plannerPendingProposal.extras.find(entry => entry.poi.id === poiID);
    if (!item) {
        return;
    }

    if (plannerPendingProposal.selected.some(entry => entry.poi.id === poiID)) {
        return;
    }

    plannerPendingProposal.selected.push(item);
    plannerPendingProposal.blocks.push(
        buildPlannerBlockFromRawPOI(item.poi, "Aggiunto manualmente dai suggerimenti coerenti dello Smart Planner.")
    );
    plannerPendingProposal.extras = plannerPendingProposal.extras.filter(entry => entry.poi.id !== poiID);
    plannerPendingProposal.estimatedDriving = plannerEstimateSequenceDriving(
        plannerPendingProposal.dayDate,
        plannerPendingProposal.blocks
    );
    plannerPendingProposal.estimatedVisit = plannerPendingProposal.blocks.reduce(
        (sum, block) => sum + Number(block.duration_minutes || 0),
        0
    );

    renderPlannerProposal(plannerPendingProposal);
}


async function applyPlannerProposal() {

    if (!plannerPendingProposal) {
        return;
    }

    const current = itineraryData.days[currentDayIndex];
    const ok = confirm(
        `Applicare la nuova proposta a ${formatPlannerDate(current.date)}? Le tappe attuali verranno sostituite, ma il vincolo del volo (se presente) resterà intatto.`
    );

    if (!ok) {
        return;
    }

    const fixedFlights = current.blocks.filter(block => block._flight_constraint);

    current.blocks = plannerPendingProposal.blocks.map(block => deepClone(block));
    current.title = plannerGeneratedDayTitle(plannerPendingProposal.profile);
    current.theme = plannerGeneratedThemeLabel(plannerPendingProposal.profile);
    current._planner = deepClone(plannerPendingProposal.profile);
    current._template_id = null;
    current._template_source = "Smart Planner";
    current._completed = false;

    if (fixedFlights.length) {
        fixedFlights.forEach(block => current.blocks.push(block));
    }

    ensureFlightConstraint(current);
    ensureBaseConstraint(current);
    await recalculatePlannerDay(current, { useNetwork: true, persist: false });
    await persistItinerary();

    plannerPendingProposal = null;
    const preview = document.getElementById("planner-preview");
    if (preview) {
        preview.classList.remove("open");
        preview.innerHTML = "";
    }

    renderDay(currentDayIndex);
    setPlannerStatus("Giornata applicata nello Smart Planner. Puoi modificarla, ricalcolarla, ottimizzarla e salvarla; quando sei soddisfatto passa a “Itinerario deciso”.", "success");
}


function plannerGeneratedDayTitle(profile) {
    const zones = (profile.zones || []).map(zone => PLANNER_ZONE_META[zone]?.label).filter(Boolean);
    const themes = Object.entries(profile.themeWeights || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([key]) => PLANNER_THEME_META[key]?.label.replace(/^[^ ]+\s/, ""))
        .filter(Boolean);

    const zoneText = zones.length ? zones.join(" + ") : "Mauritius";
    const themeText = themes.length ? themes.join(" + ") : "giornata mista";
    return `${zoneText}: ${themeText}`;
}


function plannerGeneratedThemeLabel(profile) {
    return Object.entries(profile.themeWeights || {})
        .sort((a, b) => b[1] - a[1])
        .map(([key, weight]) => `${PLANNER_THEME_META[key]?.label || key} ${"★".repeat(weight)}`)
        .join(" · ");
}


async function recalculateCurrentPlannerDay() {

    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    await saveCurrentPlannerProfileFromUI();

    setPlannerStatus("Ricalcolo spostamenti e orari mantenendo esattamente l'ordine che hai scelto…", "working");

    const result = await recalculatePlannerDay(day, { useNetwork: true, persist: true });

    renderDay(currentDayIndex);

    const warningText = result.warnings.length
        ? ` · ⚠️ ${result.warnings.join(" · ")}`
        : "";

    const destinationLabel = day.date === "2026-09-20"
        ? "arrivo in aeroporto"
        : "rientro a Veranda Tamarin";

    const timingText = day.date === "2026-09-20"
        ? `arrivo aeroporto ${day._planner.lastAirportArrivalTime || "—"} · volo 10:00`
        : `${destinationLabel} ${result.endTime}`;

    setPlannerStatus(
        `Ricalcolo completato: ${formatMinutes(result.drivingMinutes)} di guida · ${timingText}${warningText}`,
        result.warnings.length ? "warning" : "success"
    );
}


async function recalculatePlannerDay(day, { useNetwork = true, persist = false } = {}) {

    ensurePlannerProfile(day);
    ensureFlightConstraint(day);
    ensureBaseConstraint(day);

    const originalBlocks = day.blocks.filter(block => block.kind !== "transfer");
    const rebuilt = [];
    const warnings = [];

    let cursor = timeToMinutes(day._planner.startTime || plannerDefaultTimes(day.date).start);
    let previousLocation = plannerStartingLocation(day.date);
    let drivingMinutes = 0;
    let airportArrivalMinutes = null;

    for (let i = 0; i < originalBlocks.length; i++) {
        const block = originalBlocks[i];
        const location = plannerBlockLocation(block);

        if (block._flight_constraint) {
            const fixed = timeToMinutes(block._planner_fixed_time || block.time);

            if (previousLocation && location && !plannerSameLocation(previousLocation, location)) {
                const travel = await plannerTravelBetween(previousLocation, location, useNetwork);
                rebuilt.push(buildPlannerTransfer(previousLocation, location, cursor, travel.minutes, travel.source));
                cursor += travel.minutes;
                drivingMinutes += travel.minutes;
            }

            if (cursor > fixed) {
                warnings.push(`arrivo al vincolo volo con ${cursor - fixed} min di ritardo`);
            }

            block.time = minutesToTime(fixed);
            block._locked = true;
            rebuilt.push(block);
            cursor = Math.max(cursor, fixed + Number(block.duration_minutes || 0));
            previousLocation = location || previousLocation;
            continue;
        }

        if (location && previousLocation && !plannerSameLocation(previousLocation, location)) {
            const travel = await plannerTravelBetween(previousLocation, location, useNetwork);
            rebuilt.push(buildPlannerTransfer(previousLocation, location, cursor, travel.minutes, travel.source));
            cursor += travel.minutes;
            drivingMinutes += travel.minutes;

            if (
                day.date === "2026-09-20" &&
                plannerSameLocation(location, PLANNER_AIRPORT) &&
                airportArrivalMinutes === null
            ) {
                airportArrivalMinutes = cursor;
            }
        }

        if (block._planner_fixed_time) {
            const fixed = timeToMinutes(block._planner_fixed_time);
            if (cursor <= fixed) {
                cursor = fixed;
            }
            else {
                warnings.push(`"${block.title}" raggiunto ${cursor - fixed} min dopo l'orario vincolato`);
            }
        }

        block.time = minutesToTime(cursor);
        rebuilt.push(block);
        cursor += Number(block.duration_minutes || 0);

        if (location) {
            previousLocation = location;
        }
    }

    const endingLocation = plannerEndingLocation(day.date);

    if (
        endingLocation &&
        previousLocation &&
        !plannerSameLocation(previousLocation, endingLocation)
    ) {
        const travel = await plannerTravelBetween(
            previousLocation,
            endingLocation,
            useNetwork
        );

        rebuilt.push(
            buildPlannerTransfer(
                previousLocation,
                endingLocation,
                cursor,
                travel.minutes,
                travel.source
            )
        );

        cursor += travel.minutes;
        drivingMinutes += travel.minutes;
        previousLocation = endingLocation;

        if (
            day.date === "2026-09-20" &&
            plannerSameLocation(endingLocation, PLANNER_AIRPORT) &&
            airportArrivalMinutes === null
        ) {
            airportArrivalMinutes = cursor;
        }
    }

    day.blocks = rebuilt;
    day.manual_driving_minutes = drivingMinutes;
    day.target_end = day._planner.endTime;

    const endLimit = timeToMinutes(day._planner.endTime || "18:00");
    if (cursor > endLimit && day.date !== "2026-09-20") {
        warnings.push(
            `rientro a Veranda Tamarin ${cursor - endLimit} min oltre l'orario desiderato`
        );
    }

    if (day.date === "2026-09-20") {
        const flight = timeToMinutes("10:00");
        const recommendedAirportArrival = timeToMinutes(day._planner.endTime || "07:00");

        if (airportArrivalMinutes === null) {
            warnings.push("non riesco a determinare l'orario di arrivo in aeroporto");
        }
        else if (airportArrivalMinutes > recommendedAirportArrival) {
            warnings.push(
                `arrivo in aeroporto alle ${minutesToTime(airportArrivalMinutes)}: obiettivo consigliato ${minutesToTime(recommendedAirportArrival)}`
            );
        }

        if (cursor > flight) {
            warnings.push(`programma incompatibile con il volo delle 10:00`);
        }
    }

    day.buffer_minutes = day.date === "2026-09-20"
        ? Math.max(0, endLimit - (airportArrivalMinutes ?? cursor))
        : Math.max(0, endLimit - cursor);
    day._planner.lastRecalculatedAt = new Date().toISOString();
    day._planner.lastDrivingMinutes = drivingMinutes;
    day._planner.lastEndTime = minutesToTime(cursor);
    day._planner.lastAirportArrivalTime = airportArrivalMinutes === null
        ? null
        : minutesToTime(airportArrivalMinutes);
    day._planner.lastWarnings = warnings;

    if (persist) {
        await persistItinerary();
    }

    return {
        drivingMinutes,
        endTime: minutesToTime(cursor),
        warnings
    };
}


async function optimizeCurrentPlannerDay() {

    const current = itineraryData.days[currentDayIndex];
    if (!current) {
        return;
    }

    await saveCurrentPlannerProfileFromUI();

    setPlannerStatus("Cerco un ordine più efficiente senza toccare i vincoli fissi…", "working");

    const proposal = deepClone(current);
    const flexible = proposal.blocks.filter(block =>
        block.kind !== "transfer" &&
        !block._flight_constraint &&
        !block._base_constraint
    );
    const fixedFlight = proposal.blocks.find(block => block._flight_constraint);

    // Ottimizza soltanto le tappe sbloccate. I lucchetti restano
    // nello stesso punto della giornata e dividono il percorso in segmenti.
    let newBlocks = plannerOptimizeFlexibleBlocks(
        flexible,
        plannerStartingLocation(current.date)
    );

    if (fixedFlight) {
        if (PLANNER_FLIGHTS[current.date]?.position === "start") {
            newBlocks.unshift(fixedFlight);
        }
        else {
            newBlocks.push(fixedFlight);
        }
    }

    proposal.blocks = newBlocks;
    ensureFlightConstraint(proposal);
    ensureBaseConstraint(proposal);

    const beforeEstimate = plannerEstimateSequenceDriving(current.date, current.blocks.filter(block => block.kind !== "transfer"));
    const afterEstimate = plannerEstimateSequenceDriving(current.date, proposal.blocks.filter(block => block.kind !== "transfer"));

    const result = await recalculatePlannerDay(proposal, { useNetwork: false, persist: false });

    plannerPendingOptimizedDay = proposal;

    renderOptimizationModal(current, proposal, beforeEstimate, afterEstimate, result);
    openPlannerModal("planner-optimize-modal");
    setPlannerStatus("Ottimizzazione pronta: controlla la proposta prima di applicarla.", "success");
}


function plannerOptimizeFlexibleBlocks(blocks, startLocation) {

    const result = [];
    let current = startLocation;
    let segment = [];

    const flushSegment = () => {
        if (!segment.length) {
            return;
        }

        const located = segment.filter(block => plannerBlockLocation(block));
        const ordered = plannerNearestNeighborOrder(located, current);
        let orderedIndex = 0;

        const rebuiltSegment = segment.map(block => {
            if (!plannerBlockLocation(block)) {
                return block;
            }
            const replacement = ordered[orderedIndex];
            orderedIndex += 1;
            return replacement;
        });

        rebuiltSegment.forEach(block => {
            result.push(block);
            const location = plannerBlockLocation(block);
            if (location) {
                current = location;
            }
        });

        segment = [];
    };

    blocks.forEach(block => {
        if (block._locked) {
            flushSegment();
            result.push(block);
            const location = plannerBlockLocation(block);
            if (location) {
                current = location;
            }
            return;
        }

        segment.push(block);
    });

    flushSegment();
    return result;
}


function plannerNearestNeighborOrder(blocks, startLocation) {

    const remaining = blocks.map(block => deepClone(block));
    const ordered = [];
    let current = startLocation;

    while (remaining.length) {
        let bestIndex = 0;
        let bestScore = Infinity;

        remaining.forEach((block, index) => {
            const location = plannerBlockLocation(block);
            if (!location) {
                return;
            }

            let distance = current ? plannerDistanceKM(current, location) : 0;

            // Le tappe bloccate ricevono una piccola penalità al movimento:
            // non vengono eliminate e restano comunque nella proposta.
            if (block._locked) {
                distance -= 2;
            }

            if (distance < bestScore) {
                bestScore = distance;
                bestIndex = index;
            }
        });

        const [chosen] = remaining.splice(bestIndex, 1);
        ordered.push(chosen);
        current = plannerBlockLocation(chosen) || current;
    }

    return ordered;
}


function renderOptimizationModal(original, proposal, beforeDriving, afterDriving, result) {

    const container = document.getElementById("planner-optimize-result");
    if (!container) {
        return;
    }

    const oldOrder = original.blocks
        .filter(block => block.kind !== "transfer" && !block._flight_constraint && block.poi_id)
        .map(block => block.title)
        .join(" → ");

    const newOrder = proposal.blocks
        .filter(block => block.kind !== "transfer" && !block._flight_constraint && block.poi_id)
        .map(block => block.title)
        .join(" → ");

    const saving = beforeDriving - afterDriving;

    container.innerHTML = `
        <div class="planner-compare-card">
            <span>ORDINE ATTUALE</span>
            <p>${escapePlanner(oldOrder || "Nessuna tappa geolocalizzata")}</p>
        </div>
        <div class="planner-compare-card suggested">
            <span>ORDINE PROPOSTO</span>
            <p>${escapePlanner(newOrder || "Nessuna modifica")}</p>
        </div>
        <div class="planner-optimize-summary">
            <strong>${saving > 0 ? `≈ ${formatMinutes(saving)} di guida in meno` : "Ordine simile per efficienza"}</strong>
            <span>Fine stimata: ${escapePlanner(result.endTime)} · guida stimata ${formatMinutes(result.drivingMinutes)}</span>
        </div>
        <p class="planner-modal-note">Ottimizza propone un ordine diverso. Non viene applicato finché non premi “Applica proposta”.</p>
    `;
}


async function applyPlannerOptimization() {
    if (!plannerPendingOptimizedDay) {
        return;
    }

    itineraryData.days[currentDayIndex] = plannerPendingOptimizedDay;
    plannerPendingOptimizedDay = null;
    ensurePlannerProfile(itineraryData.days[currentDayIndex]);
    ensureFlightConstraint(itineraryData.days[currentDayIndex]);
    await persistItinerary();
    closePlannerModal("planner-optimize-modal");
    renderDay(currentDayIndex);
}


function augmentTimelineActions() {

    const day = itineraryData.days[currentDayIndex];
    if (!day) {
        return;
    }

    document.querySelectorAll("#timeline .timeline-item").forEach((item, index) => {
        const actions = item.querySelector(".timeline-actions");
        const block = day.blocks[index];

        if (!actions || !block || item.dataset.plannerAugmented === "1") {
            return;
        }

        item.dataset.plannerAugmented = "1";

        if (block._flight_constraint) {
            actions.innerHTML = "";
            const badge = document.createElement("span");
            badge.className = "mini-action planner-fixed-badge";
            badge.textContent = "✈️ Orario fisso";
            actions.appendChild(badge);
            return;
        }

        if (block._base_constraint) {
            actions.innerHTML = "";
            const badge = document.createElement("span");
            badge.className = "mini-action planner-fixed-badge";
            badge.textContent = "🏨 Rientro fisso";
            actions.appendChild(badge);
            return;
        }

        const edit = document.createElement("button");
        edit.className = "mini-action";
        edit.textContent = "✏️ Modifica";
        edit.dataset.plannerEditIndex = String(index);
        edit.addEventListener("click", () => openPlannerBlockEdit(index));
        actions.appendChild(edit);

        const move = document.createElement("button");
        move.className = "mini-action";
        move.textContent = "↪ Giorno";
        move.dataset.plannerMoveIndex = String(index);
        move.addEventListener("click", () => openPlannerBlockEdit(index, true));
        actions.appendChild(move);
    });
}


function openPlannerBlockEdit(index, focusMove = false) {

    const day = itineraryData.days[currentDayIndex];
    const block = day?.blocks?.[index];
    if (!block || block._flight_constraint || block._base_constraint || block.kind === "transfer") {
        return;
    }

    document.getElementById("planner-edit-index").value = String(index);
    document.getElementById("planner-edit-title").value = block.title || "";
    document.getElementById("planner-edit-duration").value = Number(block.duration_minutes || 0);
    document.getElementById("planner-edit-fixed-time").value = block._planner_fixed_time || "";
    document.getElementById("planner-edit-description").value = block.description || "";

    const moveSelect = document.getElementById("planner-edit-move-day");
    moveSelect.innerHTML = itineraryData.days.map((entry, dayIndex) => `
        <option value="${dayIndex}" ${dayIndex === currentDayIndex ? "selected" : ""}>
            ${formatPlannerDate(entry.date)} · ${escapePlanner(entry.title || "Giornata")}
        </option>
    `).join("");

    openPlannerModal("planner-edit-modal");

    if (focusMove) {
        setTimeout(() => moveSelect.focus(), 80);
    }
}


async function savePlannerBlockEdit() {

    const sourceDayIndex = currentDayIndex;
    const day = itineraryData.days[sourceDayIndex];
    const index = Number(document.getElementById("planner-edit-index").value);
    const block = day?.blocks?.[index];

    if (!block || block._flight_constraint || block._base_constraint) {
        return;
    }

    block.title = document.getElementById("planner-edit-title").value.trim() || block.title;
    block.duration_minutes = Math.max(0, Number(document.getElementById("planner-edit-duration").value || 0));
    block._planner_fixed_time = document.getElementById("planner-edit-fixed-time").value || null;
    block.description = document.getElementById("planner-edit-description").value.trim();

    const targetDayIndex = Number(document.getElementById("planner-edit-move-day").value);

    if (targetDayIndex !== sourceDayIndex) {
        day.blocks.splice(index, 1);
        const targetDay = itineraryData.days[targetDayIndex];
        ensurePlannerProfile(targetDay);
        ensureFlightConstraint(targetDay);
        ensureBaseConstraint(targetDay);

        const terminalIndex = targetDay.blocks.findIndex(entry =>
            entry._base_constraint ||
            (entry._flight_constraint && PLANNER_FLIGHTS[targetDay.date]?.position === "end")
        );

        if (terminalIndex >= 0) {
            targetDay.blocks.splice(terminalIndex, 0, block);
        }
        else {
            targetDay.blocks.push(block);
        }

        ensureBaseConstraint(day);
        ensureBaseConstraint(targetDay);

        day._completed = false;
        targetDay._completed = false;
    }

    await persistItinerary();
    closePlannerModal("planner-edit-modal");
    renderDay(currentDayIndex);
}


function openSavePlannerDayModal() {
    const day = itineraryData.days[currentDayIndex];
    document.getElementById("planner-save-name").value = day?.title || `Giornata ${formatPlannerDate(day?.date)}`;
    openPlannerModal("planner-save-modal");
    setTimeout(() => document.getElementById("planner-save-name")?.select(), 80);
}


async function saveCurrentDayToLibrary() {

    const day = itineraryData.days[currentDayIndex];
    const name = document.getElementById("planner-save-name").value.trim();

    if (!name) {
        alert("Inserisci un nome per la giornata.");
        return;
    }

    const snapshotBlocks = day.blocks
        .filter(block => block.kind !== "transfer" && !block._flight_constraint && !block._base_constraint)
        .map(block => deepClone(block));

    const entry = {
        id: `user-day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source: "Le mie giornate",
        source_group: "user",
        label: name,
        title: name,
        theme: day.theme || plannerGeneratedThemeLabel(day._planner || {}),
        weather_dependency: day.weather_dependency || "medium",
        target_end: day._planner?.endTime || day.target_end || "18:00",
        manual_driving_minutes: day.manual_driving_minutes || 0,
        buffer_minutes: day.buffer_minutes || 0,
        blocks: snapshotBlocks,
        alternatives: deepClone(day.alternatives || []),
        planner_profile: deepClone(day._planner || {}),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    plannerUserTemplates.unshift(entry);
    await savePlannerUserTemplates();

    closePlannerModal("planner-save-modal");
    setPlannerStatus(`Giornata salvata come “${name}”. La trovi in Libreria → Le mie giornate.`, "success");
}


function openPlannerLibrary() {
    renderPlannerLibrary();
    openPlannerModal("planner-library-modal");
}


function renderPlannerLibrary() {

    const container = document.getElementById("planner-library-list");
    if (!container) {
        return;
    }

    const original = plannerTemplates.filter(template => template.source_group === "original");
    const dede = plannerTemplates.filter(template => template.source_group === "dede");
    const user = plannerUserTemplates;

    container.innerHTML = [
        renderPlannerLibraryGroup("🌍 Travel Explorer", original, false),
        renderPlannerLibraryGroup("💛 Dede", dede, false),
        renderPlannerLibraryGroup("💾 Le mie giornate", user, true)
    ].join("");

    container.querySelectorAll("[data-use-template]").forEach(button => {
        button.addEventListener("click", () => usePlannerTemplate(button.dataset.useTemplate, button.dataset.templateGroup));
    });

    container.querySelectorAll("[data-duplicate-template]").forEach(button => {
        button.addEventListener("click", () => duplicatePlannerUserTemplate(button.dataset.duplicateTemplate));
    });

    container.querySelectorAll("[data-rename-template]").forEach(button => {
        button.addEventListener("click", () => renamePlannerUserTemplate(button.dataset.renameTemplate));
    });

    container.querySelectorAll("[data-delete-template]").forEach(button => {
        button.addEventListener("click", () => deletePlannerUserTemplate(button.dataset.deleteTemplate));
    });
}


function renderPlannerLibraryGroup(title, items, isUser) {

    const cards = items.length
        ? items.map(template => `
            <div class="planner-library-card">
                <div class="planner-library-copy">
                    <strong>${escapePlanner(template.label || template.title)}</strong>
                    <span>${escapePlanner(template.theme || "Giornata salvata")}</span>
                </div>
                <div class="planner-library-actions">
                    <button class="planner-primary-small" data-use-template="${escapePlanner(template.id)}" data-template-group="${isUser ? "user" : "base"}">Usa</button>
                    ${isUser ? `
                        <button class="planner-secondary-small" data-duplicate-template="${escapePlanner(template.id)}">Duplica</button>
                        <button class="planner-secondary-small" data-rename-template="${escapePlanner(template.id)}">Rinomina</button>
                        <button class="planner-danger-small" data-delete-template="${escapePlanner(template.id)}">Elimina</button>
                    ` : ""}
                </div>
            </div>
        `).join("")
        : `<div class="planner-empty">Nessuna giornata in questo gruppo.</div>`;

    return `
        <section class="planner-library-group">
            <h3>${title}</h3>
            <div class="planner-library-cards">${cards}</div>
        </section>
    `;
}


async function usePlannerTemplate(templateID, group) {

    const template = group === "user"
        ? plannerUserTemplates.find(item => item.id === templateID)
        : plannerTemplates.find(item => item.id === templateID);

    if (!template) {
        return;
    }

    const current = itineraryData.days[currentDayIndex];
    const ok = confirm(
        `Usare “${template.label || template.title}” per ${formatPlannerDate(current.date)}? Il vincolo del volo, se presente, verrà mantenuto.`
    );

    if (!ok) {
        return;
    }

    let blocks = deepClone(template.blocks || []).filter(block => block.kind !== "transfer" && !block._flight_constraint && !block._base_constraint);

    if (group !== "user") {
        const additions = await getPlannerTemplateAdditions(template.id);
        additions.forEach(addition => {
            if (!blocks.some(block => block.poi_id === addition.poi_id)) {
                blocks.push(deepClone(addition));
            }
        });
    }

    const profile = group === "user" && template.planner_profile
        ? deepClone(template.planner_profile)
        : {
            ...current._planner,
            startTime: firstPlannerBlockTime(blocks) || current._planner.startTime,
            endTime: template.target_end || current._planner.endTime,
            themeWeights: inferThemeWeightsFromText(template.theme || template.title),
            zones: inferZonesFromBlocks(blocks),
            intensity: "balanced",
            constraints: current._planner.constraints || ""
        };

    current.title = template.label || template.title;
    current.theme = template.theme || "";
    current.weather_dependency = template.weather_dependency || "medium";
    current.alternatives = deepClone(template.alternatives || []);
    current.blocks = blocks;
    current._planner = profile;
    current._template_id = template.id;
    current._template_source = template.source || (group === "user" ? "Le mie giornate" : "Template");
    current._completed = false;

    ensurePlannerProfile(current);
    ensureFlightConstraint(current);
    ensureBaseConstraint(current);
    await recalculatePlannerDay(current, { useNetwork: true, persist: false });
    await persistItinerary();

    closePlannerModal("planner-library-modal");
    renderDay(currentDayIndex);
}


async function getPlannerTemplateAdditions(templateID) {
    try {
        const all = await TravelStore.get(PLANNER_TEMPLATE_ADDITIONS_KEY) || {};
        return Array.isArray(all[templateID]) ? all[templateID] : [];
    }
    catch (error) {
        console.warn("Aggiunte template non disponibili:", error);
        return [];
    }
}


async function duplicatePlannerUserTemplate(templateID) {
    const source = plannerUserTemplates.find(item => item.id === templateID);
    if (!source) {
        return;
    }

    const copy = deepClone(source);
    copy.id = `user-day-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    copy.label = `${source.label || source.title} - copia`;
    copy.title = copy.label;
    copy.created_at = new Date().toISOString();
    copy.updated_at = copy.created_at;
    plannerUserTemplates.unshift(copy);
    await savePlannerUserTemplates();
    renderPlannerLibrary();
}


async function renamePlannerUserTemplate(templateID) {
    const item = plannerUserTemplates.find(entry => entry.id === templateID);
    if (!item) {
        return;
    }

    const name = prompt("Nuovo nome della giornata:", item.label || item.title);
    if (!name?.trim()) {
        return;
    }

    item.label = name.trim();
    item.title = name.trim();
    item.updated_at = new Date().toISOString();
    await savePlannerUserTemplates();
    renderPlannerLibrary();
}


async function deletePlannerUserTemplate(templateID) {
    const item = plannerUserTemplates.find(entry => entry.id === templateID);
    if (!item) {
        return;
    }

    if (!confirm(`Eliminare “${item.label || item.title}” dalla libreria personale?`)) {
        return;
    }

    plannerUserTemplates = plannerUserTemplates.filter(entry => entry.id !== templateID);
    await savePlannerUserTemplates();
    renderPlannerLibrary();
}


function renderPlannerDayHealth(day) {

    const element = document.getElementById("planner-day-health");
    if (!element) {
        return;
    }

    const activityBlocks = day.blocks.filter(block => block.kind !== "transfer" && !block._flight_constraint);
    const visits = activityBlocks.filter(block => block.poi_id).length;
    const driving = Number(day.manual_driving_minutes || day._planner?.lastDrivingMinutes || 0);
    const endTime = day._planner?.lastEndTime || day.target_end || "—";
    const warnings = day._planner?.lastWarnings || [];

    const finalLabel = day.date === "2026-09-20"
        ? "ARRIVO AEROPORTO"
        : "RIENTRO VERANDA";

    const displayedEndTime = day.date === "2026-09-20"
        ? (day._planner?.lastAirportArrivalTime || "—")
        : endTime;

    element.innerHTML = `
        <div><span>TAPPE</span><strong>${visits}</strong></div>
        <div><span>GUIDA</span><strong>${formatMinutes(driving)}</strong></div>
        <div><span>${finalLabel}</span><strong>${escapePlanner(displayedEndTime)}</strong></div>
        <div><span>STATO</span><strong>${warnings.length ? `⚠️ ${warnings.length}` : "✓"}</strong></div>
    `;
}


function buildPlannerBlockFromRawPOI(poi, description) {
    return {
        kind: poi.type === "adventure" ? "activity" : (poi.type === "food" ? "meal" : "visit"),
        time: "00:00",
        duration_minutes: plannerPOIDuration(poi),
        poi_id: poi.id,
        poi_type: poi.type,
        title: poi.name,
        description,
        _uid: `planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        _locked: false,
        _planner_generated: true
    };
}


function buildPlannerTransfer(from, to, startMinutes, durationMinutes, source) {
    return {
        kind: "transfer",
        time: minutesToTime(startMinutes),
        duration_minutes: Math.max(1, Math.round(durationMinutes)),
        title: `${from.name || "Tappa"} → ${to.name || "Tappa"}`,
        description: source === "osrm"
            ? "Tempo stradale ricalcolato online sulla rete viaria OpenStreetMap."
            : "Tempo di trasferimento stimato localmente (offline).",
        _planner_transfer: true,
        _locked: true,
        _uid: `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
}


async function plannerTravelBetween(from, to, useNetwork) {

    const key = `${Number(from.lat).toFixed(5)},${Number(from.lon).toFixed(5)}>${Number(to.lat).toFixed(5)},${Number(to.lon).toFixed(5)}`;

    if (plannerRouteCache.has(key)) {
        return plannerRouteCache.get(key);
    }

    if (useNetwork && navigator.onLine) {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&steps=false`;
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                const route = data?.routes?.[0];
                if (route && Number(route.duration) > 0) {
                    const result = {
                        minutes: Math.max(3, Math.round(Number(route.duration) / 60)),
                        km: Number(route.distance || 0) / 1000,
                        source: "osrm"
                    };
                    plannerRouteCache.set(key, result);
                    return result;
                }
            }
        }
        catch (error) {
            console.warn("Routing online non disponibile, uso stima locale:", error);
        }
    }

    const km = plannerDistanceKM(from, to);
    const roadKM = km * 1.32;
    const minutes = Math.max(7, Math.round((roadKM / 31) * 60 + 4));
    const fallback = { minutes, km: roadKM, source: "estimate" };
    plannerRouteCache.set(key, fallback);
    return fallback;
}


function plannerEstimateSequenceDriving(date, blocks) {
    let current = plannerStartingLocation(date);
    let total = 0;

    blocks.forEach(block => {
        if (block._flight_constraint) {
            const location = plannerBlockLocation(block);
            if (current && location) {
                total += plannerEstimateTravelMinutes(current, location);
                current = location;
            }
            return;
        }

        const location = plannerBlockLocation(block);
        if (!location) {
            return;
        }

        if (current) {
            total += plannerEstimateTravelMinutes(current, location);
        }

        current = location;
    });

    const endingLocation = plannerEndingLocation(date);

    if (
        current &&
        endingLocation &&
        !plannerSameLocation(current, endingLocation)
    ) {
        total += plannerEstimateTravelMinutes(
            current,
            endingLocation
        );
    }

    return total;
}


function plannerEstimateTravelMinutes(from, to) {
    if (!from || !to || plannerSameLocation(from, to)) {
        return 0;
    }
    const km = plannerDistanceKM(from, to) * 1.32;
    return Math.max(7, Math.round((km / 31) * 60 + 4));
}


function plannerStartingLocation(date) {
    if (date === "2026-09-13") {
        return { ...PLANNER_AIRPORT };
    }

    return { ...PLANNER_BASE };
}


function plannerEndingLocation(date) {
    if (date === "2026-09-20") {
        return { ...PLANNER_AIRPORT };
    }

    return { ...PLANNER_BASE };
}


function plannerBlockLocation(block) {
    if (!block) {
        return null;
    }

    if (block.poi_id) {
        const raw = plannerRawPOIs.get(block.poi_id);
        if (raw && plannerHasCoordinates(raw)) {
            return { name: raw.name, lat: Number(raw.lat), lon: Number(raw.lon) };
        }

        if (typeof poiIndex !== "undefined") {
            const normalized = poiIndex.get(block.poi_id);
            if (normalized && plannerHasCoordinates(normalized)) {
                return { name: normalized.name, lat: Number(normalized.lat), lon: Number(normalized.lon) };
            }
        }
    }

    if (block.custom_location && plannerHasCoordinates(block.custom_location)) {
        return {
            name: block.custom_location.name || block.title || "Località",
            lat: Number(block.custom_location.lat),
            lon: Number(block.custom_location.lon)
        };
    }

    return null;
}


function plannerPOIDuration(poi) {
    const practical = poi.practical || {};
    const numeric = practical.duration_recommended ?? practical.duration_min;
    if (Number.isFinite(Number(numeric))) {
        return Math.max(20, Number(numeric));
    }

    const text = String(practical.duration || "");
    const minuteRange = text.match(/(\d+)\s*[-–]\s*(\d+)\s*min/i);
    if (minuteRange) {
        return Math.round((Number(minuteRange[1]) + Number(minuteRange[2])) / 2);
    }

    const hourRange = text.match(/(\d+)\s*[-–]\s*(\d+)\s*ore?/i);
    if (hourRange) {
        return Math.round(((Number(hourRange[1]) + Number(hourRange[2])) / 2) * 60);
    }

    if (poi.type === "food") return 60;
    if (poi.type === "adventure") return 150;
    return 60;
}


function isPlannerPOIUsable(poi) {
    return Boolean(
        poi &&
        poi.id &&
        poi.name &&
        poi.id !== PLANNER_BASE.id &&
        plannerHasCoordinates(poi)
    );
}


function plannerHasCoordinates(value) {
    return Number.isFinite(Number(value?.lat)) && Number.isFinite(Number(value?.lon));
}


function plannerSameLocation(a, b) {
    if (!plannerHasCoordinates(a) || !plannerHasCoordinates(b)) {
        return false;
    }
    return plannerDistanceKM(a, b) < 0.12;
}


function plannerDistanceKM(a, b) {
    const lat1 = Number(a.lat);
    const lon1 = Number(a.lon);
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lon);

    const R = 6371;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}


function plannerPOIMatchesZone(poi, zoneKey) {
    const meta = PLANNER_ZONE_META[zoneKey];
    if (!meta) {
        return false;
    }
    const text = normalizePlannerText(`${poi.area} ${poi.name} ${(poi.tags || []).join(" ")}`);
    return meta.patterns.some(pattern => text.includes(normalizePlannerText(pattern)));
}


function plannerPOIText(poi) {
    return normalizePlannerText([
        poi.name,
        poi.area,
        ...(poi.categories || []),
        ...(poi.tags || []),
        poi.description || "",
        poi.why_go || ""
    ].join(" "));
}


function inferThemeWeightsFromDay(day) {
    return inferThemeWeightsFromText(`${day.theme || ""} ${day.title || ""}`);
}


function inferThemeWeightsFromText(text) {
    const normalized = normalizePlannerText(text);
    const result = {};

    Object.entries(PLANNER_THEME_META).forEach(([key, meta]) => {
        let hits = 0;
        (meta.keywords || []).forEach(keyword => {
            if (normalized.includes(normalizePlannerText(keyword))) {
                hits++;
            }
        });
        if (hits > 0) {
            result[key] = Math.min(3, 1 + Math.floor(hits / 2));
        }
    });

    if (!Object.keys(result).length) {
        result.nature = 1;
        result.culture = 1;
    }

    return result;
}


function inferZonesFromDay(day) {
    return inferZonesFromBlocks(day.blocks || []);
}


function inferZonesFromBlocks(blocks) {
    const counts = {};
    blocks.forEach(block => {
        const raw = block.poi_id ? plannerRawPOIs.get(block.poi_id) : null;
        if (!raw) {
            return;
        }
        Object.keys(PLANNER_ZONE_META).forEach(zone => {
            if (plannerPOIMatchesZone(raw, zone)) {
                counts[zone] = (counts[zone] || 0) + 1;
            }
        });
    });

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([zone]) => zone);
}


function firstPlannerBlockTime(blocks) {
    const block = blocks.find(item => item.time && item.kind !== "transfer");
    return block?.time || null;
}


function normalizePlannerText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}


function formatPlannerDate(dateString) {
    if (!dateString) {
        return "";
    }
    const date = new Date(`${dateString}T12:00:00`);
    return new Intl.DateTimeFormat("it-IT", {
        weekday: "short",
        day: "2-digit",
        month: "short"
    }).format(date);
}


function setPlannerStatus(message, state = "") {
    const element = document.getElementById("planner-status");
    if (!element) {
        return;
    }
    element.className = `planner-status${state ? ` ${state}` : ""}`;
    element.textContent = message;
}


function openPlannerModal(id) {
    document.getElementById(id)?.classList.add("open");
}


function closePlannerModal(id) {
    document.getElementById(id)?.classList.remove("open");
}


function plannerDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function escapePlanner(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


// ======================================================
// DIARIO AUTOMATICO DA "GIORNATA COMPLETATA"
// ======================================================

function hookDiaryCompletionPlanner() {
    const button = document.getElementById("complete-day");
    if (!button || button.dataset.plannerDiaryHook === "1") {
        return;
    }

    button.dataset.plannerDiaryHook = "1";

    button.addEventListener("click", () => {
        setTimeout(async () => {
            const day = itineraryData.days[currentDayIndex];
            if (day && day._completed) {
                await upsertPlannerDiaryFromCompletedDay(day);
            }
        }, 250);
    });
}


async function upsertPlannerDiaryFromCompletedDay(day) {
    try {
        const diary = (await TravelStore.get(PLANNER_DIARY_KEY)) || [];
        const expenses = (await TravelStore.get(PLANNER_EXPENSES_KEY)) || [];
        const budgetSettings = (await TravelStore.get(PLANNER_BUDGET_SETTINGS_KEY)) || { fxRate: 50 };

        const pois = day.blocks
            .filter(block => block.poi_id)
            .map(block => {
                const raw = plannerRawPOIs.get(block.poi_id);
                return {
                    id: block.poi_id,
                    type: block.poi_type || raw?.type || "place",
                    name: raw?.name || block.title,
                    area: raw?.area || ""
                };
            });

        const dayExpenses = expenses.filter(expense => expense.date === day.date);
        const totalEUR = dayExpenses.reduce((sum, expense) => {
            if (Number.isFinite(Number(expense.amountEUR))) {
                return sum + Number(expense.amountEUR);
            }
            const value = Number(expense.amount || 0);
            if (expense.currency === "MUR") {
                return sum + value / (Number(expense.fxRate || budgetSettings.fxRate) || 50);
            }
            return sum + value;
        }, 0);

        let weatherText = "";
        try {
            if (
                typeof currentLiveSnapshot !== "undefined" &&
                currentLiveSnapshot &&
                currentLiveSnapshot.dayDate === day.date &&
                currentLiveSnapshot.available
            ) {
                weatherText = currentLiveSnapshot.assessment?.reasons?.join(" · ") || "";
            }
        }
        catch (_) {
            weatherText = "";
        }

        const entryID = `itinerary-${day.date}`;
        const existingIndex = diary.findIndex(item => item.id === entryID);
        const existing = existingIndex >= 0 ? diary[existingIndex] : {};

        const automaticText = [
            "Giornata creata automaticamente dall'itinerario completato.",
            `Tappe registrate: ${pois.length}.`,
            dayExpenses.length
                ? `Spese registrate: ${dayExpenses.length} · circa ${totalEUR.toFixed(2)} €.`
                : "Nessuna spesa registrata per questa data."
        ].join(" ");

        const entry = {
            ...existing,
            id: entryID,
            source: "itinerary",
            date: day.date,
            rating: Number(existing.rating) || 5,
            title: day.title,
            auto_text: automaticText,
            text: existing.text || automaticText,
            food: existing.food || "",
            weather: existing.weather || weatherText,
            pois,
            photo: existing.photo || null,
            created_at: existing.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (existingIndex >= 0) {
            diary[existingIndex] = entry;
        }
        else {
            diary.unshift(entry);
        }

        await TravelStore.set(PLANNER_DIARY_KEY, diary);
    }
    catch (error) {
        console.error("Errore collegamento Itinerario → Diario:", error);
    }
}
