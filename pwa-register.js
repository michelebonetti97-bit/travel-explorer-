// ======================================================
// TRAVEL EXPLORER - PWA REGISTER V6
// Installazione + aggiornamento + supporto iOS
// ======================================================

let deferredInstallPrompt = null;

const TE_PWA_SCRIPT_URL =
    document.currentScript?.src ||
    new URL("pwa-register.js", window.location.href).href;

const TE_PWA_ROOT_URL =
    new URL("./", TE_PWA_SCRIPT_URL);

const TE_SERVICE_WORKER_URL =
    new URL("service-worker.js", TE_PWA_ROOT_URL).href;

document.addEventListener("DOMContentLoaded", () => {
    registerTravelExplorerServiceWorker();
    initializeInstallUI();
});


async function registerTravelExplorerServiceWorker() {

    if (!("serviceWorker" in navigator)) {
        return;
    }

    // Durante lo sviluppo con Live Server evitiamo che una vecchia
    // cache PWA mascheri i file appena sostituiti.
    const isLocalDevelopment =
        location.hostname === "127.0.0.1" ||
        location.hostname === "localhost";

    if (isLocalDevelopment) {
        const registrations =
            await navigator.serviceWorker.getRegistrations();

        await Promise.all(
            registrations.map(
                registration =>
                    registration.unregister()
            )
        );

        if ("caches" in window) {
            const keys =
                await caches.keys();

            await Promise.all(
                keys
                    .filter(
                        key =>
                            key.startsWith(
                                "travel-explorer-"
                            )
                    )
                    .map(
                        key =>
                            caches.delete(
                                key
                            )
                    )
            );
        }

        console.log(
            "Travel Explorer: PWA disattivata su Live Server."
        );

        return;
    }

    try {

        const registration =
            await navigator.serviceWorker.register(
                TE_SERVICE_WORKER_URL,
                {
                    scope: TE_PWA_ROOT_URL.pathname
                }
            );

        console.log(
            "Travel Explorer Service Worker attivo:",
            registration.scope
        );

        // Se una nuova versione del SW è già pronta, la attiviamo.
        if (registration.waiting) {
            registration.waiting.postMessage({
                type: "SKIP_WAITING"
            });
        }

        registration.addEventListener(
            "updatefound",
            () => {

                const worker =
                    registration.installing;

                if (!worker) {
                    return;
                }

                worker.addEventListener(
                    "statechange",
                    () => {

                        if (
                            worker.state === "installed" &&
                            navigator.serviceWorker.controller
                        ) {

                            showPWAStatus(
                                "🔄 Nuova versione pronta. Riapri l'app per aggiornarla."
                            );

                        }

                    }
                );

            }
        );

    }

    catch (error) {

        console.error(
            "Errore registrazione PWA:",
            error
        );

        showPWAStatus(
            "⚠️ Modalità offline non ancora disponibile."
        );

    }

}


function initializeInstallUI() {

    const installButton =
        document.getElementById(
            "install-app-button"
        );

    const status =
        document.getElementById(
            "pwa-install-status"
        );

    if (!installButton) {
        return;
    }

    if (isStandaloneMode()) {

        installButton.hidden = true;

        if (status) {
            status.textContent =
                "✅ Travel Explorer è installata.";
        }

        return;

    }

    const isiOS =
        /iphone|ipad|ipod/i
            .test(
                navigator.userAgent
            );

    if (isiOS) {

        installButton.hidden =
            false;

        installButton.textContent =
            "📲 Installa su iPhone";

        if (status) {
            status.textContent =
                "Aprila in Safari e aggiungila alla schermata Home.";
        }

        installButton.addEventListener(
            "click",
            showIOSInstallInstructions
        );

        return;

    }

    // Chrome / Edge / Android.
    window.addEventListener(
        "beforeinstallprompt",
        event => {

            event.preventDefault();

            deferredInstallPrompt =
                event;

            installButton.hidden =
                false;

            installButton.textContent =
                "📲 Installa Travel Explorer";

            if (status) {
                status.textContent =
                    "Installazione disponibile.";
            }

        }
    );

    installButton.addEventListener(
        "click",
        installTravelExplorer
    );

    window.addEventListener(
        "appinstalled",
        () => {

            deferredInstallPrompt =
                null;

            installButton.hidden =
                true;

            if (status) {
                status.textContent =
                    "✅ App installata.";
            }

        }
    );

}


async function installTravelExplorer() {

    if (!deferredInstallPrompt) {

        showPWAStatus(
            "Se il pulsante di installazione non compare, usa il menu del browser → Installa app / Aggiungi alla schermata Home."
        );

        return;

    }

    deferredInstallPrompt.prompt();

    try {

        await deferredInstallPrompt
            .userChoice;

    }

    finally {

        deferredInstallPrompt =
            null;

    }

}


function showIOSInstallInstructions() {

    alert(
        "Per installare Travel Explorer su iPhone:\n\n" +
        "1. Apri questa pagina in Safari\n" +
        "2. Tocca il pulsante Condividi ⬆️\n" +
        "3. Scorri e scegli “Aggiungi alla schermata Home”\n" +
        "4. Tocca “Aggiungi”\n\n" +
        "Poi Travel Explorer si aprirà come un'app."
    );

}


function isStandaloneMode() {

    return (
        window.matchMedia(
            "(display-mode: standalone)"
        ).matches ||
        window.navigator.standalone === true
    );

}


function showPWAStatus(message) {

    const status =
        document.getElementById(
            "pwa-install-status"
        );

    if (status) {
        status.textContent =
            message;
    }

}