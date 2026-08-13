'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeLatin1, fetchPriceList, PRICE_LIST_PATH } = require('./deltronClient');

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
