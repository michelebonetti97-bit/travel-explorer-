// Configurazione pubblica del client Supabase.
// La sicurezza dei dati è applicata dalle policy RLS nel database.
window.TRAVEL_SYNC_CONFIG = Object.freeze({
    supabaseUrl: "https://mnyypkydbdqictlwlgyb.supabase.co",
    publishableKey: "sb_publishable_FnCraoWUfkHNOAeZMHr4WA_gPiXmFAv",
    tripName: "Mauritius 2026",
    storageBucket: "travel-files",
    maxFileBytes: 25 * 1024 * 1024,
    sharedKeys: Object.freeze([
        "mauritius-2026-route-overrides-v2",
        "mauritius-2026-user-day-templates-v1",
        "mauritius-2026-template-additions-v1",
        "mauritius-2026-budget-settings",
        "mauritius-2026-expenses",
        "mauritius-2026-documents",
        "mauritius-2026-diary",
        "mauritius-2026-checklist"
    ])
});
