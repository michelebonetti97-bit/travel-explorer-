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
        initMap();
        renderDay(0);
        bindGlobalActions();

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

    day.blocks.push({
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
    });

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
