// /api/ai-checkout.js
// Proxy endpoint for ChatGPT or external AI clients
// Relays requests to your main /api/checkout route
// 🔓 Validación ligera: SOLO pkg, mainBar y payMode.

export const config = { runtime: "nodejs" };

// Campos mínimos que /api/checkout necesita para funcionar
const REQUIRED_CORE_FIELDS = ["pkg", "mainBar", "payMode"];

export default async function handler(req, res) {
  // Aceptar solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel normalmente ya parsea JSON; por si acaso, soportamos string también
    const rawBody = req.body || {};
    const body =
      typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody;

    // ✅ Validación LIGERA (solo campos core)
    const missing = REQUIRED_CORE_FIELDS.filter((field) => {
      const value = body[field];
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      );
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required core fields",
        missing
      });
    }

    // 🔁 Reenviar el payload tal cual a tu /api/checkout real
    const response = await fetch(
      "https://manna-webhooks-2.vercel.app/api/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

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
    return res.status(500).json({
      success: false,
      error: "Internal AI checkout proxy error",
      detail: err.message
    });
  }
}
