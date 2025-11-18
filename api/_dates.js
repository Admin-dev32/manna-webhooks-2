const DEFAULT_TZ = process.env.TIMEZONE || 'America/Los_Angeles';

export function zonedStartISO(ymd, hour, tz = DEFAULT_TZ) {
  const [y, m, d] = (ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const asDate = new Date(guess);
  const inTz = new Date(asDate.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = inTz.getTime() - asDate.getTime();
  return new Date(guess - offsetMs).toISOString();
}

function toDate(value, tz = DEFAULT_TZ) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const dayOnly = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dayOnly) {
      const iso = zonedStartISO(dayOnly[1], 12, tz); // midday avoids DST edges
      return iso ? new Date(iso) : null;
    }
    const naive = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/);
    if (naive) {
      const [, ymd, hh, mm = '0', ss = '0'] = naive;
      const baseISO = zonedStartISO(ymd, Number(hh), tz);
      if (baseISO) {
        const dt = new Date(baseISO);
        dt.setMinutes(dt.getMinutes() + Number(mm));
        dt.setSeconds(dt.getSeconds() + Number(ss));
        return dt;
      }
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getLocalDateKey(isoLike, tz = DEFAULT_TZ) {
  const date = toDate(isoLike, tz);
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

export function getDayBoundsForISO(isoLike, tz = DEFAULT_TZ) {
  let dateKey = '';
  if (typeof isoLike === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoLike)) {
      dateKey = isoLike;
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(isoLike) && !(/[zZ]$/.test(isoLike) || /[+-]\d{2}:\d{2}$/.test(isoLike))) {
      dateKey = isoLike.slice(0, 10);
    }
  }
  if (!dateKey) {
    dateKey = getLocalDateKey(isoLike, tz);
  }
  if (!dateKey) {
    return { dayKey: '', timeMin: null, timeMax: null };
  }
  const timeMin = zonedStartISO(dateKey, 0, tz);
  const endBase = zonedStartISO(dateKey, 23, tz);
  const end = endBase ? new Date(endBase) : null;
  if (end) {
    end.setMinutes(end.getMinutes() + 59);
    end.setSeconds(end.getSeconds() + 59);
  }
  return {
    dayKey: dateKey,
    timeMin,
    timeMax: end ? end.toISOString() : null
  };
}
