// ======================================================
// TRAVEL EXPLORER - FLEX ITINERARY V5
// Template intercambiabili + bilanciamento + Diario automatico
// Si appoggia al motore Itinerario/AI già esistente: NON lo sostituisce.
// ======================================================

const FLEX_TEMPLATE_PATH =
    "data/route-templates.json";

const FLEX_DIARY_KEY =
    "mauritius-2026-diary";

const FLEX_EXPENSES_KEY =
    "mauritius-2026-expenses";

const FLEX_BUDGET_SETTINGS_KEY =
    "mauritius-2026-budget-settings";

const FLEX_TEMPLATE_ADDITIONS_KEY =
    "mauritius-2026-template-additions-v1";

let flexTemplates = [];
let flexReady = false;


document.addEventListener(
    "DOMContentLoaded",
    () => {
        waitForItineraryEngine();
    }
);


async function waitForItineraryEngine() {

    let attempts = 0;

    while (
        attempts < 100
    ) {

        attempts++;

        if (
            typeof itineraryData !==
                "undefined" &&
            itineraryData &&
            Array.isArray(
                itineraryData.days
            ) &&
            typeof renderDay ===
                "function" &&
            typeof persistItinerary ===
                "function"
        ) {

            await initFlexibleItinerary();
            return;

        }

        await delayFlex(100);

    }

    console.error(
        "Flex V5: motore itinerario non pronto."
    );

}


async function initFlexibleItinerary() {

    try {

        const response =
            await fetch(
                FLEX_TEMPLATE_PATH,
                {
                    cache:
                        "no-store"
                }
            );

        if (!response.ok) {

            throw new Error(
                "route-templates.json non disponibile"
            );

        }

        const payload =
            await response.json();

        flexTemplates =
            Array.isArray(
                payload.templates
            )
                ? payload.templates
                : [];

    }

    catch (error) {

        console.error(
            error
        );

        flexTemplates = [];

    }

    inferCurrentTemplateIDs();
    injectFlexiblePanel();
    hookRenderDay();
    hookDiaryCompletion();

    flexReady = true;

    refreshFlexiblePanel();

}


function inferCurrentTemplateIDs() {

    if (
        !flexTemplates.length
    ) {
        return;
    }

    itineraryData.days.forEach(
        (
            day,
            index
        ) => {

            if (
                index === 0 ||
                index ===
                    itineraryData.days.length -
                    1
            ) {

                day._template_fixed =
                    true;

                return;

            }

            if (
                day._template_id
            ) {
                return;
            }

            const normalizedTitle =
                normalizeFlexText(
                    day.title
                );

            const match =
                flexTemplates.find(
                    template =>
                        template.source_group ===
                            "original" &&
                        normalizeFlexText(
                            template.title
                        ) ===
                        normalizedTitle
                );

            if (match) {

                day._template_id =
                    match.id;

                day._template_source =
                    match.source;

            }

        }
    );

}


