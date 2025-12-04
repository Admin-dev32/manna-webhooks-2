// pricing.js
// Core pricing logic for Manna Snack Bars
// All prices are TAX INCLUDED in this table.

// ---- BASE PRICE TABLE ----
const PRICE_POINTS = [
  { guests: 30,  total: 380 },
  { guests: 50,  total: 390 },
  { guests: 90,  total: 400 },
  { guests: 110, total: 425 },
  { guests: 130, total: 475 },
  { guests: 150, total: 535 },
  { guests: 175, total: 555 },
  { guests: 200, total: 590 },
  { guests: 225, total: 630 },
  { guests: 250, total: 650 } // NEW MAX
];

// Utility: clamp guest count to supported range
function clampGuests(n) {
  const num = Number(n) || 0;
  return Math.max(30, Math.min(250, num));
}

// Utility: round to nearest $5
function roundTo5(amount) {
  return Math.round(amount / 5) * 5;
}

// Get the standard bar total (tax included) from the table,
// using linear interpolation for values that are not in PRICE_POINTS.
function getStandardPrice(guests) {
  const g = clampGuests(guests);

  // Exact/edge matches
  if (g <= PRICE_POINTS[0].guests) return PRICE_POINTS[0].total;
  if (g >= PRICE_POINTS[PRICE_POINTS.length - 1].guests) {
    return PRICE_POINTS[PRICE_POINTS.length - 1].total;
  }

  // Walk the table and interpolate
  for (let i = 0; i < PRICE_POINTS.length - 1; i++) {
    const a = PRICE_POINTS[i];
    const b = PRICE_POINTS[i + 1];

    if (g === a.guests) return a.total;
    if (g === b.guests) return b.total;

    if (g > a.guests && g < b.guests) {
      const ratio = (g - a.guests) / (b.guests - a.guests);
      const interpolated = a.total + ratio * (b.total - a.total);
      return roundTo5(interpolated);
    }
  }

  // Fallback (should not hit)
  return PRICE_POINTS[PRICE_POINTS.length - 1].total;
}

// Main bar price (handles premium logic)
// barType examples: "standard", "snack", "pancake", "maruchan", "tostiloco"
function getMainBarPrice(guests, barType = "standard") {
  const base = getStandardPrice(guests);

  // Tostiloco = premium +$50 flat
  if (String(barType).toLowerCase() === "tostiloco") {
    return roundTo5(base + 50);
  }

  // Other bars use standard price for now
  return roundTo5(base);
}

// Second bar discounted price.
// Uses same base logic but applies a discount.
function getSecondBarPrice(guests, barType = "standard") {
  const g = clampGuests(guests);

  // Base = what that bar would normally cost as main bar
  const basePrice = getMainBarPrice(g, barType);

  // Discount rules
  const pct = g <= 150 ? 0.15 : 0.18; // 15% up to 150, 18% above
  let discount = basePrice * pct;

  // Clamp discount amount
  const MIN_DISCOUNT = 30;
  const MAX_DISCOUNT = 150;
  if (discount < MIN_DISCOUNT) discount = MIN_DISCOUNT;
  if (discount > MAX_DISCOUNT) discount = MAX_DISCOUNT;

  const finalPrice = basePrice - discount;
  return roundTo5(finalPrice);
}

// Optional helper: generic API that "thinks" the price for any bar
// mode: "main" or "second"
function getBarPrice({ guests, barType = "standard", mode = "main" }) {
  if (mode === "second") {
    return getSecondBarPrice(guests, barType);
  }
  return getMainBarPrice(guests, barType);
}

// Export everything you might need
export {
  PRICE_POINTS,
  clampGuests,
  roundTo5,
  getStandardPrice,
  getMainBarPrice,
  getSecondBarPrice,
  getBarPrice
};

// If you need CommonJS instead, use:
// module.exports = {
//   PRICE_POINTS,
//   clampGuests,
//   roundTo5,
//   getStandardPrice,
//   getMainBarPrice,
//   getSecondBarPrice,
//   getBarPrice
// };
