'use strict';

const { CompudiskettSession } = require('./lib/compudiskettClient');
const {
  parseTipoCambio,
  parsePageInfo,
  parseProductCards,
  splitModelAndPartNumber,
} = require('./lib/parseCompudiskettCatalog');
const { CATEGORY_MAP } = require('./compudiskettCategoryMap');
const { round2 } = require('./pricingEngine');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./lib/syncCommon');

const SUPPLIER_NAME = 'Compudiskett';

async function fetchAllCardsForKey(session, buscarKey) {
  await session.setPage(1);
  const allCards = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    const html = await session.fetchCategoryPage(buscarKey);
    const info = parsePageInfo(html);
    currentPage = info.currentPage;
    totalPages = info.totalPages;
    allCards.push(...parseProductCards(html));

    if (currentPage < totalPages) {
      await session.setPage(currentPage + 1);
    }
  } while (currentPage < totalPages);

  return allCards;
}

function buildProductRow(card, { categoryId, supplierId, tcm, pricesIncludeIgv }) {
  const { model, partNumber } = splitModelAndPartNumber(card.rawName);
  return {
    model,
    part_number: partNumber,
    brand: card.brand,
    category_id: categoryId,
    supplier_id: supplierId,
    supplier_sku: card.supplierSku,
    cost: round2(card.priceUsd * tcm),
    cost_includes_igv: pricesIncludeIgv,
    source_type: 'web_sync',
    confidence: 'high',
  };
}

async function run() {
  const supabase = getSupabaseClient();

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (supplierError) throw supplierError;

  const logId = await logSyncStart(supabase, supplier.id);
  const session = new CompudiskettSession();

  try {
    const categoryIdByName = await getCategoryIdMap(supabase);

    const tcmRaw = await session.fetchTipoCambio();
    const tcm = parseTipoCambio(tcmRaw);

    const rows = [];
    let skippedCategories = 0;

    for (const [ourCategoryName, buscarKeys] of Object.entries(CATEGORY_MAP)) {
      const categoryId = categoryIdByName.get(ourCategoryName);
      if (!categoryId) {
        skippedCategories += 1;
        continue;
      }
      for (const buscarKey of buscarKeys) {
        const cards = await fetchAllCardsForKey(session, buscarKey);
        for (const card of cards) {
          rows.push(
            buildProductRow(card, {
              categoryId,
              supplierId: supplier.id,
              tcm,
              pricesIncludeIgv: supplier.prices_include_igv,
            })
          );
        }
      }
    }

    const { error: upsertError } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'supplier_id,supplier_sku' });
    if (upsertError) throw upsertError;

    await logSyncFinish(supabase, logId, {
      status: 'success',
      itemsSynced: rows.length,
      message:
        skippedCategories > 0
          ? `${skippedCategories} categoría(s) local(es) sin mapeo en Compudiskett, omitidas.`
          : null,
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

module.exports = { run, fetchAllCardsForKey, buildProductRow };
