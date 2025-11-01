// /api/stripe/webhook.js
export const config = { runtime: 'nodejs' };

import Stripe from 'stripe';
import { getOAuthCalendar } from './_google.js';

// ---------- Reglas de negocio ----------
const TZ = process.env.TIMEZONE || 'America/Los_Angeles';
const CAL_ID = process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'primary';
const HOURS_RANGE = { start: 9, end: 22 }; // inicio de servicio permitido: 09:00..21:59
const PREP_HOURS = 1;
const CLEAN_HOURS = 1;
const MAX_PER_SLOT = 2; // máx eventos coincidentes en la ventana operativa
const MAX_PER_DAY  = 3; // máx eventos por día calendario

// ---------- Utilidades ----------
function hoursFromPkg(pkg) {
  if (pkg === '50-150-5h') return 2;
  if (pkg === '150-250-5h') return 2.5;
  if (pkg === '250-350-6h') return 3;
  return 2;
}
function barLabel(v) {
  const map = {
    pancake: 'Mini Pancake',
    maruchan: 'Maruchan',
    esquites: 'Esquites (Corn Cups)',
    snack: 'Manna Snack — Classic',
    tostiloco: 'Tostiloco (Premium)',
  };
  return map[v] || v || 'Service';
}
function pkgLabel(v) {
  const map = {
    '50-150-5h': '50–150 (5h window)',
    '150-250-5h': '150–250 (5h window)',
    '250-350-6h': '250–350 (6h window)',
  };
  return map[v] || v || '';
}
function s(v, fb='') { return (typeof v === 'string' ? v : fb).trim(); }

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Hora local (0–23) en TZ para un ISO
function localHour(iso, tz = TZ) {
  const dt = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    .formatToParts(dt);
  return Number(parts.find(p => p.type === 'hour')?.value || '0');
}

// Ventana operativa completa (prep + servicio + limpieza) en ISO
function operationalWindow(startISO, liveHours) {
  const start = new Date(startISO);
  const opStart = new Date(start.getTime() - PREP_HOURS * 3600e3);
  const opEnd   = new Date(start.getTime() + (liveHours + CLEAN_HOURS) * 3600e3);
  return { opStartISO: opStart.toISOString(), opEndISO: opEnd.toISOString() };
}

// Rango de día local [00:00, 24:00) en TZ para la fecha de startISO
function localDayRangeFromStart(startISO, tz = TZ) {
  const d = new Date(startISO);
  const dayStartLocal = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const dayEndLocal   = new Date(dayStartLocal.getTime() + 24 * 3600e3);
  return { dayStartISO: dayStartLocal.toISOString(), dayEndISO: dayEndLocal.toISOString() };
}

