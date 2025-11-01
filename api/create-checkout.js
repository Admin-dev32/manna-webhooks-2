// /api/create-checkout.js
export const config = { runtime: 'nodejs' };

import Stripe from 'stripe';
import { applyCors, handlePreflight } from './_cors.js';

// ⚙️ Entorno:
// - STRIPE_SECRET_KEY (requerido)
// - STRIPE_SUCCESS_URL (opcional; default https://mannasnackbars.com/thankyou)
// - STRIPE_CANCEL_URL  (opcional; default https://mannasnackbars.com/)
// - (El webhook leerá metadata y creará el evento)

function s(v, fb = '') {
  return (typeof v === 'string' ? v : fb).trim();
}

export default async function handler(req, res) {
  // CORS
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      return res.status(500).json({ ok: false, error: 'missing_STRIPE_SECRET_KEY' });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: '2022-11-15' });

    const successUrl = process.env.STRIPE_SUCCESS_URL || 'https://mannasnackbars.com/thankyou';
    const cancelUrl  = process.env.STRIPE_CANCEL_URL  || 'https://mannasnackbars.com/';

    // ---- Body & normalización
    const body = req.body || {};

    const pkg        = s(body.pkg);
    const mainBar    = s(body.mainBar);
    const fullName   = s(body.fullName || 'Client');
    const phone      = s(body.phone);
    const email      = s(body.email);            // puede venir vacío; el webhook preferirá checkout email
    const venue      = s(body.venue);
    const dateISO    = s(body.dateISO);
    const startISO   = s(body.startISO);         // **importante**: lo usará el webhook para calendar
    const affName    = s(body.affiliateName);
    const affEmail   = s(body.affiliateEmail);
    const pin        = s(body.pin);

    // Totales (el webhook los usa para pintar Deposit/Balance en Calendar)
    const depositNum = Number(body.deposit || 0);
    const totalNum   = Number(body.total   || 0);
    const balanceNum = Math.max(0, totalNum - depositNum);

    // 🔒 Forzamos modo depósito y validamos > 0
    if (!(depositNum > 0)) {
      return res.status(400).json({ ok: false, error: 'deposit_required', detail: 'Enter a deposit > $0.' });
    }

    // Validaciones mínimas
    if (!pkg || !mainBar || !fullName) {
      return res.status(400).json({ ok: false, error: 'missing_fields', detail: 'pkg, mainBar, fullName are required.' });
    }
    if (!startISO) {
      return res.status(400).json({ ok: false, error: 'missing_startISO', detail: 'Pick a slot first.' });
    }

    // Título de la línea
    const titleMap = {
      pancake: 'Mini Pancake',
      maruchan: 'Maruchan',
      esquites: 'Esquites (Corn Cups)',
      snack: 'Manna Snack — Classic',
      tostiloco: 'Tostiloco (Premium)'
    };
    const sizeMap = {
      '50-150-5h': '50–150',
      '150-250-5h': '150–250',
      '250-350-6h': '250–350'
    };
    const productTitle = `${titleMap[mainBar] || 'Service'} — ${sizeMap[pkg] || pkg} (Deposit)`;

    // Metadata que consumirá /api/stripe/webhook
    const metadata = {
      pkg,
      mainBar,
      fullName,
      phone,
      venue,
      dateISO,
      startISO,       // <<< clave para calendar
      email,          // opcional; webhook preferirá session.customer_details.email
      affiliateName: affName,
      affiliateEmail: affEmail,
      pin,
      payMode: 'deposit',
      // Totales redondeados a enteros (como se mostrará en Calendar)
      deposit: String(Math.round(depositNum)),
      total:   String(Math.round(totalNum)),
      balance: String(Math.round(balanceNum)),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(depositNum * 100),
          product_data: { name: productTitle },
        },
        quantity: 1
      }],
      metadata
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    console.error('[create-checkout] error', e?.message || e);
    return res.status(500).json({ ok: false, error: 'checkout_failed', detail: String(e?.message || e) });
  }
}
