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

test('parsePriceListRows devuelve vacío para un texto con solo el separador de bloque y sin filas de datos', () => {
  const result = parsePriceListRows(
    '"_______________","_______________","__________________________________","__________"\n'
  );
  assert.deepEqual(result, { rows: [], skippedNoPrice: 0, skippedMalformed: 0 });
});

test('parsePriceListRows cuenta como malformadas las líneas de preámbulo cuando no hay separador de bloque en el texto', () => {
  // Caso sintético: si el texto no contiene ningún separador de bloque
  // "_______________", parsePriceListRows usa el texto completo como si
  // fuera la sección de datos (ver comentario sobre el recorte del
  // encabezado), así que cualquier línea de preámbulo con forma de fila
  // corta se cuenta como malformada en vez de descartarse en silencio.
  const result = parsePriceListRows(',"LISTA DE PRECIOS DELTRON"\n,"TIPO DE CAMBIO :3.380"\n');
  assert.deepEqual(result, { rows: [], skippedNoPrice: 0, skippedMalformed: 2 });
});

test('parsePriceListRows omite y cuenta un precio citado con separador de miles (coma) en vez de coercionarlo', () => {
  // "1,766.00" no debe interpretarse como 1 (donde parseFloat se detendría
  // en la coma): debe rechazarse por forma numérica inválida y contarse.
  const csvText =
    '"monitor plano 27","montest0003","monitor de prueba con precio con comas","10","1,766.00", ,"","W","marca test"';
  const { rows, skippedMalformed } = parsePriceListRows(csvText);
  assert.equal(rows.length, 0);
  assert.equal(skippedMalformed, 1);
  assert.ok(!rows.some((r) => r.priceUsd === 1));
});

test('parsePriceListRows cuenta (no descarta silenciosamente) una fila de datos con cantidad de columnas incorrecta', () => {
  // No es el separador estructural "_______________": es una fila de datos
  // real con menos columnas de las esperadas.
  const csvText =
    '"monitor plano 27","montest0004","fila con columnas rotas","10","150.00","extra col"';
  const { rows, skippedMalformed } = parsePriceListRows(csvText);
  assert.equal(rows.length, 0);
  assert.equal(skippedMalformed, 1);
});

test('parsePriceListRows no cuenta el separador de bloque "_______________" como fila malformada', () => {
  const csvText = '"_______________","_______________","__________________________________","__________"';
  const { rows, skippedMalformed, skippedNoPrice } = parsePriceListRows(csvText);
  assert.equal(rows.length, 0);
  assert.equal(skippedMalformed, 0);
  assert.equal(skippedNoPrice, 0);
});

test('parsePriceListRows tolera una comilla suelta sin escapar en la descripción sin abortar el parseo', () => {
  // p.ej. una medida de pantalla como 21.45" mencionada en la descripción
  // sin comillas CSV válidas alrededor.
  const csvText =
    '"monitor plano 27","montest0005","monitor 21.45" fhd","10","199.00", ,"","W","marca test"';
  assert.doesNotThrow(() => parsePriceListRows(csvText));
  const { rows } = parsePriceListRows(csvText);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].codigo, 'montest0005');
  assert.equal(rows[0].priceUsd, 199);
  assert.ok(rows[0].descripcion.includes('21.45'));
});