function injectFlexiblePanel() {

    if (
        document.getElementById(
            "flex-itinerary-panel"
        )
    ) {
        return;
    }

    const selector =
        document.getElementById(
            "day-selector"
        );

    if (!selector) {
        return;
    }

    const style =
        document.createElement(
            "style"
        );

    style.textContent = `
        .flex-itinerary-panel {
            background: white;
            border-radius: 22px;
            padding: 16px;
            margin-bottom: 14px;
            box-shadow: 0 5px 20px rgba(0,0,0,.05);
        }

        .flex-itinerary-panel h2 {
            margin: 0 0 5px;
            font-size: 18px;
        }

        .flex-itinerary-panel > p {
            margin: 0 0 12px;
            color: #77777c;
            font-size: 10px;
            line-height: 1.45;
        }

        .flex-select-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px;
        }

        .flex-select {
            width: 100%;
            min-width: 0;
            padding: 12px;
            border: 1px solid #dedee3;
            border-radius: 14px;
            background: #f8f8fa;
            color: #1d1d1f;
            font-size: 12px;
            font-weight: 700;
        }

        .flex-apply {
            border: 0;
            border-radius: 14px;
            padding: 0 14px;
            background: #1d1d1f;
            color: white;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
        }

        .flex-template-note {
            margin-top: 9px;
            padding: 10px;
            border-radius: 12px;
            background: #f5f5f7;
            color: #6e6e73;
            font-size: 10px;
            line-height: 1.4;
        }

        .trip-balance {
            margin-top: 11px;
            padding: 12px;
            border-radius: 15px;
            background: #eef6ff;
        }

        .trip-balance strong {
            font-size: 13px;
        }

        .trip-balance p {
            margin: 5px 0 0;
            color: #536577;
            font-size: 10px;
            line-height: 1.45;
        }

        .trip-balance.good {
            background: #eaf7ed;
        }

        .trip-balance.good p {
            color: #356847;
        }

        .trip-balance.warn {
            background: #fff8e8;
        }

        .trip-balance.warn p {
            color: #715a20;
        }

        .fixed-day-box {
            padding: 12px;
            border-radius: 14px;
            background: #f5f5f7;
            color: #636368;
            font-size: 11px;
            line-height: 1.45;
        }
    `;

    document.head.appendChild(
        style
    );

    const panel =
        document.createElement(
            "section"
        );

    panel.id =
        "flex-itinerary-panel";

    panel.className =
        "flex-itinerary-panel";

    panel.innerHTML = `
        <h2>🎛️ Scegli la giornata</h2>

        <p>
            Arrivo e partenza restano fissi.
            Nei sei giorni centrali puoi usare sia gli itinerari Travel Explorer sia i 7 Dede.
            Tutti i lucchetti, Ricalcolo AI, meteo live e deviazioni restano attivi.
        </p>

        <div id="flex-selector-content"></div>

        <div
            id="trip-balance"
            class="trip-balance"
        ></div>
    `;

    selector.insertAdjacentElement(
        "afterend",
        panel
    );

}


function hookRenderDay() {

    if (
        renderDay._flexWrapped
    ) {
        return;
    }

    const original =
        renderDay;

    const wrapped =
        function (
            index
        ) {

            const result =
                original(
                    index
                );

            setTimeout(
                refreshFlexiblePanel,
                0
            );

            return result;

        };

    wrapped._flexWrapped =
        true;

    renderDay =
        wrapped;

}


function refreshFlexiblePanel() {

    const content =
        document.getElementById(
            "flex-selector-content"
        );

    if (
        !content ||
        !itineraryData
    ) {
        return;
    }

    const day =
        itineraryData.days[
            currentDayIndex
        ];

    const isFixed =
        currentDayIndex ===
            0 ||
        currentDayIndex ===
            itineraryData.days.length -
            1;

    if (isFixed) {

        content.innerHTML = `
            <div class="fixed-day-box">
                🔒 <strong>Giornata fissa</strong><br>
                ${escapeFlex(
                    day.title
                )}.
                Gli orari di arrivo/partenza e i voli non vengono sostituiti dai template.
            </div>
        `;

    }

    else {

        content.innerHTML = `
            <div class="flex-select-row">
                <select
                    id="route-template-select"
                    class="flex-select"
                ></select>

                <button
                    id="route-template-apply"
                    class="flex-apply"
                >
                    Applica
                </button>
            </div>

            <div
                id="route-template-note"
                class="flex-template-note"
            ></div>
        `;

        fillTemplateSelect(
            day
        );

        document
            .getElementById(
                "route-template-apply"
            )
            .addEventListener(
                "click",
                applySelectedTemplate
            );

        document
            .getElementById(
                "route-template-select"
            )
            .addEventListener(
                "change",
                updateTemplateNote
            );

        updateTemplateNote();

    }

    renderTripBalance();

}


function fillTemplateSelect(
    day
) {

    const select =
        document.getElementById(
            "route-template-select"
        );

    if (!select) {
        return;
    }

    select.innerHTML =
        "";

    const groups = [
        {
            key:
                "original",
            label:
                "Travel Explorer · originali"
        },
        {
            key:
                "dede",
            label:
                "💛 Dede File · 7 itinerari"
        }
    ];

    groups.forEach(
        group => {

            const optgroup =
                document.createElement(
                    "optgroup"
                );

            optgroup.label =
                group.label;

            flexTemplates
                .filter(
                    template =>
                        template.source_group ===
                        group.key
                )
                .forEach(
                    template => {

                        const option =
                            document.createElement(
                                "option"
                            );

                        option.value =
                            template.id;

                        option.textContent =
                            template.label ||
                            template.title;

                        if (
                            template.id ===
                            day._template_id
                        ) {
                            option.selected =
                                true;
                        }

                        optgroup.appendChild(
                            option
                        );

                    }
                );

            select.appendChild(
                optgroup
            );

        }
    );

    if (
        !day._template_id &&
        select.options.length
    ) {

        select.selectedIndex =
            0;

    }

}


