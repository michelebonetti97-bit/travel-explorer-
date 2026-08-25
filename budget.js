// ======================================================
// TRAVEL EXPLORER - BUDGET V1
// ======================================================

const BUDGET_SETTINGS_KEY = "mauritius-2026-budget-settings";
const EXPENSES_KEY = "mauritius-2026-expenses";

let budgetSettings = {
    totalEUR: 0,
    fxRate: 50
};

let expenses = [];

document.addEventListener("DOMContentLoaded", initBudget);

async function initBudget() {
    budgetSettings =
        await TravelStore.get(BUDGET_SETTINGS_KEY) ||
        budgetSettings;

    expenses =
        await TravelStore.get(EXPENSES_KEY) ||
        [];

    document.getElementById("budget-total").value =
        budgetSettings.totalEUR || "";

    document.getElementById("fx-rate").value =
        budgetSettings.fxRate || 50;

    const today = new Date();

    document.getElementById("expense-date").value =
        toISODate(today);

    document.getElementById("expense-time").value =
        String(today.getHours()).padStart(2, "0") +
        ":" +
        String(today.getMinutes()).padStart(2, "0");

    document.getElementById("save-budget-settings")
        .addEventListener("click", saveBudgetSettings);

    document.getElementById("add-expense")
        .addEventListener("click", addExpense);

    document.getElementById("scan-receipt")
        .addEventListener("click", scanReceiptIntelligently);

    document.getElementById("expense-receipt")
        .addEventListener("change", () => {
            const file = document.getElementById("expense-receipt").files[0];
            const status = document.getElementById("receipt-status");
            if (status) {
                status.textContent = file
                    ? `Pronto: ${file.name}. Premi “Leggi scontrino”.`
                    : "Nessuno scontrino selezionato.";
            }
        });

    renderBudget();
}

async function saveBudgetSettings() {
    budgetSettings = {
        totalEUR:
            Number(document.getElementById("budget-total").value) || 0,
        fxRate:
            Number(document.getElementById("fx-rate").value) || 50
    };

    await TravelStore.set(
        BUDGET_SETTINGS_KEY,
        budgetSettings
    );

    renderBudget();
}

async function addExpense() {
    const amount =
        Number(document.getElementById("expense-amount").value);

    if (!Number.isFinite(amount) || amount <= 0) {
        alert("Inserisci un importo valido.");
        return;
    }

    const receiptInput =
        document.getElementById("expense-receipt");

    const receipt =
        receiptInput.files[0] || null;

    const expense = {
        id:
            "exp-" +
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 7),
        date:
            document.getElementById("expense-date").value,
        time:
            document.getElementById("expense-time").value,
        category:
            document.getElementById("expense-category").value,
        amount,
        currency:
            document.getElementById("expense-currency").value,
        owner:
            document.getElementById("expense-owner").value,
        payment:
            document.getElementById("expense-payment").value,
        description:
            document.getElementById("expense-description").value.trim(),
        receipt:
            receipt
                ? {
                    name: receipt.name,
                    type: receipt.type,
                    blob: receipt
                }
                : null,
        created_at:
            new Date().toISOString()
    };

    expenses.unshift(expense);

    await TravelStore.set(
        EXPENSES_KEY,
        expenses
    );

    document.getElementById("expense-amount").value = "";
    document.getElementById("expense-description").value = "";
    receiptInput.value = "";

    const receiptResult = document.getElementById("receipt-result");
    const receiptStatus = document.getElementById("receipt-status");
    if (receiptResult) {
        receiptResult.classList.remove("open");
        receiptResult.innerHTML = "";
    }
    if (receiptStatus) {
        receiptStatus.textContent = "Spesa contabilizzata. Puoi fotografare il prossimo scontrino.";
    }

    renderBudget();
}

