// ======================================================
// TRAVEL EXPLORER - DIARIO V1.1 ROBUSTO
// ======================================================

const DIARY_KEY = "mauritius-2026-diary";

const DIARY_DATABASES = {
    place: "places.json",
    culture: "culture.json",
    food: "food.json",
    adventure: "adventure.json"
};

let diaryEntries = [];
let diaryPOIs = [];
let selectedPOIs = [];
let editingEntryId = null;


document.addEventListener(
    "DOMContentLoaded",
    initDiary
);


async function initDiary() {

    setDiaryStatus(
        "Caricamento diario…"
    );

    try {

        if (
            typeof TravelStore ===
            "undefined"
        ) {

            throw new Error(
                "travel-store.js non caricato"
            );

        }

        const stored =
            await TravelStore.get(
                DIARY_KEY
            );

        diaryEntries =
            normalizeDiaryEntries(
                stored
            );

    }

    catch (error) {

        console.error(
            "Errore lettura diario:",
            error
        );

        diaryEntries = [];

        setDiaryStatus(
            "⚠️ Non riesco a leggere il salvataggio locale. Il diario resta utilizzabile, ma controlla travel-store.js.",
            true
        );

    }

    bindDiaryControls();

    const dateInput =
        document.getElementById(
            "diary-date"
        );

    if (dateInput) {

        dateInput.value =
            toISODate(
                new Date()
            );

    }

    renderDiary();
    renderSelectedPOIs();

    // Carichiamo i 400 POI DOPO aver reso operativo il diario.
    try {

        await loadDiaryPOIs();

        setDiaryStatus(
            `✅ Diario pronto · ${diaryPOIs.length} POI disponibili per collegare i luoghi visitati.`
        );

    }

    catch (error) {

        console.error(
            "Errore caricamento POI:",
            error
        );

        setDiaryStatus(
            "⚠️ Diario pronto, ma la ricerca tra i 400 POI non è disponibile. Controlla Live Server e la cartella data/.",
            true
        );

    }

}


function bindDiaryControls() {

    const search =
        document.getElementById(
            "poi-search"
        );

    const save =
        document.getElementById(
            "save-diary-entry"
        );

    if (search) {

        search.addEventListener(
            "input",
            event =>
                renderPOISearch(
                    event.target.value
                )
        );

    }

    if (save) {

        save.addEventListener(
            "click",
            saveDiaryEntry
        );

    }

    const cancel =
        document.getElementById(
            "cancel-diary-edit"
        );

    if (cancel) {

        cancel.addEventListener(
            "click",
            cancelDiaryEdit
        );

    }

}


function normalizeDiaryEntries(
    raw
) {

    if (
        !Array.isArray(raw)
    ) {
        return [];
    }

    return raw.map(
        entry => ({
            id:
                entry.id ||
                (
                    "diary-" +
                    Date.now() +
                    "-" +
                    Math.random()
                        .toString(36)
                        .slice(2, 7)
                ),
            date:
                entry.date ||
                "",
            rating:
                Number(
                    entry.rating
                ) || 5,
            title:
                entry.title ||
                "",
            text:
                entry.text ||
                "",
            food:
                entry.food ||
                "",
            weather:
                entry.weather ||
                "",
            pois:
                Array.isArray(
                    entry.pois
                )
                    ? entry.pois
                    : [],
            photo:
                entry.photo ||
                null,
            source:
                entry.source ||
                (String(entry.id || "").startsWith("itinerary-") ? "itinerary" : "manual"),
            auto_text:
                entry.auto_text ||
                "",
            created_at:
                entry.created_at ||
                new Date()
                    .toISOString(),
            updated_at:
                entry.updated_at ||
                entry.created_at ||
                new Date()
                    .toISOString()
        })
    );

}