function updateTemplateNote() {

    const select =
        document.getElementById(
            "route-template-select"
        );

    const note =
        document.getElementById(
            "route-template-note"
        );

    if (
        !select ||
        !note
    ) {
        return;
    }

    const template =
        flexTemplates.find(
            item =>
                item.id ===
                select.value
        );

    if (!template) {

        note.textContent =
            "";

        return;

    }

    note.innerHTML = `
        <strong>
            ${escapeFlex(
                template.source
            )}
        </strong>
        ·
        ${escapeFlex(
            template.theme ||
            ""
        )}
        <br>
        ${
            escapeFlex(
                template.template_note ||
                "Puoi modificarlo dopo l'applicazione come qualsiasi altra giornata."
            )
        }
    `;

}


function insertFlexTemplateAdditionSmart(
    day,
    block
) {

    if (!Array.isArray(day.blocks)) {
        day.blocks = [];
    }

    let insertIndex =
        day.blocks.length;

    for (
        let index = day.blocks.length - 1;
        index >= 0;
        index--
    ) {

        const current =
            day.blocks[index];

        const title =
            String(
                current.title ||
                ""
            )
            .toLowerCase();

        const finalBlock =
            current.kind ===
                "hotel" ||
            (
                current.kind ===
                    "transfer" &&
                (
                    title.includes(
                        "tamarin"
                    ) ||
                    title.includes(
                        "rientro"
                    ) ||
                    title.includes(
                        "hotel"
                    )
                )
            );

        if (finalBlock) {
            insertIndex =
                index;
            continue;
        }

        break;

    }

    day.blocks.splice(
        insertIndex,
        0,
        block
    );

}


async function getFlexTemplateAdditions(
    templateID
) {

    try {

        const all =
            await TravelStore.get(
                FLEX_TEMPLATE_ADDITIONS_KEY
            ) || {};

        const additions =
            all[templateID];

        return Array.isArray(
            additions
        )
            ? additions
            : [];

    }

    catch (error) {

        console.error(
            "Errore caricamento POI aggiunti al template:",
            error
        );

        return [];

    }

}


async function applySelectedTemplate() {

    const select =
        document.getElementById(
            "route-template-select"
        );

    if (!select) {
        return;
    }

    const template =
        flexTemplates.find(
            item =>
                item.id ===
                select.value
        );

    if (!template) {
        return;
    }

    if (
        currentDayIndex ===
            0 ||
        currentDayIndex ===
            itineraryData.days.length -
            1
    ) {

        alert(
            "Il primo e l'ultimo giorno sono fissi."
        );

        return;

    }

    const current =
        itineraryData.days[
            currentDayIndex
        ];

    const date =
        current.date;

    const ok =
        confirm(
            `Usare "${template.label || template.title}" per ${date}? Le modifiche non bloccate della giornata corrente verranno sostituite.`
        );

    if (!ok) {
        return;
    }

    const newDay =
        deepClone(
            template
        );

    delete newDay.id;
    delete newDay.label;
    delete newDay.source_group;
    delete newDay.source;
    delete newDay.template_note;

    const templateAdditions =
        await getFlexTemplateAdditions(
            template.id
        );

    if (
        templateAdditions.length
    ) {

        if (!Array.isArray(newDay.blocks)) {
            newDay.blocks = [];
        }

        templateAdditions.forEach(
            addition => {

                const duplicate =
                    newDay.blocks.some(
                        block =>
                            block.poi_id &&
                            block.poi_id ===
                                addition.poi_id
                    );

                if (!duplicate) {

                    const copy =
                        deepClone(
                            addition
                        );

                    copy._uid =
                        copy._uid ||
                        (
                            "template-poi-" +
                            Date.now() +
                            "-" +
                            Math.random()
                                .toString(36)
                                .slice(2, 7)
                        );

                    copy._locked =
                        false;

                    insertFlexTemplateAdditionSmart(
                        newDay,
                        copy
                    );

                }

            }
        );

        if (
            typeof reflowDayTimes ===
                "function"
        ) {

            reflowDayTimes(
                newDay
            );

        }

    }

    newDay.date =
        date;

    newDay._template_id =
        template.id;

    newDay._template_source =
        template.source;

    newDay._completed =
        false;

    itineraryData.days[
        currentDayIndex
    ] = newDay;

    ensureEditableMetadata();

    await persistItinerary();

    renderDaySelector();

    renderDay(
        currentDayIndex
    );

}


