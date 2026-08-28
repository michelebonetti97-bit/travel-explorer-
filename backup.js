// TRAVEL EXPLORER - BACKUP V1
document.addEventListener("DOMContentLoaded", initBackup);

async function initBackup() {
    document.getElementById("export-backup")?.addEventListener("click", exportTravelBackup);
    document.getElementById("import-merge")?.addEventListener("click", () => importTravelBackup(false));
    document.getElementById("import-replace")?.addEventListener("click", () => importTravelBackup(true));
    await renderBackupSummary();
}

async function renderBackupSummary() {
    try {
        const records = await TravelStore.dump();
        const byKey = Object.fromEntries(records.map(record => [record.key, record.value]));
        const cards = [
            ["Giornate salvate", Array.isArray(byKey["mauritius-2026-user-day-templates-v1"]) ? byKey["mauritius-2026-user-day-templates-v1"].length : 0],
            ["Spese", Array.isArray(byKey["mauritius-2026-expenses"]) ? byKey["mauritius-2026-expenses"].length : 0],
            ["Documenti", Array.isArray(byKey["mauritius-2026-documents"]) ? byKey["mauritius-2026-documents"].length : 0],
            ["Diario", Array.isArray(byKey["mauritius-2026-diary"]) ? byKey["mauritius-2026-diary"].length : 0],
            ["Checklist", Array.isArray(byKey["mauritius-2026-checklist"]) ? byKey["mauritius-2026-checklist"].length : 0],
            ["Record locali", records.length]
        ];
        document.getElementById("backup-summary").innerHTML = cards.map(([label,value]) => `<div><span>${escapeBackup(label)}</span><strong>${value}</strong></div>`).join("");
    } catch (error) {
        setBackupStatus("⚠️ Non riesco a leggere i dati locali.");
    }
}

async function exportTravelBackup() {
    try {
        setBackupStatus("Preparazione backup… le foto possono richiedere qualche secondo.");
        const records = await TravelStore.dump();
        const encoded = await encodeBackupValue(records);
        const payload = {
            format: "travel-explorer-backup",
            version: 1,
            trip: "mauritius-2026",
            created_at: new Date().toISOString(),
            records: encoded
        };
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const date = new Date().toISOString().slice(0,10);
        a.href = url;
        a.download = `TravelExplorer_Mauritius_backup_${date}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setBackupStatus(`✅ Backup creato · ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
        console.error(error);
        setBackupStatus("❌ Errore durante la creazione del backup.");
    }
}

async function importTravelBackup(replace) {
    const file = document.getElementById("backup-file")?.files?.[0];
    if (!file) return alert("Seleziona prima un file di backup.");
    if (replace && !confirm("Sostituire tutti i dati locali di Travel Explorer con questo backup?")) return;
    if (!replace && !confirm("Unire questo backup ai dati presenti sul dispositivo? I record con la stessa chiave verranno aggiornati.")) return;

    try {
        setBackupStatus("Lettura e ripristino backup…");
        const payload = JSON.parse(await file.text());
        if (payload?.format !== "travel-explorer-backup" || !Array.isArray(payload.records)) {
            throw new Error("Formato backup non riconosciuto");
        }
        const records = await decodeBackupValue(payload.records);
        await TravelStore.restore(records, { replace });
        setBackupStatus("✅ Backup ripristinato. Riapri Travel Explorer per vedere tutti i dati.");
        await renderBackupSummary();
    } catch (error) {
        console.error(error);
        setBackupStatus("❌ File non valido o backup danneggiato.");
    }
}

async function encodeBackupValue(value) {
    if (value instanceof Blob) {
        return {
            __te_type: value instanceof File ? "File" : "Blob",
            name: value instanceof File ? value.name : null,
            type: value.type || "application/octet-stream",
            lastModified: value instanceof File ? value.lastModified : null,
            data: await blobToDataURL(value)
        };
    }
    if (Array.isArray(value)) return Promise.all(value.map(encodeBackupValue));
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, child] of Object.entries(value)) out[key] = await encodeBackupValue(child);
        return out;
    }
    return value;
}

async function decodeBackupValue(value) {
    if (Array.isArray(value)) return Promise.all(value.map(decodeBackupValue));
    if (value && typeof value === "object" && (value.__te_type === "Blob" || value.__te_type === "File") && value.data) {
        const blob = dataURLToBlob(value.data, value.type);
        if (value.__te_type === "File" && typeof File !== "undefined") {
            return new File([blob], value.name || "file", { type: value.type || blob.type, lastModified: value.lastModified || Date.now() });
        }
        return blob;
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, child] of Object.entries(value)) out[key] = await decodeBackupValue(child);
        return out;
    }
    return value;
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function dataURLToBlob(dataURL, fallbackType) {
    const [head, data] = String(dataURL).split(",");
    const type = /data:([^;]+)/.exec(head)?.[1] || fallbackType || "application/octet-stream";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
}

function setBackupStatus(message) {
    const el = document.getElementById("backup-status");
    if (el) el.textContent = message;
}
function escapeBackup(value) {
    const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    };
    return String(value ?? "").replace(/[&<>"']/g, char => map[char]);
}
