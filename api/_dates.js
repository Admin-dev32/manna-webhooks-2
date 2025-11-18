const DEFAULT_TZ = process.env.TIMEZONE || 'America/Los_Angeles';

function toDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function getLocalDateKey(isoLike, tz = DEFAULT_TZ) {
  const date = toDate(isoLike);
  if (!date || Number.isNaN(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function zonedStartISO(ymd, hour, tz = DEFAULT_TZ) {
  const [y, m, d] = (ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const asDate = new Date(guess);
  const inTz = new Date(asDate.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = inTz.getTime() - asDate.getTime();
  return new Date(guess - offsetMs).toISOString();
}

export function getDayBoundsForISO(isoLike, tz = DEFAULT_TZ) {
  const dateKey = getLocalDateKey(isoLike, tz);
  if (!dateKey) {
    return { dayKey: '', timeMin: null, timeMax: null };
  }
  const start = zonedStartISO(dateKey, 0, tz);
  const endBase = zonedStartISO(dateKey, 23, tz);
  const end = endBase ? new Date(new Date(endBase).getTime() + 59 * 60 * 1000 + 59 * 1000).toISOString() : null;
  return {
    dayKey: dateKey,
    timeMin: start,
    timeMax: end
  };
}
