// /api/stripe/webhook.js
export const config = { api: { bodyParser: false }, runtime: 'nodejs' };

import Stripe from 'stripe';
import { getCalendarClient } from '../_google.js'; // <- ruta correcta desde /api/stripe/
import {
  mapEvents,
  dayCapacityReached,
  MAX_EVENTS_PER_DAY,
  evaluateSlotAllowance
} from '../_calendarRules.js';
import { getDayBoundsForISO } from '../_dates.js';
import { composeBookingEmail, sendBookingConfirmation } from '../_email.js';
import { rememberDaySnapshot, incrementDaySnapshot } from '../_capacityStore.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });


const BAR_TITLES = {
  pancake: '🥞 Mini Pancake',
  esquites: '🌽 Esquites',
  maruchan: '🍜 Maruchan',
  tostiloco: '🌶️ Tostiloco (Premium)',
  snack: '🍭 Manna Snack Bar — “La Clásica”'
};

function pkgToHours(pkg) {
  if (pkg === '50-150-5h') return 2;
  if (pkg === '150-250-5h') return 2.5;
  if (pkg === '250-350-6h') return 3;
  return 2; // fallback
}

// Leer el RAW body SIN 'micro'
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function pkgLabel(pkg) {
  if (pkg === '50-150-5h') return '50–150 guests (2h live)';
  if (pkg === '150-250-5h') return '150–250 guests (2.5h live)';
  if (pkg === '250-350-6h') return '250–350 guests (3h live)';
  return pkg || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // 1) Verificar firma de Stripe con RAW body
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const buf = await readRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature/parse failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2) Solo procesamos el checkout.session.completed
  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const md = session.metadata || {};

  try {
    const tz = process.env.TIMEZONE || 'America/Los_Angeles';
    const calId = process.env.CALENDAR_ID || 'primary';
    const calendar = getCalendarClient(); // usa tus GCP_* de _google.js

    // 3) Calcular ventana de bloqueo (prep + servicio + clean)
    const startISO = md.startISO;
    const liveHrs  = Number(md.hours || 0) || pkgToHours(md.pkg);
    if (!startISO || !liveHrs) {
      console.warn('[webhook] missing startISO/hours — skipping calendar insert');
      return res.json({ received: true, skipped: true });
    }
    // 4) Cargar eventos del MISMO día (para capacidad y traslape)
    const { timeMin, timeMax } = getDayBoundsForISO(startISO, tz);

    const list = await calendar.events.list({
      calendarId: calId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });
    const items = (list.data.items || []).filter(e => e.status !== 'cancelled');

    // Idempotencia: si ya existe este pedido, lo actualizamos
    const existing = items.find(e => e.extendedProperties?.private?.orderId === session.id);
    const events = mapEvents(items);

    const slotState = evaluateSlotAllowance({ events, startISO, liveHours: liveHrs, tz, ignoreId: existing?.id });
    const { blockStart, blockEnd, dateKey } = slotState;
    rememberDaySnapshot({ dateKey, count: slotState.dayCount, limit: MAX_EVENTS_PER_DAY, tz, source: 'webhook', startISO });

    if (!existing && (slotState.dayFull || dayCapacityReached(events, dateKey, tz))) {
      console.warn('[capacity] day capacity reached', {
        startISO,
        tz,
        dayKey: dateKey,
        limit: MAX_EVENTS_PER_DAY,
        count: slotState.dayCount
      });
      return res.json({ received: true, capacity: 'full' });
    }

    if (!existing && slotState.concurrentFull) {
      console.warn('[capacity] concurrent limit hit', {
        startISO,
        tz,
        dayKey: dateKey,
        overlapCount: slotState.overlapCount,
        limit: MAX_EVENTS_PER_DAY
      });
      return res.json({ received: true, conflict: 'overlap' });
    }

    // 5) Construir el evento (ahora invitamos al cliente como attendee)
    const existingPrivate = existing?.extendedProperties?.private || {};
    const attendeeEmail = (md.email || existingPrivate.email || '').trim();
    const secondEnabled = md.secondEnabled === true || md.secondEnabled === 'true';
    const fountainEnabled = md.fountainEnabled === true || md.fountainEnabled === 'true';
    const extrasNotes = [];
    if (secondEnabled) extrasNotes.push(`Second bar: ${md.secondBar || ''} (${md.secondSize || ''})`);
    if (fountainEnabled) extrasNotes.push(`Fountain: ${md.fountainSize || ''} (${md.fountainType || ''})`);

    const privateProps = { ...existingPrivate, orderId: session.id };
    const override = (key, value, fallback) => {
      if (value === undefined || value === null) return;
      const str = `${value}`.trim();
      if (str) {
        privateProps[key] = str;
      } else if (fallback && !(key in privateProps)) {
        privateProps[key] = fallback;
      }
    };

    override('lang', md.lang, privateProps.lang || 'en');
    override('email', attendeeEmail || md.email);
    override('fullName', md.fullName || existingPrivate.fullName || '');
    override('phone', md.phone || existingPrivate.phone || '');
    override('mainBar', md.mainBar || existingPrivate.mainBar || '');
    override('pkg', md.pkg || existingPrivate.pkg || '');
    override('payMode', md.payMode || existingPrivate.payMode || '');
    override('dateISO', md.dateISO || existingPrivate.dateISO || '');
    override('startISO', md.startISO || existingPrivate.startISO || '');
    override('venue', md.venue || existingPrivate.venue || '');
    override('secondEnabled', secondEnabled ? 'true' : 'false');
    override('secondBar', md.secondBar || existingPrivate.secondBar || '');
    override('secondSize', md.secondSize || existingPrivate.secondSize || '');
    override('fountainEnabled', fountainEnabled ? 'true' : 'false');
    override('fountainSize', md.fountainSize || existingPrivate.fountainSize || '');
    override('fountainType', md.fountainType || existingPrivate.fountainType || '');
    override('total', md.total || existingPrivate.total || '');
    override('dueNow', md.dueNow || existingPrivate.dueNow || '');
    privateProps.timezone = privateProps.timezone || tz;

    const mainBarTitle = BAR_TITLES[privateProps.mainBar] || privateProps.mainBar || 'Booking';
    const requestBody = {
      summary: `Manna Snack Bars — ${mainBarTitle} (${pkgLabel(md.pkg)})`,
      description: [
        `Name: ${md.fullName || ''}`,
        attendeeEmail ? `Email: ${attendeeEmail}` : '',
        md.phone ? `Phone: ${md.phone}` : '',
        `Package: ${pkgLabel(md.pkg)}`,
        `Bar: ${mainBarTitle}`,
        `Date: ${md.dateISO || ''}`,
        `Start: ${startISO}`,
        extrasNotes.join(' | '),
        `Service hours: ${liveHrs}`,
        `Stripe session: ${session.id}`
      ].filter(Boolean).join('\n'),
      location: md.venue || '',
      start: { dateTime: blockStart.toISOString(), timeZone: tz },
      end:   { dateTime: blockEnd.toISOString(),   timeZone: tz },
      extendedProperties: { private: privateProps },
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false
    };

    if (!existing) {
      const snapshot = incrementDaySnapshot({ dateKey, limit: MAX_EVENTS_PER_DAY, tz, startISO });
      console.log('[capacity] increment', {
        startISO,
        tz,
        dayKey: dateKey,
        newCount: snapshot?.count || slotState.dayCount + 1,
        limit: snapshot?.limit || MAX_EVENTS_PER_DAY
      });
    }

    if (attendeeEmail) {
      requestBody.attendees = [{ email: attendeeEmail, displayName: md.fullName || '' }];
    }

    async function pushEvent(body){
      const sendUpdates = body.attendees?.length ? 'all' : 'none';
      if (existing) {
        await calendar.events.patch({
          calendarId: calId,
          eventId: existing.id,
          requestBody: body,
          sendUpdates
        });
        return { updated: true };
      }
      await calendar.events.insert({
        calendarId: calId,
        requestBody: body,
        sendUpdates
      });
      return { created: true };
    }

    let result;
    try {
      result = await pushEvent(requestBody);
    } catch (err) {
      if (requestBody.attendees) {
        console.warn('[webhook] attendee insert failed, retrying without attendees', err.message);
        delete requestBody.attendees;
        const fallback = await pushEvent(requestBody);
        result = { ...fallback, attendeesFallback: true };
      } else {
        throw err;
      }
    }

    if (attendeeEmail) {
      try {
        const copy = composeBookingEmail({
          lang: (privateProps.lang || 'en'),
          type: 'confirmation',
          data: { ...privateProps }
        });
        const bcc = process.env.BOOKING_INTERNAL_NOTIFY_EMAIL || undefined;
        const sent = await sendBookingConfirmation({ to: attendeeEmail, subject: copy.subject, html: copy.html, text: copy.text, bcc });
        if (sent) console.log('[webhook] confirmation email sent', { sessionId: session.id, to: attendeeEmail });
        else console.warn('[webhook] confirmation email skipped (SMTP missing)');
      } catch (emailErr) {
        console.error('[webhook] email send failed', emailErr.message);
      }
    }

    console.log('[webhook] calendar event saved', { sessionId: session.id, action: existing ? 'updated' : 'created', start: blockStart.toISOString() });
    return res.json({ received: true, ...result });
  } catch (err) {
    console.error('[webhook] handler error:', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
}
