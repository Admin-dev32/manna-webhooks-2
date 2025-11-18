// /api/availability.js
export const config = { runtime: 'nodejs' };

import {
  HOURS_RANGE,
  blockWindow,
  mapEvents,
  slotCapacityState,
  dayCapacityReached
} from './_calendarRules.js';
import { zonedStartISO, getDayBoundsForISO } from './_dates.js';

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
    const { timeMin: dayStart, timeMax: dayEnd } = getDayBoundsForISO(`${date}T00:00:00`, tz);

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

    const events = mapEvents(items);

    // ✅ Daily capacity — max events per local day using shared helper
    if (dayCapacityReached(events, date, tz)) {
      console.log('[availability] day at capacity', { date, events: events.length, tz });
      return res.json({ slots: [] });
    }

    const slots = [];
    for (let h = HOURS_RANGE.start; h <= HOURS_RANGE.end; h++) {
      const startIso = zonedStartISO(date, h, tz);
      const start = new Date(startIso);

      // Skip past times
      const now = new Date();
      if (start < now) continue;

      // Full block = 1h prep + live service + 1h cleanup
      const { blockStart, blockEnd } = blockWindow(startIso, liveHours);

      const state = slotCapacityState({ events, blockStart, blockEnd, tz });
      if (state.dayFull) {
        console.log('[availability] slot skipped (day at capacity)', { date, hour: h, tz });
        break;
      }
      if (state.concurrentFull) {
        console.log('[availability] slot blocked (concurrent limit)', { date, hour: h, overlaps: state.overlapCount, tz });
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