async function loadDiaryPOIs() {

    diaryPOIs = [];

    const jobs =
        Object.entries(
            DIARY_DATABASES
        )
        .map(
            async (
                [type, file]
            ) => {

                try {

                    const response =
                        await fetch(
                            "data/" +
                            file,
                            {
                                cache:
                                    "no-store"
                            }
                        );

                    if (
                        !response.ok
                    ) {

                        console.warn(
                            "File POI non caricato:",
                            file,
                            response.status
                        );

                        return [];

                    }

                    const data =
                        await response.json();

                    if (
                        !Array.isArray(
                            data
                        )
                    ) {

                        console.warn(
                            "JSON non è un array:",
                            file
                        );

                        return [];

                    }

                    return data.map(
                        item => ({
                            id:
                                item.id,
                            type,
                            name:
                                item.name ||
                                item.id ||
                                "POI",
                            area:
                                item.area ||
                                ""
                        })
                    )
                    .filter(
                        item =>
                            item.id
                    );

                }

                catch (error) {

                    console.error(
                        "Errore in",
                        file,
                        error
                    );

                    return [];

                }

            }
        );

    const results =
        await Promise.all(
            jobs
        );

    diaryPOIs =
        results.flat();

    if (
        diaryPOIs.length ===
        0
    ) {

        throw new Error(
            "Nessun POI caricato"
        );

    }

}


function renderPOISearch(
    query
) {

    const container =
        document.getElementById(
            "poi-search-results"
        );

    if (!container) {
        return;
    }

    const normalized =
        String(
            query || ""
        )
        .trim()
        .toLowerCase();

    if (
        normalized.length <
        2
    ) {

        container.innerHTML =
            "";

        return;

    }

    if (
        !diaryPOIs.length
    ) {

        container.innerHTML = `
            <div class="empty">
                I POI non sono ancora disponibili. Il diario può comunque essere salvato senza collegare un luogo.
            </div>
        `;

        return;

    }

    const selectedIDs =
        new Set(
            selectedPOIs.map(
                item =>
                    item.id
            )
        );

    const results =
        diaryPOIs
            .filter(
                poi =>
                    !selectedIDs.has(
                        poi.id
                    )
            )
            .filter(
                poi =>
                    (
                        String(
                            poi.name
                        ) +
                        " " +
                        String(
                            poi.area
                        )
                    )
                    .toLowerCase()
                    .includes(
                        normalized
                    )
            )
            .slice(
                0,
                25
            );

    if (
        !results.length
    ) {

        container.innerHTML = `
            <div class="empty">
                Nessun POI trovato per “${escapeDiary(query)}”.
            </div>
        `;

        return;

    }

    container.innerHTML =
        "";

    results.forEach(
        poi => {

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "poi-search-button";

            button.innerHTML = `
                <strong>
                    ${escapeDiary(
                        poi.name
                    )}
                </strong>

                <div class="muted">
                    ${escapeDiary(
                        poi.area
                    )}
                    ·
                    ${escapeDiary(
                        typeLabel(
                            poi.type
                        )
                    )}
                </div>
            `;

            button.addEventListener(
                "click",
                () => {

                    if (
                        !selectedPOIs
                            .some(
                                item =>
                                    item.id ===
                                    poi.id
                            )
                    ) {

                        selectedPOIs.push({
                            ...poi
                        });

                    }

                    const search =
                        document.getElementById(
                            "poi-search"
                        );

                    if (search) {
                        search.value =
                            "";
                    }

                    container.innerHTML =
                        "";

                    renderSelectedPOIs();

                }
            );

            container.appendChild(
                button
            );

        }
    );

}


