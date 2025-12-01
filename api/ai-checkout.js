// /api/ai-checkout.js
// Proxy endpoint for ChatGPT or external AI clients
// Safely relays requests to your main /api/checkout route

export const config = { runtime: "nodejs" };

const REQUIRED_FIELDS = [
  "pkg",       // rango de invitados / paquete
  "mainBar",   // tipo de barra principal
  "payMode",   // "deposit" o "full"
  "fullName",  // nombre completo del cliente
  "email",     // correo del cliente
  "dateISO",   // fecha del evento (YYYY-MM-DD)
  "startISO",  // hora de inicio en ISO (ej. 2026-03-29T20:30:00-08:00)
  "venue",     // ciudad / dirección del evento
  "guests"     // número aproximado de invitados
];

export default async function handler(req, res) {
  // Accept only POST requests from ChatGPT
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel normalmente ya parsea JSON; por si acaso, soportamos string también
    const rawBody = req.body || {};
    const body =
      typeof rawBody === "string"
        ? JSON.parse(rawBody || "{}")
        : rawBody;

    // 🔒 Validación estricta de campos obligatorios
    const missing = REQUIRED_FIELDS.filter((field) => {
      const value = body[field];
      // Consideramos vacío: undefined, null, "", 0 invitados, etc.
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (field === "guests" && (!Number.isFinite(Number(value)) || Number(value) <= 0))
      );
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        missing
      });
    }

    // Forward the same payload to your real /api/checkout
    const response = await fetch(
      "https://manna-webhooks-2.vercel.app/api/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    // If checkout returns a URL, relay it back to ChatGPT
    if (response.ok) {
      const data = await response.json();
      return res.status(200).json({
        success: true,
        checkout_url: data.url || null
      });
    } else {
      const errorText = await response.text();
      return res.status(response.status).json({
        success: false,
        error: "Upstream checkout error",
        detail: errorText
      });
    }
  } catch (err) {
    console.error("AI Checkout error:", err);
    res.status(500).json({
      success: false,
      error: "Internal AI checkout proxy error",
      detail: err.message
    });
  }
}
