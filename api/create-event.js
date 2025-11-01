// /api/create-event.js
export const config = { runtime: 'nodejs' };

import { applyCors, handlePreflight } from './_cors.js';
import { getOAuthCalendar } from './_google.js';
import { resolveAffiliate } from './_affiliates.js';

const TZ = process.env.TIMEZONE || 'America/Los_Angeles';
const CAL_ID = process.env.CALENDAR_ID || process.env.GOOGLE_CALENDAR_ID || 'primary';

// Reglas sincronizadas con el webhook
const HOURS_RANGE = { start: 9, end: 22 }; // permite inicios 09:00..21:59 (LA)
const PREP_HOURS = 1;
const CLEAN_HOURS = 1;
const MAX_PER_SLOT = 2;
const MAX_PER_DAY = 3;

// ---- helpers ----
const s = (v, fb = '') => (typeof v === 'string' ? v : fb).trim();

function pkgLabel(v) {
  const m = {
    '50-150-5h': '50–150 (5h window)',
    '150-250-5h': '150–250 (5h window)',
    '250-350-6h': '250–350 (6h window)',
  };
  return m[v] || v || '';
}
function barLabel(v) {
  const m = {
    pancake: 'Mini Pancake',
    maruchan: 'Maruchan',
    esquites: 'Esquites (Corn Cups)',
    snack: 'Manna Snack — Classic',
    tostiloco: 'Tostiloco (Premium)',
  };
  return m[v] || v || 'Bar';
}
function serviceHours(pkg) {
  if (pkg === '50-150-5h') return 2;
  if (pkg === '150-250-5h') return 2.5;
  if (pkg === '250-350-6h') return 3;
  return 2;
}

function localHour(iso, tz) {
  const dt = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).formatToParts(dt);
  return Number(parts.find(p => p.type === 'hour')?.value || '0');
}
function assertWithinHours(startISO, tz) {
  const hh = localHour(startISO, tz);
  if (hh < HOURS_RANGE.start || hh >= HOURS_RANGE.end) {
    const e = new Error(`outside_business_hours: ${hh}:00 not in ${HOURS_RANGE.start}:00–${HOURS_RANGE.end - 1}:59 ${tz}`);
    e.status = 409;
    throw e;
  }
}

