// ======================================================
// TRAVEL EXPLORER - CHECKLIST V1.2
// Michele / Denise / Entrambi
// ======================================================

const CHECKLIST_KEY = "mauritius-2026-checklist";

const DEFAULT_CHECKLIST = [
    ["Documenti", "Passaporto", "shared"],
    ["Documenti", "Biglietti aerei / carte d'imbarco", "shared"],
    ["Documenti", "Voucher hotel", "shared"],
    ["Documenti", "Prenotazione auto", "michele"],
    ["Documenti", "Assicurazione viaggio", "shared"],
    ["Auto / guida", "Patente", "shared"],
    ["Auto / guida", "Controllare requisiti guida Mauritius", "michele"],
    ["Tecnologia", "Power bank", "shared"],
    ["Tecnologia", "Caricabatterie telefono", "shared"],
    ["Tecnologia", "Caricabatterie fotocamera / GoPro", "michele"],
    ["Tecnologia", "Schede di memoria", "michele"],
    ["Tecnologia", "Scaricare mappe e documenti offline", "michele"],
    ["Valigia", "Costume", "shared"],
    ["Valigia", "Scarpe trekking", "shared"],
    ["Valigia", "K-way / giacca antivento leggera", "shared"],
    ["Valigia", "Cappello", "shared"],
    ["Valigia", "Occhiali da sole", "shared"],
    ["Salute / sicurezza", "Protezione solare", "shared"],
    ["Salute / sicurezza", "Repellente insetti", "shared"],
    ["Salute / sicurezza", "Piccolo kit farmaci / cerotti", "shared"],
    ["Casa", "Controllare prese e utenze prima della partenza", "shared"],
    ["Altro", "Contanti / carta di backup", "shared"],
    ["Altro", "Condividere il pacchetto viaggio con Denise", "michele"]
];

let checklist = [];
let ownerFilter = "all";

document.addEventListener("DOMContentLoaded", initChecklist);

async function initChecklist() {
    checklist = await TravelStore.get(CHECKLIST_KEY);

    if (!checklist) {
        checklist = buildDefaultChecklist();
    }

    // Retrocompatibilità: tutte le vecchie voci senza assegnatario
    // vengono considerate condivise.
    checklist = checklist.map(item => ({
        ...item,
        owner: item.owner || "shared"
    }));

    await persistChecklist();

    document.getElementById("add-check")
        .addEventListener("click", addChecklistItem);

    document.getElementById("reset-checklist")
        .addEventListener("click", resetChecklist);

    document.querySelectorAll("[data-owner-filter]")
        .forEach(button => {
            button.addEventListener("click", () => {
                ownerFilter = button.dataset.ownerFilter;

                document.querySelectorAll("[data-owner-filter]")
                    .forEach(element => {
                        element.classList.remove("active");
                    });

                button.classList.add("active");
                renderChecklist();
            });
        });

    renderChecklist();
}

function buildDefaultChecklist() {
    return DEFAULT_CHECKLIST.map(
        ([category, text, owner], index) => ({
            id: "base-" + index,
            category,
            text,
            owner,
            done: false,
            created_at: new Date().toISOString()
        })
    );
}

async function persistChecklist() {
    await TravelStore.set(
        CHECKLIST_KEY,
        checklist
    );
}

async function addChecklistItem() {
    const text =
        document.getElementById("check-text").value.trim();

    if (!text) return;

    checklist.push({
        id: "check-" + Date.now(),
        category:
            document.getElementById("check-category").value,
        text,
        owner:
            document.getElementById("check-owner").value,
        done: false,
        created_at: new Date().toISOString()
    });

    document.getElementById("check-text").value = "";

    await persistChecklist();
    renderChecklist();
}

async function toggleChecklistItem(id) {
    const item =
        checklist.find(entry => entry.id === id);

    if (!item) return;

    item.done = !item.done;

    await persistChecklist();
    renderChecklist();
}

async function changeChecklistOwner(id, owner) {
    const item =
        checklist.find(entry => entry.id === id);

    if (!item) return;

    item.owner = owner;

    await persistChecklist();
    renderChecklist();
}

