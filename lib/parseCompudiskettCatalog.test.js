'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTipoCambio, parsePageInfo, splitModelAndPartNumber } = require('./parseCompudiskettCatalog');

test('parseTipoCambio lee "TCM:3.380" como 3.38', () => {
  assert.equal(parseTipoCambio('TCM:3.380'), 3.38);
});

test('parseTipoCambio soporta espacios extra', () => {
  assert.equal(parseTipoCambio('  TCM:3.5  '), 3.5);
});

test('parseTipoCambio soporta separador de miles con coma', () => {
  assert.equal(parseTipoCambio('TCM:3,380'), 3.38);
});

test('parsePageInfo lee "Página 1 -  8 de 218 Resultados"', () => {
  const html = '<span id="pag_rig">Página 1 -  8 de 218 Resultados </span>';
  assert.deepEqual(parsePageInfo(html), { currentPage: 1, totalPages: 8, totalResults: 218 });
});

test('parsePageInfo lee página 2 de 4', () => {
  const html = '<span id="pag_rig">Página 2 -  4 de 112 Resultados </span>';
  assert.deepEqual(parsePageInfo(html), { currentPage: 2, totalPages: 4, totalResults: 112 });
});

test('splitModelAndPartNumber separa un part number alfanumérico final', () => {
  assert.deepEqual(
    splitModelAndPartNumber('CPU AMD RYZEN 7 5700G AM4 100-100000263BOX'),
    { model: 'CPU AMD RYZEN 7 5700G AM4', partNumber: '100-100000263BOX' }
  );
});

test('splitModelAndPartNumber deja part number null si no hay token final numérico', () => {
  assert.deepEqual(
    splitModelAndPartNumber('MOUSE INALAMBRICO ERGONOMICO'),
    { model: 'MOUSE INALAMBRICO ERGONOMICO', partNumber: null }
  );
});

test('splitModelAndPartNumber no rompe con un solo token', () => {
  assert.deepEqual(splitModelAndPartNumber('WEBCAM'), { model: 'WEBCAM', partNumber: null });
});

const fs = require('node:fs');
const path = require('node:path');
const { parseProductCards } = require('./parseCompudiskettCatalog');

test('parseProductCards extrae las 2 tarjetas del fixture', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'fixtures', 'compudiskett_category_page.html'),
    'utf8'
  );
  const { cards, skipped } = parseProductCards(html);
  assert.equal(cards.length, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(cards[0], {
    supplierSku: '0603-020113',
    brand: 'AMD',
    rawName: 'CPU AMD RYZEN 7 5700G AM4 100-100000263BOX',
    priceUsd: 346.0,
  });
  assert.deepEqual(cards[1], {
    supplierSku: '0603-020140',
    brand: 'AMD',
    rawName: 'CPU AMD RYZEN 5 8400F AM5 100-100001591BOX',
    priceUsd: 164.29,
  });
});

test('parseProductCards devuelve arreglo vacío si no hay tarjetas', () => {
  assert.deepEqual(parseProductCards('<div id="list_product"></div>'), { cards: [], skipped: 0 });
});

test('parseProductCards soporta precios con separador de miles (coma)', () => {
  const html = `
    <div class="card p-1">
      <a onclick="busqueda_general('bus_rapida', ' ', ' ', '0603-099999')" href=""></a>
      <div class="card-title"><span class="text-dark">MARCA</span></div>
      <div class="card-title"><span class="fw-medium">LAPTOP CARISIMA XYZ-123456</span></div>
      <div class="alert-danger text-decoration-line-through">$1,299.00</div>
    </div>
  `;
  const { cards, skipped } = parseProductCards(html);
  assert.equal(skipped, 0);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].priceUsd, 1299.0);
});

test('parseProductCards cuenta como omitidas las tarjetas sin SKU o sin precio parseable', () => {
  const html = `
    <div class="card p-1">
      <div class="card-title"><span class="text-dark">MARCA</span></div>
      <div class="card-title"><span class="fw-medium">SIN SKU</span></div>
      <div class="alert-danger">$10.00</div>
    </div>
    <div class="card p-1">
      <a onclick="busqueda_general('bus_rapida', ' ', ' ', '0603-000001')" href=""></a>
      <div class="card-title"><span class="text-dark">MARCA</span></div>
      <div class="card-title"><span class="fw-medium">SIN PRECIO</span></div>
    </div>
  `;
  const { cards, skipped } = parseProductCards(html);
  assert.equal(cards.length, 0);
  assert.equal(skipped, 2);
});
