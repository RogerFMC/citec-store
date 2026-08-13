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
const UPSERT_CHUNK_SIZE = 500;

// Recorre todas las páginas de un buscarKey. Se protege contra paginación
// que no avanza (sesión/cookie atascada del lado del servidor) con dos
// líneas de defensa: (1) si currentPage no supera a la página anterior se
// aborta de inmediato, (2) un tope duro de iteraciones por si el servidor
// reporta páginas que sí cambian pero nunca llegan a totalPages.
async function fetchAllCardsForKey(session, buscarKey) {
  await session.setPage(1);
  const allCards = [];
  let skipped = 0;
  let currentPage = 1;
  let totalPages = 1;
  let previousPage = 0;
  let iterations = 0;

  do {
    const html = await session.fetchCategoryPage(buscarKey);
    const info = parsePageInfo(html);
    currentPage = info.currentPage;
    totalPages = info.totalPages;
    iterations += 1;

    if (currentPage <= previousPage) {
      throw new Error(`Paginación no avanza para "${buscarKey}": se quedó en la página ${currentPage}`);
    }
    if (iterations > totalPages + 2) {
      throw new Error(`Paginación no avanza para "${buscarKey}": se quedó en la página ${currentPage}`);
    }
    previousPage = currentPage;

    const { cards, skipped: skippedOnPage } = parseProductCards(html);
    allCards.push(...cards);
    skipped += skippedOnPage;

    if (currentPage < totalPages) {
      await session.setPage(currentPage + 1);
    }
  } while (currentPage < totalPages);

  return { cards: allCards, skipped };
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
    last_synced_at: new Date().toISOString(),
  };
}

async function run({ supabaseClient, session: injectedSession } = {}) {
  const supabase = supabaseClient || getSupabaseClient();

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (supplierError) throw supplierError;

  const logId = await logSyncStart(supabase, supplier.id);
  const session = injectedSession || new CompudiskettSession();

  try {
    const categoryIdByName = await getCategoryIdMap(supabase);

    const tcmRaw = await session.fetchTipoCambio();
    const tcm = parseTipoCambio(tcmRaw);

    const rows = [];
    let skippedCategories = 0;
    let skippedCards = 0;
    const keyErrors = [];
    let attemptedKeys = 0;

    for (const [ourCategoryName, buscarKeys] of Object.entries(CATEGORY_MAP)) {
      const categoryId = categoryIdByName.get(ourCategoryName);
      if (!categoryId) {
        skippedCategories += 1;
        continue;
      }
      for (const buscarKey of buscarKeys) {
        attemptedKeys += 1;
        try {
          const { cards, skipped } = await fetchAllCardsForKey(session, buscarKey);
          skippedCards += skipped;
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
        } catch (keyErr) {
          keyErrors.push(`"${buscarKey}": ${keyErr.message}`);
        }
      }
    }

    // Deduplicar por supplier_sku (última tarjeta gana) para evitar un error
    // de cardinalidad en el upsert si el mismo SKU aparece bajo dos
    // buscarKey distintos.
    const dedupedRows = [...new Map(rows.map((r) => [r.supplier_sku, r])).values()];

    for (let i = 0; i < dedupedRows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = dedupedRows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('products')
        .upsert(chunk, { onConflict: 'supplier_id,supplier_sku' });
      if (upsertError) throw upsertError;
    }

    const messageParts = [];
    if (skippedCategories > 0) {
      messageParts.push(`${skippedCategories} categoría(s) local(es) sin mapeo en Compudiskett, omitidas.`);
    }
    if (skippedCards > 0) {
      messageParts.push(`${skippedCards} tarjeta(s) de producto sin SKU o precio parseable, omitidas.`);
    }
    if (keyErrors.length > 0) {
      messageParts.push(`${keyErrors.length} búsqueda(s) fallaron: ${keyErrors.join('; ')}`);
    }

    let status = 'success';
    if (keyErrors.length > 0) {
      status = keyErrors.length >= attemptedKeys && dedupedRows.length === 0 ? 'failed' : 'partial';
    }

    await logSyncFinish(supabase, logId, {
      status,
      itemsSynced: dedupedRows.length,
      message: messageParts.length > 0 ? messageParts.join(' ') : null,
    });

    if (status === 'failed') {
      const failedErr = new Error(messageParts.join(' ') || 'La sincronización falló para todas las categorías.');
      failedErr.alreadyLogged = true;
      throw failedErr;
    }
  } catch (err) {
    if (!err.alreadyLogged) {
      await logSyncFinish(supabase, logId, { status: 'failed', itemsSynced: 0, message: err.message });
    }
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