async function scanReceiptIntelligently() {
    const input = document.getElementById("expense-receipt");
    const file = input?.files?.[0];
    const status = document.getElementById("receipt-status");
    const result = document.getElementById("receipt-result");

    if (!file) {
        alert("Scatta o scegli prima uno scontrino.");
        return;
    }

    if (!String(file.type || "").startsWith("image/")) {
        alert("Per la lettura automatica usa una foto dello scontrino.");
        return;
    }

    if (typeof Tesseract === "undefined") {
        if (status) {
            status.textContent = "Il motore OCR non è disponibile. Controlla la connessione internet e ricarica la pagina.";
        }
        return;
    }

    if (result) {
        result.classList.remove("open");
        result.innerHTML = "";
    }

    try {
        if (status) {
            status.textContent = "Avvio lettura intelligente…";
        }

        const recognition = await Tesseract.recognize(
            file,
            "eng",
            {
                logger: message => {
                    if (!status) return;

                    if (message.status === "recognizing text") {
                        const percent = Math.round((message.progress || 0) * 100);
                        status.textContent = `Sto leggendo lo scontrino… ${percent}%`;
                    }
                    else if (message.status) {
                        status.textContent = `OCR: ${message.status}`;
                    }
                }
            }
        );

        const text = recognition?.data?.text || "";
        const parsed = parseReceiptText(text);

        applyReceiptToForm(parsed);
        renderReceiptResult(parsed, text);

        if (status) {
            status.textContent = "Lettura completata. Controlla i dati proposti e poi premi “Conferma e contabilizza”.";
        }
    }
    catch (error) {
        console.error("Errore OCR scontrino:", error);

        if (status) {
            status.textContent = "Non sono riuscito a leggere bene lo scontrino. Puoi riprovare con una foto più frontale oppure compilare i campi manualmente.";
        }
    }
}


function parseReceiptText(text) {
    const raw = String(text || "");
    const normalized = raw.replace(/\r/g, "\n");
    const lines = normalized
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const upper = normalized.toUpperCase();

    const currency = detectReceiptCurrency(upper);
    const amount = detectReceiptAmount(lines);
    const merchant = detectReceiptMerchant(lines);
    const category = detectReceiptCategory(upper + " " + merchant.toUpperCase());
    const date = detectReceiptDate(normalized);
    const time = detectReceiptTime(normalized);

    return {
        merchant,
        category,
        amount,
        currency,
        date,
        time,
        confidence: [merchant, category, amount].filter(Boolean).length
    };
}


function detectReceiptCurrency(upperText) {
    if (/\bMUR\b|\bRS\.?\b|RUPEE|RUPEES|MAURITIUS RUPEE/.test(upperText)) {
        return "MUR";
    }

    if (/\bEUR\b|€|EURO/.test(upperText)) {
        return "EUR";
    }

    // Nel viaggio Mauritius, se compare il simbolo Rs in modo OCR-imperfetto
    // la valuta più probabile resta MUR, ma senza indizi lasciamo il valore attuale.
    return null;
}


function detectReceiptAmount(lines) {
    const totalKeywords = [
        "GRAND TOTAL",
        "TOTAL DUE",
        "TOTAL TTC",
        "AMOUNT DUE",
        "AMOUNT",
        "MONTANT",
        "NET TOTAL",
        "TOTAL"
    ];

    const candidates = [];

    lines.forEach((line, index) => {
        const upper = line.toUpperCase();
        const numbers = extractMoneyNumbers(line);

        if (!numbers.length) return;

        let keywordScore = 0;

        totalKeywords.forEach((keyword, position) => {
            if (upper.includes(keyword)) {
                keywordScore = Math.max(keywordScore, 100 - position * 4);
            }
        });

        numbers.forEach(number => {
            if (number <= 0 || number > 1000000) return;

            candidates.push({
                value: number,
                score:
                    keywordScore +
                    (line.includes(".") || line.includes(",") ? 6 : 0) +
                    index / Math.max(1, lines.length) * 8
            });
        });
    });

    if (!candidates.length) {
        return null;
    }

    const withTotal = candidates.filter(item => item.score >= 60);

    if (withTotal.length) {
        withTotal.sort((a, b) => b.score - a.score || b.value - a.value);
        return roundMoney(withTotal[0].value);
    }

    // Fallback: di solito il totale è tra gli importi più alti dello scontrino.
    const plausible = candidates
        .map(item => item.value)
        .filter(value => value >= 1 && value <= 100000)
        .sort((a, b) => b - a);

    return plausible.length
        ? roundMoney(plausible[0])
        : null;
}


function extractMoneyNumbers(line) {
    const matches = String(line)
        .replace(/\s(?=\d{3}(?:\D|$))/g, "")
        .match(/\d{1,6}(?:[.,]\d{1,2})?/g) || [];

    return matches
        .map(value => {
            let clean = value;

            if (clean.includes(",") && clean.includes(".")) {
                if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
                    clean = clean.replace(/\./g, "").replace(",", ".");
                }
                else {
                    clean = clean.replace(/,/g, "");
                }
            }
            else if (clean.includes(",")) {
                clean = clean.replace(",", ".");
            }

            return Number(clean);
        })
        .filter(Number.isFinite);
}


