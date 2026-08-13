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
