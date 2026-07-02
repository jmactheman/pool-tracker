// IndexedDB offline queue for pool readings.
// Plain script with a single global (PoolDB) so it can be loaded by both the
// page (<script>) and the service worker (importScripts).
const PoolDB = (() => {
  const DB_NAME = 'pool-tracker';
  const DB_VERSION = 1;
  const STORE = 'queue';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function enqueue(reading) {
    const db = await open();
    try {
      await tx(db, 'readwrite', (s) => s.add(reading));
    } finally {
      db.close();
    }
  }

  async function all() {
    const db = await open();
    try {
      const items = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return items;
    } finally {
      db.close();
    }
  }

  async function remove(qid) {
    const db = await open();
    try {
      await tx(db, 'readwrite', (s) => s.delete(qid));
    } finally {
      db.close();
    }
  }

  async function count() {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  return { enqueue, all, remove, count };
})();