function detectReceiptMerchant(lines) {
    const ignored = /RECEIPT|INVOICE|TAX|VAT|TOTAL|CASH|CARD|TEL|PHONE|DATE|TIME|THANK|MERCI|WELCOME|BILL|MUR|RS\b/i;

    const candidate = lines.find(line => {
        if (line.length < 3 || line.length > 55) return false;
        if (ignored.test(line)) return false;
        const letters = (line.match(/[A-Za-z]/g) || []).length;
        return letters >= 3 && letters / line.length >= 0.35;
    });

    return candidate || "Spesa da scontrino";
}


function detectReceiptCategory(text) {
    const upper = String(text || "").toUpperCase();

    const rules = [
        ["Carburante", /PETROL|FUEL|GAS OIL|DIESEL|MOGAS|SHELL|ENGEN|TOTALENERGIES|SERVICE STATION/],
        ["Hotel", /HOTEL|RESORT|ROOM|ACCOMMODATION|VERANDA|CHECK[- ]?OUT/],
        ["Attività", /TOUR|EXCURSION|PARK|TICKET|ADMISSION|ENTRY|KAYAK|SNORKEL|DIVING|ZIPLINE|CASELA|CHAMAREL/],
        ["Parcheggio", /PARKING|PARKING COUPON|STATIONNEMENT/],
        ["Auto", /CAR RENTAL|RENT A CAR|VEHICLE|RENTAL/],
        ["Assicurazione", /INSURANCE|ASSURANCE/],
        ["Food", /RESTAURANT|CAFE|CAFÉ|BISTRO|BAR|FOOD|GRILL|KITCHEN|PIZZA|BURGER|DHOLL|ROTI|BRIYANI|BIRYANI|NOODLE|MARKET|SUPERMARKET|SUPER U|LONDON WAY|INTERMART|JUMBO|WINNERS/],
        ["Shopping", /SHOP|STORE|BOUTIQUE|MALL|PHARMACY|PHARMACIE|CLOTHING|SOUVENIR/]
    ];

    for (const [category, pattern] of rules) {
        if (pattern.test(upper)) {
            return category;
        }
    }

    return "Altro";
}


function detectReceiptDate(text) {
    const value = String(text || "");

    let match = value.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);

    if (match) {
        return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    }

    match = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);

    if (match) {
        const year = match[3].length === 2 ? "20" + match[3] : match[3];
        return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
    }

    return null;
}


function detectReceiptTime(text) {
    const match = String(text || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);

    if (!match) return null;

    return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}


function applyReceiptToForm(parsed) {
    if (parsed.merchant) {
        document.getElementById("expense-description").value = parsed.merchant;
    }

    if (parsed.category) {
        document.getElementById("expense-category").value = parsed.category;
    }

    if (Number.isFinite(Number(parsed.amount))) {
        document.getElementById("expense-amount").value = parsed.amount;
    }

    if (parsed.currency) {
        document.getElementById("expense-currency").value = parsed.currency;
    }

    if (parsed.date) {
        document.getElementById("expense-date").value = parsed.date;
    }

    if (parsed.time) {
        document.getElementById("expense-time").value = parsed.time;
    }
}


function renderReceiptResult(parsed, rawText) {
    const result = document.getElementById("receipt-result");

    if (!result) return;

    result.classList.add("open");

    const amountText = Number.isFinite(Number(parsed.amount))
        ? `${Number(parsed.amount).toFixed(2)} ${parsed.currency || "?"}`
        : "Totale da controllare";

    result.innerHTML = `
        <strong>Proposta automatica</strong>
        <div class="mini">
            🏪 ${escapeBudget(parsed.merchant || "Esercente non riconosciuto")}<br>
            💰 ${escapeBudget(amountText)}<br>
            🗂️ ${escapeBudget(parsed.category || "Altro")}<br>
            📅 ${escapeBudget(parsed.date || "data attuale")} ${escapeBudget(parsed.time || "")}
        </div>

        <details class="ocr-details">
            <summary>Mostra testo letto dallo scontrino</summary>
            <div class="ocr-text">${escapeBudget(rawText || "")}</div>
        </details>
    `;
}


function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
}


function expenseEUR(expense) {
    if (expense.currency === "EUR") {
        return Number(expense.amount);
    }

    const rate =
        Number(budgetSettings.fxRate) || 50;

    return Number(expense.amount) / rate;
}

function ownerShares(expense) {
    const value = expenseEUR(expense);

    if (expense.owner === "shared") {
        return {
            mine: value / 2,
            denise: value / 2
        };
    }

    if (expense.owner === "mine") {
        return {
            mine: value,
            denise: 0
        };
    }

    return {
        mine: 0,
        denise: value
    };
}

