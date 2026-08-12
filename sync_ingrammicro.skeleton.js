'use strict';

/**
 * PROVEEDOR EN PAUSA — no ejecutar en producción todavía.
 *
 * Ingram Micro Perú (https://pe.ingrammicro.com/cep/app/my/dashboard) es una
 * SPA detrás de login. Roger quiere esperar a que confirmen si ofrecen
 * API/feed propio antes de considerar scraping con Playwright (que además
 * requeriría un login manual inicial para persistir la sesión/cookies).
 *
 * Este archivo existe como PATRÓN de referencia para los sincronizadores
 * reales (Compudiskett, Deltron): estructura de env vars, ciclo de vida de
 * sync_log, y el contrato de qué columnas escribe un sync en `products`.
 * No dupliques el cálculo de precio aquí: el trigger `trg_compute_final_price`
 * en Postgres es quien calcula `final_price` (ver schema.sql / pricingEngine.js).
 */

const { createClient } = require('@supabase/supabase-js');

const SUPPLIER_NAME = 'Ingram Micro Perú';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios (nunca hardcodear).');
  }
  // service_role: no está sujeto a RLS ni a los grants de anon/authenticated.
  return createClient(url, serviceRoleKey);
}

async function getSupplierId(supabase) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, pricing_mode, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (error) throw error;
  return data;
}

async function getCategoryMap(supabase) {
  const { data, error } = await supabase.from('categories').select('id, name');
  if (error) throw error;
  return new Map(data.map((c) => [c.name, c.id]));
}

/**
 * PAUSADO. Placeholder de dónde iría la extracción real (Playwright,
 * login manual la primera vez para guardar el estado de sesión, luego
 * navegación del catálogo). No implementar hasta que Roger confirme si
 * hay API/feed alternativo.
 */
async function fetchCatalog() {
  throw new Error(
    'sync_ingrammicro está en pausa — confirmar con Roger API/feed antes de automatizar el portal (ver sección 5 de las instrucciones).'
  );
}

/**
 * Mapea un item crudo del proveedor a las columnas que un script de sync
 * debe escribir en `products`. No incluye final_price: eso lo calcula el
 * trigger de Postgres a partir de cost / cost_includes_igv / category_id /
 * supplier_id.
 */
function mapToProductRow(rawItem, { supplierId, pricesIncludeIgv, categoryMap }) {
  const categoryId = categoryMap.get(rawItem.categoryName);
  if (!categoryId) {
    throw new Error(`Categoría desconocida en catálogo del proveedor: "${rawItem.categoryName}"`);
  }
  return {
    model: rawItem.model,
    part_number: rawItem.partNumber ?? null,
    brand: rawItem.brand,
    description: rawItem.description ?? null,
    category_id: categoryId,
    supplier_id: supplierId,
    cost: rawItem.cost,
    cost_includes_igv: pricesIncludeIgv,
    stock_qty: rawItem.stockQty ?? null,
    stock_status: rawItem.stockStatus ?? 'unknown',
    source_type: 'web_sync',
    confidence: 'high',
  };
}

async function logSyncStart(supabase, supplierId) {
  const { data, error } = await supabase
    .from('sync_log')
    .insert({ supplier_id: supplierId, status: 'partial', started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function logSyncFinish(supabase, logId, { status, itemsSynced, message }) {
  const { error } = await supabase
    .from('sync_log')
    .update({
      status,
      items_synced: itemsSynced,
      message: message ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', logId);
  if (error) throw error;
}

async function run() {
  const supabase = getSupabaseClient();
  const supplier = await getSupplierId(supabase);
  const categoryMap = await getCategoryMap(supabase);
  const logId = await logSyncStart(supabase, supplier.id);

  try {
    const rawItems = await fetchCatalog();
    const rows = rawItems.map((item) =>
      mapToProductRow(item, {
        supplierId: supplier.id,
        pricesIncludeIgv: supplier.prices_include_igv,
        categoryMap,
      })
    );

    // NOTA: `products` hoy no tiene una unique constraint (ej. supplier_id +
    // part_number/SKU del proveedor) que permita un upsert idempotente por
    // conflicto. Antes de implementar un sync real hay que resolver esto
    // (ver aviso a Roger) o el upsert de abajo insertará duplicados en cada
    // corrida en lugar de actualizar.
    const { error } = await supabase.from('products').upsert(rows);
    if (error) throw error;

    await logSyncFinish(supabase, logId, { status: 'success', itemsSynced: rows.length });
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

module.exports = { run, mapToProductRow, getSupplierId, getCategoryMap };
