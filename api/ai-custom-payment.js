// /api/ai-custom-payment.js
// Crea un Stripe Checkout de MONTO LIBRE para usarlo desde ChatGPT / AI.
// 🔓 Validación ligera: SOLO se exige un "amount" válido (> 0).

export const config = { runtime: "nodejs" };

import Stripe from "stripe";

let stripe = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable");
  }
  if (!stripe) {
    stripe = new Stripe(key, {
      apiVersion: "2024-06-20",
    });
  }
  return stripe;
}

function usd(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100); // dollars → cents
}

export default async function handler(req, res) {
  // CORS muy básico; realmente ChatGPT llamará server-to-server.
  const allowList = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin || "";
  const okOrigin = allowList.length ? allowList.includes(origin) : true;

  res.setHeader("Access-Control-Allow-Origin", okOrigin ? origin || "*" : "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Soportamos body como objeto o como string JSON
    const rawBody = req.body || {};
    let body;

    try {
      body =
        typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody;
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
        detail: String(parseErr.message || parseErr),
      });
    }

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
      bundleLabel,
    } = body;

    // ✅ ÚNICA validación obligatoria: amount > 0
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "amount" (must be > 0)',
      });
    }

    const cents = usd(numAmount);
    if (!cents || cents <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid "amount" after normalization',
      });
    }

    const BASE_URL = (process.env.PUBLIC_URL || "https://mannasnackbars.com")
      .replace(/\/+$/, "");

    const stripeClient = getStripe();

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      payment_method_types: ["card", "affirm"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name:
                description ||
                `Custom payment — ${fullName || "Manna Snack Bars"}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${BASE_URL}/`,
      cancel_url: `${BASE_URL}/`,
      metadata: {
        type: "manual_custom_payment",
        amount: String(numAmount),
        description: description || "",

        fullName: fullName || "",
        email: email || "",
        phone: phone || "",

        // Datos de evento (opcionales)
        dateISO: dateISO || "",
        startISO: startISO || "",
        venue: venue || "",
        guests: guests !== undefined ? String(guests) : "",

        mainBar: mainBar || "",

        // Info comercial opcional
        discountLabel: discountLabel || "",
        discountAmount:
          discountAmount !== undefined ? String(discountAmount) : "",
        bundleLabel: bundleLabel || "",

        notes: notes || "",
      },
    });

    return res.status(200).json({
      success: true,
      checkout_url: session.url,
    });
  } catch (e) {
    console.error("ai-custom-payment error", e);
    return res.status(500).json({
      success: false,
      error: "Custom payment failed",
      detail: e.message || String(e),
    });
  }
}
