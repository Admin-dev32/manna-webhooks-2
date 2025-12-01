import fs from "fs";
import path from "path";

export default function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), "index.html");
    const html = fs.readFileSync(filePath, "utf8");

    // Busca los precios dentro del HTML con una expresión regular
    const prices = {};
    const regex = /data-bar="([^"]+)"\s+data-price="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      prices[match[1]] = parseFloat(match[2]);
    }

    res.status(200).json({ prices });
  } catch (error) {
    res.status(500).json({ error: "Could not read prices", details: error.message });
  }
}