function renderSelectedPOIs() {

    const container =
        document.getElementById(
            "selected-pois"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        "";

    selectedPOIs.forEach(
        poi => {

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "tag";

            button.textContent =
                "📍 " +
                poi.name +
                " ✕";

            button.addEventListener(
                "click",
                () => {

                    selectedPOIs =
                        selectedPOIs.filter(
                            item =>
                                item.id !==
                                poi.id
                        );

                    renderSelectedPOIs();

                }
            );

            container.appendChild(
                button
            );

        }
    );

}


async function saveDiaryEntry() {

    const title =
        fieldValue(
            "diary-title"
        ).trim();

    const text =
        fieldValue(
            "diary-text"
        ).trim();

    if (
        !title &&
        !text &&
        !selectedPOIs.length
    ) {

        alert(
            "Scrivi almeno una nota, un titolo oppure seleziona un luogo visitato."
        );

        return;

    }

    const photoInput =
        document.getElementById(
            "diary-photo"
        );

    const newPhoto =
        photoInput?.files?.[0] ||
        null;

    const storedPhotoBlob =
        newPhoto
            ? await compressTravelImage(newPhoto, 1800, 0.84)
            : null;

    const existing =
        editingEntryId
            ? diaryEntries.find(
                item =>
                    item.id ===
                    editingEntryId
            )
            : null;

    const entry = {
        ...(existing || {}),
        id:
            existing?.id ||
            (
                "diary-" +
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .slice(2, 6)
            ),
        date:
            fieldValue(
                "diary-date"
            ),
        rating:
            Number(
                fieldValue(
                    "diary-rating"
                )
            ) || 5,
        title,
        text,
        food:
            fieldValue(
                "diary-food"
            ).trim(),
        weather:
            fieldValue(
                "diary-weather"
            ).trim(),
        pois:
            selectedPOIs.map(
                item => ({
                    id:
                        item.id,
                    type:
                        item.type,
                    name:
                        item.name,
                    area:
                        item.area
                })
            ),
        photo:
            newPhoto
                ? {
                    name:
                        newPhoto.name,
                    type:
                        storedPhotoBlob.type || newPhoto.type || "image/jpeg",
                    blob:
                        storedPhotoBlob
                }
                : (
                    existing?.photo ||
                    null
                ),
        source:
            existing?.source ||
            "manual",
        created_at:
            existing?.created_at ||
            new Date()
                .toISOString(),
        updated_at:
            new Date()
                .toISOString()
    };

    if (existing) {

        const index =
            diaryEntries.findIndex(
                item =>
                    item.id ===
                    existing.id
            );

        diaryEntries[index] =
            entry;

    }

    else {

        diaryEntries.unshift(
            entry
        );

    }

    try {

        await TravelStore.set(
            DIARY_KEY,
            diaryEntries
        );

    }

    catch (error) {

        console.error(
            "Errore salvataggio diario:",
            error
        );

        alert(
            "Non riesco a salvare questa nota nel database locale. Se hai allegato una foto molto grande, prova senza foto."
        );

        return;

    }

    resetDiaryForm();
    renderDiary();

    setDiaryStatus(
        existing
            ? "✅ Giornata aggiornata nel diario."
            : "✅ Nota salvata nel diario."
    );

}


function editDiaryEntry(id) {

    const entry =
        diaryEntries.find(
            item =>
                item.id === id
        );

    if (!entry) {
        return;
    }

    editingEntryId =
        entry.id;

    setFieldValue(
        "diary-date",
        entry.date || ""
    );

    setFieldValue(
        "diary-rating",
        String(
            entry.rating || 5
        )
    );

    setFieldValue(
        "diary-title",
        entry.title || ""
    );

    setFieldValue(
        "diary-text",
        entry.text || ""
    );

    setFieldValue(
        "diary-food",
        entry.food || ""
    );

    setFieldValue(
        "diary-weather",
        entry.weather || ""
    );

    selectedPOIs =
        Array.isArray(
            entry.pois
        )
            ? entry.pois.map(
                poi => ({
                    ...poi
                })
            )
            : [];

    renderSelectedPOIs();

    const save =
        document.getElementById(
            "save-diary-entry"
        );

    const cancel =
        document.getElementById(
            "cancel-diary-edit"
        );

    if (save) {
        save.textContent =
            entry.source ===
            "itinerary"
                ? "✓ Completa giornata"
                : "✓ Aggiorna nota";
    }

    if (cancel) {
        cancel.style.display =
            "inline-flex";
    }

    setDiaryStatus(
        entry.source ===
        "itinerary"
            ? "📅 Stai completando una giornata creata automaticamente dall'itinerario. Le tappe sono già inserite."
            : "✏️ Modifica nota in corso."
    );

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

}


function cancelDiaryEdit() {
    resetDiaryForm();
    setDiaryStatus(
        `✅ Diario pronto · ${diaryPOIs.length} POI disponibili per collegare eventuali tappe extra.`
    );
}


function resetDiaryForm() {

    editingEntryId =
        null;

    selectedPOIs = [];

    clearField(
        "diary-title"
    );

    clearField(
        "diary-text"
    );

    clearField(
        "diary-food"
    );

    clearField(
        "diary-weather"
    );

    const photoInput =
        document.getElementById(
            "diary-photo"
        );

    if (photoInput) {
        photoInput.value = "";
    }

    const save =
        document.getElementById(
            "save-diary-entry"
        );

    const cancel =
        document.getElementById(
            "cancel-diary-edit"
        );

    if (save) {
        save.textContent =
            "Salva nel diario";
    }

    if (cancel) {
        cancel.style.display =
            "none";
    }

    renderSelectedPOIs();

}


function renderDiary() {

    const summary =
        document.getElementById(
            "diary-summary"
        );

    const container =
        document.getElementById(
            "diary-list"
        );

    if (
        !summary ||
        !container
    ) {
        return;
    }

    const visited =
        new Set();

    diaryEntries.forEach(
        entry => {

            const pois =
                Array.isArray(
                    entry.pois
                )
                    ? entry.pois
                    : [];

            pois.forEach(
                poi => {

                    if (
                        poi &&
                        poi.id
                    ) {

                        visited.add(
                            poi.id
                        );

                    }

                }
            );

        }
    );

    const photos =
        diaryEntries.filter(
            entry =>
                Boolean(
                    entry.photo
                )
        ).length;

    const average =
        diaryEntries.length
            ? (
                diaryEntries.reduce(
                    (
                        sum,
                        entry
                    ) =>
                        sum +
                        (
                            Number(
                                entry.rating
                            ) || 0
                        ),
                    0
                ) /
                diaryEntries.length
            )
            .toFixed(1)
            : "—";

    summary.innerHTML = `
        <div class="summary-card">
            <span>NOTE</span>
            <strong>
                ${diaryEntries.length}
            </strong>
        </div>

        <div class="summary-card">
            <span>POI VISITATI</span>
            <strong>
                ${visited.size}
            </strong>
        </div>

        <div class="summary-card">
            <span>FOTO</span>
            <strong>
                ${photos}
            </strong>
        </div>

        <div class="summary-card">
            <span>VOTO MEDIO</span>
            <strong>
                ${average}
            </strong>
        </div>
    `;

    if (
        !diaryEntries.length
    ) {

        container.innerHTML = `
            <div class="empty">
                Il diario è ancora vuoto. Scrivi una nota sopra e premi “Salva nel diario”.
            </div>
        `;

        return;

    }

    container.innerHTML =
        "";

    diaryEntries
        .slice()
        .sort(
            (
                a,
                b
            ) =>
                String(
                    b.date || ""
                )
                .localeCompare(
                    String(
                        a.date || ""
                    )
                )
        )
        .forEach(
            entry => {

                const card =
                    document.createElement(
                        "div"
                    );

                card.className =
                    "item-card";

                const pois =
                    Array.isArray(
                        entry.pois
                    )
                        ? entry.pois
                        : [];

                card.innerHTML = `
                    <div class="item-top">

                        <div>
                            <h3>
                                ${escapeDiary(
                                    entry.title ||
                                    "Nota di viaggio"
                                )}
                            </h3>

                            <p>
                                ${escapeDiary(
                                    entry.date ||
                                    ""
                                )}
                            </p>
                        </div>

                        <div class="rating">
                            ${stars(
                                entry.rating
                            )}
                        </div>

                    </div>

                    ${
                        entry.text
                            ? `
                            <p>
                                ${escapeDiary(
                                    entry.text
                                )}
                            </p>
                            `
                            : ""
                    }

                    <div class="tag-row">

                        ${
                            entry.weather
                                ? `
                                <span class="tag">
                                    🌦️
                                    ${escapeDiary(
                                        entry.weather
                                    )}
                                </span>
                                `
                                : ""
                        }

                        ${
                            entry.food
                                ? `
                                <span class="tag">
                                    🍛
                                    ${escapeDiary(
                                        entry.food
                                    )}
                                </span>
                                `
                                : ""
                        }

                        ${
                            pois.map(
                                poi => `
                                    <a
                                        class="tag"
                                        href="pages/place.html?id=${encodeURIComponent(
                                            poi.id
                                        )}&type=${encodeURIComponent(
                                            poi.type
                                        )}"
                                    >
                                        📍
                                        ${escapeDiary(
                                            poi.name
                                        )}
                                    </a>
                                `
                            )
                            .join("")
                        }

                        ${
                            entry.source === "itinerary" ||
                            String(entry.id || "").startsWith("itinerary-")
                                ? `
                                <span class="tag">
                                    📅 da itinerario
                                </span>
                                `
                                : ""
                        }

                        ${
                            entry.photo
                                ? `
                                <button
                                    type="button"
                                    class="tag"
                                    data-photo="${escapeDiary(
                                        entry.id
                                    )}"
                                >
                                    🖼️ Foto
                                </button>
                                `
                                : ""
                        }

                        <button
                            type="button"
                            class="tag"
                            data-edit="${escapeDiary(
                                entry.id
                            )}"
                        >
                            ✏️ ${entry.source === "itinerary" || String(entry.id || "").startsWith("itinerary-") ? "Completa" : "Modifica"}
                        </button>

                        <button
                            type="button"
                            class="tag"
                            data-delete="${escapeDiary(
                                entry.id
                            )}"
                        >
                            ✕ Elimina
                        </button>

                    </div>
                `;

                container.appendChild(
                    card
                );

            }
        );

    container
        .querySelectorAll(
            "[data-edit]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        editDiaryEntry(
                            button.dataset
                                .edit
                        )
                );

            }
        );

    container
        .querySelectorAll(
            "[data-delete]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        deleteDiaryEntry(
                            button.dataset
                                .delete
                        )
                );

            }
        );

    container
        .querySelectorAll(
            "[data-photo]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        openDiaryPhoto(
                            button.dataset
                                .photo
                        )
                );

            }
        );

}


