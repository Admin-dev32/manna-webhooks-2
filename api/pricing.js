export default async function handler(req, res) {
  try {
    // Fetch the public HTML file directly from your live domain
    const url = "https://manna-webhooks-2.vercel.app/public/index.html";
    const html = await fetch(url).then(r => r.text());

    // Extract constants via regex
    const basePricesMatch = html.match(/const BASE_PRICES\s*=\s*({[\s\S]*?});/);
    const barMetaMatch = html.match(/const BAR_META\s*=\s*({[\s\S]*?});/);
    const secondDiscountMatch = html.match(/const SECOND_DISCOUNT\s*=\s*({[\s\S]*?});/);
    const fountainPriceMatch = html.match(/const FOUNTAIN_PRICE\s*=\s*({[\s\S]*?});/);
    const fullFlatOffMatch = html.match(/const FULL_FLAT_OFF\s*=\s*(\d+)/);

    // Turn extracted JS objects into JSON
    const data = {
      base_prices: basePricesMatch ? eval(`(${basePricesMatch[1]})`) : {},
      bar_meta: barMetaMatch ? eval(`(${barMetaMatch[1]})`) : {},
      second_discount: secondDiscountMatch ? eval(`(${secondDiscountMatch[1]})`) : {},
      fountain_price: fountainPriceMatch ? eval(`(${fountainPriceMatch[1]})`) : {},
      full_payment_discount: fullFlatOffMatch ? parseInt(fullFlatOffMatch[1]) : 0,
      source: url
    };

    res.status(200).json(data);
  } catch (error) {
    console.error("Error reading HTML:", error);
    res.status(500).json({ error: "Failed to load prices from index.html" });
  }
}
