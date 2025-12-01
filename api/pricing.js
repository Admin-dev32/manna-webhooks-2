export default async function handler(req, res) {
  try {
    const url = "https://manna-webhooks-2.vercel.app/public/index.html";
    const html = await fetch(url).then(r => r.text());

    // More flexible regex: supports minified and compact code
    const extractObject = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*({[^;]+})`);
      const match = html.match(regex);
      if (!match) return {};
      try {
        return eval(`(${match[1]})`);
      } catch {
        return {};
      }
    };

    const extractNumber = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`);
      const match = html.match(regex);
      return match ? parseInt(match[1]) : 0;
    };

    const data = {
      base_prices: extractObject("BASE_PRICES"),
      bar_meta: extractObject("BAR_META"),
      second_discount: extractObject("SECOND_DISCOUNT"),
      fountain_price: extractObject("FOUNTAIN_PRICE"),
      full_payment_discount: extractNumber("FULL_FLAT_OFF"),
      source: url,
    };

    res.status(200).json(data);
  } catch (error) {
    console.error("Error parsing pricing:", error);
    res.status(500).json({ error: "Failed to parse prices from index.html" });
  }
}
