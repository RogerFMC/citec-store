'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductRow, fetchAllCardsForKey } = require('./sync_compudiskett');

test('buildProductRow arma la fila de products sin final_price', () => {
  const row = buildProductRow(
    { supplierSku: '0603-020113', brand: 'AMD', rawName: 'CPU AMD RYZEN 7 5700G AM4 100-100000263BOX', priceUsd: 346.0 },
    { categoryId: 'cat-1', supplierId: 'sup-1', tcm: 3.38, pricesIncludeIgv: false }
  );
  assert.deepEqual(row, {
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
        return '<span id="pag_rig">Página 1 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-A\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO A</span></div><div class="alert-danger">$10.00</div></div>';
      }
      return '<span id="pag_rig">Página 2 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-B\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO B</span></div><div class="alert-danger">$20.00</div></div>';
    },
  };

  const cards = await fetchAllCardsForKey(fakeSession, ' IMPRESION  ');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].supplierSku, 'SKU-A');
  assert.equal(cards[1].supplierSku, 'SKU-B');
  assert.deepEqual(calls.setPage, [1, 2]);
});