function renderTripBalance() {

    const container =
        document.getElementById(
            "trip-balance"
        );

    if (
        !container ||
        !itineraryData
    ) {
        return;
    }

    const result =
        calculateTripBalanceV5();

    container.className =
        "trip-balance " +
        (
            result.score >= 88
                ? "good"
                : result.score >= 72
                    ? ""
                    : "warn"
        );

    container.innerHTML = `
        <strong>
            ⚖️ Equilibrio viaggio:
            ${result.score}/100
        </strong>

        <p>
            ${
                result.messages
                    .map(
                        message =>
                            escapeFlex(
                                message
                            )
                    )
                    .join("<br>")
            }
        </p>
    `;

}


function calculateTripBalanceV5() {

    const days =
        itineraryData.days
            .slice(
                1,
                -1
            );

    let score =
        100;

    const messages =
        [];

    const hard =
        days.map(
            isHardDayV5
        );

    const sea =
        days.map(
            day =>
                typeof dayHasSeaSensitivity ===
                    "function"
                    ? dayHasSeaSensitivity(
                        day
                    )
                    : false
        );

    for (
        let i = 1;
        i < days.length;
        i++
    ) {

        if (
            hard[i] &&
            hard[i - 1]
        ) {

            score -= 12;

            messages.push(
                `⚠️ Due giornate fisiche consecutive: ${days[i - 1].title} → ${days[i].title}.`
            );

        }

        if (
            sea[i] &&
            sea[i - 1]
        ) {

            score -= 7;

            messages.push(
                `🌊 Due giornate molto marine consecutive: valuta di alternarle.`
            );

        }

    }

    const highWeather =
        days.filter(
            day =>
                day.weather_dependency ===
                    "high" ||
                day.weather_dependency ===
                    "very_high"
        ).length;

    if (
        highWeather >= 5
    ) {

        score -= 7;

        messages.push(
            "🌦️ Quasi tutto il viaggio dipende molto dal meteo: tieni almeno una giornata culturale facilmente spostabile."
        );

    }

    const templateIDs =
        days
            .map(
                day =>
                    day._template_id
            )
            .filter(Boolean);

    const duplicates =
        templateIDs.filter(
            (
                id,
                index
            ) =>
                templateIDs
                    .indexOf(
                        id
                    ) !==
                index
        );

    if (
        duplicates.length
    ) {

        score -=
            Math.min(
                12,
                duplicates.length *
                6
            );

        messages.push(
            "↻ Stai usando lo stesso template più di una volta."
        );

    }

    const cultureDays =
        days.filter(
            day =>
                day.blocks.some(
                    block =>
                        block.poi_type ===
                        "culture"
                )
        ).length;

    if (
        cultureDays === 0
    ) {

        score -= 8;

        messages.push(
            "🛕 Nessuna giornata contiene una tappa culturale."
        );

    }

    if (
        !messages.length
    ) {

        messages.push(
            "✅ Buona alternanza tra attività, cultura, mare e recupero."
        );

    }

    score =
        Math.max(
            55,
            Math.min(
                100,
                score
            )
        );

    return {
        score,
        messages
    };

}


function isHardDayV5(
    day
) {

    const text =
        (
            String(
                day.title ||
                ""
            ) +
            " " +
            String(
                day.theme ||
                ""
            )
        )
        .toLowerCase();

    if (
        text.includes(
            "trekking"
        ) ||
        text.includes(
            "cascad"
        ) ||
        text.includes(
            "adventure"
        )
    ) {
        return true;
    }

    return day.blocks.some(
        block =>
            block.kind ===
                "activity" &&
            Number(
                block.duration_minutes ||
                0
            ) >=
                180
    );

}


// ======================================================
// DIARIO AUTOMATICO DA "GIORNATA COMPLETATA"
// ======================================================

function hookDiaryCompletion() {

    const button =
        document.getElementById(
            "complete-day"
        );

    if (
        !button ||
        button.dataset.flexDiaryHook ===
            "1"
    ) {
        return;
    }

    button.dataset.flexDiaryHook =
        "1";

    button.addEventListener(
        "click",
        () => {

            setTimeout(
                async () => {

                    const day =
                        itineraryData.days[
                            currentDayIndex
                        ];

                    if (
                        day &&
                        day._completed
                    ) {

                        await upsertDiaryFromCompletedDay(
                            day
                        );

                    }

                },
                250
            );

        }
    );

}


