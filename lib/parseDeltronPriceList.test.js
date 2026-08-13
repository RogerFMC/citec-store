'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTipoCambio, parseStockInfo } = require('./parseDeltronPriceList');

test('parseTipoCambio lee "TIPO DE CAMBIO :3.380" como 3.38', () => {
  assert.equal(parseTipoCambio(',"TIPO DE CAMBIO :3.380"'), 3.38);
});

test('parseTipoCambio soporta espacios extra alrededor de los dos puntos', () => {
  assert.equal(parseTipoCambio('TIPO DE CAMBIO   :  3.5'), 3.5);
});

test('parseTipoCambio lanza si no encuentra el patrón', () => {
  assert.throws(() => parseTipoCambio('sin tipo de cambio aquí'), /tipo de cambio/i);
});

test('parseStockInfo: vacío es out_of_stock con qty 0', () => {
  assert.deepEqual(parseStockInfo(' '), { qty: 0, status: 'out_of_stock' });
  assert.deepEqual(parseStockInfo(''), { qty: 0, status: 'out_of_stock' });
});

test('parseStockInfo: ">20" es in_stock con qty null (cantidad exacta desconocida)', () => {
  assert.deepEqual(parseStockInfo('>20'), { qty: null, status: 'in_stock' });
});

test('parseStockInfo: 1 a 5 unidades es low_stock', () => {
  assert.deepEqual(parseStockInfo('1'), { qty: 1, status: 'low_stock' });
  assert.deepEqual(parseStockInfo('5'), { qty: 5, status: 'low_stock' });
});

test('parseStockInfo: más de 5 unidades exactas es in_stock', () => {
  assert.deepEqual(parseStockInfo('10'), { qty: 10, status: 'in_stock' });
});

test('parseStockInfo: "0" es out_of_stock', () => {
  assert.deepEqual(parseStockInfo('0'), { qty: 0, status: 'out_of_stock' });
});

const fs = require('node:fs');
const path = require('node:path');
const { parsePriceListRows, PRICE_SENTINEL_NO_PRICE } = require('./parseDeltronPriceList');

function loadFixture() {
  const buffer = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'fixtures', 'deltron_price_list_sample.csv')
  );
  return buffer.toString('latin1');
}

test('PRICE_SENTINEL_NO_PRICE es 9999999.99', () => {
  assert.equal(PRICE_SENTINEL_NO_PRICE, 9999999.99);
});

test('parsePriceListRows extrae las filas con precio real del fixture', () => {
  const { rows, skippedNoPrice } = parsePriceListRows(loadFixture());

  assert.equal(rows.length, 3);
  assert.equal(skippedNoPrice, 1);

  assert.deepEqual(rows[0], {
    category: 'MONITOR PLANO 27',
    codigo: 'montest0001',
    descripcion: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
    stock: { qty: null, status: 'in_stock' },
    priceUsd: 150.0,
    marca: 'marca test',
  });

  assert.deepEqual(rows[1], {
    category: 'MONITOR PLANO 27',
    codigo: 'montest0002',
    descripcion: 'monitor de prueba premium 27 4k uhd hdr diseño avanzado',
    stock: { qty: 3, status: 'low_stock' },
    priceUsd: 1250.0,
    marca: 'marca test',
  });

  assert.deepEqual(rows[2], {
    category: 'CPU CI5 14XXX S1700',
    codigo: 'cputest0001',
    descripcion: 'procesador de prueba core i5 generico',
    stock: { qty: 0, status: 'out_of_stock' },
    priceUsd: 320.0,
    marca: 'marca test',
  });
});

test('parsePriceListRows omite y cuenta filas con el precio centinela 9999999.99', () => {
  const { rows, skippedNoPrice } = parsePriceListRows(loadFixture());
  assert.ok(!rows.some((r) => r.codigo === 'gartest0001'));
  assert.equal(skippedNoPrice, 1);
});

test('parsePriceListRows devuelve vacío para un texto sin filas de datos', () => {
  const result = parsePriceListRows(',"LISTA DE PRECIOS DELTRON"\n,"TIPO DE CAMBIO :3.380"\n');
  assert.deepEqual(result, { rows: [], skippedNoPrice: 0 });
});
