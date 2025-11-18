// /api/reminders
export const config = { runtime: 'nodejs' };

import { getCalendarClient } from './_google.js';
import { composeBookingEmail, sendBookingConfirmation } from './_email.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const expectedSecret = process.env.REMINDER_CRON_SECRET;
  const secret = req.query.secret || req.headers['x-reminder-secret'];
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const calendar = getCalendarClient();
    const tz = process.env.TIMEZONE || 'America/Los_Angeles';
    const calId = process.env.CALENDAR_ID || 'primary';

    // Target window ~24h before start time
    const now = new Date();
    const windowStart = new Date(now.getTime() + 24 * 3600e3);
    const windowEnd = new Date(now.getTime() + 26 * 3600e3);

    const rsp = await calendar.events.list({
      calendarId: calId,
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 200
    });

    const events = (rsp.data.items || []).filter(ev => ev.status !== 'cancelled');
    let sent = 0;

    for (const ev of events) {
      const priv = { ...(ev.extendedProperties?.private || {}) };
      const email = (priv.email || '').trim();
      if (!email || priv.reminderSent === '1') continue;

      const lang = priv.lang || 'en';
      const data = {
        ...priv,
        email,
        startISO: priv.startISO || ev.start?.dateTime || ev.start?.date,
        timezone: priv.timezone || tz
      };
      const copy = composeBookingEmail({ lang, type: 'reminder', data });

      try {
        const bcc = process.env.BOOKING_INTERNAL_NOTIFY_EMAIL || undefined;
        const ok = await sendBookingConfirmation({ to: email, subject: copy.subject, html: copy.html, text: copy.text, bcc });
        if (!ok) continue;
        priv.reminderSent = '1';
        await calendar.events.patch({
          calendarId: calId,
          eventId: ev.id,
          requestBody: { extendedProperties: { private: priv } }
        });
        sent += 1;
        console.log('[reminders] reminder sent', { eventId: ev.id, to: email });
      } catch (err) {
        console.error('[reminders] failed to send', { eventId: ev.id, error: err.message });
      }
    }

    return res.json({ processed: events.length, sent });
  } catch (err) {
    console.error('[reminders] handler error', err);
    return res.status(500).json({ error: 'reminders_failed', detail: err.message });
  }
}
