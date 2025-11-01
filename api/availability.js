// /api/availability.js
export const config = { runtime: "nodejs" };

import { applyCors, handlePreflight } from "./_cors.js";
import { getOAuthCalendar } from "./_google.js";

// Reglas de negocio (sincronizadas con tu sistema nuevo)
const HOURS_RANGE = { start: 9, end: 22 }; // permite inicios 09:00..21:59
const PREP_HOURS = 1;                      // 1h antes
const CLEAN_HOURS = 1;                     // 1h después
const MAX_PER_SLOT = 2;                    // máx 2 eventos solapados en el bloque operativo
const MAX_PER_DAY = 3;                     // máx 3 eventos al día
const TZ = process.env.TIMEZONE || "America/Los_Angeles";

function hoursFromPkg(pkg) {
  if (pkg === "50-150-5h") return 2;
  if (pkg === "150-250-5h") return 2.5;
  if (pkg === "250-350-6h") return 3;
  return 2;
}

// --- Normaliza la fecha a YYYY-MM-DD (acepta YYYY-MM-DD o MM/DD/YYYY)
function toYMD(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // MM/DD/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const y = +m[3], mo = +m[1], d = +m[2];
    if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const pad = (n) => String(n).padStart(2, "0");
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
  }

  // Fallback: parse nativo y re-formatea en LA
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(dt);
    const y = parts.find((p) => p.type === "year")?.value;
    const mo = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && mo && d) return `${y}-${mo}-${d}`;
  }
  return null;
}

// Determina offset LA para ese día (PDT/PST) y arma ISO local estable
function laOffsetForYMD(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "short",
  }).formatToParts(noonUTC);
  const abbr = (parts.find((p) => p.type === "timeZoneName")?.value || "")
    .toUpperCase();
  return abbr.includes("PDT") ? "-07:00" : "-08:00";
}

const pad = (n) => String(n).padStart(2, "0");
function isoAt(ymd, hour) {
  return `${ymd}T${pad(hour)}:00:00${laOffsetForYMD(ymd)}`;
}

function fullBlock(startISO, liveHours) {
  const start = new Date(startISO);
  const blockStart = new Date(start.getTime() - PREP_HOURS * 3600e3);
  const blockEnd = new Date(start.getTime() + (liveHours + CLEAN_HOURS) * 3600e3);
  return { blockStart, blockEnd };
}

export default async function handler(req, res) {
  // CORS
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const ymd = toYMD((req.query || {}).date);
    if (!ymd) {
      return res
        .status(400)
        .json({ error: "date required (YYYY-MM-DD or MM/DD/YYYY)" });
    }
    const pkg = String((req.query || {}).pkg || "");
    const liveHours = hoursFromPkg(pkg);

    const calId =
      process.env.CALENDAR_ID ||
      process.env.GOOGLE_CALENDAR_ID ||
      "primary";

    // OAuth calendar (para poder invitar asistentes en otros endpoints)
    const { calendar } = await getOAuthCalendar();

    // Rango del día local en ISO: 00:00–23:59 LA
    const dayStartISO = isoAt(ymd, 0);
    const dayEndISO = isoAt(ymd, 23);

    // Lee eventos del día
    const rsp = await calendar.events.list({
      calendarId: calId,
      timeMin: dayStartISO,
      timeMax: dayEndISO,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const events = (rsp.data.items || [])
      .filter((e) => e.status !== "cancelled")
      .map((e) => ({
        start: new Date(e.start?.dateTime || e.start?.date),
        end: new Date(e.end?.dateTime || e.end?.date),
      }));

    // Límite duro por día
    if (events.length >= MAX_PER_DAY) {
      return res.status(200).json({
        slots: [],
        debug: {
          ymd,
          pkg,
          liveHours,
          dayStartISO,
          dayEndISO,
          events: events.length,
          reason: "day_cap_reached",
          MAX_PER_DAY,
        },
      });
    }

    const now = new Date();
    const slots = [];

    // Genera candidatos 09..21 (la hora 22:00 no se ofrece como inicio)
    for (let h = HOURS_RANGE.start; h < HOURS_RANGE.end; h++) {
      const startISO = isoAt(ymd, h);
      if (new Date(startISO) < now) continue;

      const { blockStart, blockEnd } = fullBlock(startISO, liveHours);

      // Cuenta solapados dentro del bloque operativo
      const overlapping = events.filter(
        (ev) => !(ev.end <= blockStart || ev.start >= blockEnd)
      ).length;

      if (overlapping < MAX_PER_SLOT) {
        // Regresa hour (para tu HTML actual) y startISO (por si lo quieres usar)
        slots.push({ hour: h, startISO });
      }
    }

    return res.status(200).json({
      slots,
      debug: {
        ymd,
        pkg,
        liveHours,
        dayStartISO,
        dayEndISO,
        events: events.length,
        MAX_PER_SLOT,
        MAX_PER_DAY,
      },
    });
  } catch (e) {
    console.error("availability error:", e?.response?.data || e);
    return res
      .status(500)
      .json({ error: "availability_failed", detail: String(e.message || e) });
  }
}
