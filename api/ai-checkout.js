// pages/api/ai-checkout.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// Helper: convierte base_prices en tabla ordenada por "máximo de invitados"
function buildPriceTable(basePrices) {
  return Object.entries(basePrices || {})
    .map(([key, price]) => {
      // key puede ser "150" o "100-150"
      let maxGuests;

      if (key.includes('-')) {
        const parts = key.split('-').map((x) => parseInt(x.trim(), 10));
        maxGuests = parts[1]; // usamos el máximo del rango
      } else {
        maxGuests = parseInt(key.trim(), 10);
      }

      return { key, maxGuests, price: Number(price) };
    })
    .filter((row) => !Number.isNaN(row.maxGuests) && !Number.isNaN(row.price))
    .sort((a, b) => a.maxGuests - b.maxGuests);
}

// Helper: encuentra el precio usando guests
function resolvePriceFromGuests(guests, basePrices) {
  const table = buildPriceTable(basePrices);
  if (!table.length) return null;

  const guestsNum = Number(guests);

  // primer paquete cuyo maxGuests sea >= guests
  const match = table.find((row) => guestsNum <= row.maxGuests);

  // si no hay ninguno, usamos el más grande (último)
  return (match || table[table.length - 1]).price;
}

// Helper: obtiene el precio base final usando pkg o guests
function getBasePrice({ pkg, guests, basePrices }) {
  // 1) si el pkg existe en base_prices, úsalo
  if (pkg && basePrices && basePrices[pkg] != null) {
    return Number(basePrices[pkg]);
  }

  // 2) si no, intenta resolver con guests
  return resolvePriceFromGuests(guests, basePrices);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const {
      pkg,
      mainBar,          // "pancake" | "tostiloco" | "maruchan" | "snack" | etc.
      payMode,          // "deposit" | "full"
      secondEnabled,
      secondBar,
      secondSize,
      fountainEnabled,
      fountainSize,
      fountainType,
      fullName,
      email,
      phone,
      venue,
      dateISO,
      startISO,
      guests,
      discountApplied,
      discountNote,
      bundleNote,
    } = req.body || {};

    // -------- Validaciones mínimas obligatorias --------
    if (!mainBar || !payMode || !fullName || !email || !venue || !dateISO || !startISO || !guests) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    // -------- 1) Traer precios vivos desde /api/pricing --------
    const baseUrl =
      process.env.MANNA_BASE_URL || 'https://manna-webhooks-2.vercel.app';

    const pricingRes = await fetch(`${baseUrl}/api/pricing`);
    if (!pricingRes.ok) {
      console.error('Error fetching /api/pricing', pricingRes.status);
      return res.status(500).json({
        success: false,
        error: 'Failed to load pricing data',
      });
    }

    const pricing = await pricingRes.json();
    const basePrices = pricing.base_prices || {};
    const secondDiscountMap = pricing.second_discount || {};
    const fountainPriceMap = pricing.fountain_price || {};
    const fullPaymentDiscount = Number(pricing.full_payment_discount || 0);

    // -------- 2) Calcular precio base de la barra principal --------
    const basePriceMain = getBasePrice({ pkg, guests, basePrices });

    if (!basePriceMain || basePriceMain <= 0) {
      console.error('Base price resolved as 0 or invalid', {
        pkg,
        guests,
        basePriceMain,
      });

      return res.status(400).json({
        success: false,
        error: 'No valid base price found for this guest count',
        debug: { pkg, guests },
      });
    }

    // Monto principal según modo de pago
    let subtotalMain =
      payMode === 'deposit' ? basePriceMain * 0.25 : basePriceMain;

    // Descuento por pago completo (si existe en /api/pricing)
    if (payMode === 'full' && fullPaymentDiscount > 0) {
      subtotalMain = Math.max(subtotalMain - fullPaymentDiscount, 0);
    }

    // -------- 3) Segunda barra (si aplica) --------
    let subtotalSecond = 0;

    if (secondEnabled) {
      // Para la segunda barra podemos:
      // - usar secondSize si existe en el mapa de descuentos
      // - o volver a usar guests / basePrices y aplicar un descuento
      const secondBase = getBasePrice({
        pkg: secondSize || pkg,
        guests,
        basePrices,
      });

      let secondDiscount = 0;
      if (secondSize && secondDiscountMap[secondSize] != null) {
        // segundo mapa podría ser monto fijo a descontar o porcentaje,
        // aquí asumimos monto fijo en dólares.
        secondDiscount = Number(secondDiscountMap[secondSize]);
      }

      const secondPrice = Math.max(secondBase - secondDiscount, 0);
      subtotalSecond =
        payMode === 'deposit' ? secondPrice * 0.25 : secondPrice;
    }

    // -------- 4) Chocolate fountain (si aplica) --------
    let subtotalFountain = 0;

    if (fountainEnabled && fountainSize) {
      const fountainBase = Number(fountainPriceMap[fountainSize] || 0);
      if (fountainBase > 0) {
        subtotalFountain =
          payMode === 'deposit' ? fountainBase * 0.25 : fountainBase;
      }
    }

    // -------- 5) Total general --------
    const subtotal = subtotalMain + subtotalSecond + subtotalFountain;

    if (!subtotal || subtotal <= 0) {
      console.error('Subtotal is 0, aborting Stripe session', {
        subtotalMain,
        subtotalSecond,
        subtotalFountain,
      });

      return res.status(400).json({
        success: false,
        error: 'Calculated subtotal is 0 — check pricing configuration',
      });
    }

    const amountInCents = Math.round(subtotal * 100);

    // -------- 6) Crear sesión de Stripe Checkout --------
    const productName = `Manna — ${mainBar} • ${
      payMode === 'deposit' ? '25% deposit' : 'Full payment'
    }`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${baseUrl}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout-cancelled`,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: productName,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      metadata: {
        mainBar,
        payMode,
        fullName,
        phone: phone || '',
        venue,
        dateISO,
        startISO,
        guests: String(guests),
        secondEnabled: String(!!secondEnabled),
        secondBar: secondBar || '',
        secondSize: secondSize || '',
        fountainEnabled: String(!!fountainEnabled),
        fountainSize: fountainSize || '',
        fountainType: fountainType || '',
        discountApplied: String(!!discountApplied),
        discountNote: discountNote || '',
        bundleNote: bundleNote || '',
        pkg: pkg || '',
      },
    });

    return res.status(200).json({
      success: true,
      checkout_url: session.url,
    });
  } catch (err) {
    console.error('ai-checkout error', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error creating checkout session',
    });
  }
}