async function deleteDiaryEntry(
    id
) {

    const entry =
        diaryEntries.find(
            item =>
                item.id === id
        );

    if (!entry) {
        return;
    }

    if (
        !confirm(
            `Eliminare "${entry.title || "questa nota"}"?`
        )
    ) {
        return;
    }

    diaryEntries =
        diaryEntries.filter(
            item =>
                item.id !== id
        );

    try {

        await TravelStore.set(
            DIARY_KEY,
            diaryEntries
        );

        renderDiary();

    }

    catch (error) {

        console.error(
            error
        );

        alert(
            "Errore durante l'eliminazione."
        );

    }

}


function openDiaryPhoto(
    id
) {

    const entry =
        diaryEntries.find(
            item =>
                item.id === id
        );

    const blob =
        entry?.photo?.blob;

    if (!blob) {

        alert(
            "Foto non disponibile."
        );

        return;

    }

    const url =
        URL.createObjectURL(
            blob
        );

    window.open(
        url,
        "_blank"
    );

    setTimeout(
        () =>
            URL.revokeObjectURL(
                url
            ),
        60000
    );

}


function stars(value) {

    const rating =
        Math.max(
            1,
            Math.min(
                5,
                Number(value) ||
                1
            )
        );

    return (
        "★".repeat(
            rating
        ) +
        "☆".repeat(
            5 - rating
        )
    );

}