async function upsertDiaryFromCompletedDay(
    day
) {

    try {

        const diary =
            (
                await TravelStore.get(
                    FLEX_DIARY_KEY
                )
            ) || [];

        const expenses =
            (
                await TravelStore.get(
                    FLEX_EXPENSES_KEY
                )
            ) || [];

        const budgetSettings =
            (
                await TravelStore.get(
                    FLEX_BUDGET_SETTINGS_KEY
                )
            ) || {
                fxRate:
                    50
            };

        const pois =
            day.blocks
                .filter(
                    block =>
                        block.poi_id
                )
                .map(
                    block => {

                        const poi =
                            poiIndex.get(
                                block.poi_id
                            );

                        return {
                            id:
                                block.poi_id,
                            type:
                                block.poi_type ||
                                poi?.type ||
                                "place",
                            name:
                                poi?.name ||
                                block.title,
                            area:
                                poi?.area ||
                                ""
                        };

                    }
                );

        const dayExpenses =
            expenses.filter(
                expense =>
                    expense.date ===
                    day.date
            );

        const totalEUR =
            dayExpenses.reduce(
                (
                    sum,
                    expense
                ) => {

                    const value =
                        Number(
                            expense.amount ||
                            0
                        );

                    if (
                        expense.currency ===
                        "MUR"
                    ) {

                        return (
                            sum +
                            value /
                            (
                                Number(
                                    budgetSettings.fxRate
                                ) ||
                                50
                            )
                        );

                    }

                    return (
                        sum +
                        value
                    );

                },
                0
            );

        let weatherText =
            "";

        try {

            if (
                typeof currentLiveSnapshot !==
                    "undefined" &&
                currentLiveSnapshot &&
                currentLiveSnapshot.dayDate ===
                    day.date &&
                currentLiveSnapshot.available
            ) {

                weatherText =
                    currentLiveSnapshot
                        .assessment
                        ?.reasons
                        ?.join(
                            " · "
                        ) ||
                    "";

            }

        }

        catch (_) {
            weatherText = "";
        }

        const autoTextParts = [
            "Giornata creata automaticamente dall'itinerario completato.",
            `Tappe registrate: ${pois.length}.`,
            dayExpenses.length
                ? `Spese registrate: ${dayExpenses.length} · circa ${totalEUR.toFixed(2)} €.`
                : "Nessuna spesa registrata per questa data."
        ];

        const entryID =
            "itinerary-" +
            day.date;

        const existingIndex =
            diary.findIndex(
                item =>
                    item.id ===
                    entryID
            );

        const existing =
            existingIndex >= 0
                ? diary[
                    existingIndex
                ]
                : {};

        const automaticText =
            autoTextParts.join(
                " "
            );

        const entry = {
            ...existing,
            id:
                entryID,
            source:
                "itinerary",
            date:
                day.date,
            rating:
                Number(
                    existing.rating
                ) ||
                5,
            title:
                day.title,
            auto_text:
                automaticText,
            text:
                existing.text ||
                automaticText,
            food:
                existing.food ||
                "",
            weather:
                existing.weather ||
                weatherText,
            pois,
            photo:
                existing.photo ||
                null,
            created_at:
                existing.created_at ||
                new Date()
                    .toISOString(),
            updated_at:
                new Date()
                    .toISOString()
        };

        if (
            existingIndex >= 0
        ) {

            diary[
                existingIndex
            ] =
                entry;

        }

        else {

            diary.unshift(
                entry
            );

        }

        await TravelStore.set(
            FLEX_DIARY_KEY,
            diary
        );

        console.log(
            "Diario aggiornato automaticamente:",
            day.date
        );

    }

    catch (error) {

        console.error(
            "Errore collegamento Itinerario → Diario:",
            error
        );

    }

}


function normalizeFlexText(
    value
) {

    return String(
        value ||
        ""
    )
    .trim()
    .toLowerCase();

}


function escapeFlex(
    value
) {

    return String(
        value ??
        ""
    )
    .replaceAll(
        "&",
        "&amp;"
    )
    .replaceAll(
        "<",
        "&lt;"
    )
    .replaceAll(
        ">",
        "&gt;"
    )
    .replaceAll(
        '"',
        "&quot;"
    )
    .replaceAll(
        "'",
        "&#039;"
    );

}


function delayFlex(
    milliseconds
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );

}