async function deleteChecklistItem(id) {
    checklist =
        checklist.filter(item => item.id !== id);

    await persistChecklist();
    renderChecklist();
}

async function resetChecklist() {
    if (
        !confirm(
            "Ripristinare la checklist base Mauritius? Le voci personalizzate verranno eliminate."
        )
    ) {
        return;
    }

    checklist = buildDefaultChecklist();
    ownerFilter = "all";

    document.querySelectorAll("[data-owner-filter]")
        .forEach(element => {
            element.classList.toggle(
                "active",
                element.dataset.ownerFilter === "all"
            );
        });

    await persistChecklist();
    renderChecklist();
}

function renderChecklist() {
    const done =
        checklist.filter(item => item.done).length;

    const michelePending =
        checklist.filter(
            item =>
                !item.done &&
                (
                    item.owner === "michele" ||
                    item.owner === "shared"
                )
        ).length;

    const denisePending =
        checklist.filter(
            item =>
                !item.done &&
                (
                    item.owner === "denise" ||
                    item.owner === "shared"
                )
        ).length;

    const percent =
        checklist.length
            ? Math.round(done / checklist.length * 100)
            : 0;

    document.getElementById("check-summary").innerHTML = `
        <div class="summary-card">
            <span>COMPLETATE</span>
            <strong>${done}/${checklist.length}</strong>
        </div>

        <div class="summary-card">
            <span>PROGRESSO</span>
            <strong>${percent}%</strong>
        </div>

        <div class="summary-card">
            <span>MICHELE DA FARE</span>
            <strong>${michelePending}</strong>
        </div>

        <div class="summary-card">
            <span>DENISE DA FARE</span>
            <strong>${denisePending}</strong>
        </div>
    `;

    const container =
        document.getElementById("checklist");

    container.innerHTML = "";

    const filtered =
        checklist.filter(
            item =>
                ownerFilter === "all" ||
                item.owner === ownerFilter
        );

    const sorted =
        [...filtered].sort(
            (a, b) => {
                if (Number(a.done) !== Number(b.done)) {
                    return Number(a.done) - Number(b.done);
                }

                return a.category.localeCompare(
                    b.category,
                    "it"
                );
            }
        );

    if (!sorted.length) {
        container.innerHTML = `
            <div class="empty">
                Nessuna voce assegnata a questo filtro.
            </div>
        `;
        return;
    }

    sorted.forEach(item => {
        const row =
            document.createElement("div");

        row.className = "item-card";

        row.innerHTML = `
            <div class="check-row">
                <input
                    class="check-toggle"
                    type="checkbox"
                    ${item.done ? "checked" : ""}
                    data-toggle="${escapeCheck(item.id)}"
                >

                <div>
                    <h3 class="${item.done ? "done-text" : ""}">
                        ${escapeCheck(item.text)}
                    </h3>

                    <p>${escapeCheck(item.category)}</p>

                    <div style="margin-top:7px;">
                        <select
                            class="owner-select"
                            data-owner="${escapeCheck(item.id)}"
                        >
                            <option
                                value="shared"
                                ${item.owner === "shared" ? "selected" : ""}
                            >
                                👥 Entrambi
                            </option>

                            <option
                                value="michele"
                                ${item.owner === "michele" ? "selected" : ""}
                            >
                                👤 Michele
                            </option>

                            <option
                                value="denise"
                                ${item.owner === "denise" ? "selected" : ""}
                            >
                                👤 Denise
                            </option>
                        </select>
                    </div>
                </div>

                <button
                    class="button small danger"
                    data-delete="${escapeCheck(item.id)}"
                >
                    ✕
                </button>
            </div>
        `;

        container.appendChild(row);
    });

    container.querySelectorAll("[data-toggle]")
        .forEach(input => {
            input.addEventListener(
                "change",
                () => toggleChecklistItem(input.dataset.toggle)
            );
        });

    container.querySelectorAll("[data-owner]")
        .forEach(select => {
            select.addEventListener(
                "change",
                () => changeChecklistOwner(
                    select.dataset.owner,
                    select.value
                )
            );
        });

    container.querySelectorAll("[data-delete]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => deleteChecklistItem(button.dataset.delete)
            );
        });
}

function escapeCheck(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}