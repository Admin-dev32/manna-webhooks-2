export default async function handler(req, res) {
  try {
    const url = "https://manna-webhooks-2.vercel.app/public/index.html";
    const html = await fetch(url).then(r => r.text());

    // Flexible extractors
    const extractObject = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*({[^;]+})`);
      const match = html.match(regex);
      if (!match) return {};
      try { return eval(`(${match[1]})`); } catch { return {}; }
    };

    const extractNumber = (name) => {
      const regex = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`);
      const match = html.match(regex);
      return match ? parseInt(match[1]) : 0;
    };

    // Extract JS-defined data
    const base_prices = extractObject("BASE_PRICES");
    const bar_meta = extractObject("BAR_META");
    const second_discount = extractObject("SECOND_DISCOUNT");
    const fountain_price = extractObject("FOUNTAIN_PRICE");
    const full_payment_discount = extractNumber("FULL_FLAT_OFF");

    // 🔍 Extract in-page info: bar cards, descriptions, toppings
    const barBlocks = Array.from(html.matchAll(
      /<label class="choice bar-card"[^>]*data-bar="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g
    )).map(([_, key, content]) => {
      const title = (content.match(/<div class="title">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const desc = (content.match(/<div class="desc">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const details = (content.match(/<div class="details">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const tag = (content.match(/<div class="tag"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      return { key, title, desc, details, tag };
    });

    // 🔍 Extract add-ons
    const addOns = Array.from(html.matchAll(
      /<div class="add-on-row">([\s\S]*?)<\/div>\s*<\/div>/g
    )).map(([full, block]) => {
      const title = (block.match(/<div class="title"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const copy = (block.match(/<div class="copy"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const price = (block.match(/<div class="price"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      return { title, copy, price };
    });

    // Combine
    const data = {
      source: url,
      base_prices,
      bar_meta,
      second_discount,
      fountain_price,
      full_payment_discount,
      bars: barBlocks,
      addons: addOns
    };

    res.status(200).json(data);
  } catch (err) {
    console.error("Parsing error:", err);
    res.status(500).json({ error: "Failed to extract full bar data" });
  }
}
