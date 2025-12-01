// /api/ai-checkout.js
// Proxy endpoint for ChatGPT or external AI clients
// Safely relays requests to your main /api/checkout route

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // Accept only POST requests from ChatGPT
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // Minimal validation
    if (!body.pkg || !body.mainBar || !body.payMode) {
      return res.status(400).json({
        error: "Missing required fields: pkg, mainBar, payMode"
      });
    }

    // Forward the same payload to your real /api/checkout
    const response = await fetch("https://manna-webhooks-2.vercel.app/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

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