function renderBudget() {
    const totalSpent =
        expenses.reduce(
            (sum, expense) =>
                sum + expenseEUR(expense),
            0
        );

    const remaining =
        Number(budgetSettings.totalEUR) -
        totalSpent;

    let mine = 0;
    let denise = 0;

    expenses.forEach(expense => {
        const shares = ownerShares(expense);
        mine += shares.mine;
        denise += shares.denise;
    });

    document.getElementById("budget-summary").innerHTML = `
        <div class="summary-card">
            <span>BUDGET</span>
            <strong>${formatEUR(budgetSettings.totalEUR)}</strong>
        </div>
        <div class="summary-card">
            <span>SPESO</span>
            <strong>${formatEUR(totalSpent)}</strong>
        </div>
        <div class="summary-card">
            <span>RESTANTE</span>
            <strong class="${remaining >= 0 ? "balance-positive" : "balance-negative"}">
                ${formatEUR(remaining)}
            </strong>
        </div>
        <div class="summary-card">
            <span>MIO / DENISE</span>
            <strong>${formatEUR(mine)} / ${formatEUR(denise)}</strong>
        </div>
    `;

    renderCategories();
    renderExpenseList();
}

function renderCategories() {
    const grouped = {};

    expenses.forEach(expense => {
        grouped[expense.category] =
            (grouped[expense.category] || 0) +
            expenseEUR(expense);
    });

    const container =
        document.getElementById("category-summary");

    const entries =
        Object.entries(grouped)
            .sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
        container.innerHTML = `
            <div class="empty">
                Nessuna spesa ancora registrata.
            </div>
        `;
        return;
    }

    container.innerHTML =
        entries.map(([category, value]) => `
            <div class="item-card">
                <div class="item-top">
                    <h3>${escapeBudget(category)}</h3>
                    <strong>${formatEUR(value)}</strong>
                </div>
            </div>
        `).join("");
}

function renderExpenseList() {
    const container =
        document.getElementById("expense-list");

    if (!expenses.length) {
        container.innerHTML = `
            <div class="empty">
                Lo storico delle spese comparirà qui.
            </div>
        `;
        return;
    }

    container.innerHTML = "";

    expenses.forEach(expense => {
        const card =
            document.createElement("div");

        card.className = "item-card";

        const original =
            expense.currency === "EUR"
                ? formatEUR(expense.amount)
                : `${Number(expense.amount).toFixed(2)} MUR`;

        card.innerHTML = `
            <div class="item-top">
                <div>
                    <h3>${escapeBudget(expense.description || expense.category)}</h3>
                    <p>${escapeBudget(expense.date)} · ${escapeBudget(expense.time || "")}</p>
                </div>
                <strong>${original}</strong>
            </div>

            <div class="tag-row">
                <span class="tag">${escapeBudget(expense.category)}</span>
                <span class="tag">${ownerLabel(expense.owner)}</span>
                <span class="tag">${escapeBudget(expense.payment)}</span>
                ${
                    expense.currency === "MUR"
                        ? `<span class="tag">≈ ${formatEUR(expenseEUR(expense))}</span>`
                        : ""
                }
                ${
                    expense.receipt
                        ? `<button class="tag" data-receipt="${escapeBudget(expense.id)}">📎 Ricevuta</button>`
                        : ""
                }
                <button class="tag" data-delete="${escapeBudget(expense.id)}">✕ Elimina</button>
            </div>
        `;

        container.appendChild(card);
    });

    container.querySelectorAll("[data-delete]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => deleteExpense(button.dataset.delete)
            );
        });

    container.querySelectorAll("[data-receipt]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => openReceipt(button.dataset.receipt)
            );
        });
}

async function deleteExpense(id) {
    const expense =
        expenses.find(item => item.id === id);

    if (!expense) return;

    if (!confirm(`Eliminare "${expense.description || expense.category}"?`)) {
        return;
    }

    expenses =
        expenses.filter(item => item.id !== id);

    await TravelStore.set(
        EXPENSES_KEY,
        expenses
    );

    renderBudget();
}

function openReceipt(id) {
    const expense =
        expenses.find(item => item.id === id);

    const blob =
        expense?.receipt?.blob;

    if (!blob) return;

    const url =
        URL.createObjectURL(blob);

    window.open(url, "_blank");

    setTimeout(
        () => URL.revokeObjectURL(url),
        60000
    );
}

function ownerLabel(value) {
    if (value === "mine") return "Mia";
    if (value === "denise") return "Denise";
    return "Condivisa";
}

function formatEUR(value) {
    return new Intl.NumberFormat(
        "it-IT",
        {
            style: "currency",
            currency: "EUR"
        }
    ).format(Number(value) || 0);
}

function toISODate(date) {
    return (
        date.getFullYear() +
        "-" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(date.getDate()).padStart(2, "0")
    );
}

function escapeBudget(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}