// ======================================================
// TRAVEL EXPLORER - PERSISTENZA LOCALE V2
// IndexedDB offline-first + aggancio opzionale alla sync.
// ======================================================

window.TravelStore = (() => {

    const DB_NAME = "travel-explorer-db";
    const DB_VERSION = 2;
    const DATA_STORE = "settings";
    const SYNC_STORE = "sync_meta";

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = event => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(DATA_STORE)) {
                    db.createObjectStore(DATA_STORE, { keyPath: "key" });
                }

                if (!db.objectStoreNames.contains(SYNC_STORE)) {
                    db.createObjectStore(SYNC_STORE, { keyPath: "key" });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("Aggiornamento database locale bloccato: chiudi le altre schede di Travel Explorer."));
        });
    }

    async function getRecordFrom(storeName, key) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).get(key);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => db.close();
            transaction.onabort = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    async function putRecordIn(storeName, key, value, updatedAt) {
        const db = await openDB();
        const timestamp = updatedAt || new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");

            transaction.objectStore(storeName).put({
                key,
                value,
                updated_at: timestamp
            });

            transaction.oncomplete = () => {
                db.close();
                resolve({ key, value, updated_at: timestamp });
            };

            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    async function deleteRecordFrom(storeName, key) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).delete(key);

            transaction.oncomplete = () => {
                db.close();
                resolve();
            };

            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    async function deleteRecordIfValueMatches(storeName, key, expectedValue) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            let removed = false;

            request.onsuccess = () => {
                if (
                    request.result &&
                    valuesEquivalent(request.result.value, expectedValue)
                ) {
                    store.delete(key);
                    removed = true;
                }
            };

            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => {
                db.close();
                resolve(removed);
            };
            transaction.onabort = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    async function getAllFrom(storeName) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).getAll();

            request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => db.close();
            transaction.onabort = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    function isSharedKey(key) {
        const configured = window.TRAVEL_SYNC_CONFIG?.sharedKeys;

        if (Array.isArray(configured)) {
            return configured.includes(key);
        }

        return String(key || "").startsWith("mauritius-2026-") &&
            key !== "mauritius-2026-fx-eur-mur";
    }

    function emitChange(key, value, source) {
        window.dispatchEvent(new CustomEvent("travelstore:changed", {
            detail: { key, value, source }
        }));
    }

    function valuesEquivalent(left, right) {
        if (left === right) {
            return true;
        }

        if (left instanceof Blob || right instanceof Blob) {
            return left instanceof Blob &&
                right instanceof Blob &&
                left.size === right.size &&
                left.type === right.type &&
                (left.name || "") === (right.name || "") &&
                Number(left.lastModified || 0) === Number(right.lastModified || 0);
        }

        if (Array.isArray(left) || Array.isArray(right)) {
            return Array.isArray(left) &&
                Array.isArray(right) &&
                left.length === right.length &&
                left.every((value, index) => valuesEquivalent(value, right[index]));
        }

        if (left && right && typeof left === "object" && typeof right === "object") {
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);

            return leftKeys.length === rightKeys.length &&
                leftKeys.every(key =>
                    Object.prototype.hasOwnProperty.call(right, key) &&
                    valuesEquivalent(left[key], right[key])
                );
        }

        return false;
    }

    async function get(key) {
        if (isSharedKey(key) && window.TravelSync?.beforeRead) {
            await window.TravelSync.beforeRead(key);
        }

        const record = await getRecordFrom(DATA_STORE, key);
        return record ? record.value : null;
    }

    async function set(key, value) {
        const existing = await getRecordFrom(DATA_STORE, key);

        if (existing && valuesEquivalent(existing.value, value)) {
            return;
        }

        const record = await putRecordIn(DATA_STORE, key, value);
        emitChange(key, value, "local");

        if (isSharedKey(key) && window.TravelSync?.localChanged) {
            await window.TravelSync.localChanged(key, record.updated_at, false);
        }
    }

    async function remove(key) {
        await deleteRecordFrom(DATA_STORE, key);
        const timestamp = new Date().toISOString();
        emitChange(key, null, "local");

        if (isSharedKey(key) && window.TravelSync?.localChanged) {
            await window.TravelSync.localChanged(key, timestamp, true);
        }
    }

    async function dump() {
        if (window.TravelSync?.beforeRead) {
            await window.TravelSync.beforeRead();
        }

        return getAllFrom(DATA_STORE);
    }

    async function restore(records, { replace = false } = {}) {
        if (!Array.isArray(records)) {
            throw new Error("Backup non valido");
        }

        if (window.TravelSync?.beforeRead) {
            await window.TravelSync.beforeRead();
        }

        const previous = replace ? await getAllFrom(DATA_STORE) : [];
        const db = await openDB();

        await new Promise((resolve, reject) => {
            const transaction = db.transaction(DATA_STORE, "readwrite");
            const store = transaction.objectStore(DATA_STORE);

            if (replace) {
                store.clear();
            }

            records.forEach(record => {
                if (record && typeof record.key === "string") {
                    store.put({
                        key: record.key,
                        value: record.value,
                        updated_at: record.updated_at || new Date().toISOString()
                    });
                }
            });

            transaction.oncomplete = () => {
                db.close();
                resolve();
            };

            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };
        });

        if (window.TravelSync?.localChanged) {
            const restoredKeys = new Set(records.map(record => record?.key).filter(Boolean));

            for (const record of records) {
                if (record && isSharedKey(record.key)) {
                    await window.TravelSync.localChanged(
                        record.key,
                        record.updated_at || new Date().toISOString(),
                        false
                    );
                }
            }

            if (replace) {
                for (const record of previous) {
                    if (isSharedKey(record.key) && !restoredKeys.has(record.key)) {
                        await window.TravelSync.localChanged(
                            record.key,
                            new Date().toISOString(),
                            true
                        );
                    }
                }
            }
        }

        window.dispatchEvent(new CustomEvent("travelstore:restored"));
    }

    // Metodi interni: TravelSync li usa senza generare un nuovo ciclo di sync.
    async function applyRemote(key, value, updatedAt) {
        if (value === null) {
            await deleteRecordFrom(DATA_STORE, key);
        } else {
            await putRecordIn(DATA_STORE, key, value, updatedAt);
        }

        emitChange(key, value, "remote");
    }

    async function applyRemoteIfCurrent(key, value, updatedAt, expectedRecord) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DATA_STORE, "readwrite");
            const store = transaction.objectStore(DATA_STORE);
            const request = store.get(key);
            let applied = false;

            request.onsuccess = () => {
                const current = request.result || null;
                const unchanged = expectedRecord
                    ? Boolean(
                        current &&
                        current.updated_at === expectedRecord.updated_at &&
                        valuesEquivalent(current.value, expectedRecord.value)
                    )
                    : !current;

                if (!unchanged) {
                    return;
                }

                if (value === null) {
                    store.delete(key);
                } else {
                    store.put({
                        key,
                        value,
                        updated_at: updatedAt || new Date().toISOString()
                    });
                }

                applied = true;
            };

            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => {
                db.close();

                if (applied) {
                    emitChange(key, value, "remote");
                }

                resolve(applied);
            };
            transaction.onabort = () => {
                db.close();
                reject(transaction.error);
            };
        });
    }

    return {
        get,
        set,
        remove,
        dump,
        restore,
        _getRecord: key => getRecordFrom(DATA_STORE, key),
        _getAllRecords: () => getAllFrom(DATA_STORE),
        _applyRemote: applyRemote,
        _applyRemoteIfCurrent: applyRemoteIfCurrent,
        _syncGet: key => getRecordFrom(SYNC_STORE, key),
        _syncSet: (key, value) => putRecordIn(SYNC_STORE, key, value),
        _syncRemove: key => deleteRecordFrom(SYNC_STORE, key),
        _syncRemoveIfValue: (key, expectedValue) =>
            deleteRecordIfValueMatches(SYNC_STORE, key, expectedValue),
        _syncAll: () => getAllFrom(SYNC_STORE)
    };

})();
