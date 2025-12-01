export default async function handler(req, res) {
  try {
    const url = "https://manna-webhooks-2.vercel.app/";
    const html = await fetch(url).then(r => r.text());

    /* --- 1. Safe extractors for constants --- */
    const extractObj = (key) => {
      const regex = new RegExp(`const\\s+${key}\\s*=\\s*({[\\s\\S]*?})[;\\n]`);
      const match = html.match(regex);
      if (!match) return {};
      try { return eval("(" + match[1] + ")"); } catch { return {}; }
    };
    const extractNum = (key) => {
      const regex = new RegExp(`const\\s+${key}\\s*=\\s*(\\d+)`);
      const match = html.match(regex);
      return match ? Number(match[1]) : 0;
    };

    /* --- 2. Extract JS constants --- */
    const base_prices = extractObj("BASE_PRICES");
    const bar_meta = extractObj("BAR_META");
    const second_discount = extractObj("SECOND_DISCOUNT");
    const fountain_price = extractObj("FOUNTAIN_PRICE");
    const full_payment_discount = extractNum("FULL_FLAT_OFF");

    /* --- 3. Parse HTML bar blocks for human text --- */
    const bars = Array.from(
      html.matchAll(/<label class="choice bar-card"[^>]*data-bar="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)
    ).map(([_, id, inner]) => {
      const title = (inner.match(/<div class="title">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const tag = (inner.match(/<div class="tag"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const desc = (inner.match(/<div class="desc">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const details = (inner.match(/<div class="details">(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const meta = bar_meta?.[id] || {};
      return {
        id,
        title: title || meta.title || '',
        tag,
        desc: desc || meta.desc || '',
        details: details || meta.details || '',
        add: meta.add || 0,
        base_price: base_prices || {}
      };
    });

    /* --- 4. Parse add-on info --- */
    const addons = Array.from(
      html.matchAll(/<div class="add-on-row">([\s\S]*?)<\/div>\s*<\/div>/g)
    ).map(([_, block]) => {
      const title = (block.match(/<div class="title"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const copy = (block.match(/<div class="copy"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      const price = (block.match(/<div class="price"[^>]*>(.*?)<\/div>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
      return { title, copy, price };
    });

    /* --- 5. Combine everything --- */
    const data = {
      source: url,
      base_prices,
      bar_meta,
      second_discount,
      fountain_price,
      full_payment_discount,
      bars,
      addons
    };

    res.status(200).json(data);
  } catch (err) {
    console.error("Error reading pricing data:", err);
    res.status(500).json({ error: "Failed to extract pricing information from live HTML" });
  }
}
