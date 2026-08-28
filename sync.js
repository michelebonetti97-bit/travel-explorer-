// TRAVEL EXPLORER - PAGINA ACCOUNT E SINCRONIZZAZIONE

let syncPageOverride = null;
let syncPageOverrideTimer = null;

document.addEventListener("DOMContentLoaded", initSyncPage);

async function initSyncPage() {
    bindSyncPage();
    window.addEventListener("travel-sync:state", event => {
        renderSyncPage(event.detail);
    });

    await TravelSync.ensureStarted();
    renderSyncPage(TravelSync.getState());
}

function bindSyncPage() {
    document.getElementById("sync-login-form")?.addEventListener("submit", async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("button[type='submit']");

        await runSyncAction(button, async () => {
            await TravelSync.signIn(
                document.getElementById("sync-email").value,
                document.getElementById("sync-password").value
            );
            document.getElementById("sync-password").value = "";
            showSyncMessage("Accesso effettuato.", "good");
        });
    });

    document.getElementById("sync-create-trip")?.addEventListener("click", async event => {
        const confirmed = confirm(
            "Creare il viaggio condiviso usando i dati presenti su questo dispositivo? Prima è consigliato aver esportato il backup locale."
        );

        if (!confirmed) {
            return;
        }

        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.createTrip("Mauritius 2026");
            showSyncMessage("Viaggio creato e dati locali inviati.", "good");
        });
    });

    document.getElementById("sync-join-trip")?.addEventListener("click", async event => {
        const code = document.getElementById("sync-invite-input").value.trim();

        if (!code) {
            showSyncMessage("Inserisci il codice mostrato sul telefono di Michele.", "warn");
            return;
        }

        const confirmed = confirm(
            "Collegare questo dispositivo al viaggio condiviso? I dati del viaggio di Michele diventeranno la copia di riferimento."
        );

        if (!confirmed) {
            return;
        }

        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.joinTrip(code);
            showSyncMessage("iPhone collegato al viaggio.", "good");
        });
    });

    document.getElementById("sync-copy-code")?.addEventListener("click", async () => {
        const code = document.getElementById("sync-invite-code").textContent.trim();

        try {
            await navigator.clipboard.writeText(code);
            showSyncMessage("Codice copiato.", "good");
        } catch (error) {
            prompt("Copia questo codice e invialo a Denise:", code);
        }
    });

    document.getElementById("sync-now")?.addEventListener("click", async event => {
        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.syncNow();
            showSyncMessage("Sincronizzazione completata.", "good");
        });
    });

    document.getElementById("sync-sign-out")?.addEventListener("click", async event => {
        if (!confirm("Uscire dall’account su questo dispositivo? I dati locali non verranno eliminati.")) {
            return;
        }

        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.signOut();
            showSyncMessage("Account disconnesso. I dati restano sul dispositivo.", "good");
        });
    });

    document.getElementById("sync-save-name")?.addEventListener("click", async event => {
        const name = document.getElementById("sync-display-name").value.trim();

        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.updateProfile(name);
            showSyncMessage("Nome aggiornato.", "good");
        });
    });

    document.getElementById("sync-change-password")?.addEventListener("click", async event => {
        const input = document.getElementById("sync-new-password");

        if (input.value.length < 8) {
            showSyncMessage("La nuova password deve avere almeno 8 caratteri.", "warn");
            return;
        }

        await runSyncAction(event.currentTarget, async () => {
            await TravelSync.changePassword(input.value);
            input.value = "";
            showSyncMessage("Password aggiornata.", "good");
        });
    });

    document.getElementById("sync-invite-input")?.addEventListener("input", event => {
        event.target.value = event.target.value
            .toUpperCase()
            .replace(/[^A-F0-9]/g, "")
            .slice(0, 10);
    });
}

async function runSyncAction(button, action) {
    const original = button?.textContent;

    if (button) {
        button.disabled = true;
        button.textContent = "Attendi…";
    }

    try {
        await action();
    } catch (error) {
        console.error(error);
        showSyncMessage(TravelSync.readableError(error), "bad");
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = original;
        }
        renderSyncPage(TravelSync.getState());
    }
}

function renderSyncPage(state) {
    setVisible("sync-login-view", !state.signedIn);
    setVisible("sync-trip-view", state.signedIn && !state.trip);
    setVisible("sync-connected-view", Boolean(state.signedIn && state.trip));
    setVisible("sync-account-view", state.signedIn);

    if (!syncPageOverride) {
        const level = state.status === "error"
            ? "bad"
            : (state.status === "offline" || state.status === "pending" ? "warn" : "good");
        setSyncStatus(state.error || state.message || "Pronto.", level);
    }

    if (state.user) {
        setText("sync-account-email", state.user.email || "—");
    }

    if (state.profile) {
        const input = document.getElementById("sync-display-name");
        if (input && document.activeElement !== input) {
            input.value = state.profile.display_name || "";
        }
    }

    if (state.trip) {
        setText("sync-trip-name", state.trip.name || "Mauritius 2026");
        setText("sync-invite-code", state.trip.invite_code || "—");
        setText(
            "sync-account-role",
            (state.profile?.display_name || "Utente") +
                (state.membership?.role === "owner" ? " · proprietario" : " · partecipante")
        );
        setText("sync-pending-count", String(state.pending || 0));
        setText("sync-last-time", formatSyncTime(state.lastSyncAt));
    }
}

function showSyncMessage(message, level) {
    syncPageOverride = { message, level };
    clearTimeout(syncPageOverrideTimer);
    setSyncStatus(message, level);

    syncPageOverrideTimer = setTimeout(() => {
        syncPageOverride = null;
        renderSyncPage(TravelSync.getState());
    }, 3500);
}

function setSyncStatus(message, level) {
    const status = document.getElementById("sync-page-status");
    if (!status) {
        return;
    }

    status.textContent = message;
    status.className = "sync-status " + (level || "");
}

function setVisible(id, visible) {
    const element = document.getElementById(id);
    if (element) {
        element.hidden = !visible;
    }
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function formatSyncTime(value) {
    if (!value) {
        return "Non ancora";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}
