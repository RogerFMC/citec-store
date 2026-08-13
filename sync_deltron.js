'use strict';

const { fetchPriceList } = require('./lib/deltronClient');
const { parseTipoCambio, parsePriceListRows } = require('./lib/parseDeltronPriceList');
const { CATEGORY_MAP } = require('./deltronCategoryMap');
const { round2 } = require('./pricingEngine');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./lib/syncCommon');

const SUPPLIER_NAME = 'Deltron';
const UPSERT_CHUNK_SIZE = 500;

function buildCategoryLookup(categoryMap) {
  const lookup = new Map();
  for (const [ourCategoryName, deltronCategories] of Object.entries(categoryMap)) {
    for (const deltronCategory of deltronCategories) {
      lookup.set(deltronCategory, ourCategoryName);
    }
  }
  return lookup;
}

function buildProductRow(row, { categoryId, supplierId, tcm, pricesIncludeIgv }) {
  return {
    model: row.descripcion,
    part_number: null,
    brand: row.marca,
    category_id: categoryId,
    supplier_id: supplierId,
    supplier_sku: row.codigo,
    cost: round2(row.priceUsd * tcm),
    cost_includes_igv: pricesIncludeIgv,
    stock_qty: row.stock.qty,
    stock_status: row.stock.status,
    source_type: 'web_sync',
    confidence: 'high',
    last_synced_at: new Date().toISOString(),
  };
}

async function run({ supabaseClient, credentials, fetchPriceList: fetchPriceListFn } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const username = credentials?.username ?? process.env.DELTRON_USERNAME;
  const password = credentials?.password ?? process.env.DELTRON_PASSWORD;
  const doFetchPriceList = fetchPriceListFn || fetchPriceList;

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (supplierError) throw supplierError;

  const logId = await logSyncStart(supabase, supplier.id);

  try {
    const categoryIdByName = await getCategoryIdMap(supabase);
    const categoryLookup = buildCategoryLookup(CATEGORY_MAP);

    const csvText = await doFetchPriceList({ username, password });
    const tcm = parseTipoCambio(csvText);
    const { rows, skippedNoPrice, skippedMalformed } = parsePriceListRows(csvText);

    // Este sync trae el catálogo completo en una sola petición (a diferencia
    // de Compudiskett, que hace muchas peticiones independientes por
    // categoría y puede reportar fallas parciales). Si no se parseó
    // absolutamente nada -- ni filas útiles ni omisiones contadas -- es
    // señal fuerte de que Deltron cambió el formato del archivo, y no debe
    // reportarse como un éxito silencioso de 0 items.
    if (rows.length === 0 && skippedNoPrice === 0 && skippedMalformed === 0) {
      throw new Error('Formato de la lista de precios de Deltron no reconocido: 0 filas procesadas.');
    }

    const productRows = [];
    let skippedCategories = 0;

    for (const row of rows) {
      const ourCategoryName = categoryLookup.get(row.category);
      const categoryId = ourCategoryName ? categoryIdByName.get(ourCategoryName) : undefined;
      if (!categoryId) {
        skippedCategories += 1;
        continue;
      }
      productRows.push(
        buildProductRow(row, {
          categoryId,
          supplierId: supplier.id,
          tcm,
          pricesIncludeIgv: supplier.prices_include_igv,
        })
      );
    }

    const dedupedRows = [...new Map(productRows.map((r) => [r.supplier_sku, r])).values()];

    for (let i = 0; i < dedupedRows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = dedupedRows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('products')
        .upsert(chunk, { onConflict: 'supplier_id,supplier_sku' });
      if (upsertError) throw upsertError;
    }

    const messageParts = [];
    if (skippedCategories > 0) {
      messageParts.push(`${skippedCategories} fila(s) de categoría(s) de Deltron sin mapeo local, omitidas.`);
    }
    if (skippedNoPrice > 0) {
      messageParts.push(`${skippedNoPrice} fila(s) sin precio fijo (cotización o dato inválido), omitidas.`);
    }
    if (skippedMalformed > 0) {
      messageParts.push(`${skippedMalformed} fila(s) con precio en formato inesperado, omitidas.`);
    }

    await logSyncFinish(supabase, logId, {
      status: 'success',
      itemsSynced: dedupedRows.length,
      message: messageParts.length > 0 ? messageParts.join(' ') : null,
    });
  } catch (err) {
    await logSyncFinish(supabase, logId, { status: 'failed', itemsSynced: 0, message: err.message });
    throw err;
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { run, buildProductRow, buildCategoryLookup };