function opWindow(startISO, pkg) {
  const live = serviceHours(pkg);
  const t = new Date(startISO).getTime();
  const opStartISO = new Date(t - PREP_HOURS * 3600_000).toISOString();
  const opEndISO = new Date(t + (live + CLEAN_HOURS) * 3600_000).toISOString();
  return { opStartISO, opEndISO, live };
}
function dayRange(startISO) {
  const d = new Date(startISO);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  return { dayStartISO: dayStart.toISOString(), dayEndISO: dayEnd.toISOString() };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    const body = req.body || {};

    // Afiliado obligatorio
    const pin = s(body.pin);
    const aff = resolveAffiliate(pin);
    if (!aff) return res.status(400).json({ ok: false, error: 'invalid_pin' });

    // Requeridos
    const startISO = s(body.startISO);
    const pkg = s(body.pkg);
    const mainBar = s(body.mainBar);
    const fullName = s(body.fullName);
    if (!startISO || !pkg || !mainBar || !fullName) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    // Horario
    assertWithinHours(startISO, TZ);

    // Capacidad
    const { opStartISO, opEndISO, live } = opWindow(startISO, pkg);
    const { calendar } = await getOAuthCalendar();

    // Límite por día
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
      return res.status(409).json({ ok: false, error: 'capacity_day_limit', detail: `Max ${MAX_PER_DAY} events per day reached.` });
    }

    // Límite de solapamiento en bloque operativo
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
      return res.status(409).json({
        ok: false,
        error: 'capacity_overlap_limit',
        detail: `Max ${MAX_PER_SLOT} concurrent events in operational window (prep+${live}h+clean).`,
      });
    }

    // Totales y descripción bonita (igual que webhook)
    const total = Number(body.total || 0);
    const deposit = Number(body.deposit || 0);
    const balance = Math.max(0, total - deposit);

    const email = s(body.email);
    const phone = s(body.phone);
    const venue = s(body.venue);
    const notes = s(body.notes);
    const secondEnabled = !!body.secondEnabled;
    const fountainEnabled = !!body.fountainEnabled;

    const secondBar = s(body.secondBar);
    const secondSize = s(body.secondSize);
    const fountainType = s(body.fountainType);
    const fountainSize = s(body.fountainSize);

    const affiliateName = s(body.affiliateName || aff.name);
    const affiliateEmail = s(body.affiliateEmail || aff.email);

    const description = [
      `👤 Client: ${fullName}`,
      email ? `✉️ Email: ${email}` : '',
      phone ? `📞 Phone: ${phone}` : '',
      venue ? `📍 Venue: ${venue}` : '',
      '',
      `🍫 Main bar: ${barLabel(mainBar)} — ${pkgLabel(pkg)}`,
      secondEnabled ? `➕ Second bar: ${barLabel(secondBar)} — ${pkgLabel(secondSize)}` : '',
      fountainEnabled ? `🫗 Chocolate fountain: ${fountainType || '-'} — ${fountainSize || '-'} ppl` : '',
      '',
      '💰 Totals:',
      `   • Total: $${total.toFixed(0)}`,
      `   • Deposit: $${deposit.toFixed(0)}`,
      `   • Balance: $${balance.toFixed(0)}`,
      '',
      '⏱️ Timing:',
      `   • Prep: 1h before start`,
      `   • Service: ${serviceHours(pkg)}h`,
      `   • Clean up: +1h after`,
      '',
      `🤝 Affiliate: ${affiliateName}${affiliateEmail ? ` <${affiliateEmail}>` : ''}`,
      pin ? `🔑 PIN: ${pin}` : '',
      notes ? `📝 Notes: ${notes}` : '',
    ].filter(Boolean).join('\n');

    // Attendees (cliente + afiliado si existe email)
    const attendees = [];
    if (email && /\S+@\S+\.\S+/.test(email)) attendees.push({ email: email.trim() });
    if (affiliateEmail && /\S+@\S+\.\S+/.test(affiliateEmail)) attendees.push({ email: affiliateEmail.trim() });

    // Fin de servicio (solo horas de servicio; el bloque operativo es para la validación)
    const endServiceISO = new Date(new Date(startISO).getTime() + serviceHours(pkg) * 3600_000).toISOString();

    const title = `Manna Snack Bars — ${barLabel(mainBar)} — ${pkgLabel(pkg)} — ${fullName}`;

    // Idempotencia opcional (si el front manda idempotencyKey)
    const idempotencyKey = s(body.idempotencyKey);
    if (idempotencyKey) {
      const { dayStartISO: ds, dayEndISO: de } = dayRange(startISO);
      const exist = await calendar.events.list({
        calendarId: CAL_ID,
        timeMin: ds,
        timeMax: de,
        singleEvents: true,
        orderBy: 'startTime',
        privateExtendedProperty: `idem=${idempotencyKey}`,
        maxResults: 50,
      });
      if ((exist.data.items || []).length) {
        return res.status(200).json({ ok: true, already: true });
      }
    }

    const eventBody = {
      summary: title,
      location: venue || undefined,
      description,
      start: { dateTime: startISO, timeZone: TZ },
      end: { dateTime: endServiceISO, timeZone: TZ },
      attendees: attendees.length ? attendees : undefined,
      guestsCanSeeOtherGuests: true,
      reminders: { useDefault: true },
      extendedProperties: {
        private: {
          pkg,
          mainBar,
          secondEnabled: String(!!secondEnabled),
          secondBar,
          secondSize,
          fountainEnabled: String(!!fountainEnabled),
          fountainType,
          fountainSize,
          affiliateName,
          affiliateEmail,
          pin,
          idem: idempotencyKey || '',
        },
      },
    };

    const resp = await calendar.events.insert({
      calendarId: CAL_ID,
      requestBody: eventBody,
      sendUpdates: attendees.length ? 'all' : 'none',
    });

    return res.status(200).json({ ok: true, eventId: resp.data?.id || null });
  } catch (e) {
    const status = e.status || e?.response?.status || 500;
    const detail = e?.response?.data || e?.message || String(e);
    console.error('[create-event] error', detail);
    return res.status(status).json({ ok: false, error: 'create_event_failed', detail });
  }
}
