// Offline-queue flush. Loaded by both the page and the service worker
// (importScripts) — uses plain fetch against the Supabase REST API so it
// works in both contexts. Requires config.js and db.js loaded first.
const PoolSync = (() => {
  const READINGS_ENDPOINT = () => `${POOL_SUPABASE.url}/rest/v1/pool_readings`;

  function headers() {
    return {
      'Content-Type': 'application/json',
      apikey: POOL_SUPABASE.anonKey,
      Authorization: `Bearer ${POOL_SUPABASE.anonKey}`,
      Prefer: 'return=minimal',
    };
  }

  // POST one reading to Supabase. Throws on network failure or non-2xx.
  async function postReading(reading) {
    const res = await fetch(READINGS_ENDPOINT(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(reading),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`insert failed: ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    }
  }

  // Drain the IndexedDB queue. Returns {sent, remaining}.
  // On a 4xx (bad row — would never succeed) the row is dropped, not retried.
  async function flush() {
    const items = await PoolDB.all();
    let sent = 0;
    for (const item of items) {
      const { qid, ...reading } = item;
      try {
        await postReading(reading);
        await PoolDB.remove(qid);
        sent += 1;
      } catch (err) {
        if (err.status && err.status >= 400 && err.status < 500) {
          await PoolDB.remove(qid); // permanently rejected; don't wedge the queue
        } else {
          break; // offline / server error — stop, keep order, retry later
        }
      }
    }
    return { sent, remaining: await PoolDB.count() };
  }

  return { postReading, flush };
})();
