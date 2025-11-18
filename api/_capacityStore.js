const MAX_ENTRIES = 90; // keep store bounded for serverless memory

const globalStore = globalThis.__MANNA_CAPACITY_STORE__ || new Map();
globalThis.__MANNA_CAPACITY_STORE__ = globalStore;

function prune() {
  if (globalStore.size <= MAX_ENTRIES) return;
  const entries = Array.from(globalStore.entries()).sort((a, b) => {
    return (a[1].updatedAt || '').localeCompare(b[1].updatedAt || '');
  });
  while (entries.length && globalStore.size > MAX_ENTRIES) {
    const [key] = entries.shift();
    globalStore.delete(key);
  }
}

export function rememberDaySnapshot({ dateKey, count, limit, tz, source, startISO }) {
  if (!dateKey) return;
  const now = new Date().toISOString();
  const entry = globalStore.get(dateKey) || { date: dateKey, count: 0 };
  entry.count = typeof count === 'number' ? count : entry.count;
  if (typeof limit === 'number') entry.limit = limit;
  if (tz) entry.tz = tz;
  if (source) entry.source = source;
  if (startISO) entry.lastStartISO = startISO;
  entry.updatedAt = now;
  globalStore.set(dateKey, entry);
  prune();
  return entry;
}

export function incrementDaySnapshot({ dateKey, limit, tz, startISO }) {
  if (!dateKey) return null;
  const entry = globalStore.get(dateKey) || { date: dateKey, count: 0 };
  entry.count = (entry.count || 0) + 1;
  if (typeof limit === 'number') entry.limit = limit;
  if (tz) entry.tz = tz;
  entry.updatedAt = new Date().toISOString();
  if (startISO) entry.lastStartISO = startISO;
  globalStore.set(dateKey, entry);
  prune();
  return entry;
}

export function listDaySnapshots(filterDate) {
  const items = Array.from(globalStore.entries())
    .filter(([key]) => (filterDate ? key === filterDate : true))
    .map(([key, value]) => ({ date: key, ...value }));
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}

export function resetDaySnapshot(dateKey) {
  if (!dateKey) return null;
  const entry = globalStore.get(dateKey);
  globalStore.delete(dateKey);
  return entry || null;
}
