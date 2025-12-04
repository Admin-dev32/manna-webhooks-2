export default async function handler(req, res) {
  try {
    const url = "https://manna-webhooks-2.vercel.app/";
    const html = await fetch(url).then((r) => r.text());

    // ---- Helpers para extraer constantes del <script> ----
    const extractObj = (key) => {
      // Busca: const KEY = { ... };
      const regex = new RegExp(
        `const\\s+${key}\\s*=\\s*({[\\s\\S]*?})\\s*[;\\n]`
      );
      const match = html.match(regex);
      if (!match) return null;
      try {
        // Evaluar solo el objeto, en un scope aislado
        // (no ejecuta el resto del script)
        // eslint-disable-next-line no-new-func
        return Function('"use strict"; return (' + match[1] + ");")();
      } catch {
        return null;
      }
    };

    const extractNum = (key) => {
      const regex = new RegExp(`const\\s+${key}\\s*=\\s*(\\d+(?:\\.\\d+)?)`);
      const match = html.match(regex);
      return match ? Number(match[1]) : null;
    };

    // ---- 1. Lo que SÍ existe ahora en el HTML ----
    const bar_meta = extractObj("BAR_META") || {};
    const full_payment_discount = extractNum("FULL_FLAT_OFF");

    // ---- 2. Construir arreglo de barras a partir de BAR_META + HTML ----
    const barsFromHtml = Array.from(
      html.matchAll(
        /<label class="choice bar-card"[^>]*data-bar="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g
      )
    ).map(([_, id, inner]) => {
      const titleHtml =
        (inner.match(/<div class="title">(.*?)<\/div>/) || [])[1] || "";
      const tagHtml =
        (inner.match(/<div class="tag"[^>]*>(.*?)<\/div>/) || [])[1] || "";
      const descHtml =
        (inner.match(/<div class="desc">(.*?)<\/div>/) || [])[1] || "";
      const detailsHtml =
        (inner.match(/<div class="details">(.*?)<\/div>/) || [])[1] || "";

      const clean = (s) => s.replace(/<[^>]+>/g, "").trim();

      const meta = bar_meta[id] || {};

      return {
        id,
        title: clean(titleHtml) || meta.title || "",
        tag: clean(tagHtml),
        desc: clean(descHtml),
        details: clean(detailsHtml),
        // priceAdd en BAR_META (ej. Tostiloco +$50)
        add: meta.priceAdd || 0,
      };
    });

    // Si por alguna razón no encontramos nada en el HTML, caemos al objeto
    const bars =
      barsFromHtml.length > 0
        ? barsFromHtml
        : Object.entries(bar_meta).map(([id, meta]) => ({
            id,
            title: meta.title || "",
            tag: "",
            desc: "",
            details: "",
            add: meta.priceAdd || 0,
          }));

    // ---- 3. Extras / add-ons desde el HTML ----
    const addons = Array.from(
      html.matchAll(/<div class="add-on-row">([\s\S]*?)<\/div>\s*<\/div>/g)
    ).map(([_, block]) => {
      const rawTitle =
        (block.match(/<div class="title"[^>]*>(.*?)<\/div>/) || [])[1] || "";
      const rawCopy =
        (block.match(/<div class="copy"[^>]*>(.*?)<\/div>/) || [])[1] || "";
      const rawPrice =
        (block.match(/<div class="price"[^>]*>(.*?)<\/div>/) || [])[1] || "";

      const clean = (s) => s.replace(/<[^>]+>/g, "").trim();

      return {
        title: clean(rawTitle),
        copy: clean(rawCopy),
        priceText: clean(rawPrice), // texto tal cual se ve (ej. "$325.00 • 120 guests • 2 hrs")
      };
    });

    // ---- 4. Respuesta unificada ----
    const data = {
      source: url,
      pricing_mode: "dynamic-from-widget", // IMPORTANTE para tu GPT
      // Estas tablas ya no existen en el HTML actual; las marcamos como null
      base_prices: null,
      second_discount: null,
      fountain_price: null,
      // Lo que sí es real:
      full_payment_discount, // normalmente 20
      bar_meta,
      bars,
      addons,
    };

    res.status(200).json(data);
  } catch (err) {
    console.error("Error reading pricing data:", err);
    res
      .status(500)
      .json({ error: "Failed to extract pricing information from live HTML" });
  }
}
