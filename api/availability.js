// /api/availability.js
export const config = { runtime: 'nodejs' };

import {
  HOURS_RANGE,
  MAX_EVENTS_PER_DAY,
  MAX_CONCURRENT_EVENTS,
  blockWindow,
  mapEvents,
  countOverlaps
} from './_calendarRules.js';

function zonedStartISO(ymd, hour, tz) {
  // Build the exact local time in tz, then convert to a stable ISO.
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const asDate = new Date(guess);
  const inTz = new Date(asDate.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = inTz.getTime() - asDate.getTime();
  return new Date(guess - offsetMs).toISOString();
}

export default async function handler(req, res) {
  // CORS
  const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  const okOrigin = allow.length ? allow.includes(origin) : true;

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', okOrigin ? origin : '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', okOrigin ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  try {
    const { date, hours } = req.query || {};
    const tz = process.env.TIMEZONE || 'America/Los_Angeles';
    const calId = process.env.CALENDAR_ID || 'primary';
    const liveHours = Math.max(1, parseFloat(hours || '2')); // 2, 2.5, 3…

    if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

    // --- Google auth (supports JSON or split vars) ---
    const { google } = await import('googleapis');
    let clientEmail, privateKey;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      clientEmail = sa.client_email;
      privateKey = (sa.private_key || '').replace(/\\n/g, '\n');
    } else {
      clientEmail = process.env.GCP_CLIENT_EMAIL;
      privateKey = (process.env.GCP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    }

    const jwt = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );
    const calendar = google.calendar({ version: 'v3', auth: jwt });

    // Load all events for the date to compute overlaps
    const dayStart = zonedStartISO(date, 0, tz);
    const dayEnd   = zonedStartISO(date, 23, tz);

    const rsp = await calendar.events.list({
      calendarId: calId,
      timeMin: dayStart,
      timeMax: dayEnd,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });

    // Ignore cancelled events
    const items = (rsp.data.items || []).filter(e => e.status !== 'cancelled');

    // ✅ Daily capacity — max events per day
    if (items.length >= MAX_EVENTS_PER_DAY) {
      console.log('[availability] day at capacity', { date, events: items.length });
      return res.json({ slots: [] });
    }

    // Map to simple ranges for collision checks
    const events = mapEvents(items);

    const slots = [];
    for (let h = HOURS_RANGE.start; h <= HOURS_RANGE.end; h++) {
      const startIso = zonedStartISO(date, h, tz);
      const start = new Date(startIso);

      // Skip past times
      const now = new Date();
      if (start < now) continue;

      // Full block = 1h prep + live service + 1h cleanup
      const { blockStart, blockEnd } = blockWindow(startIso, liveHours);

      const overlapCount = countOverlaps(events, blockStart, blockEnd);
      if (overlapCount >= MAX_CONCURRENT_EVENTS) {
        console.log('[availability] slot blocked (concurrent limit)', { date, hour: h, overlaps: overlapCount });
        continue;
      }

      slots.push({ startISO: startIso });
    }

    return res.json({ slots });
  } catch (e) {
    console.error('availability error', e);
    return res.status(500).json({ error: 'availability_failed', detail: e.message });
  }
}
