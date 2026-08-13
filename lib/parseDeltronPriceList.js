'use strict';

const { parse } = require('csv-parse/sync');

function parseTipoCambio(rawText) {
  const match = rawText.match(/TIPO DE CAMBIO\s*:\s*([\d.,]+)/);
  if (!match) {
    throw new Error('No se pudo leer el tipo de cambio de la lista de precios de Deltron.');
  }
  return parseFloat(match[1].replace(',', '.'));
}

function parseStockInfo(stockRaw) {
  const trimmed = (stockRaw || '').trim();
  if (trimmed === '') {
    return { qty: 0, status: 'out_of_stock' };
  }
  if (trimmed.startsWith('>')) {
    return { qty: null, status: 'in_stock' };
  }
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n === 0) {
    return { qty: 0, status: 'out_of_stock' };
  }
  if (n <= 5) {
    return { qty: n, status: 'low_stock' };
  }
  return { qty: n, status: 'in_stock' };
}

const PRICE_SENTINEL_NO_PRICE = 9999999.99;

function parsePriceListRows(csvText) {
  // El encabezado del archivo (título, fecha, almacenes, tipo de cambio)
  // tiene comillas mal formadas para un parser CSV estricto (verificado:
  // `,"Generada el :"2026-08-13 11:05:14` — texto pegado directo a una
  // comilla de cierre, sin delimitador). csv-parse lanza
  // "Invalid Closing Quote" si se le pasa el archivo completo. Como el
  // encabezado no tiene filas de datos reales, se recorta el texto para
  // empezar en el primer bloque (que sí es CSV válido) antes de parsear.
  const firstBlockIndex = csvText.indexOf('"_______________"');
  const blocksText = firstBlockIndex >= 0 ? csvText.slice(firstBlockIndex) : csvText;

  const records = parse(blocksText, { relax_column_count: true, skip_empty_lines: true });
  const rows = [];
  let skippedNoPrice = 0;

  for (const record of records) {
    if (record.length !== 9) continue;
    if (record[1] === 'CODIGO') continue; // fila de encabezado de bloque

    const category = (record[0] || '').trim().toUpperCase();
    if (!category) continue;

    const priceUsd = parseFloat(record[4]);
    if (Number.isNaN(priceUsd) || priceUsd === PRICE_SENTINEL_NO_PRICE) {
      skippedNoPrice += 1;
      continue;
    }

    rows.push({
      category,
      codigo: (record[1] || '').trim(),
      descripcion: (record[2] || '').trim(),
      stock: parseStockInfo(record[3]),
      priceUsd,
      marca: (record[8] || '').trim(),
    });
  }

  return { rows, skippedNoPrice };
}

module.exports = { parseTipoCambio, parseStockInfo, parsePriceListRows, PRICE_SENTINEL_NO_PRICE };
