// ======================================================
// TRAVEL EXPLORER - DOCUMENTI V1.2
// Michele / Denise / Entrambi
// ======================================================

const DOCUMENTS_KEY =
    "mauritius-2026-documents";

let documents = [];
let ownerFilter = "all";


document.addEventListener(
    "DOMContentLoaded",
    initDocuments
);


async function initDocuments() {

    try {

        const stored =
            await TravelStore.get(
                DOCUMENTS_KEY
            );

        documents =
            Array.isArray(stored)
                ? stored
                : [];

        // Retrocompatibilità:
        // tutti i vecchi documenti senza owner
        // diventano "Entrambi".
        documents =
            documents.map(
                doc => ({
                    ...doc,
                    owner:
                        doc.owner ||
                        "shared"
                })
            );

        await persistDocuments();

    }

    catch (error) {

        console.error(
            "Errore lettura documenti:",
            error
        );

        documents = [];

    }

    document
        .getElementById(
            "add-document"
        )
        .addEventListener(
            "click",
            addDocument
        );

    document
        .querySelectorAll(
            "[data-owner-filter]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        ownerFilter =
                            button.dataset
                                .ownerFilter;

                        document
                            .querySelectorAll(
                                "[data-owner-filter]"
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

                        renderDocuments();

                    }
                );

            }
        );

    renderDocuments();

}


async function persistDocuments() {

    await TravelStore.set(
        DOCUMENTS_KEY,
        documents
    );

}


async function addDocument() {

    const input =
        document.getElementById(
            "doc-file"
        );

    const file =
        input.files[0];

    if (!file) {

        alert(
            "Seleziona un file."
        );

        return;

    }

    const title =
        document
            .getElementById(
                "doc-title"
            )
            .value
            .trim() ||
        file.name;

    const doc = {
        id:
            "doc-" +
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .slice(2, 7),

        title,

        category:
            document
                .getElementById(
                    "doc-category"
                )
                .value,

        owner:
            document
                .getElementById(
                    "doc-owner"
                )
                .value,

        note:
            document
                .getElementById(
                    "doc-note"
                )
                .value
                .trim(),

        file: {
            name:
                file.name,
            type:
                file.type,
            size:
                file.size,
            blob:
                file
        },

        created_at:
            new Date()
                .toISOString()
    };

    documents.unshift(
        doc
    );

    try {

        await persistDocuments();

    }

    catch (error) {

        console.error(
            "Errore salvataggio documento:",
            error
        );

        documents.shift();

        alert(
            "Non riesco a salvare il documento. Il file potrebbe essere troppo grande per lo spazio disponibile nel browser."
        );

        return;

    }

    document
        .getElementById(
            "doc-title"
        )
        .value = "";

    document
        .getElementById(
            "doc-note"
        )
        .value = "";

    input.value = "";

    renderDocuments();

}


async function changeDocumentOwner(
    id,
    owner
) {

    const doc =
        documents.find(
            item =>
                item.id === id
        );

    if (!doc) {
        return;
    }

    doc.owner =
        owner;

    await persistDocuments();

    renderDocuments();

}


