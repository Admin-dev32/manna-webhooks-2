// /api/stripe/webhook.js
export const config = { runtime: 'nodejs' };

import Stripe from 'stripe';
import { getOAuthCalendar } from '../_google.js';

const TZ =
  process.env.TIMEZONE || 'America/Los_Angeles';
const CAL_ID =
  process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'primary';

// Reglas de negocio (sincronizadas)
const HOURS_RANGE = { start: 9, end: 22 }; // permite inicios 09:00..21:59
const PREP_HOURS = 1;
const CLEAN_HOURS = 1;
const MAX_PER_SLOT = 2;
const MAX_PER_DAY = 3;

// ---- Helpers ----
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
const s = (v, fb = '') => (typeof v === 'string' ? v : fb).trim();

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Hora local (0–23) para un ISO dado en TZ
function localHour(iso, tz) {
  const dt = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  return Number(parts.find(p => p.type === 'hour')?.value || '0');
}

function assertWithinHours(startISO, tz) {
  const hh = localHour(startISO, tz);
  if (hh < HOURS_RANGE.start || hh >= HOURS_RANGE.end) {
    const msg = `outside_business_hours: ${hh}:00 not in ${HOURS_RANGE.start}:00–${HOURS_RANGE.end - 1}:59 ${tz}`;
    const e = new Error(msg);
    e.status = 409;
    throw e;
  }
}

function opWindow(startISO, pkg) {
  const live = hoursFromPkg(pkg);
  const start = new Date(startISO).getTime();
  const opStartISO = new Date(start - PREP_HOURS * 3600_000).toISOString();
  const opEndISO = new Date(start + (live + CLEAN_HOURS) * 3600_000).toISOString();
  return { opStartISO, opEndISO, live };
}

function dayRange(startISO) {
  const d = new Date(startISO);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  return { dayStartISO: dayStart.toISOString(), dayEndISO: dayEnd.toISOString() };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecret || !webhookSecret) {
    res.status(500).send('Server misconfigured');
    return;
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: '2022-11-15' });

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

  // Solo nos interesa checkout.session.completed pagado
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

    const pkg = s(md.pkg);
    const mainBar = s(md.mainBar);
    const fullName = s(md.fullName || session.customer_details?.name || 'Client');
    const venue = s(md.venue);
    const startISO = s(md.startISO);
    const metaEmail = s(md.email); // email opcional que mandas desde tu form
    const affiliateEmail = s(md.affiliateEmail);
    const affiliateName = s(md.affiliateName);
    const sessionId = s(session.id);

    if (!startISO || !pkg || !mainBar || !fullName) {
      console.error('Missing required fields in metadata:', md);
      return res.status(200).json({ ok: true, skipped: 'missing_metadata' });
    }

    // 1) Enforce horario de inicio
    try {
      assertWithinHours(startISO, TZ);
    } catch (e) {
      console.warn('[webhook] hours check', e.message);
      return res.status(200).json({ ok: true, skipped: 'outside_business_hours', detail: e.message });
    }

    // 2) Construir descripción con Totals
    const depositPaid = Number(md.deposit || Math.round((session.amount_total || 0) / 100));
    const totalAll = Number(md.total || 0);
    const balanceDue = Math.max(0, totalAll - depositPaid);

    const desc = [
      `👤 Client: ${fullName}`,
      session.customer_details?.email ? `✉️ Email: ${session.customer_details.email}` : (metaEmail ? `✉️ Email: ${metaEmail}` : ''),
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

    // 3) Attendees (comprador + meta + afiliado)
    const attendees = [];
    const checkoutEmail = s(session.customer_details?.email);
    if (checkoutEmail) attendees.push({ email: checkoutEmail });
    if (metaEmail && metaEmail !== checkoutEmail) attendees.push({ email: metaEmail });
    if (affiliateEmail) attendees.push({ email: affiliateEmail });

    // 4) Idempotencia por session.id (un evento al día con ese sessionId)
    const { calendar } = await getOAuthCalendar();
    if (sessionId) {
      const { dayStartISO, dayEndISO } = dayRange(startISO);
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

    // 5) Capacidad: máx 3 por día / máx 2 solapados en bloque operativo
    //    — cuenta TODOS los eventos del día
    const { dayStartISO, dayEndISO } = dayRange(startISO);
    const dayList = await calendar.events.list({
      calendarId: CAL_ID,
      timeMin: dayStartISO,
      timeMax: dayEndISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    const dayEvents = (dayList.data.items || []).filter(e => e.status !== 'cancelled');

    if (dayEvents.length >= MAX_PER_DAY) {
      return res.status(200).json({
        ok: true,
        skipped: 'capacity_day_limit',
        detail: `Max ${MAX_PER_DAY} events per day reached.`,
      });
    }

    const { opStartISO, opEndISO, live } = opWindow(startISO, pkg);
    // Lista en ventana operativa para medir solapamiento
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
      const aStart = new Date(opStartISO), aEnd = new Date(opEndISO);
      const bStart = new Date(ev.start?.dateTime || ev.start?.date);
      const bEnd = new Date(ev.end?.dateTime || ev.end?.date);
      return !(bEnd <= aStart || bStart >= aEnd);
    }).length;

    if (overlapping >= MAX_PER_SLOT) {
      return res.status(200).json({
        ok: true,
        skipped: 'capacity_overlap_limit',
        detail: `Max ${MAX_PER_SLOT} concurrent events in operational window (prep+${live}h+clean).`,
      });
    }

    // 6) Crear evento
    const endServiceISO = new Date(new Date(startISO).getTime() + hoursFromPkg(pkg) * 3600_000).toISOString();
    const title = `Manna Snack Bars — ${barLabel(mainBar)} — ${pkgLabel(pkg)} — ${fullName}`;

    const eventBody = {
      summary: title,
      location: venue || undefined,
      description: desc,
      start: { dateTime: startISO, timeZone: TZ },
      end: { dateTime: endServiceISO, timeZone: TZ },
      attendees: attendees.length ? attendees : undefined,
      guestsCanSeeOtherGuests: true,
      reminders: { useDefault: true },
      extendedProperties: { private: { sessionId: sessionId || '' } },
    };

    const resp = await calendar.events.insert({
      calendarId: CAL_ID,
      sendUpdates: attendees.length ? 'all' : 'none',
      requestBody: eventBody,
    });

    return res.status(200).json({ ok: true, created: resp.data?.id || null });
  } catch (err) {
    // No hacer que Stripe reintente por lógicas de negocio
    const detail = String(err?.message || err);
    console.error('webhook create-event error:', err?.response?.data || detail);
    return res.status(200).json({ ok: false, error: 'create_event_failed', detail });
  }
}
