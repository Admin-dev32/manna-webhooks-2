// /api/ai-checkout.js
// Proxy endpoint for ChatGPT or external AI clients
// Relays requests to your main /api/checkout route
// 🔓 Validación ligera: SOLO pkg, mainBar y payMode.

export const config = { runtime: "nodejs" };

// Base del backend real (puedes cambiarla por env var)
const CHECKOUT_BASE =
  process.env.MANNA_CHECKOUT_BASE || "https://manna-webhooks-2.vercel.app";

const REQUIRED_CORE_FIELDS = ["pkg", "mainBar", "payMode"];

export default async function handler(req, res) {
  // Solo POST (opcionalmente podrías aceptar OPTIONS para CORS)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel ya parsea JSON, pero soportamos string por si llega crudo
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
        missing,
      });
    }

    // Construimos la URL real de checkout por si cambias base
    const upstreamUrl = new URL("/api/checkout", CHECKOUT_BASE).toString();

    // 🔁 Reenviar el payload tal cual a tu /api/checkout real
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Leemos el cuerpo UNA sola vez y luego intentamos parsear JSON
    let upstreamText = "";
    try {
      upstreamText = await response.text();
    } catch {
      upstreamText = "";
    }

    let upstreamJson = null;
    try {
      upstreamJson = upstreamText ? JSON.parse(upstreamText) : null;
    } catch {
      upstreamJson = null;
    }

    if (response.ok) {
      const checkoutUrl =
        (upstreamJson && upstreamJson.url) || upstreamJson?.checkout_url || null;

      return res.status(200).json({
        success: true,
        checkout_url: checkoutUrl,
        // Opcionalmente eco del cuerpo por si tu GPT quiere leer más info
        upstream: upstreamJson || upstreamText || null,
      });
    } else {
      return res.status(response.status).json({
        success: false,
        error: "Upstream checkout error",
        detail:
          (upstreamJson && (upstreamJson.detail || upstreamJson.error)) ||
          upstreamText ||
          null,
      });
    }
  } catch (err) {
    console.error("AI Checkout error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal AI checkout proxy error",
      detail: err.message || String(err),
    });
  }
}