// Lanza error si está fuera de horas hábiles
function assertWithinHours(startISO, tz = TZ) {
  const hh = localHour(startISO, tz);
  if (hh < HOURS_RANGE.start || hh >= HOURS_RANGE.end) {
    const msg = `outside_business_hours: ${hh}:00 not in ${HOURS_RANGE.start}:00–${HOURS_RANGE.end}:00 ${tz}`;
    const e = new Error(msg);
    e.status = 409;
    throw e;
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const stripeSecret  = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecret || !webhookSecret) {
    res.status(500).send('Server misconfigured'); return;
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: '2022-11-15' });

  // Verificación de firma
  let event;
  try {
    const buf = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err?.message || err);
    res.status(400).send(`Webhook Error: ${err.message || 'invalid signature'}`);
    return;
  }

  if (event.type !== 'checkout.session.completed') {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  try {
    const session = event.data.object;
    if (session.payment_status !== 'paid') {
      return res.status(200).json({ ok: true, skipped: 'not_paid' });
    }

    const md = session.metadata || {};
    const pkg            = s(md.pkg);
    const mainBar        = s(md.mainBar);
    const fullName       = s(md.fullName || session.customer_details?.name || 'Client');
    const venue          = s(md.venue);
    const startISO       = s(md.startISO);
    const affiliateEmail = s(md.affiliateEmail);
    const affiliateName  = s(md.affiliateName);
    const customerEmail  = s(session.customer_details?.email || md.email);

    if (!startISO || !pkg || !mainBar || !fullName) {
      console.error('Missing required fields in metadata:', md);
      return res.status(200).json({ ok: true, skipped: 'missing_metadata' });
    }

    // Horas hábiles (09:00–22:00)
    assertWithinHours(startISO, TZ);

    // Capacidades
    const liveHours = hoursFromPkg(pkg);
    const { opStartISO, opEndISO } = operationalWindow(startISO, liveHours);

    const { calendar } = await getOAuthCalendar();

    // 1) Máx 3 eventos por día
    const { dayStartISO, dayEndISO } = localDayRangeFromStart(startISO, TZ);
    const dayList = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: dayStartISO,
      timeMax: dayEndISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const dayCount = (dayList.data.items || []).filter(e => e.status !== 'cancelled').length;
    if (dayCount >= MAX_PER_DAY) {
      return res.status(200).json({ ok: false, error: 'capacity_day_limit', detail: 'Max 3 events per day reached.' });
    }

    // 2) Máx 2 solapes en la ventana operativa completa (prep + servicio + limpieza)
    const overlapList = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: opStartISO,
      timeMax: opEndISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const overlapping = (overlapList.data.items || []).filter(ev => {
      if (ev.status === 'cancelled') return false;
      const evStart = ev.start?.dateTime || ev.start?.date;
      const evEnd   = ev.end?.dateTime   || ev.end?.date;
      if (!evStart || !evEnd) return false;
      // overlap si NO (evEnd <= opStart || evStart >= opEnd)
      return !(new Date(evEnd) <= new Date(opStartISO) || new Date(evStart) >= new Date(opEndISO));
    }).length;
    if (overlapping >= MAX_PER_SLOT) {
      return res.status(200).json({ ok: false, error: 'capacity_overlap_limit', detail: 'Max 2 concurrent events in the operational window.' });
    }

    // Idempotencia por session.id (propiedad privada)
    const sessionId = s(session.id);
    if (sessionId) {
      const existing = await calendar.events.list({
        calendarId: CAL_ID,
        timeMin: dayStartISO,
        timeMax: dayEndISO,
        singleEvents: true,
        orderBy: 'startTime',
        privateExtendedProperty: `sessionId=${sessionId}`,
        maxResults: 50,
      });
      if ((existing.data.items || []).length > 0) {
        return res.status(200).json({ ok: true, already: true });
      }
    }

    // ----- Descripción bonita con Totales -----
    const depositPaid = Number(md.deposit || Math.round((session.amount_total || 0) / 100));
    const totalAll    = Number(md.total   || 0);
    const balanceDue  = Number(md.balance || Math.max(0, totalAll - depositPaid));

    const desc = [
      `👤 Client: ${fullName}`,
      customerEmail ? `✉️ Email: ${customerEmail}` : '',
      venue ? `📍 Venue: ${venue}` : '',
      '',
      `🍫 Main bar: ${barLabel(mainBar)} — ${pkgLabel(pkg)}`,
      '',
      '💰 Totals:',
      `   • Total: $${totalAll ? totalAll.toFixed(0) : '—'}`,
      `   • Deposit: $${depositPaid.toFixed(0)} (paid)`,
      `   • Balance: $${balanceDue ? balanceDue.toFixed(0) : '—'}`,
      '',
      '⏱️ Timing:',
      `   • Prep: 1h before start`,
      `   • Service: ${hoursFromPkg(pkg)}h`,
      `   • Clean up: +1h after`,
      '',
      affiliateName ? `🤝 Affiliate: ${affiliateName}` : ''
    ].filter(Boolean).join('\n');

    // Fin de servicio (solo servicio, sin limpieza)
    const endServiceISO = new Date(new Date(startISO).getTime() + hoursFromPkg(pkg) * 3600e3).toISOString();

    // Invitados
    const attendees = [];
    if (customerEmail) attendees.push({ email: customerEmail });
    if (affiliateEmail) attendees.push({ email: affiliateEmail });

    const title = `Manna Snack Bars — ${barLabel(mainBar)} — ${pkgLabel(pkg)} — ${fullName}`;

    const eventBody = {
      summary: title,
      location: venue || undefined,
      description: desc,
      start: { dateTime: startISO, timeZone: TZ },
      end:   { dateTime: endServiceISO, timeZone: TZ },
      attendees: attendees.length ? attendees : undefined,
      guestsCanSeeOtherGuests: true,
      reminders: { useDefault: true },
      extendedProperties: { private: { sessionId: sessionId || '' } }
    };

    const resp = await calendar.events.insert({
      calendarId: CAL_ID,
      sendUpdates: attendees.length ? 'all' : 'none',
      requestBody: eventBody
    });

    return res.status(200).json({ ok: true, created: resp.data?.id || null });
  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error('[stripe/webhook] create-event error:', detail);
    // Responder 200 para que Stripe no reintente indefinidamente; indicamos fallo lógico
    return res.status(200).json({ ok: false, error: 'create_event_failed', detail });
  }
}
