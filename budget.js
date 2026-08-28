// ======================================================
// TRAVEL EXPLORER - BUDGET V2.0
// Cambio EUR/MUR live + scontrino intelligente
// ======================================================

const BUDGET_SETTINGS_KEY = "mauritius-2026-budget-settings";
const EXPENSES_KEY = "mauritius-2026-expenses";
const FX_CACHE_KEY = "mauritius-2026-fx-eur-mur";

const FX_PRIMARY_URL = "https://api.frankfurter.dev/v2/rate/EUR/MUR";
const FX_FALLBACK_URL = "https://cdn.jsdelivr.net/gh/irfanokr/currency-api@main/v1/currencies/eur.min.json";

let budgetSettings = { totalEUR: 0, fxRate: 50, fxDate: null, fxSource: null, fxFetchedAt: null };
let expenses = [];
let receiptPreviewURL = null;

document.addEventListener("DOMContentLoaded", initBudget);

async function initBudget() {
  const savedSettings = await TravelStore.get(BUDGET_SETTINGS_KEY);
  if (savedSettings && typeof savedSettings === "object") budgetSettings = { ...budgetSettings, ...savedSettings };

  const savedExpenses = await TravelStore.get(EXPENSES_KEY);
  expenses = Array.isArray(savedExpenses) ? savedExpenses : [];
  expenses = expenses.map(migrateExpense);

  document.getElementById("budget-total").value = budgetSettings.totalEUR || "";
  setExpenseDateTimeNow();
  bindBudgetEvents();
  await loadCachedFXRate();
  renderFX();
  renderBudget();
  updateExpenseFXPreview();
  await refreshFXRate({ silent: Boolean(budgetSettings.fxRate) });
}

function bindBudgetEvents() {
  document.getElementById("refresh-fx").addEventListener("click", () => refreshFXRate({ silent: false }));
  document.getElementById("converter-eur").addEventListener("input", convertEURtoMUR);
  document.getElementById("converter-mur").addEventListener("input", convertMURtoEUR);
  document.getElementById("save-budget-settings").addEventListener("click", saveBudgetSettings);
  document.getElementById("expense-receipt").addEventListener("change", handleReceiptSelection);
  document.getElementById("scan-receipt").addEventListener("click", scanReceiptIntelligently);
  document.getElementById("clear-receipt").addEventListener("click", clearReceiptPhoto);
  document.getElementById("add-expense").addEventListener("click", addExpense);
  document.getElementById("reset-expense-form").addEventListener("click", () => resetExpenseForm());
  ["expense-amount", "expense-currency"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateExpenseFXPreview);
    document.getElementById(id).addEventListener("change", updateExpenseFXPreview);
  });
}

// ----------------------------- FX LIVE -----------------------------

async function refreshFXRate({ silent = false } = {}) {
  setFXStatus(silent ? "Aggiornamento cambio…" : "Recupero del cambio aggiornato…");
  const button = document.getElementById("refresh-fx");
  button.disabled = true;

  try {
    const live = await fetchFrankfurterRate();
    await applyLiveFX(live.rate, live.date, "Frankfurter");
    setFXStatus(`Aggiornato al ${formatItalianDate(live.date)} · fonte Frankfurter`);
  } catch (primaryError) {
    console.warn("Frankfurter non disponibile:", primaryError);
    try {
      const fallback = await fetchFallbackRate();
      await applyLiveFX(fallback.rate, fallback.date, "Currency API / jsDelivr");
      setFXStatus(`Cambio aggiornato · fonte di riserva · ${formatItalianDate(fallback.date)}`);
    } catch (fallbackError) {
      console.warn("Fallback cambio non disponibile:", fallbackError);
      if (Number(budgetSettings.fxRate) > 0) {
        setFXStatus(`Offline: uso l'ultimo cambio salvato (${budgetSettings.fxDate ? formatItalianDate(budgetSettings.fxDate) : "data non disponibile"}).`);
      } else {
        setFXStatus("Cambio non disponibile. Collegati a Internet e premi Aggiorna.");
      }
    }
  } finally {
    button.disabled = false;
    renderFX();
    updateExpenseFXPreview();
  }
}

