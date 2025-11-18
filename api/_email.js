import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[email] SMTP environment variables missing; email sending skipped.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

function boolish(v) {
  return v === true || v === 'true';
}

const BAR_TITLES = {
  pancake: '🥞 Mini Pancake',
  esquites: '🌽 Esquites',
  maruchan: '🍜 Maruchan',
  tostiloco: '🌶️ Tostiloco (Premium)',
  snack: '🍭 Manna Snack Bar — “La Clásica”'
};

const PKG_LABELS = {
  en: {
    '50-150-5h': '50–150 guests • 2h live',
    '150-250-5h': '150–250 guests • 2.5h live',
    '250-350-6h': '250–350 guests • 3h live'
  },
  es: {
    '50-150-5h': '50–150 invitados • 2h en vivo',
    '150-250-5h': '150–250 invitados • 2.5h en vivo',
    '250-350-6h': '250–350 invitados • 3h en vivo'
  }
};

const SUPPORT_EMAIL = 'team@mannasnackbars.com';
const SUPPORT_PHONE = '661-403-0004';
const SUPPORT_PHONE_TEL = '+16614030004';

const EMAIL_COPY = {
  en: {
    confirmationSubject: '🎉 Your Manna Snack Bars booking is confirmed',
    reminderSubject: '⏰ Friendly reminder: your snack bar is tomorrow',
    greeting: 'Hi {name}! 🙌',
    friendName: 'friend',
    introConfirmation: 'Thank you for inviting our snack squad. Here’s the delicious plan we just locked in:',
    introReminder: 'We’re packing the goodies! Here’s a quick refresher for tomorrow’s celebration:',
    reminderPrep: 'Our team arrives about 1 hour early for setup—please reserve space & power for us.',
    outroConfirmation: 'We can’t wait to celebrate with you!',
    outroReminder: 'Get ready for a sweet time—we’ll see you soon!',
    tagline: 'Mobile snack bars for Bakersfield & Kern County events.',
    supportTitle: 'Need to make a change or have questions?',
    supportEmailLabel: 'Email',
    supportPhoneLabel: 'Call / Text',
    sections: {
      reservation: 'Reservation details',
      extras: 'Extras & upgrades',
      payment: 'Payment summary'
    },
    labels: {
      bar: 'Main bar',
      pkg: 'Package',
      date: 'Date & time',
      timezone: 'Timezone',
      location: 'Location',
      payment: 'Payment mode',
      extras: 'Extras',
      secondBar: 'Second bar: {value}',
      fountain: 'Chocolate fountain: {value}',
      noExtras: 'No extras added',
      total: 'Total',
      dueToday: 'Due today',
      remaining: 'Remaining',
      payModeFull: 'Paying in full (save $20)',
      payModeDeposit: '25% deposit',
      contact: 'Contact',
      phone: 'Phone'
    }
  },
  es: {
    confirmationSubject: '🎉 Tu reservación de Manna Snack Bars está confirmada',
    reminderSubject: '⏰ Recordatorio amigable: tu barra es mañana',
    greeting: '¡Hola {name}! 🙌',
    friendName: 'amig@',
    introConfirmation: 'Gracias por invitar a nuestro equipo dulce. Estos son los detalles que acabamos de asegurar:',
    introReminder: '¡Ya vamos en camino! Te recordamos la información para mañana:',
    reminderPrep: 'Llegamos aprox. 1 hora antes para montar—ayúdanos con espacio y electricidad.',
    outroConfirmation: '¡Nos emociona celebrar contigo!',
    outroReminder: 'Prepárate para un momento delicioso, ¡nos vemos muy pronto!',
    tagline: 'Barras móviles para eventos en Bakersfield y todo Kern County.',
    supportTitle: '¿Necesitas hacer un cambio o tienes dudas?',
    supportEmailLabel: 'Email',
    supportPhoneLabel: 'Llamadas / Mensajes',
    sections: {
      reservation: 'Detalles de tu evento',
      extras: 'Extras y upgrades',
      payment: 'Resumen de pago'
    },
    labels: {
      bar: 'Barra principal',
      pkg: 'Paquete',
      date: 'Fecha y hora',
      timezone: 'Zona horaria',
      location: 'Ubicación',
      payment: 'Modo de pago',
      extras: 'Extras',
      secondBar: 'Segunda barra: {value}',
      fountain: 'Fuente de chocolate: {value}',
      noExtras: 'Sin extras agregados',
      total: 'Total',
      dueToday: 'Pagar hoy',
      remaining: 'Saldo',
      payModeFull: 'Pago total (ahorra $20)',
      payModeDeposit: 'Anticipo del 25%',
      contact: 'Contacto',
      phone: 'Teléfono'
    }
  }
};

