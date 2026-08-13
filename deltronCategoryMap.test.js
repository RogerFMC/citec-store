'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_MAP } = require('./deltronCategoryMap');

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

test('ninguna categoría de Deltron se repite entre nuestras categorías', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('todas las claves de Deltron están en mayúsculas (deben calzar con categoría.toUpperCase() del CSV)', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  for (const key of allKeys) {
    assert.equal(key, key.toUpperCase(), `"${key}" debería estar en mayúsculas`);
  }
});

test('cada categoría tiene al menos una entrada', () => {
  for (const keys of Object.values(CATEGORY_MAP)) {
    assert.ok(keys.length > 0);
  }
});
