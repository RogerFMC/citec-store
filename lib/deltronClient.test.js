'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { decodeLatin1, decodeUtf8, fetchPriceList, readLocalPriceList, PRICE_LIST_PATH } = require('./deltronClient');

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

test('readLocalPriceList lee y decodifica el archivo local como UTF-8', () => {
  // Verificado contra el archivo real (2026-08-13): el CSV que exporta el
  // portal de Deltron es UTF-8, no Latin-1 como se asumió originalmente.
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'deltron_price_list_sample.csv');
  const text = readLocalPriceList(fixturePath);
  assert.ok(text.includes('TIPO DE CAMBIO'));
  assert.ok(text.includes('diseño'), 'debe decodificar la ñ correctamente (UTF-8, no Latin-1)');
});

test('decodeUtf8 decodifica una ñ codificada en UTF-8 (0xC3 0xB1)', () => {
  const buffer = Buffer.from('diseño', 'utf8');
  assert.equal(decodeUtf8(buffer), 'diseño');
});

test('readLocalPriceList lanza un error claro si el archivo no existe', () => {
  assert.throws(
    () => readLocalPriceList('C:/ruta/que/no/existe/lista.csv'),
    /No se encontró el archivo/
  );
});
