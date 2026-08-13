'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductRow, fetchAllCardsForKey, run } = require('./sync_compudiskett');

test('buildProductRow arma la fila de products sin final_price, con last_synced_at fresco', () => {
  const row = buildProductRow(
    { supplierSku: '0603-020113', brand: 'AMD', rawName: 'CPU AMD RYZEN 7 5700G AM4 100-100000263BOX', priceUsd: 346.0 },
    { categoryId: 'cat-1', supplierId: 'sup-1', tcm: 3.38, pricesIncludeIgv: false }
  );
  assert.ok(row.last_synced_at, 'debe incluir last_synced_at');
  assert.equal(typeof row.last_synced_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(row.last_synced_at)), 'last_synced_at debe ser una fecha ISO válida');
  const { last_synced_at, ...rest } = row;
  assert.deepEqual(rest, {
    model: 'CPU AMD RYZEN 7 5700G AM4',
    part_number: '100-100000263BOX',
    brand: 'AMD',
    category_id: 'cat-1',
    supplier_id: 'sup-1',
    supplier_sku: '0603-020113',
    cost: 1169.48,
    cost_includes_igv: false,
    source_type: 'web_sync',
    confidence: 'high',
  });
  assert.equal('final_price' in row, false);
});

test('fetchAllCardsForKey junta las tarjetas de todas las páginas', async () => {
  const calls = { setPage: [], fetchCategoryPage: [] };
  const fakeSession = {
    setPage: async (n) => calls.setPage.push(n),
    fetchCategoryPage: async (key) => {
      calls.fetchCategoryPage.push(key);
      const page = calls.setPage.length; // página actual tras el último setPage
      if (page <= 1) {
        return '<span id="pag_rig">Página 1 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-A\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO A</span></div><div class="alert-danger text-decoration-line-through">$10.00</div></div>';
      }
      return '<span id="pag_rig">Página 2 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-B\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO B</span></div><div class="alert-info text-decoration-line-through">$20.00</div></div>';
    },
  };

  const { cards, skipped } = await fetchAllCardsForKey(fakeSession, ' IMPRESION  ');
  assert.equal(cards.length, 2);
  assert.equal(skipped, 0);
  assert.equal(cards[0].supplierSku, 'SKU-A');
  assert.equal(cards[1].supplierSku, 'SKU-B');
  assert.deepEqual(calls.setPage, [1, 2]);
});

test('fetchAllCardsForKey devuelve 0 tarjetas sin lanzar cuando la categoría está vacía', async () => {
  const fakeSession = {
    setPage: async () => {},
    fetchCategoryPage: async () =>
      '<div class="alert alert-info text-center fs-3 mt-8" role="alert">No tenemos información de su búsqueda.</div>',
  };

  const { cards, skipped } = await fetchAllCardsForKey(fakeSession, ' EQUIPOS INFORMATICOS/DESKTOP  ');
  assert.deepEqual({ cards, skipped }, { cards: [], skipped: 0 });
});

test('fetchAllCardsForKey lanza error si la paginación no avanza', async () => {
  const fakeSession = {
    setPage: async () => {},
    // Siempre reporta la página 1, nunca avanza (sesión/cookie atascada).
    fetchCategoryPage: async () =>
      '<span id="pag_rig">Página 1 -  8 de 218 Resultados </span>',
  };

  await assert.rejects(
    () => fetchAllCardsForKey(fakeSession, 'TARJETAS DE VIDEO'),
    /no avanza/
  );
});

test('run: si un buscarKey falla no descarta las filas de las demás y el log queda "partial"', async () => {
  const originalCategoryMap = require('./compudiskettCategoryMap').CATEGORY_MAP;
  // No mutamos CATEGORY_MAP real; en su lugar probamos el comportamiento
  // end-to-end usando fakes de supabase/session inyectados vía módulo.
  // Este test usa las dependencias reales del módulo pero con un cliente
  // supabase falso y una sesión falsa cuyo comportamiento depende de la key.
  const cardHtmlFor = (sku, name, price, page, totalPages, totalResults) =>
    `<span id="pag_rig">Página ${page} -  ${totalPages} de ${totalResults} Resultados </span>` +
    `<div class="card p-1"><a onclick="busqueda_general('bus_rapida', ' ', ' ', '${sku}')"></a>` +
    `<div class="card-title"><span class="text-dark">MARCA</span></div>` +
    `<div class="card-title"><span class="fw-medium">${name}</span></div>` +
    `<div class="alert-danger text-decoration-line-through">$${price}</div></div>`;

  const categoryNames = Object.keys(originalCategoryMap);
  const goodCategoryName = categoryNames[0];
  const badCategoryName = categoryNames.find((n) => n !== goodCategoryName) || categoryNames[0];
  const badKey = originalCategoryMap[badCategoryName][originalCategoryMap[badCategoryName].length - 1];

  const categoryRows = categoryNames.map((name, i) => ({ id: `cat-${i}`, name }));

  const upsertedChunks = [];
  let finishArgs = null;

  const fakeSupabase = {
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
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }),
          }),
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

  const fakeSession = {
    setPage: async () => {},
    fetchTipoCambio: async () => 'TCM:3.5',
    fetchCategoryPage: async (key) => {
      if (key === badKey) {
        throw new Error('Compudiskett respondió 500 en /consultas/cdk_consultas/c_productos.php');
      }
      return cardHtmlFor('SKU-OK', 'PRODUCTO OK', '10.00', 1, 1, 1);
    },
  };

  await run({ supabaseClient: fakeSupabase, session: fakeSession });

  const totalUpserted = upsertedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  assert.ok(totalUpserted > 0, 'las filas de las keys que sí funcionaron deben upsertearse');
  assert.equal(finishArgs.status, 'partial');
  assert.match(finishArgs.message, /fallaron/);
});
