'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { decodeLatin1, fetchPriceList, readLocalPriceList, PRICE_LIST_PATH } = require('./deltronClient');

test('decodeLatin1 decodifica correctamente una Ñ (byte 0xD1)', () => {
  const buffer = Buffer.from([0x44, 0x49, 0x53, 0x45, 0xd1, 0x4f]); // "DISE" + 0xD1 + "O"
  assert.equal(decodeLatin1(buffer), 'DISEÑO');
});

test('decodeLatin1 decodifica texto ASCII simple sin cambios', () => {
  const buffer = Buffer.from('TIPO DE CAMBIO :3.380', 'ascii');
  assert.equal(decodeLatin1(buffer), 'TIPO DE CAMBIO :3.380');
});

test('PRICE_LIST_PATH apunta al endpoint real verificado', () => {
  assert.equal(PRICE_LIST_PATH, '/modulos/productos/listaprodnw.php');
});

test('fetchPriceList lanza si faltan usuario o contraseña', async () => {
  await assert.rejects(() => fetchPriceList({}), /DELTRON_USERNAME|usuario/i);
  await assert.rejects(() => fetchPriceList({ username: 'x' }), /DELTRON_PASSWORD|contraseña/i);
});

test('readLocalPriceList lee y decodifica el archivo local como Latin-1', () => {
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'deltron_price_list_sample.csv');
  const text = readLocalPriceList(fixturePath);
  assert.ok(text.includes('TIPO DE CAMBIO'));
  assert.ok(text.includes('diseño'), 'debe decodificar la ñ correctamente (Latin-1, no UTF-8)');
});

test('readLocalPriceList lanza un error claro si el archivo no existe', () => {
  assert.throws(
    () => readLocalPriceList('C:/ruta/que/no/existe/lista.csv'),
    /No se encontró el archivo/
  );
});