function typeLabel(type) {

    const labels = {
        place:
            "Luogo",
        culture:
            "Cultura",
        food:
            "Food",
        adventure:
            "Attività"
    };

    return (
        labels[type] ||
        type ||
        ""
    );

}


function fieldValue(id) {

    const element =
        document.getElementById(
            id
        );

    return element
        ? String(
            element.value || ""
        )
        : "";

}


function setFieldValue(id, value) {

    const element =
        document.getElementById(
            id
        );

    if (element) {
        element.value =
            value ?? "";
    }

}


function clearField(id) {

    const element =
        document.getElementById(
            id
        );

    if (element) {
        element.value =
            "";
    }

}


function setDiaryStatus(
    message,
    warning = false
) {

    const container =
        document.getElementById(
            "diary-status"
        );

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div
            class="muted"
            style="${
                warning
                    ? "color:#8b5f15;"
                    : ""
            }"
        >
            ${escapeDiary(
                message
            )}
        </div>
    `;

}


function toISODate(date) {

    return (
        date.getFullYear() +
        "-" +
        String(
            date.getMonth() +
            1
        )
        .padStart(
            2,
            "0"
        ) +
        "-" +
        String(
            date.getDate()
        )
        .padStart(
            2,
            "0"
        )
    );

}


function escapeDiary(value) {

    return String(
        value ?? ""
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

// Riduce le foto del diario prima del salvataggio IndexedDB.
async function compressTravelImage(file, maxDimension = 1800, quality = 0.84) {
    if (!file || !String(file.type || "").startsWith("image/")) {
        return file;
    }

    try {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.decoding = "async";

        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = url;
        });

        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url);

        return await new Promise(resolve => {
            canvas.toBlob(
                blob => resolve(blob || file),
                "image/jpeg",
                quality
            );
        });
    }
    catch (error) {
        console.warn("Compressione foto non disponibile, salvo originale.", error);
        return file;
    }
}
