import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  try {
    // Ruta absoluta hacia el index.html dentro de /public
    const htmlPath = path.join(process.cwd(), "public", "index.html");
    const html = fs.readFileSync(htmlPath, "utf-8");

    // Extrae los objetos de precios del <script> usando regex
    const basePricesMatch = html.match(/const BASE_PRICES\s*=\s*({[\s\S]*?});/);
    const barMetaMatch = html.match(/const BAR_META\s*=\s*({[\s\S]*?});/);
    const secondDiscountMatch = html.match(/const SECOND_DISCOUNT\s*=\s*({[\s\S]*?});/);
    const fountainPriceMatch = html.match(/const FOUNTAIN_PRICE\s*=\s*({[\s\S]*?});/);
    const fullFlatOffMatch = html.match(/const FULL_FLAT_OFF\s*=\s*(\d+)/);

    const data = {
      base_prices: basePricesMatch ? eval(`(${basePricesMatch[1]})`) : {},
      bar_meta: barMetaMatch ? eval(`(${barMetaMatch[1]})`) : {},
      second_discount: secondDiscountMatch ? eval(`(${secondDiscountMatch[1]})`) : {},
      fountain_price: fountainPriceMatch ? eval(`(${fountainPriceMatch[1]})`) : {},
      full_payment_discount: fullFlatOffMatch ? parseInt(fullFlatOffMatch[1]) : 0,
      source: "/public/index.html"
    };

    res.status(200).json(data);
  } catch (error) {
    console.error("Error reading HTML:", error);
    res.status(500).json({ error: "Failed to load prices from index.html" });
  }
}
