// Pool Tracker — poolside entry form.
// Requires config.js, db.js, sync.js loaded first.

// ---- field definitions -----------------------------------------------------
// step: stepper increment; dp: decimals displayed
const FIELDS = [
  { key: 'fc',     label: 'FC',   unit: 'ppm', step: 0.5, dp: 1 },
  { key: 'cc',     label: 'CC',   unit: 'ppm', step: 0.5, dp: 1 },
  { key: 'ph',     label: 'pH',   unit: '',    step: 0.1, dp: 1 },
  { key: 'ta',     label: 'TA',   unit: 'ppm', step: 10,  dp: 0 },
  { key: 'ch',     label: 'CH',   unit: 'ppm', step: 10,  dp: 0 },
  { key: 'cya',    label: 'CYA',  unit: 'ppm', step: 10,  dp: 0 },
  { key: 'salt',   label: 'Salt', unit: 'ppm', step: 10,  dp: 0 },
  { key: 'temp_f', label: 'Temp', unit: '°F',  step: 1,   dp: 0 },
  { key: 'orp_mv', label: 'ORP',  unit: 'mV',  step: 10,  dp: 0 },
];

const LS_LAST = 'pool.lastValues';     // last-entered values -> next defaults
const LS_CONFIG = 'pool.configCache';  // cached pool_config row for offline chip

let poolConfig = null;

// ---- helpers ---------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);

function lastValues() {
  try { return JSON.parse(localStorage.getItem(LS_LAST)) || {}; }
  catch { return {}; }
}

function fieldValue(key) {
  const raw = $(`#f-${key}`).value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---- build the form --------------------------------------------------------
function buildForm() {
  const defaults = lastValues();
  const form = $('#fields');
  for (const f of FIELDS) {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `
      <label for="f-${f.key}">${f.label}<span class="unit">${f.unit}</span></label>
      <div class="stepper">
        <button type="button" class="step-btn" data-key="${f.key}" data-dir="-1" aria-label="decrease ${f.label}">−</button>
        <input id="f-${f.key}" inputmode="decimal" autocomplete="off"
               placeholder="—" value="${defaults[f.key] ?? ''}">
        <button type="button" class="step-btn" data-key="${f.key}" data-dir="1" aria-label="increase ${f.label}">+</button>
      </div>`;
    form.appendChild(row);
  }

  form.addEventListener('click', (e) => {
    const btn = e.target.closest('.step-btn');
    if (!btn) return;
    const f = FIELDS.find((x) => x.key === btn.dataset.key);
    const input = $(`#f-${f.key}`);
    const cur = input.value.trim() === '' ? null : Number(input.value);
    // stepping a blank field starts from the last-entered value, else 0
    const base = cur ?? Number(lastValues()[f.key]) ?? 0;
    const next = (Number.isFinite(base) ? base : 0) + f.step * Number(btn.dataset.dir);
    input.value = Math.max(0, next).toFixed(f.dp);
    updateChip();
  });

  form.addEventListener('input', updateChip);
}

// ---- pool_config + adequacy chip -------------------------------------------
async function loadConfig() {
  try {
    const res = await fetch(
      `${POOL_SUPABASE.url}/rest/v1/pool_config?select=*&id=eq.1`,
      { headers: { apikey: POOL_SUPABASE.anonKey, Authorization: `Bearer ${POOL_SUPABASE.anonKey}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows.length) {
        poolConfig = rows[0];
        localStorage.setItem(LS_CONFIG, JSON.stringify(poolConfig));
      }
    }
  } catch { /* offline — fall back to cache */ }
  if (!poolConfig) {
    try { poolConfig = JSON.parse(localStorage.getItem(LS_CONFIG)); } catch { /* ignore */ }
  }
  updateChip();
}

// Live "sanitizer adequate?" chip: FC vs CYA-derived min/target, before submit.
function updateChip() {
  const chip = $('#chip');
  const fc = fieldValue('fc');
  // fall back to last-known CYA so the chip works when only FC was tested
  const cya = fieldValue('cya') ?? (Number(lastValues().cya) || null);
  if (!poolConfig || fc === null || cya === null) {
    chip.className = 'chip';
    chip.textContent = poolConfig
      ? 'Enter FC + CYA for sanitizer check'
      : 'Pool config unavailable';
    return;
  }
  const fcMin = cya * poolConfig.fc_min_pct / 100;
  const fcTarget = cya * poolConfig.fc_target_pct / 100;
  const ok = fc >= fcMin;
  chip.className = `chip ${ok ? 'ok' : 'bad'}`;
  chip.textContent = `${ok ? 'FC OK' : 'FC LOW'} — min ${fcMin.toFixed(1)}, target ${fcTarget.toFixed(1)}`;
}

// ---- submit + offline queue ------------------------------------------------
async function submitReading() {
  const reading = { source: 'manual' };
  const remembered = lastValues();
  for (const f of FIELDS) {
    const v = fieldValue(f.key);
    if (v !== null) {
      reading[f.key] = v;
      remembered[f.key] = v; // remember as next default
    }
  }
  const note = $('#f-note').value.trim();
  if (note) reading.note = note;

  localStorage.setItem(LS_LAST, JSON.stringify(remembered));

  const btn = $('#submit');
  btn.disabled = true;
  try {
    await PoolSync.postReading(reading);
    toast('Saved ✓');
  } catch {
    await PoolDB.enqueue(reading);
    await registerBgSync();
    toast('Offline — queued');
  } finally {
    btn.disabled = false;
    $('#f-note').value = '';
    updateBadge();
  }
}

async function registerBgSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) await reg.sync.register('pool-sync');
  } catch { /* background sync unsupported — online listener covers it */ }
}

async function flushQueue() {
  try {
    const { sent } = await PoolSync.flush();
    if (sent > 0) toast(`Synced ${sent} queued`);
  } catch { /* still offline */ }
  updateBadge();
}

async function updateBadge() {
  const n = await PoolDB.count().catch(() => 0);
  const badge = $('#pending');
  badge.hidden = n === 0;
  badge.textContent = `${n} pending`;
}

// ---- toast -----------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---- init ------------------------------------------------------------------
buildForm();
loadConfig();
updateBadge();
flushQueue(); // pick up anything queued from a previous visit

$('#submit').addEventListener('click', submitReading);
window.addEventListener('online', flushQueue);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
  // SW tells us when its background sync drained the queue
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'pool-sync-done') updateBadge();
  });
}