function formatCurrency(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function formatPkg(lang, pkg) {
  return PKG_LABELS[lang]?.[pkg] || PKG_LABELS.en[pkg] || pkg || '';
}

function formatBar(barKey) {
  return BAR_TITLES[barKey] || barKey || 'Snack bar';
}

function formatSecondBar(lang, data) {
  if (!boolish(data.secondEnabled)) return '';
  const label = formatBar(data.secondBar);
  const size = formatPkg(lang, data.secondSize);
  return [label, size].filter(Boolean).join(' • ');
}

function formatFountain(data) {
  if (!boolish(data.fountainEnabled)) return '';
  return [data.fountainSize, data.fountainType].filter(Boolean).join(' • ');
}

export function composeBookingEmail({ lang = 'en', type = 'confirmation', data = {} } = {}) {
  const copy = EMAIL_COPY[lang] || EMAIL_COPY.en;
  const locale = lang === 'es' ? 'es-MX' : 'en-US';
  const subject = type === 'reminder' ? copy.reminderSubject : copy.confirmationSubject;
  const greeting = copy.greeting.replace('{name}', data.fullName || copy.friendName);
  const timezone = data.timezone || 'America/Los_Angeles';
  const startISO = data.startISO || data.dateISO || '';
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: timezone });
  const when = startISO ? dateFormatter.format(new Date(startISO)) : (data.dateISO || '');

  const barTitle = formatBar(data.mainBar);
  const pkgLabel = formatPkg(lang, data.pkg);
  const secondSummary = formatSecondBar(lang, data);
  const fountainSummary = formatFountain(data);
  const extras = [];
  if (secondSummary) extras.push(copy.labels.secondBar.replace('{value}', secondSummary));
  if (fountainSummary) extras.push(copy.labels.fountain.replace('{value}', fountainSummary));

  const total = formatCurrency(data.total);
  const dueNow = formatCurrency(data.dueNow);
  const totalNumber = Number(data.total) || 0;
  const dueNumber = Number(data.dueNow) || 0;
  const remaining = formatCurrency(Math.max(totalNumber - dueNumber, 0));
  const payModeLabel = data.payMode === 'full' ? copy.labels.payModeFull : copy.labels.payModeDeposit;

  const intro = type === 'reminder' ? copy.introReminder : copy.introConfirmation;
  const outro = type === 'reminder' ? copy.outroReminder : copy.outroConfirmation;
  const prepLine = type === 'reminder' ? `<div style="margin:0 0 18px;padding:14px 16px;border-radius:16px;background:rgba(249,168,212,.2);color:#7a2e81;font-weight:600;">${copy.reminderPrep}</div>` : '';

  const reservationRows = [
    { label: copy.labels.bar, value: barTitle },
    { label: copy.labels.pkg, value: pkgLabel },
    { label: copy.labels.date, value: when },
    { label: copy.labels.timezone, value: timezone },
    { label: copy.labels.location, value: data.venue || '—' },
    { label: copy.labels.contact, value: `${data.fullName || '—'} · ${data.email || '—'} · ${copy.labels.phone}: ${data.phone || '—'}` }
  ];

  const extrasValue = extras.length ? extras.join('<br>') : copy.labels.noExtras;
  const paymentRows = [
    { label: copy.labels.payment, value: payModeLabel },
    { label: copy.labels.total, value: total },
    { label: copy.labels.dueToday, value: dueNow },
    { label: copy.labels.remaining, value: remaining }
  ];

  const sections = [
    { title: copy.sections.reservation, rows: reservationRows },
    { title: copy.sections.extras, rows: [{ label: copy.labels.extras, value: extrasValue }] },
    { title: copy.sections.payment, rows: paymentRows }
  ];

  const detailCards = sections.map(section => {
    const rows = section.rows.map(row => `
        <tr>
          <td style="padding:4px 0;color:#7c8296;font-size:13px;width:45%;vertical-align:top;">${row.label}</td>
          <td style="padding:4px 0;color:#0f172a;font-weight:600;font-size:14px;vertical-align:top;">${row.value || '—'}</td>
        </tr>
      `).join('');
    return `
      <div style="margin:0 0 18px;background:#fff7ff;border:1px solid rgba(192,132,252,.3);border-radius:18px;padding:16px;">
        <div style="font-weight:700;font-size:15px;color:#7a2e81;padding-bottom:8px;">${section.title}</div>
        <table role="presentation" width="100%" style="border-collapse:collapse;">${rows}</table>
      </div>
    `;
  }).join('');

  const html = `
    <div style="font-family:'Plus Jakarta Sans','Segoe UI',Arial,sans-serif;background:#fdf7ff;padding:28px 12px;">
      <table role="presentation" width="100%" style="max-width:620px;margin:0 auto;border-collapse:collapse;">
        <tr>
          <td>
            <div style="text-align:center;margin-bottom:20px;">
              <div style="font-size:24px;font-weight:800;color:#7a2e81;">Manna Snack Bars</div>
              <div style="color:#7c8296;font-weight:600;">${copy.tagline}</div>
            </div>
            <div style="background:#ffffff;border-radius:28px;padding:28px;box-shadow:0 25px 50px rgba(122,46,129,.12);color:#0f172a;">
              <p style="margin:0 0 12px;font-size:18px;font-weight:700;">${greeting}</p>
              <p style="margin:0 0 16px;">${intro}</p>
              ${prepLine}
              ${detailCards}
              <p style="margin:12px 0 0;">${outro}</p>
            </div>
            <div style="text-align:center;margin-top:20px;font-size:14px;color:#7c8296;">
              <strong>${copy.supportTitle}</strong><br>
              ${copy.supportEmailLabel}: <a href="mailto:${SUPPORT_EMAIL}" style="color:#7a2e81;text-decoration:none;">${SUPPORT_EMAIL}</a><br>
              ${copy.supportPhoneLabel}: <a href="tel:${SUPPORT_PHONE_TEL}" style="color:#7a2e81;text-decoration:none;">${SUPPORT_PHONE}</a>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  const extrasText = extras.length ? extras.join('\n') : copy.labels.noExtras;
  const lines = [
    greeting,
    '',
    intro,
    type === 'reminder' ? copy.reminderPrep : '',
    '',
    `${copy.sections.reservation}:`,
    `${copy.labels.bar}: ${barTitle}`,
    `${copy.labels.pkg}: ${pkgLabel}`,
    `${copy.labels.date}: ${when}`,
    `${copy.labels.timezone}: ${timezone}`,
    `${copy.labels.location}: ${data.venue || '—'}`,
    `${copy.labels.contact}: ${data.fullName || '—'} / ${data.email || '—'} / ${copy.labels.phone}: ${data.phone || '—'}`,
    '',
    `${copy.sections.extras}: ${extrasText}`,
    '',
    `${copy.sections.payment}:`,
    `${copy.labels.payment}: ${payModeLabel}`,
    `${copy.labels.total}: ${total}`,
    `${copy.labels.dueToday}: ${dueNow}`,
    `${copy.labels.remaining}: ${remaining}`,
    '',
    outro,
    `${copy.supportEmailLabel}: ${SUPPORT_EMAIL}`,
    `${copy.supportPhoneLabel}: ${SUPPORT_PHONE}`
  ].filter(Boolean).join('\n');

  return { subject, html, text: lines };
}

async function sendMail({ to, subject, html, text, bcc }) {
  const tx = getTransporter();
  if (!tx) return false;
  if (!to) {
    console.warn('[email] no recipient supplied');
    return false;
  }
  const fromAddress = process.env.BOOKING_FROM_EMAIL || process.env.SMTP_USER;
  const from = fromAddress ? `Manna Snack Bars – Booking Team <${fromAddress}>` : undefined;
  const payload = {
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ')
  };
  if (bcc) payload.bcc = bcc;
  await tx.sendMail(payload);
  return true;
}

export async function sendBookingConfirmation(opts) {
  return sendMail(opts);
}

export async function sendBookingEmail(opts) {
  return sendMail(opts);
}
