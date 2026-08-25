// ======================================================
// TRAVEL EXPLORER - PERSISTENZA UTENTE (IndexedDB)
// ======================================================
// Mantiene separate le informazioni editoriali JSON
// dalle modifiche personali al viaggio.
// ======================================================

window.TravelStore = (() => {

    const DB_NAME = "travel-explorer-db";
    const DB_VERSION = 1;
    const STORE_NAME = "settings";

    function openDB() {

        return new Promise((resolve, reject) => {

            const request =
                indexedDB.open(
                    DB_NAME,
                    DB_VERSION
                );

            request.onupgradeneeded = event => {

                const db =
                    event.target.result;

                if (
                    !db.objectStoreNames
                        .contains(STORE_NAME)
                ) {

                    db.createObjectStore(
                        STORE_NAME,
                        {
                            keyPath: "key"
                        }
                    );

                }

            };

            request.onsuccess =
                () => resolve(
                    request.result
                );

            request.onerror =
                () => reject(
                    request.error
                );

        });

    }


    async function get(key) {

        const db =
            await openDB();

        return new Promise(
            (resolve, reject) => {

                const transaction =
                    db.transaction(
                        STORE_NAME,
                        "readonly"
                    );

                const store =
                    transaction.objectStore(
                        STORE_NAME
                    );

                const request =
                    store.get(key);

                request.onsuccess =
                    () => resolve(
                        request.result
                            ? request.result.value
                            : null
                    );

                request.onerror =
                    () => reject(
                        request.error
                    );

                transaction.oncomplete =
                    () => db.close();

            }
        );

    }


    async function set(
        key,
        value
    ) {

        const db =
            await openDB();

        return new Promise(
            (resolve, reject) => {

                const transaction =
                    db.transaction(
                        STORE_NAME,
                        "readwrite"
                    );

                const store =
                    transaction.objectStore(
                        STORE_NAME
                    );

                store.put({
                    key,
                    value,
                    updated_at:
                        new Date()
                            .toISOString()
                });

                transaction.oncomplete =
                    () => {
                        db.close();
                        resolve();
                    };

                transaction.onerror =
                    () => {
                        db.close();
                        reject(
                            transaction.error
                        );
                    };

            }
        );

    }


    async function remove(key) {

        const db =
            await openDB();

        return new Promise(
            (resolve, reject) => {

                const transaction =
                    db.transaction(
                        STORE_NAME,
                        "readwrite"
                    );

                transaction
                    .objectStore(STORE_NAME)
                    .delete(key);

                transaction.oncomplete =
                    () => {
                        db.close();
                        resolve();
                    };

                transaction.onerror =
                    () => {
                        db.close();
                        reject(
                            transaction.error
                        );
                    };

            }
        );

    }


    return {
        get,
        set,
        remove
    };

})();