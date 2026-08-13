'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductRow, buildCategoryLookup, run } = require('./sync_deltron');

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