async function fetchFrankfurterRate() {
  const response = await fetch(FX_PRIMARY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rate = Number(data?.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Tasso EUR/MUR non valido");
  return { rate, date: data.date || toISODate(new Date()) };
}

async function fetchFallbackRate() {
  const response = await fetch(FX_FALLBACK_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rate = Number(data?.eur?.mur);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Fallback EUR/MUR non valido");
  return { rate, date: data.date || toISODate(new Date()) };
}

async function applyLiveFX(rate, date, source) {
  budgetSettings.fxRate = Number(rate);
  budgetSettings.fxDate = date || toISODate(new Date());
  budgetSettings.fxSource = source;
  budgetSettings.fxFetchedAt = new Date().toISOString();
  await TravelStore.set(FX_CACHE_KEY, { rate: budgetSettings.fxRate, date: budgetSettings.fxDate, source, fetchedAt: budgetSettings.fxFetchedAt });
  await persistBudgetSettings();
}

async function loadCachedFXRate() {
  try {
    const cached = await TravelStore.get(FX_CACHE_KEY);
    if (cached && Number(cached.rate) > 0) {
      budgetSettings.fxRate = Number(cached.rate);
      budgetSettings.fxDate = cached.date || budgetSettings.fxDate;
      budgetSettings.fxSource = cached.source || budgetSettings.fxSource;
      budgetSettings.fxFetchedAt = cached.fetchedAt || budgetSettings.fxFetchedAt;
    }
  } catch (error) {
    console.warn("Cache cambio non leggibile:", error);
  }
}

function renderFX() {
  const rate = Number(budgetSettings.fxRate);
  document.getElementById("fx-live-rate").textContent = Number.isFinite(rate) && rate > 0 ? `1 € = ${formatMURNumber(rate)} ₨` : "Cambio non disponibile";
}

function convertEURtoMUR() {
  const rate = Number(budgetSettings.fxRate);
  const value = Number(document.getElementById("converter-eur").value);
  document.getElementById("converter-mur").value = Number.isFinite(value) && rate > 0 ? roundMoney(value * rate) : "";
}

function convertMURtoEUR() {
  const rate = Number(budgetSettings.fxRate);
  const value = Number(document.getElementById("converter-mur").value);
  document.getElementById("converter-eur").value = Number.isFinite(value) && rate > 0 ? roundMoney(value / rate) : "";
}

function setFXStatus(message) {
  document.getElementById("fx-live-status").textContent = message;
}

// -------------------------- RECEIPT OCR ----------------------------

function handleReceiptSelection() {
  const file = document.getElementById("expense-receipt").files?.[0];
  clearReceiptPreviewURL();
  clearReceiptAnalysis();

  const wrap = document.getElementById("receipt-preview");
  const image = document.getElementById("receipt-preview-image");

  if (!file) {
    wrap.classList.remove("open");
    image.removeAttribute("src");
    setReceiptStatus("Nessuno scontrino selezionato.");
    return;
  }

  receiptPreviewURL = URL.createObjectURL(file);
  image.src = receiptPreviewURL;
  wrap.classList.add("open");
  setReceiptStatus(`Pronto: ${file.name}. Premi “Analizza scontrino”.`);
}

async function scanReceiptIntelligently() {
  const file = document.getElementById("expense-receipt").files?.[0];
  if (!file) return alert("Scatta o scegli prima uno scontrino.");
  if (!String(file.type || "").startsWith("image/")) return alert("Per la lettura automatica serve una foto dello scontrino.");
  if (typeof Tesseract === "undefined") {
    setReceiptStatus("Il motore di lettura non è disponibile. Controlla Internet e ricarica la pagina.", "warning");
    return;
  }

  const button = document.getElementById("scan-receipt");
  button.disabled = true;
  clearReceiptAnalysis();

  try {
    setReceiptStatus("Preparo la foto per la lettura…", "working");
    const processed = await preprocessReceiptImage(file);
    let recognition;

    try {
      recognition = await Tesseract.recognize(processed, "eng+fra", { logger: updateOCRProgress });
    } catch (multiLanguageError) {
      console.warn("OCR eng+fra fallito, riprovo eng:", multiLanguageError);
      recognition = await Tesseract.recognize(processed, "eng", { logger: updateOCRProgress });
    }

    const rawText = recognition?.data?.text || "";
    if (rawText.trim().length < 3) throw new Error("Nessun testo riconosciuto");

    const parsed = parseReceiptText(rawText);
    applyReceiptToForm(parsed);
    renderReceiptAnalysis(parsed, rawText);
    setReceiptStatus("Lettura completata. Controlla i campi e conferma solo se il totale è corretto.", "success");
    updateExpenseFXPreview();
  } catch (error) {
    console.error("Errore analisi scontrino:", error);
    setReceiptStatus("Non sono riuscito a leggere bene lo scontrino. Prova una foto più frontale e luminosa oppure compila i campi manualmente.", "warning");
  } finally {
    button.disabled = false;
  }
}

function updateOCRProgress(message) {
  if (message.status === "recognizing text") {
    const percent = Math.round((message.progress || 0) * 100);
    setReceiptStatus(`Leggo lo scontrino… ${percent}%`, "working");
  } else if (message.status) {
    setReceiptStatus(`Analisi: ${message.status}`, "working");
  }
}

async function preprocessReceiptImage(file) {
  const source = await fileToDataURL(file);
  const image = await loadImage(source);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114;
    const value = Math.max(0, Math.min(255, (gray - 128) * 1.28 + 128));
    imageData.data[i] = imageData.data[i + 1] = imageData.data[i + 2] = value;
  }
  context.putImageData(imageData, 0, 0);

  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Impossibile preparare la foto")), "image/jpeg", 0.9));
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function parseReceiptText(text) {
  const normalized = String(text || "").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const upper = normalized.toUpperCase();
  const merchant = detectReceiptMerchant(lines);
  const currency = detectReceiptCurrency(upper);
  const amount = detectReceiptAmount(lines, currency);
  const category = detectReceiptCategory(`${upper} ${merchant.toUpperCase()}`);
  const date = detectReceiptDate(normalized);
  const time = detectReceiptTime(normalized);
  const confidence = [merchant !== "Spesa da scontrino", Number.isFinite(amount), Boolean(currency), Boolean(date), category !== "Altro"].filter(Boolean).length;
  return { merchant, currency, amount: Number.isFinite(amount) ? amount : null, category, date, time, confidence };
}

function detectReceiptCurrency(text) {
  if (/\bMUR\b|₨|\bRS\.?\s?\d|MAURITI(?:AN|US)\s+RUPEE|RUPEES?/i.test(text)) return "MUR";
  if (/\bEUR\b|€|EUROS?/i.test(text)) return "EUR";
  return "MUR";
}

function detectReceiptAmount(lines, currency) {
  const keywords = ["GRAND TOTAL", "TOTAL DUE", "TOTAL TTC", "NET TOTAL", "AMOUNT DUE", "MONTANT A PAYER", "MONTANT À PAYER", "BALANCE DUE", "TOTAL"];
  const negative = /CHANGE|MONNAIE|CASH GIVEN|TENDERED|VAT|TAX|TVA|SUBTOTAL|SOUS[- ]?TOTAL/i;
  const candidates = [];

  lines.forEach((line, index) => {
    const upper = line.toUpperCase();
    const values = extractMoneyNumbers(line);
    if (!values.length) return;
    let score = 0;
    keywords.forEach((keyword, position) => { if (upper.includes(keyword)) score = Math.max(score, 150 - position * 8); });
    if (negative.test(upper)) score -= 90;
    if (currency === "MUR" && (upper.includes("MUR") || /\bRS\b/.test(upper))) score += 20;
    values.forEach(value => {
      if (value > 0 && value <= 1000000) candidates.push({ value, score: score + (index / Math.max(1, lines.length)) * 8 });
    });
  });

  if (!candidates.length) return null;
  const totals = candidates.filter(item => item.score >= 70).sort((a, b) => b.score - a.score || b.value - a.value);
  if (totals.length) return roundMoney(totals[0].value);
  const plausible = candidates.map(item => item.value).filter(value => value >= 1 && value <= 100000).sort((a, b) => b - a);
  return plausible.length ? roundMoney(plausible[0]) : null;
}

function extractMoneyNumbers(line) {
  const matches = String(line).match(/\d{1,3}(?:[ .,'’]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g) || [];
  return matches.map(parseMoneyToken).filter(Number.isFinite);
}

function parseMoneyToken(token) {
  let value = String(token).trim().replace(/['’\s]/g, "");
  if (!value) return NaN;
  const hasComma = value.includes(",");
  const hasDot = value.includes(".");

  if (hasComma && hasDot) {
    const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    value = value.split(thousands).join("").replace(decimal, ".");
    return Number(value);
  }

  const separator = hasComma ? "," : hasDot ? "." : null;
  if (!separator) return Number(value);
  const parts = value.split(separator);
  if (parts.length > 2) return Number(parts.join(""));
  const decimals = parts[1]?.length || 0;
  if (decimals === 3) return Number(parts.join("")); // 1.280 => 1280
  if (decimals === 1 || decimals === 2) return Number(`${parts[0]}.${parts[1]}`);
  return Number(parts.join(""));
}

function detectReceiptMerchant(lines) {
  const ignored = /RECEIPT|INVOICE|FACTURE|TAX|VAT|TVA|TOTAL|CASH|CARD|TEL|PHONE|DATE|TIME|THANK|MERCI|WELCOME|BILL|MUR|RUPEE|RS\b/i;
  const candidate = lines.slice(0, 12).find(line => {
    if (line.length < 3 || line.length > 55 || ignored.test(line)) return false;
    const letters = (line.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    return letters >= 3 && letters / Math.max(1, line.length) >= 0.35;
  });
  return candidate || "Spesa da scontrino";
}

function detectReceiptCategory(text) {
  const rules = [
    ["Carburante", /PETROL|FUEL|GAS OIL|DIESEL|MOGAS|SHELL|ENGEN|TOTALENERGIES|SERVICE STATION|STATION SERVICE/],
    ["Hotel", /HOTEL|RESORT|ROOM|ACCOMMODATION|VERANDA|CHECK[- ]?OUT/],
    ["Attività", /TOUR|EXCURSION|PARK|TICKET|ADMISSION|ENTRY|KAYAK|SNORKEL|DIVING|ZIPLINE|CASELA|CHAMAREL|BOAT|DOLPHIN|WHALE/],
    ["Parcheggio", /PARKING|PARKING COUPON|STATIONNEMENT/],
    ["Auto", /CAR RENTAL|RENT A CAR|VEHICLE|RENTAL|LOCATION DE VOITURE/],
    ["Assicurazione", /INSURANCE|ASSURANCE/],
    ["Food", /RESTAURANT|CAFE|CAFÉ|BISTRO|BAR|FOOD|GRILL|KITCHEN|PIZZA|BURGER|DHOLL|ROTI|BRIYANI|BIRYANI|NOODLE|MARKET|SUPERMARKET|SUPER U|LONDON WAY|INTERMART|JUMBO|WINNERS|BAKERY|BOULANGERIE/],
    ["Shopping", /SHOP|STORE|BOUTIQUE|MALL|PHARMACY|PHARMACIE|CLOTHING|SOUVENIR/]
  ];
  for (const [category, pattern] of rules) if (pattern.test(String(text).toUpperCase())) return category;
  return "Altro";
}

function detectReceiptDate(text) {
  let match = String(text).match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = String(text).match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2}|\d{2})\b/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  }
  return null;
}

function detectReceiptTime(text) {
  const match = String(text).match(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)(?::[0-5]\d)?\b/i);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : null;
}

function applyReceiptToForm(parsed) {
  if (parsed.merchant && parsed.merchant !== "Spesa da scontrino") document.getElementById("expense-description").value = parsed.merchant;
  if (parsed.category) document.getElementById("expense-category").value = parsed.category;
  if (Number.isFinite(Number(parsed.amount))) document.getElementById("expense-amount").value = parsed.amount;
  if (parsed.currency) document.getElementById("expense-currency").value = parsed.currency;
  if (parsed.date) document.getElementById("expense-date").value = parsed.date;
  if (parsed.time) document.getElementById("expense-time").value = parsed.time;
}

function renderReceiptAnalysis(parsed, rawText) {
  const result = document.getElementById("receipt-analysis");
  const amountText = Number.isFinite(Number(parsed.amount)) ? `${Number(parsed.amount).toFixed(2)} ${parsed.currency || "?"}` : "Totale non riconosciuto";
  const confidence = parsed.confidence >= 4 ? "buona" : parsed.confidence >= 2 ? "media" : "bassa";
  result.classList.add("open");
  result.innerHTML = `<strong>✨ Dati proposti automaticamente</strong><p>🏪 ${escapeBudget(parsed.merchant || "Esercente non riconosciuto")}<br>💰 ${escapeBudget(amountText)}<br>🗂️ ${escapeBudget(parsed.category || "Altro")}<br>📅 ${escapeBudget(parsed.date || "data non riconosciuta")} ${escapeBudget(parsed.time || "")}<br>🔎 Affidabilità lettura: <b>${confidence}</b></p><details class="ocr-details"><summary>Mostra testo letto dalla foto</summary><div class="ocr-text">${escapeBudget(rawText || "")}</div></details>`;
}

function clearReceiptAnalysis() {
  const result = document.getElementById("receipt-analysis");
  result.classList.remove("open");
  result.innerHTML = "";
}

function clearReceiptPhoto() {
  document.getElementById("expense-receipt").value = "";
  clearReceiptPreviewURL();
  document.getElementById("receipt-preview").classList.remove("open");
  document.getElementById("receipt-preview-image").removeAttribute("src");
  clearReceiptAnalysis();
  setReceiptStatus("Nessuno scontrino selezionato.");
}

function clearReceiptPreviewURL() {
  if (receiptPreviewURL) URL.revokeObjectURL(receiptPreviewURL);
  receiptPreviewURL = null;
}

function setReceiptStatus(message, state = "") {
  const status = document.getElementById("receipt-status");
  status.className = `receipt-status${state ? ` ${state}` : ""}`;
  status.textContent = message;
}

// ---------------------------- STORAGE ------------------------------

async function addExpense() {
  const amount = Number(document.getElementById("expense-amount").value);
  if (!Number.isFinite(amount) || amount <= 0) return alert("Controlla l'importo prima di archiviare.");

  const currency = document.getElementById("expense-currency").value;
  const rate = Number(budgetSettings.fxRate);
  const amountEUR = currency === "EUR" ? amount : rate > 0 ? amount / rate : null;
  if (currency === "MUR" && !Number.isFinite(amountEUR)) return alert("Non ho un cambio EUR/MUR valido. Premi Aggiorna prima di archiviare.");

  const receipt = document.getElementById("expense-receipt").files?.[0] || null;
  const storedReceiptBlob = receipt
    ? await compressBudgetImage(receipt, 1800, 0.84)
    : null;

  const expense = {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: document.getElementById("expense-date").value,
    time: document.getElementById("expense-time").value,
    description: document.getElementById("expense-description").value.trim(),
    category: document.getElementById("expense-category").value,
    amount: roundMoney(amount),
    currency,
    amountEUR: roundMoney(amountEUR),
    fxRate: currency === "MUR" ? rate : null,
    fxDate: currency === "MUR" ? budgetSettings.fxDate : null,
    fxSource: currency === "MUR" ? budgetSettings.fxSource : null,
    owner: document.getElementById("expense-owner").value,
    payment: document.getElementById("expense-payment").value,
    note: document.getElementById("expense-note").value.trim(),
    receipt: receipt ? {
      name: receipt.name,
      type: storedReceiptBlob.type || receipt.type || "image/jpeg",
      blob: storedReceiptBlob
    } : null,
    created_at: new Date().toISOString()
  };

  expenses.unshift(expense);
  await persistExpenses();
  resetExpenseForm();
  setReceiptStatus("Spesa archiviata correttamente.", "success");
  renderBudget();
}

function migrateExpense(expense) {
  const migrated = { ...expense };
  if (!Number.isFinite(Number(migrated.amountEUR))) {
    if (migrated.currency === "EUR") migrated.amountEUR = Number(migrated.amount) || 0;
    else migrated.amountEUR = (Number(migrated.amount) || 0) / (Number(migrated.fxRate) || Number(budgetSettings.fxRate) || 50);
  }
  if (migrated.owner === "Michele") migrated.owner = "mine";
  return migrated;
}

async function persistExpenses() {
  await TravelStore.set(EXPENSES_KEY, expenses);
}

async function saveBudgetSettings() {
  budgetSettings.totalEUR = Number(document.getElementById("budget-total").value) || 0;
  await persistBudgetSettings();
  renderBudget();
}

async function persistBudgetSettings() {
  await TravelStore.set(BUDGET_SETTINGS_KEY, budgetSettings);
}

function resetExpenseForm() {
  document.getElementById("expense-description").value = "";
  document.getElementById("expense-category").value = "Food";
  document.getElementById("expense-amount").value = "";
  document.getElementById("expense-currency").value = "MUR";
  document.getElementById("expense-owner").value = "shared";
  document.getElementById("expense-payment").value = "Carta";
  document.getElementById("expense-note").value = "";
  setExpenseDateTimeNow();
  clearReceiptPhoto();
  updateExpenseFXPreview();
}

function setExpenseDateTimeNow() {
  const now = new Date();
  document.getElementById("expense-date").value = toISODate(now);
  document.getElementById("expense-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function updateExpenseFXPreview() {
  const amount = Number(document.getElementById("expense-amount").value);
  const currency = document.getElementById("expense-currency").value;
  const box = document.getElementById("expense-fx-preview");
  if (!Number.isFinite(amount) || amount <= 0) return box.textContent = "Il controvalore in euro verrà calcolato con il cambio attuale.";
  if (currency === "EUR") return box.textContent = `Da archiviare: ${formatEUR(amount)}.`;
  const rate = Number(budgetSettings.fxRate);
  if (!Number.isFinite(rate) || rate <= 0) return box.textContent = "Cambio EUR/MUR non disponibile.";
  box.textContent = `${formatMUR(amount)} ≈ ${formatEUR(amount / rate)} · cambio salvato con questa spesa: 1 € = ${formatMURNumber(rate)} ₨`;
}

// ----------------------------- RENDER -------------------------------

function expenseEUR(expense) {
  const stored = Number(expense.amountEUR);
  if (Number.isFinite(stored)) return stored;
  if (expense.currency === "EUR") return Number(expense.amount) || 0;
  return (Number(expense.amount) || 0) / (Number(expense.fxRate) || Number(budgetSettings.fxRate) || 50);
}

function ownerShares(expense) {
  const value = expenseEUR(expense);
  if (expense.owner === "shared") return { mine: value / 2, denise: value / 2 };
  if (expense.owner === "mine") return { mine: value, denise: 0 };
  return { mine: 0, denise: value };
}

function renderBudget() {
  const totalSpent = expenses.reduce((sum, expense) => sum + expenseEUR(expense), 0);
  const remaining = Number(budgetSettings.totalEUR) - totalSpent;
  let mine = 0, denise = 0;
  expenses.forEach(expense => { const shares = ownerShares(expense); mine += shares.mine; denise += shares.denise; });

  document.getElementById("budget-summary").innerHTML = `
    <div class="summary-card"><span>BUDGET</span><strong>${formatEUR(budgetSettings.totalEUR)}</strong></div>
    <div class="summary-card"><span>SPESO</span><strong>${formatEUR(totalSpent)}</strong></div>
    <div class="summary-card"><span>RESTANTE</span><strong class="${remaining >= 0 ? "balance-positive" : "balance-negative"}">${formatEUR(remaining)}</strong></div>
    <div class="summary-card"><span>MICHELE / DENISE</span><strong>${formatEUR(mine)} / ${formatEUR(denise)}</strong></div>`;

  renderCategories();
  renderExpenseList();
}

function renderCategories() {
  const grouped = {};
  expenses.forEach(expense => grouped[expense.category || "Altro"] = (grouped[expense.category || "Altro"] || 0) + expenseEUR(expense));
  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById("category-summary");
  if (!entries.length) return container.innerHTML = '<div class="empty">Nessuna spesa ancora registrata.</div>';
  container.innerHTML = entries.map(([category, value]) => `<div class="item-card"><div class="item-top"><h3>${escapeBudget(category)}</h3><strong>${formatEUR(value)}</strong></div></div>`).join("");
}

function renderExpenseList() {
  const container = document.getElementById("expense-list");
  if (!expenses.length) return container.innerHTML = '<div class="empty">Lo storico delle spese comparirà qui.</div>';
  container.innerHTML = "";

  expenses.forEach(expense => {
    const card = document.createElement("div");
    card.className = "item-card";
    const original = expense.currency === "EUR" ? formatEUR(expense.amount) : formatMUR(expense.amount);
    card.innerHTML = `
      <div class="item-top"><div><h3>${escapeBudget(expense.description || expense.category || "Spesa")}</h3><p>${escapeBudget(expense.date || "")}${expense.time ? ` · ${escapeBudget(expense.time)}` : ""}</p>${expense.note ? `<p>${escapeBudget(expense.note)}</p>` : ""}</div><strong>${original}</strong></div>
      <div class="tag-row"><span class="tag">${escapeBudget(expense.category || "Altro")}</span><span class="tag">${ownerLabel(expense.owner)}</span><span class="tag">${escapeBudget(expense.payment || "")}</span>${expense.currency === "MUR" ? `<span class="tag">≈ ${formatEUR(expenseEUR(expense))}</span>` : ""}${expense.fxRate && expense.currency === "MUR" ? `<span class="tag">1€ = ${formatMURNumber(expense.fxRate)}₨</span>` : ""}${expense.receipt ? `<button class="tag" data-receipt="${escapeBudget(expense.id)}">📎 Scontrino</button>` : ""}<button class="tag" data-delete="${escapeBudget(expense.id)}">✕ Elimina</button></div>`;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => deleteExpense(button.dataset.delete)));
  container.querySelectorAll("[data-receipt]").forEach(button => button.addEventListener("click", () => openReceipt(button.dataset.receipt)));
}

async function deleteExpense(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;
  if (!confirm(`Eliminare "${expense.description || expense.category || "questa spesa"}"?`)) return;
  expenses = expenses.filter(item => item.id !== id);
  await persistExpenses();
  renderBudget();
}

function openReceipt(id) {
  const blob = expenses.find(item => item.id === id)?.receipt?.blob;
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ----------------------------- UTILS --------------------------------

function ownerLabel(value) {
  if (value === "mine") return "Michele";
  if (value === "denise") return "Denise";
  return "Condivisa";
}

function formatEUR(value) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function formatMUR(value) {
  return `${new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} MUR`;
}

function formatMURNumber(value) {
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value) || 0);
}

function formatItalianDate(value) {
  if (!value) return "data non disponibile";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeBudget(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function compressBudgetImage(file, maxDimension = 1800, quality = 0.84) {
  if (!file || !String(file.type || "").startsWith("image/")) return file;

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
      canvas.toBlob(blob => resolve(blob || file), "image/jpeg", quality);
    });
  }
  catch (error) {
    console.warn("Compressione scontrino non disponibile, salvo originale.", error);
    return file;
  }
}