function renderDocuments() {

    const totalSize =
        documents.reduce(
            (
                sum,
                doc
            ) =>
                sum +
                Number(
                    doc.file?.size ||
                    0
                ),
            0
        );

    const micheleCount =
        documents.filter(
            doc =>
                doc.owner ===
                    "michele" ||
                doc.owner ===
                    "shared"
        ).length;

    const deniseCount =
        documents.filter(
            doc =>
                doc.owner ===
                    "denise" ||
                doc.owner ===
                    "shared"
        ).length;

    document
        .getElementById(
            "documents-summary"
        )
        .innerHTML = `
            <div class="summary-card">
                <span>DOCUMENTI</span>
                <strong>
                    ${documents.length}
                </strong>
            </div>

            <div class="summary-card">
                <span>MICHELE</span>
                <strong>
                    ${micheleCount}
                </strong>
            </div>

            <div class="summary-card">
                <span>DENISE</span>
                <strong>
                    ${deniseCount}
                </strong>
            </div>

            <div class="summary-card">
                <span>SPAZIO</span>
                <strong>
                    ${formatBytes(
                        totalSize
                    )}
                </strong>
            </div>
        `;

    const container =
        document.getElementById(
            "document-list"
        );

    const filtered =
        documents.filter(
            doc =>
                ownerFilter ===
                    "all" ||
                doc.owner ===
                    ownerFilter
        );

    if (!filtered.length) {

        container.innerHTML = `
            <div class="empty">
                ${
                    documents.length
                        ? "Nessun documento per questo filtro."
                        : "Nessun documento salvato."
                }
            </div>
        `;

        return;

    }

    container.innerHTML =
        "";

    filtered.forEach(
        doc => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "item-card";

            card.innerHTML = `
                <div class="item-top">

                    <div>
                        <h3>
                            ${docIcon(
                                doc.file?.type
                            )}
                            ${escapeDoc(
                                doc.title
                            )}
                        </h3>

                        <p>
                            ${escapeDoc(
                                doc.category
                            )}
                            ·
                            ${formatBytes(
                                doc.file?.size ||
                                0
                            )}
                        </p>
                    </div>

                </div>

                ${
                    doc.note
                        ? `
                        <p>
                            ${escapeDoc(
                                doc.note
                            )}
                        </p>
                        `
                        : ""
                }

                <div class="tag-row">

                    <select
                        class="owner-select"
                        data-owner="${escapeDoc(
                            doc.id
                        )}"
                    >
                        <option
                            value="shared"
                            ${doc.owner === "shared" ? "selected" : ""}
                        >
                            👥 Entrambi
                        </option>

                        <option
                            value="michele"
                            ${doc.owner === "michele" ? "selected" : ""}
                        >
                            👤 Michele
                        </option>

                        <option
                            value="denise"
                            ${doc.owner === "denise" ? "selected" : ""}
                        >
                            👤 Denise
                        </option>
                    </select>

                    <button
                        type="button"
                        class="tag"
                        data-open="${escapeDoc(
                            doc.id
                        )}"
                    >
                        Apri
                    </button>

                    <button
                        type="button"
                        class="tag"
                        data-delete="${escapeDoc(
                            doc.id
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
            "[data-owner]"
        )
        .forEach(
            select => {

                select.addEventListener(
                    "change",
                    () =>
                        changeDocumentOwner(
                            select.dataset
                                .owner,
                            select.value
                        )
                );

            }
        );

    container
        .querySelectorAll(
            "[data-open]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        openDocument(
                            button.dataset
                                .open
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
                        deleteDocument(
                            button.dataset
                                .delete
                        )
                );

            }
        );

}


function openDocument(id) {

    const doc =
        documents.find(
            item =>
                item.id === id
        );

    const blob =
        doc?.file?.blob;

    if (!blob) {

        alert(
            "File non disponibile."
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


async function deleteDocument(id) {

    const doc =
        documents.find(
            item =>
                item.id === id
        );

    if (!doc) {
        return;
    }

    if (
        !confirm(
            `Eliminare "${doc.title}"?`
        )
    ) {
        return;
    }

    documents =
        documents.filter(
            item =>
                item.id !== id
        );

    await persistDocuments();

    renderDocuments();

}


function docIcon(type) {

    if (
        String(type)
            .includes(
                "pdf"
            )
    ) {
        return "📕";
    }

    if (
        String(type)
            .startsWith(
                "image/"
            )
    ) {
        return "🖼️";
    }

    return "📄";

}


function formatBytes(bytes) {

    const value =
        Number(bytes) ||
        0;

    if (
        value <
        1024
    ) {
        return value +
            " B";
    }

    if (
        value <
        1024 *
        1024
    ) {

        return (
            value /
            1024
        )
        .toFixed(1) +
        " KB";

    }

    return (
        value /
        1024 /
        1024
    )
    .toFixed(1) +
    " MB";

}


function escapeDoc(value) {

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