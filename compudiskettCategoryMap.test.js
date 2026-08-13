'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_MAP } = require('./compudiskettCategoryMap');

test('tiene exactamente las 7 categorías vigentes de Citec Store', () => {
  const expected = [
    'Laptops y PCs',
    'Impresoras',
    'Suministros',
    'Estabilizadores y UPS',
    'Accesorios y periféricos',
    'Monitores',
    'Tarjetas de video',
  ];
  assert.deepEqual(Object.keys(CATEGORY_MAP).sort(), expected.sort());
});

test('ninguna clave de Compudiskett se repite entre categorías', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('cada categoría tiene al menos una clave no vacía', () => {
  for (const keys of Object.values(CATEGORY_MAP)) {
    assert.ok(keys.length > 0);
    for (const key of keys) assert.ok(key.trim().length > 0);
  }
});
