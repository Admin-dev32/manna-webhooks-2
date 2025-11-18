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

const EMAIL_COPY = {
  en: {
    confirmationSubject: '🎉 Your Manna Snack Bars booking is confirmed',
    reminderSubject: '⏰ Reminder: Manna Snack Bars arrives tomorrow',
    greeting: 'Hi {name}! 🙌',
    friendName: 'there',
    introConfirmation: 'Thanks for booking Manna Snack Bars. Here are your sweet details:',
    introReminder: 'We\'re packing the goodies! Here\'s a quick refresher for tomorrow:',
    reminderPrep: 'Our crew arrives about 1 hour early for setup.',
    outroConfirmation: 'Need to make a change? Just reply to this email.',
    outroReminder: 'Reply to this email if anything changes—see you soon! 😊',
    labels: {
      bar: 'Main bar',
      pkg: 'Package',
      date: 'Date & time',
      timezone: 'Timezone',
      location: 'Location',
      payment: 'Payment',
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
      phone: 'Phone',
      reminderPrep: 'We arrive ~1h early for setup.'
    },
    footer: 'Manna Snack Bars — booking team'
  },
  es: {
    confirmationSubject: '🎉 Tu reservación de Manna Snack Bars está confirmada',
    reminderSubject: '⏰ Recordatorio: tu barra Manna llega mañana',
    greeting: '¡Hola {name}! 🙌',
    friendName: 'amig@',
    introConfirmation: 'Gracias por reservar con Manna Snack Bars. Aquí están tus detalles:',
    introReminder: '¡Ya vamos en camino! Te recordamos los datos de tu evento para mañana:',
    reminderPrep: 'Nuestro equipo llega aprox. 1 hora antes para montar.',
    outroConfirmation: '¿Necesitas hacer un cambio? Responde este correo y te ayudamos.',
    outroReminder: 'Si algo cambia, solo responde este correo. ¡Nos vemos pronto! 😊',
    labels: {
      bar: 'Barra principal',
      pkg: 'Paquete',
      date: 'Fecha y hora',
      timezone: 'Zona horaria',
      location: 'Ubicación',
      payment: 'Pago',
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
      phone: 'Teléfono',
      reminderPrep: 'Llegamos ~1h antes para el montaje.'
    },
    footer: 'Manna Snack Bars — equipo de reservaciones'
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
  const prepLine = type === 'reminder' ? `<p>${copy.reminderPrep}</p>` : '';

  const detailsHtml = [
    { label: copy.labels.bar, value: barTitle },
    { label: copy.labels.pkg, value: pkgLabel },
    { label: copy.labels.date, value: when },
    { label: copy.labels.timezone, value: timezone },
    { label: copy.labels.location, value: data.venue || '—' },
    { label: copy.labels.payment, value: `${payModeLabel}<br>${copy.labels.total}: ${total}<br>${copy.labels.dueToday}: ${dueNow}<br>${copy.labels.remaining}: ${remaining}` },
    { label: copy.labels.extras, value: extras.length ? extras.join('<br>') : copy.labels.noExtras },
    { label: copy.labels.contact, value: `${data.fullName || '—'}<br>${data.email || ''}<br>${copy.labels.phone}: ${data.phone || '—'}` }
  ].map(row => `<div style="margin-bottom:12px;"><strong>${row.label}:</strong><div style="margin-top:4px;color:#0f172a;">${row.value || '—'}</div></div>`).join('');

  const html = `
    <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;background:#f4f6fb;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:28px;color:#0f172a;">
        <h2 style="margin:0 0 8px;">${greeting}</h2>
        <p style="margin:0 0 16px;">${intro}</p>
        ${prepLine}
        ${detailsHtml}
        <p style="margin:16px 0 0;">${outro}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#475467;">${copy.footer}</p>
      </div>
    </div>
  `;

  const extrasText = extras.length ? extras.join('\n') : copy.labels.noExtras;
  const lines = [
    greeting,
    '',
    intro,
    type === 'reminder' ? copy.reminderPrep : '',
    '',
    `${copy.labels.bar}: ${barTitle}`,
    `${copy.labels.pkg}: ${pkgLabel}`,
    `${copy.labels.date}: ${when}`,
    `${copy.labels.timezone}: ${timezone}`,
    `${copy.labels.location}: ${data.venue || '—'}`,
    `${copy.labels.payment}: ${payModeLabel}`,
    `${copy.labels.total}: ${total}`,
    `${copy.labels.dueToday}: ${dueNow}`,
    `${copy.labels.remaining}: ${remaining}`,
    `${copy.labels.extras}: ${extrasText}`,
    `${copy.labels.contact}: ${data.fullName || '—'} / ${data.email || ''} / ${copy.labels.phone}: ${data.phone || '—'}`,
    '',
    outro,
    copy.footer
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
  const from = process.env.BOOKING_FROM_EMAIL || process.env.SMTP_USER;
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
