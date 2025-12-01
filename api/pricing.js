export default async function handler(req, res) {
  try {
    const url = "https://manna-webhooks-2.vercel.app"; // fetch root, not /public
    const html = await fetch(url).then(r => r.text());

    // Helper to extract JavaScript object definitions from HTML
    const extractObject = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*({[\\s\\S]*?})[;\\n]`);
      const match = html.match(regex);
      if (!match) return {};
      try {
        return eval(`(${match[1]})`);
      } catch (err) {
        console.warn(`Failed to parse ${name}`, err);
        return {};
      }
    };

    // Helper to extract numeric constants
    const extractNumber = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`);
      const match = html.match(regex);
      return match ? Number(match[1]) : 0;
    };

    // 🔍 Extract JavaScript constants directly from your index.html
    const base_prices = extractObject("BASE_PRICES");
    const bar_meta = extractObject("BAR_META");
    const second_discount = extractObject("SECOND_DISCOUNT");
    const fountain_price = extractObject("FOUNTAIN_PRICE");
    const full_payment_discount = extractNumber("FULL_FLAT_OFF");

    // Fallback: Try parsing inside <script> tags too (for bundled builds)
    if (Object.keys(base_prices).length === 0) {
      const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
      for (const s of scripts) {
        const text = s[1];
        if (!text) continue;
        if (!Object.keys(base_prices).length && text.includes("BASE_PRICES"))
          try { Object.assign(base_prices, eval("(" + text.match(/BASE_PRICES\s*=\s*({[\s\S]*?})[;,\n]/)[1] + ")")); } catch {}
        if (!Object.keys(bar_meta).length && text.includes("BAR_META"))
          try { Object.assign(bar_meta, eval("(" + text.match(/BAR_META\s*=\s*({[\s\S]*?})[;,\n]/)[1] + ")")); } catch {}
        if (!Object.keys(second_discount).length && text.includes("SECOND_DISCOUNT"))
          try { Object.assign(second_discount, eval("(" + text.match(/SECOND_DISCOUNT\s*=\s*({[\s\S]*?})[;,\n]/)[1] + ")")); } catch {}
        if (!Object.keys(fountain_price).length && text.includes("FOUNTAIN_PRICE"))
          try { Object.assign(fountain_price, eval("(" + text.match(/FOUNTAIN_PRICE\s*=\s*({[\s\S]*?})[;,\n]/)[1] + ")")); } catch {}
      }
    }

    const result = {
      source: url,
      base_prices,
      bar_meta,
      second_discount,
      fountain_price,
      full_payment_discount,
    };

    res.status(200).json(result);
  } catch (err) {
    console.error("Error extracting data:", err);
    res.status(500).json({ error: "Failed to extract prices from live index.html" });
  }
}
