'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildProductRow, buildCategoryLookup, run } = require('./sync_deltron');
const { CATEGORY_MAP } = require('./deltronCategoryMap');

function loadFixture() {
  const buffer = fs.readFileSync(
    path.join(__dirname, 'test', 'fixtures', 'deltron_price_list_sample.csv')
  );
  return buffer.toString('latin1');
}

// Fake de Supabase compartido entre los tests end-to-end de run(): captura
// lo que se inserta/actualiza en sync_log y lo que se upsertea en products,
// siguiendo el mismo patrón que sync_compudiskett.test.js.
function makeFakeSupabase({ callOrder }) {
  const upsertedChunks = [];
  let finishArgs = null;
  const categoryRows = Object.keys(CATEGORY_MAP).map((name, i) => ({ id: `cat-${i}`, name }));

  const supabase = {
    from(table) {
      if (table === 'suppliers') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { id: 'sup-1', prices_include_igv: false }, error: null }),
            }),
          }),
        };
      }
      if (table === 'categories') {
        return { select: async () => ({ data: categoryRows, error: null }) };
      }
      if (table === 'sync_log') {
        return {
          insert: () => {
            callOrder.push('sync_log_insert');
            return { select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }) };
          },
          update: (payload) => ({
            eq: async () => {
              finishArgs = payload;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'products') {
        return {
          upsert: async (rows) => {
            upsertedChunks.push(rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Tabla inesperada en fake supabase: ${table}`);
    },
  };

  return {
    supabase,
    upsertedChunks,
    getFinishArgs: () => finishArgs,
  };
}

test('run: abre sync_log antes de traer el CSV, upsertea products sin final_price y loguea éxito', async () => {
  const callOrder = [];
  const { supabase, upsertedChunks, getFinishArgs } = makeFakeSupabase({ callOrder });

  const fakeGetCsvText = async () => {
    callOrder.push('get_csv_text');
    return loadFixture();
  };

  await run({ supabaseClient: supabase, getCsvText: fakeGetCsvText });

  assert.deepEqual(callOrder, ['sync_log_insert', 'get_csv_text']);

  const allUpserted = upsertedChunks.flat();
  assert.ok(allUpserted.length > 0, 'debe upsertear al menos una fila');
  for (const row of allUpserted) {
    assert.equal('final_price' in row, false);
  }
  // El fixture tiene 2 filas de "MONITOR PLANO 27" (mapea a Monitores) y 1
  // de "CPU CI5 14XXX S1700" (sin mapeo local, se omite) y 1 con precio
  // centinela (se omite).
  assert.equal(allUpserted.length, 2);

  const finishArgs = getFinishArgs();
  assert.equal(finishArgs.status, 'success');
  assert.equal(finishArgs.items_synced, 2);
});

test('run: un CSV sin filas de datos reconocibles se loguea como "failed", no como éxito silencioso', async () => {
  const callOrder = [];
  const { supabase, getFinishArgs } = makeFakeSupabase({ callOrder });

  // Tiene un TIPO DE CAMBIO válido (para no fallar antes por ese lado) y el
  // separador de bloque, pero ninguna fila de datos real: simula que
  // Deltron cambió el formato del archivo y ya no hay nada reconocible que
  // parsear.
  const garbageCsv =
    ',"TIPO DE CAMBIO :3.380"\n"_______________","_______________","__________________________________","__________"\n';
  const fakeGetCsvText = async () => garbageCsv;

  await assert.rejects(
    () => run({ supabaseClient: supabase, getCsvText: fakeGetCsvText }),
    /0 filas procesadas/
  );

  const finishArgs = getFinishArgs();
  assert.equal(finishArgs.status, 'failed');
  assert.equal(finishArgs.items_synced, 0);
});

test('run: sin getCsvText inyectado, lee el archivo real de csvFilePath (readLocalPriceList real)', async () => {
  const callOrder = [];
  const { supabase, upsertedChunks } = makeFakeSupabase({ callOrder });
  const fixturePath = path.join(__dirname, 'test', 'fixtures', 'deltron_price_list_sample.csv');

  await run({ supabaseClient: supabase, csvFilePath: fixturePath });

  const allUpserted = upsertedChunks.flat();
  assert.equal(allUpserted.length, 2, 'debe leer y procesar el fixture real desde disco, sin fakes de CSV');
});

test('buildCategoryLookup invierte el mapa: categoría de Deltron -> nuestra categoría', () => {
  const lookup = buildCategoryLookup({
    Monitores: ['MONITOR PLANO 27', 'MONITOR CURVO 27'],
    Impresoras: ['IMPRESORA LASER/LED'],
  });
  assert.equal(lookup.get('MONITOR PLANO 27'), 'Monitores');
  assert.equal(lookup.get('MONITOR CURVO 27'), 'Monitores');
  assert.equal(lookup.get('IMPRESORA LASER/LED'), 'Impresoras');
  assert.equal(lookup.get('CPU CI5 14XXX S1700'), undefined);
});

test('buildProductRow arma la fila de products sin final_price, con part_number null y stock real', () => {
  const row = buildProductRow(
    {
      category: 'MONITOR PLANO 27',
      codigo: 'montest0001',
      descripcion: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
      stock: { qty: 3, status: 'low_stock' },
      priceUsd: 150.0,
      marca: 'marca test',
    },
    { categoryId: 'cat-1', supplierId: 'sup-1', tcm: 3.38, pricesIncludeIgv: false }
  );

  assert.ok(row.last_synced_at, 'debe incluir last_synced_at');
  assert.equal(typeof row.last_synced_at, 'string');
  const { last_synced_at, ...rest } = row;

  assert.deepEqual(rest, {
    model: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
    part_number: null,
    brand: 'marca test',
    category_id: 'cat-1',
    supplier_id: 'sup-1',
    supplier_sku: 'montest0001',
    cost: 507.0,
    cost_includes_igv: false,
    stock_qty: 3,
    stock_status: 'low_stock',
    source_type: 'web_sync',
    confidence: 'high',
  });
  assert.equal('final_price' in row, false);
});
