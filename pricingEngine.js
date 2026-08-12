'use strict';

const IGV_RATE = 0.18;

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Debe mantenerse en sync con la función Postgres public.compute_final_price()
 * (ver schema.sql) — esa es la que realmente calcula products.final_price en
 * cada insert/update vía el trigger trg_compute_final_price. Esta función es
 * para pruebas/uso fuera de la base de datos, no para escribir final_price.
 */
function computeFinalPrice({
  cost,
  costIncludesIgv = false,
  pricingMode = 'wholesale_cost',
  marginPct = 0,
  fixedChargeSoles = 5,
}) {
  if (typeof cost !== 'number' || cost < 0) {
    throw new Error('cost must be a non-negative number');
  }

  if (pricingMode === 'final_price') {
    return round2(cost + fixedChargeSoles);
  }

  const costWithIgv = costIncludesIgv ? cost : round2(cost * (1 + IGV_RATE));
  return round2(costWithIgv * (1 + (marginPct || 0) / 100) + fixedChargeSoles);
}

module.exports = { computeFinalPrice, round2, IGV_RATE };
