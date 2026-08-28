// ======================================================
// TRAVEL EXPLORER - SYNC V1
// Supabase + IndexedDB: locale prima, cloud quando online.
// ======================================================

window.TravelSync = (() => {

    const config = window.TRAVEL_SYNC_CONFIG;
    const scriptURL = document.currentScript?.src || new URL("travel-sync.js", location.href).href;
    const rootURL = new URL("./", scriptURL);
    const OUTBOX_PREFIX = "outbox:";
    const META_PREFIX = "remote:";
    const ACTIVE_TRIP_PREFIX = "active-trip:";
    const PROFILE_PREFIX = "profile:";
    const BLOB_PREFIX = "blob:";
    const MISSING = Symbol("missing");

    let client = null;
    let session = null;
    let trip = null;
    let membership = null;
    let profile = null;
    let realtimeChannel = null;
    let initPromise = null;
    let initialSyncPromise = Promise.resolve();
    let flushPromise = null;
    let flushTimer = null;
    let authSubscription = null;
    const profileNameCache = new Map();

    const deviceId = getOrCreateDeviceId();

    let state = {
        status: "starting",
        message: "Avvio sincronizzazione…",
        signedIn: false,
        user: null,
        profile: null,
        trip: null,
        membership: null,
        pending: 0,
        lastSyncAt: null,
        error: null
    };

    function getOrCreateDeviceId() {
        const key = "travel-explorer-device-id";

        try {
            let value = localStorage.getItem(key);

            if (!value) {
                value = crypto.randomUUID
                    ? crypto.randomUUID()
                    : "device-" + Date.now() + "-" + Math.random().toString(36).slice(2);
                localStorage.setItem(key, value);
            }

            return value;
        } catch (error) {
            return "device-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        }
    }

    function setState(patch) {
        state = { ...state, ...patch };
        updateStatusUI();
        window.dispatchEvent(new CustomEvent("travel-sync:state", {
            detail: getState()
        }));
    }

    function getState() {
        return {
            ...state,
            user: state.user ? { id: state.user.id, email: state.user.email } : null,
            profile: state.profile ? { ...state.profile } : null,
            trip: state.trip ? { ...state.trip } : null,
            membership: state.membership ? { ...state.membership } : null
        };
    }

    function ensureStarted() {
        if (!initPromise) {
            initPromise = initialize().catch(error => {
                console.error("Travel Sync init:", error);
                setState({
                    status: navigator.onLine ? "error" : "offline",
                    message: navigator.onLine
                        ? "Sincronizzazione non disponibile"
                        : "Offline · dati salvati sul dispositivo",
                    error: readableError(error)
                });
            });
        }

        return initPromise;
    }

    async function initialize() {
        ensureStatusUI();

        if (!config?.supabaseUrl || !config?.publishableKey) {
            throw new Error("Configurazione Supabase mancante");
        }

        if (!window.supabase?.createClient) {
            throw new Error("Client Supabase non caricato");
        }

        if (!window.TravelStore?._syncGet) {
            throw new Error("TravelStore V2 non caricato");
        }

        client = window.supabase.createClient(
            config.supabaseUrl,
            config.publishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storageKey: "travel-explorer-auth"
                },
                realtime: {
                    params: {
                        eventsPerSecond: 4
                    }
                }
            }
        );

        bindConnectionEvents();

        const result = await client.auth.getSession();

        if (result.error) {
            throw result.error;
        }

        try {
            await handleSession(result.data.session);
        } catch (error) {
            if (!result.data.session) {
                throw error;
            }

            console.warn("Avvio dalla copia locale:", error);
            await restoreCachedConnection(error);
        }

        const authResult = client.auth.onAuthStateChange((event, nextSession) => {
            if (event === "TOKEN_REFRESHED") {
                session = nextSession;
                return;
            }

            setTimeout(() => {
                handleSession(nextSession).catch(async error => {
                    console.error("Cambio sessione:", error);

                    if (nextSession) {
                        await restoreCachedConnection(error);
                    } else {
                        setState({
                            status: "error",
                            message: "Errore account",
                            error: readableError(error)
                        });
                    }
                });
            }, 0);
        });

        authSubscription = authResult.data.subscription;
    }

    function bindConnectionEvents() {
        window.addEventListener("online", () => {
            void refreshConnection().catch(async error => {
                console.error("Riallineamento online:", error);
                await restoreCachedConnection(error);
            });
        });

        window.addEventListener("offline", () => {
            setState({
                status: "offline",
                message: "Offline · modifiche in attesa"
            });
        });

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && navigator.onLine && session && trip) {
                initialSyncPromise = initialSync("normal");
                void initialSyncPromise.catch(async error => {
                    console.error("Riallineamento al ritorno nell’app:", error);
                    await restoreCachedConnection(error);
                });
            }
        });
    }

    async function refreshConnection() {
        if (!session) {
            return;
        }

        setState({
            status: "syncing",
            message: "Connessione ripristinata…",
            error: null
        });

        await loadProfile();
        await loadMembership();
    }

    async function handleSession(nextSession) {
        const previousUserId = session?.user?.id || null;
        const nextUserId = nextSession?.user?.id || null;

        session = nextSession;

        if (!session) {
            await removeRealtimeChannel();
            trip = null;
            membership = null;
            profile = null;
            setState({
                status: "signed-out",
                message: "Accedi per condividere il viaggio",
                signedIn: false,
                user: null,
                profile: null,
                trip: null,
                membership: null,
                pending: 0,
                error: null
            });
            return;
        }

        if (previousUserId === nextUserId && state.signedIn) {
            setState({ signedIn: true, user: session.user });
            return;
        }

        setState({
            status: "syncing",
            message: "Controllo account…",
            signedIn: true,
            user: session.user,
            error: null
        });

        await loadProfile();
        await loadMembership();
    }

    async function restoreCachedConnection(error) {
        if (!session) {
            return false;
        }

        const userId = session.user.id;
        const [cachedProfileRecord, cachedTripRecord] = await Promise.all([
            window.TravelStore._syncGet(PROFILE_PREFIX + userId),
            window.TravelStore._syncGet(ACTIVE_TRIP_PREFIX + userId)
        ]);

        profile = cachedProfileRecord?.value || profile || {
            id: userId,
            display_name: session.user.email?.split("@")[0] || "Utente"
        };
        profileNameCache.set(profile.id, profile.display_name);

        const cached = cachedTripRecord?.value || null;

        if (!cached?.tripId) {
            trip = null;
            membership = null;
            setState({
                status: navigator.onLine ? "needs-trip" : "offline",
                message: navigator.onLine
                    ? "Cloud non raggiungibile · riprova tra poco"
                    : "Offline · accedi online per collegare il viaggio",
                signedIn: true,
                user: session.user,
                profile,
                trip: null,
                membership: null,
                pending: 0,
                error: navigator.onLine ? readableError(error) : null
            });
            return false;
        }

        trip = cached.trip || {
            id: cached.tripId,
            name: config.tripName,
            invite_code: cached.inviteCode || "",
            created_by: cached.createdBy || null
        };
        membership = cached.membership || {
            trip_id: cached.tripId,
            role: cached.role || "member",
            joined_at: cached.joinedAt || null
        };

        const pending = await countOutbox();

        setState({
            status: navigator.onLine ? "pending" : "offline",
            message: navigator.onLine
                ? "Cloud non raggiungibile · uso la copia locale"
                : "Offline · modifiche salvate sul dispositivo",
            signedIn: true,
            user: session.user,
            profile,
            trip,
            membership,
            pending,
            error: navigator.onLine ? readableError(error) : null
        });

        return true;
    }

    async function loadProfile() {
        const result = await client
            .from("profiles")
            .select("id,display_name")
            .eq("id", session.user.id)
            .maybeSingle();

        if (result.error) {
            throw result.error;
        }

        profile = result.data || {
            id: session.user.id,
            display_name: session.user.email?.split("@")[0] || "Utente"
        };

        profileNameCache.set(profile.id, profile.display_name);

        await window.TravelStore._syncSet(
            PROFILE_PREFIX + session.user.id,
            profile
        );

        setState({ profile });
    }

    async function loadMembership() {
        const memberResult = await client
            .from("trip_members")
            .select("trip_id,role,joined_at")
            .eq("user_id", session.user.id)
            .order("joined_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (memberResult.error) {
            throw memberResult.error;
        }

        if (!memberResult.data) {
            await removeRealtimeChannel();
            await window.TravelStore._syncRemove(
                ACTIVE_TRIP_PREFIX + session.user.id
            );
            trip = null;
            membership = null;
            setState({
                status: "needs-trip",
                message: "Crea o collega il viaggio condiviso",
                trip: null,
                membership: null
            });
            return;
        }

        const tripResult = await client
            .from("trips")
            .select("id,name,invite_code,created_by,created_at")
            .eq("id", memberResult.data.trip_id)
            .single();

        if (tripResult.error) {
            throw tripResult.error;
        }

        await connectTrip(tripResult.data, memberResult.data, "download");
    }

    async function connectTrip(nextTrip, nextMembership, mode) {
        await removeRealtimeChannel();
        trip = nextTrip;
        membership = nextMembership;

        await window.TravelStore._syncSet(
            ACTIVE_TRIP_PREFIX + session.user.id,
            {
                tripId: trip.id,
                role: membership.role,
                inviteCode: trip.invite_code || "",
                createdBy: trip.created_by || null,
                joinedAt: membership.joined_at || null,
                trip: { ...trip },
                membership: { ...membership }
            }
        );

        setState({
            status: navigator.onLine ? "syncing" : "offline",
            message: navigator.onLine ? "Allineamento viaggio…" : "Offline · viaggio collegato",
            trip,
            membership,
            error: null
        });

        subscribeRealtime();
        initialSyncPromise = initialSync(mode);
        await initialSyncPromise;
    }

    async function initialSync(mode = "normal") {
        if (!session || !trip) {
            return;
        }

        if (!navigator.onLine) {
            setState({
                status: "offline",
                message: "Offline · dati disponibili sul dispositivo"
            });
            return;
        }

        setState({ status: "syncing", message: "Sincronizzazione dati…" });

        const result = await client
            .from("shared_state")
            .select("trip_id,store_key,payload,revision,updated_at,updated_by,device_id")
            .eq("trip_id", trip.id);

        if (result.error) {
            throw result.error;
        }

        const remoteByKey = new Map(
            (result.data || []).map(row => [row.store_key, row])
        );

        for (const key of config.sharedKeys) {
            const remote = remoteByKey.get(key) || null;
            const localRecord = await window.TravelStore._getRecord(key);
            const outbox = await getOutbox(key);
            const meta = await getRemoteMeta(key);

            if (outbox) {
                continue;
            }

            if (!remote) {
                if (localRecord) {
                    await queueOutbox(key, localRecord.updated_at, false);
                }
                continue;
            }

            if (!localRecord) {
                await applyRemoteRow(remote, false);
                continue;
            }

            if (!meta) {
                if (mode === "upload") {
                    await saveRemoteMeta(key, {
                        revision: remote.revision,
                        base_payload: remote.payload,
                        remote_updated_at: remote.updated_at,
                        last_synced_local_updated_at: null
                    });
                    await queueOutbox(key, localRecord.updated_at, false);
                } else {
                    await applyRemoteRow(remote, false);
                }
                continue;
            }

            const localIsDirty =
                !meta.last_synced_local_updated_at ||
                localRecord.updated_at !== meta.last_synced_local_updated_at;

            if (localIsDirty) {
                await queueOutbox(key, localRecord.updated_at, false);
            } else if (Number(remote.revision) > Number(meta.revision || 0)) {
                await applyRemoteRow(remote, false);
            }
        }

        await flushOutbox();
        const pending = await countOutbox();

        setState({
            status: pending ? "pending" : "synced",
            message: pending
                ? pending + " modifica" + (pending === 1 ? "" : "he") + " in attesa"
                : "Viaggio condiviso aggiornato",
            pending,
            lastSyncAt: new Date().toISOString(),
            error: null
        });
    }

    async function beforeRead() {
        await raceTimeout(
            Promise.resolve(ensureStarted()).catch(() => undefined),
            5000
        );
        await raceTimeout(
            Promise.resolve(initialSyncPromise).catch(() => undefined),
            8000
        );
    }

    async function localChanged(key, localUpdatedAt, deleted) {
        if (!config.sharedKeys.includes(key)) {
            return;
        }

        await raceTimeout(ensureStarted(), 2500);

        if (!session || !trip) {
            return;
        }

        await queueOutbox(key, localUpdatedAt, deleted);
        const pending = await countOutbox();

        setState({
            status: navigator.onLine ? "pending" : "offline",
            message: navigator.onLine
                ? "Modifica salvata · invio…"
                : "Offline · modifica salvata",
            pending
        });

        scheduleFlush(120);
    }

    function scheduleFlush(delay = 150) {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushOutbox().catch(error => {
                console.error("Invio modifiche:", error);
                setState({
                    status: navigator.onLine ? "error" : "offline",
                    message: navigator.onLine
                        ? "Modifica locale salva · sync da riprovare"
                        : "Offline · modifica in attesa",
                    error: readableError(error)
                });
            });
        }, delay);
    }

    async function queueOutbox(key, localUpdatedAt, deleted) {
        if (!trip) {
            return;
        }

        await window.TravelStore._syncSet(
            OUTBOX_PREFIX + trip.id + ":" + key,
            {
                store_key: key,
                local_updated_at: localUpdatedAt || new Date().toISOString(),
                deleted: Boolean(deleted)
            }
        );
    }

    async function getOutbox(key) {
        if (!trip) {
            return null;
        }

        const record = await window.TravelStore._syncGet(
            OUTBOX_PREFIX + trip.id + ":" + key
        );

        return record?.value || null;
    }

    async function removeOutboxIfCurrent(key, processedEntry) {
        return window.TravelStore._syncRemoveIfValue(
            OUTBOX_PREFIX + trip.id + ":" + key,
            processedEntry
        );
    }

    async function listOutbox() {
        if (!trip) {
            return [];
        }

        const prefix = OUTBOX_PREFIX + trip.id + ":";
        const records = await window.TravelStore._syncAll();

        return records
            .filter(record => record.key.startsWith(prefix))
            .map(record => record.value)
            .filter(Boolean);
    }

    async function countOutbox() {
        return (await listOutbox()).length;
    }

    async function getRemoteMeta(key) {
        const record = await window.TravelStore._syncGet(
            META_PREFIX + trip.id + ":" + key
        );
        return record?.value || null;
    }

    async function saveRemoteMeta(key, value) {
        await window.TravelStore._syncSet(
            META_PREFIX + trip.id + ":" + key,
            value
        );
    }

    async function flushOutbox() {
        if (flushPromise) {
            return flushPromise;
        }

        flushPromise = performFlush().finally(() => {
            flushPromise = null;
        });

        return flushPromise;
    }

    async function performFlush() {
        if (!client || !session || !trip || !navigator.onLine) {
            return;
        }

        const entries = await listOutbox();

        if (!entries.length) {
            return;
        }

        setState({
            status: "syncing",
            message: "Invio " + entries.length + " modifica" + (entries.length === 1 ? "" : "he") + "…",
            pending: entries.length
        });

        let firstError = null;

        for (const entry of entries) {
            try {
                await flushOne(entry);
            } catch (error) {
                firstError ||= error;
                console.error("Modulo non sincronizzato:", entry.store_key, error);
            }
        }

        const pending = await countOutbox();

        if (firstError) {
            setState({
                status: navigator.onLine ? "error" : "offline",
                message: pending
                    ? pending + " modifica" + (pending === 1 ? "" : "he") + " ancora in attesa"
                    : "Sincronizzazione incompleta",
                pending,
                error: readableError(firstError)
            });
            throw firstError;
        }

        setState({
            status: pending ? "pending" : "synced",
            message: pending ? pending + " modifiche in attesa" : "Viaggio condiviso aggiornato",
            pending,
            lastSyncAt: new Date().toISOString(),
            error: null
        });
    }

    async function flushOne(entry) {
        const key = entry.store_key;

        entry = await getOutbox(key);

        if (!entry) {
            return;
        }

        const localRecord = entry.deleted
            ? null
            : await window.TravelStore._getRecord(key);
        const localPayload = entry.deleted || !localRecord
            ? null
            : await encodeForCloud(localRecord.value);
        const processedEntry = {
            store_key: key,
            local_updated_at: localRecord?.updated_at || entry.local_updated_at,
            deleted: Boolean(entry.deleted || !localRecord)
        };
        const meta = await getRemoteMeta(key);
        const expectedRevision = Number(meta?.revision || 0);

        const result = await client.rpc("write_shared_state", {
            p_trip_id: trip.id,
            p_store_key: key,
            p_payload: localPayload,
            p_expected_revision: expectedRevision,
            p_device_id: deviceId
        });

        if (result.error) {
            if (isConflict(result.error)) {
                await resolveConflict(
                    key,
                    localPayload,
                    localRecord,
                    processedEntry,
                    meta
                );
                return;
            }
            throw result.error;
        }

        const row = rpcRow(result.data);

        await saveRemoteMeta(key, {
            revision: row.revision,
            base_payload: row.payload,
            remote_updated_at: row.updated_at,
            last_synced_local_updated_at: processedEntry.local_updated_at
        });
        await removeOutboxIfCurrent(key, processedEntry);
    }

    async function resolveConflict(
        key,
        localPayload,
        localRecord,
        processedEntry,
        meta
    ) {
        const remote = await fetchRemoteRow(key);

        if (!remote) {
            throw new Error("Conflitto di sincronizzazione senza copia remota");
        }

        const mergedPayload = mergeThreeWay(
            meta?.base_payload,
            localPayload,
            remote.payload
        );

        const retry = await client.rpc("write_shared_state", {
            p_trip_id: trip.id,
            p_store_key: key,
            p_payload: mergedPayload === MISSING ? null : mergedPayload,
            p_expected_revision: Number(remote.revision),
            p_device_id: deviceId
        });

        if (retry.error) {
            throw retry.error;
        }

        const row = rpcRow(retry.data);
        const decoded = row.payload === null
            ? null
            : await decodeFromCloud(row.payload);

        const applied = await window.TravelStore._applyRemoteIfCurrent(
            key,
            decoded,
            row.updated_at,
            processedEntry.deleted ? null : localRecord
        );

        await saveRemoteMeta(key, {
            revision: row.revision,
            base_payload: row.payload,
            remote_updated_at: row.updated_at,
            last_synced_local_updated_at: applied
                ? row.updated_at
                : processedEntry.local_updated_at
        });

        if (applied) {
            await removeOutboxIfCurrent(key, processedEntry);
            showRemoteNotice("Le modifiche dei due dispositivi sono state unite.");
        }
    }

    async function fetchRemoteRow(key) {
        const result = await client
            .from("shared_state")
            .select("trip_id,store_key,payload,revision,updated_at,updated_by,device_id")
            .eq("trip_id", trip.id)
            .eq("store_key", key)
            .maybeSingle();

        if (result.error) {
            throw result.error;
        }

        return result.data || null;
    }

    async function applyRemoteRow(row, notify) {
        const expectedRecord = await window.TravelStore._getRecord(
            row.store_key
        );
        const decoded = row.payload === null
            ? null
            : await decodeFromCloud(row.payload);

        const applied = await window.TravelStore._applyRemoteIfCurrent(
            row.store_key,
            decoded,
            row.updated_at,
            expectedRecord
        );

        if (!applied) {
            return false;
        }

        await saveRemoteMeta(row.store_key, {
            revision: row.revision,
            base_payload: row.payload,
            remote_updated_at: row.updated_at,
            last_synced_local_updated_at: row.updated_at
        });

        if (notify) {
            const author = await displayNameFor(row.updated_by);
            showRemoteNotice(
                author
                    ? "Aggiornamento ricevuto da " + author + "."
                    : "È arrivato un aggiornamento dall’altro iPhone."
            );
        }

        return true;
    }

    async function displayNameFor(userId) {
        if (!userId) {
            return "";
        }

        if (profileNameCache.has(userId)) {
            return profileNameCache.get(userId);
        }

        const result = await client
            .from("profiles")
            .select("display_name")
            .eq("id", userId)
            .maybeSingle();

        if (result.error || !result.data?.display_name) {
            return "";
        }

        profileNameCache.set(userId, result.data.display_name);
        return result.data.display_name;
    }

    function subscribeRealtime() {
        if (!client || !trip) {
            return;
        }

        realtimeChannel = client
            .channel("travel-explorer-" + trip.id + "-" + deviceId)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "shared_state",
                    filter: "trip_id=eq." + trip.id
                },
                payload => {
                    handleRealtime(payload).catch(error => {
                        console.error("Realtime:", error);
                        setState({
                            status: "error",
                            message: "Aggiornamento ricevuto ma non applicato",
                            error: readableError(error)
                        });
                    });
                }
            )
            .subscribe();
    }

    async function handleRealtime(payload) {
        const row = payload.new;

        if (!row || !config.sharedKeys.includes(row.store_key)) {
            return;
        }

        if (row.device_id === deviceId && row.updated_by === session?.user?.id) {
            return;
        }

        const outbox = await getOutbox(row.store_key);

        if (outbox) {
            await flushOutbox();
            return;
        }

        const meta = await getRemoteMeta(row.store_key);

        if (meta && Number(row.revision) <= Number(meta.revision || 0)) {
            return;
        }

        const applied = await applyRemoteRow(row, true);

        if (!applied) {
            scheduleFlush(80);
            setState({
                status: "pending",
                message: "Modifica locale salva · unione in corso"
            });
            return;
        }

        setState({
            status: "synced",
            message: "Aggiornamento ricevuto",
            lastSyncAt: new Date().toISOString()
        });
    }

    async function removeRealtimeChannel() {
        if (client && realtimeChannel) {
            try {
                await client.removeChannel(realtimeChannel);
            } catch (error) {
                console.warn("Chiusura canale realtime:", error);
            }
        }
        realtimeChannel = null;
    }

    async function encodeForCloud(value) {
        if (value instanceof Blob) {
            return uploadBlob(value);
        }

        if (Array.isArray(value)) {
            return Promise.all(value.map(encodeForCloud));
        }

        if (isPlainObject(value)) {
            const output = {};

            for (const [key, child] of Object.entries(value)) {
                if (typeof child !== "undefined") {
                    output[key] = await encodeForCloud(child);
                }
            }

            return output;
        }

        return typeof value === "undefined" ? null : value;
    }

    async function uploadBlob(blob) {
        if (blob.size > Number(config.maxFileBytes || 25 * 1024 * 1024)) {
            throw new Error(
                "Il file “" + (blob.name || "allegato") + "” supera 25 MB: resta salvato su questo iPhone ma non può essere sincronizzato."
            );
        }

        const sha256 = await hashBlob(blob);
        const mapKey = BLOB_PREFIX + trip.id + ":" + sha256;
        const mapped = await window.TravelStore._syncGet(mapKey);
        const path = mapped?.value?.path || trip.id + "/" + sha256;

        if (!mapped) {
            const upload = await client.storage
                .from(config.storageBucket)
                .upload(path, blob, {
                    cacheControl: "31536000",
                    contentType: blob.type || "application/octet-stream",
                    upsert: false
                });

            if (upload.error && !isAlreadyExists(upload.error)) {
                throw upload.error;
            }

            await window.TravelStore._syncSet(mapKey, { path });
        }

        return {
            __te_cloud_blob: "v1",
            path,
            sha256,
            name: blob.name || null,
            type: blob.type || "application/octet-stream",
            size: blob.size,
            lastModified: Number(blob.lastModified || 0) || null
        };
    }

    async function decodeFromCloud(value) {
        if (isCloudBlob(value)) {
            const download = await client.storage
                .from(config.storageBucket)
                .download(value.path);

            if (download.error) {
                throw download.error;
            }

            await window.TravelStore._syncSet(
                BLOB_PREFIX + trip.id + ":" + value.sha256,
                { path: value.path }
            );

            if (value.name && typeof File !== "undefined") {
                return new File(
                    [download.data],
                    value.name,
                    {
                        type: value.type || download.data.type,
                        lastModified: value.lastModified || Date.now()
                    }
                );
            }

            return new Blob(
                [download.data],
                { type: value.type || download.data.type }
            );
        }

        if (Array.isArray(value)) {
            return Promise.all(value.map(decodeFromCloud));
        }

        if (isPlainObject(value)) {
            const output = {};

            for (const [key, child] of Object.entries(value)) {
                output[key] = await decodeFromCloud(child);
            }

            return output;
        }

        return value;
    }

    async function hashBlob(blob) {
        const buffer = await blob.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);

        return Array.from(new Uint8Array(digest))
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    function mergeThreeWay(base, local, remote) {
        return mergeNode(
            typeof base === "undefined" ? MISSING : base,
            typeof local === "undefined" ? MISSING : local,
            typeof remote === "undefined" ? MISSING : remote
        );
    }

    function mergeNode(base, local, remote) {
        if (sameValue(local, remote)) {
            return cloneMergeValue(local);
        }

        if (sameValue(base, local)) {
            return cloneMergeValue(remote);
        }

        if (sameValue(base, remote)) {
            return cloneMergeValue(local);
        }

        if (local === MISSING || remote === MISSING) {
            if (base === MISSING) {
                return cloneMergeValue(local === MISSING ? remote : local);
            }
            return cloneMergeValue(local);
        }

        if (Array.isArray(local) && Array.isArray(remote) && arrayHasStableIds(local, remote, base)) {
            return mergeArraysById(
                Array.isArray(base) ? base : [],
                local,
                remote
            );
        }

        if (
            isPlainObject(local) &&
            isPlainObject(remote) &&
            !isCloudBlob(local) &&
            !isCloudBlob(remote)
        ) {
            const baseObject = isPlainObject(base) ? base : {};
            const output = {};
            const keys = new Set([
                ...Object.keys(baseObject),
                ...Object.keys(local),
                ...Object.keys(remote)
            ]);

            for (const key of keys) {
                const merged = mergeNode(
                    Object.prototype.hasOwnProperty.call(baseObject, key) ? baseObject[key] : MISSING,
                    Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
                    Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING
                );

                if (merged !== MISSING) {
                    output[key] = merged;
                }
            }

            return output;
        }

        return chooseNewest(local, remote);
    }

    function mergeArraysById(base, local, remote) {
        const baseMap = new Map(base.map(item => [String(item.id), item]));
        const localMap = new Map(local.map(item => [String(item.id), item]));
        const remoteMap = new Map(remote.map(item => [String(item.id), item]));
        const order = [
            ...local.map(item => String(item.id)),
            ...remote.map(item => String(item.id))
        ].filter((id, index, array) => array.indexOf(id) === index);
        const result = [];

        for (const id of order) {
            const merged = mergeNode(
                baseMap.has(id) ? baseMap.get(id) : MISSING,
                localMap.has(id) ? localMap.get(id) : MISSING,
                remoteMap.has(id) ? remoteMap.get(id) : MISSING
            );

            if (merged !== MISSING) {
                result.push(merged);
            }
        }

        return result;
    }

    function arrayHasStableIds(local, remote, base) {
        const all = [
            ...(Array.isArray(base) ? base : []),
            ...local,
            ...remote
        ];

        return all.length > 0 && all.every(item =>
            isPlainObject(item) &&
            item.id !== null &&
            typeof item.id !== "undefined"
        );
    }

    function chooseNewest(local, remote) {
        const localTime = Date.parse(local?.updated_at || local?.created_at || "");
        const remoteTime = Date.parse(remote?.updated_at || remote?.created_at || "");

        if (Number.isFinite(remoteTime) && Number.isFinite(localTime) && remoteTime > localTime) {
            return cloneMergeValue(remote);
        }

        return cloneMergeValue(local);
    }

    function sameValue(a, b) {
        if (a === MISSING || b === MISSING) {
            return a === b;
        }

        if (a === b) {
            return true;
        }

        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch (error) {
            return false;
        }
    }

    function cloneMergeValue(value) {
        if (value === MISSING) {
            return MISSING;
        }

        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }

        return JSON.parse(JSON.stringify(value));
    }

    function isPlainObject(value) {
        return Boolean(value) &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !(value instanceof Blob);
    }

    function isCloudBlob(value) {
        return isPlainObject(value) &&
            value.__te_cloud_blob === "v1" &&
            typeof value.path === "string";
    }

    function isConflict(error) {
        return error?.code === "40001" ||
            String(error?.message || "").includes("SYNC_CONFLICT");
    }

    function isAlreadyExists(error) {
        return String(error?.statusCode || "") === "409" ||
            /already exists|duplicate/i.test(String(error?.message || ""));
    }

    function rpcRow(data) {
        const row = Array.isArray(data) ? data[0] : data;

        if (!row || typeof row.revision === "undefined") {
            throw new Error("Risposta di sincronizzazione non valida");
        }

        return row;
    }

    async function signIn(email, password) {
        await ensureStarted();

        const result = await client.auth.signInWithPassword({
            email: String(email || "").trim(),
            password: String(password || "")
        });

        if (result.error) {
            throw result.error;
        }

        await handleSession(result.data.session);
        return getState();
    }

    async function signOut() {
        await ensureStarted();

        try {
            await raceTimeout(flushOutbox(), 4000);
        } catch (error) {
            console.warn("Modifiche ancora locali durante uscita:", error);
        }

        const result = await client.auth.signOut();

        if (result.error) {
            throw result.error;
        }

        await handleSession(null);
    }

    async function createTrip(name) {
        await ensureStarted();

        if (!session) {
            throw new Error("Accedi prima di creare il viaggio");
        }

        const result = await client.rpc("create_shared_trip", {
            p_name: String(name || config.tripName).trim() || config.tripName
        });

        if (result.error) {
            throw result.error;
        }

        const created = Array.isArray(result.data) ? result.data[0] : result.data;
        const nextTrip = {
            id: created.trip_id,
            name: String(name || config.tripName).trim() || config.tripName,
            invite_code: created.invite_code,
            created_by: session.user.id
        };
        const nextMembership = {
            trip_id: created.trip_id,
            role: "owner",
            joined_at: new Date().toISOString()
        };

        await connectTrip(nextTrip, nextMembership, "upload");
        return getState();
    }

    async function joinTrip(inviteCode) {
        await ensureStarted();

        if (!session) {
            throw new Error("Accedi prima di collegare il viaggio");
        }

        const result = await client.rpc("join_shared_trip", {
            p_invite_code: String(inviteCode || "").trim().toUpperCase()
        });

        if (result.error) {
            throw result.error;
        }

        await loadMembership();
        return getState();
    }

    async function updateProfile(displayName) {
        await ensureStarted();
        const cleanName = String(displayName || "").trim();

        if (!session || !cleanName) {
            throw new Error("Nome non valido");
        }

        const result = await client
            .from("profiles")
            .update({ display_name: cleanName })
            .eq("id", session.user.id)
            .select("id,display_name")
            .single();

        if (result.error) {
            throw result.error;
        }

        profile = result.data;
        profileNameCache.set(profile.id, profile.display_name);
        await window.TravelStore._syncSet(
            PROFILE_PREFIX + session.user.id,
            profile
        );
        setState({ profile });
        return profile;
    }

    async function changePassword(password) {
        await ensureStarted();

        if (String(password || "").length < 8) {
            throw new Error("La password deve contenere almeno 8 caratteri");
        }

        const result = await client.auth.updateUser({
            password: String(password)
        });

        if (result.error) {
            throw result.error;
        }
    }

    async function syncNow() {
        await ensureStarted();

        if (!session || !trip) {
            throw new Error("Account o viaggio non collegato");
        }

        initialSyncPromise = initialSync("normal");
        await initialSyncPromise;
        return getState();
    }

    function ensureStatusUI() {
        if (document.getElementById("te-sync-pill")) {
            return;
        }

        const style = document.createElement("style");
        style.textContent = '#te-sync-pill{position:fixed;z-index:9990;top:max(10px,env(safe-area-inset-top));right:10px;border:1px solid rgba(255,255,255,.78);border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.92);box-shadow:0 5px 18px rgba(0,0,0,.11);color:#355b55;font:750 10px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer}#te-sync-pill[data-state="error"]{color:#9c3e32;background:#fff4f1}#te-sync-pill[data-state="offline"],#te-sync-pill[data-state="pending"]{color:#765d23;background:#fff9e8}#te-sync-notice{position:fixed;z-index:9991;left:12px;right:12px;bottom:max(14px,env(safe-area-inset-bottom));max-width:520px;margin:auto;padding:12px 13px;border-radius:16px;background:#1d1d1f;color:#fff;box-shadow:0 10px 34px rgba(0,0,0,.24);font:650 11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;gap:10px}#te-sync-notice button{margin-left:auto;border:0;border-radius:10px;padding:8px 10px;background:#fff;color:#1d1d1f;font-weight:800}';
        document.head.appendChild(style);

        const button = document.createElement("button");
        button.type = "button";
        button.id = "te-sync-pill";
        button.textContent = "☁️ Avvio…";
        button.addEventListener("click", () => {
            location.href = new URL("sync.html", rootURL).href;
        });
        document.body.appendChild(button);
        updateStatusUI();
    }

    function updateStatusUI() {
        const button = document.getElementById("te-sync-pill");
        if (!button) {
            return;
        }

        const labels = {
            starting: "☁️ Avvio…",
            "signed-out": "☁️ Accedi",
            "needs-trip": "☁️ Collega",
            syncing: "↻ Sincronizzo",
            synced: "✓ Condiviso",
            pending: "↑ In attesa",
            offline: "○ Offline",
            error: "⚠ Sync"
        };

        button.dataset.state = state.status;
        button.textContent = labels[state.status] || "☁️ Sync";
        button.title = state.message || "Sincronizzazione Travel Explorer";
    }

    function showRemoteNotice(message) {
        if (document.visibilityState !== "visible") {
            return;
        }

        document.getElementById("te-sync-notice")?.remove();
        const notice = document.createElement("div");
        notice.id = "te-sync-notice";
        const text = document.createElement("span");
        text.textContent = message;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Aggiorna";
        button.addEventListener("click", () => location.reload());
        notice.append(text, button);
        document.body.appendChild(notice);

        setTimeout(() => notice.remove(), 15000);
    }

    function readableError(error) {
        const raw = String(error?.message || error || "Errore sconosciuto");

        if (/invalid login credentials/i.test(raw)) {
            return "Email o password non corrette";
        }
        if (/invite_code_invalid/i.test(raw)) {
            return "Codice viaggio non valido";
        }
        if (/failed to fetch|network/i.test(raw)) {
            return "Connessione non disponibile";
        }
        if (/bucket not found/i.test(raw)) {
            return "Archivio allegati non configurato in Supabase";
        }
        if (/maximum allowed size|payload too large|file size/i.test(raw)) {
            return "Allegato troppo grande per la sincronizzazione";
        }

        return raw;
    }

    async function raceTimeout(promise, milliseconds) {
        let timer;

        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise(resolve => {
                    timer = setTimeout(resolve, milliseconds);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureStarted, { once: true });
    } else {
        ensureStarted();
    }

    return {
        beforeRead,
        localChanged,
        signIn,
        signOut,
        createTrip,
        joinTrip,
        updateProfile,
        changePassword,
        syncNow,
        getState,
        ensureStarted,
        readableError,
        _mergeThreeWay: mergeThreeWay
    };

})();
