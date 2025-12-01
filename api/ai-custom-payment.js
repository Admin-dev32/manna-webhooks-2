// /api/ai-custom-payment.js
// Crea un Stripe Checkout de MONTO LIBRE para usarlo desde ChatGPT / AI.

export const config = { runtime: 'nodejs' };

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Campos que SIEMPRE queremos tener antes de cobrar
const REQUIRED_FIELDS = [
  'amount',    // monto a cobrar
  'fullName',  // nombre del cliente
  'email',     // correo
  'dateISO',   // fecha del evento
  'startISO',  // hora de inicio
  'venue',     // ciudad / dirección
  'guests',    // número de invitados
  'mainBar'    // barra principal relacionada a este pago
];

function usd(n) {
  return Math.round(Number(n || 0) * 100); // dollars → cents
}

export default async function handler(req, res) {
  // Opcional: CORS sencillo (no hace daño, pero ChatGPT es server-to-server)
  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin || '';
  const okOrigin = allowList.length ? allowList.includes(origin) : true;

  res.setHeader('Access-Control-Allow-Origin', okOrigin ? origin || '*' : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Soportamos body como objeto o como string JSON
    const rawBody = req.body || {};
    const body =
      typeof rawBody === 'string' ? JSON.parse(rawBody || '{}') : rawBody;

    const {
      amount,
      description,
      fullName,
      email,
      phone,
      notes,
      dateISO,
      startISO,
      venue,
      guests,
      mainBar,
      discountLabel,
      discountAmount,
      bundleLabel
    } = body;

    // 🔒 Validación estricta de campos requeridos
    const missing = REQUIRED_FIELDS.filter((field) => {
      const value = body[field];

      if (field === 'amount') {
        return !Number.isFinite(Number(value)) || Number(value) <= 0;
      }
      if (field === 'guests') {
        return !Number.isFinite(Number(value)) || Number(value) <= 0;
      }

      return (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')
      );
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing
      });
    }

    const numAmount = Number(amount);

    const BASE_URL = (process.env.PUBLIC_URL || 'https://mannasnackbars.com')
      .replace(/\/+$/, '');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allow_promotion_codes: true,
      payment_method_types: ['card', 'affirm'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: usd(numAmount),
            product_data: {
              name:
                description ||
                `Custom payment — ${fullName} — ${mainBar} — ~${guests} guests`
            }
          },
          quantity: 1
        }
      ],
      success_url: `${BASE_URL}/`,
      cancel_url: `${BASE_URL}/`,
      metadata: {
        type: 'manual_custom_payment',
        amount: String(numAmount),
        description: description || '',

        fullName: fullName || '',
        email: email || '',
        phone: phone || '',

        // Datos de evento (estrictos)
        dateISO: dateISO || '',
        startISO: startISO || '',
        venue: venue || '',
        guests: String(guests || ''),
        mainBar: mainBar || '',

        // Info comercial opcional
        discountLabel: discountLabel || '',
        discountAmount:
          discountAmount !== undefined ? String(discountAmount) : '',
        bundleLabel: bundleLabel || '',

        notes: notes || ''
      }
    });

    return res.status(200).json({
      success: true,
      checkout_url: session.url
    });
  } catch (e) {
    console.error('ai-custom-payment error', e);
    return res.status(500).json({
      success: false,
      error: 'Custom payment failed',
      detail: e.message
    });
  }
}
