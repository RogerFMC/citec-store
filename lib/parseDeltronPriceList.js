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

  // relax_quotes: una descripción con una comilla suelta sin escapar (p.ej.
  // `monitor 21.45" fhd`, una medida de pantalla) no debe abortar el parseo
  // de TODO el archivo con CSV_INVALID_CLOSING_QUOTE — con esta opción
  // csv-parse la tolera en vez de lanzar.
  const records = parse(blocksText, {
    relax_column_count: true,
    skip_empty_lines: true,
    relax_quotes: true,
  });
  const rows = [];
  let skippedNoPrice = 0;
  let skippedMalformed = 0;

  for (const record of records) {
    if (record.length !== 9) {
      // El separador de bloque ("_______________",...) es ruido estructural
      // esperado, no una fila de datos rota: no se cuenta como malformada.
      if (record[0] !== '_______________') {
        skippedMalformed += 1;
      }
      continue;
    }
    if (record[1] === 'CODIGO') continue; // fila de encabezado de bloque

    const category = (record[0] || '').trim().toUpperCase();
    if (!category) {
      skippedMalformed += 1;
      continue;
    }

    // Validar la forma numérica estricta antes de parsear: un campo citado
    // con separador de miles ("1,766.00") haría que parseFloat se detenga
    // en la coma y devuelva 1 en vez de 1766, silenciosamente. Cualquier
    // formato inesperado se cuenta como omisión en vez de coercionarse.
    const rawPrice = (record[4] || '').trim();
    if (!/^\d+(\.\d+)?$/.test(rawPrice)) {
      skippedMalformed += 1;
      continue;
    }
    const priceUsd = parseFloat(rawPrice);
    if (priceUsd === PRICE_SENTINEL_NO_PRICE) {
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

  return { rows, skippedNoPrice, skippedMalformed };
}

module.exports = { parseTipoCambio, parseStockInfo, parsePriceListRows, PRICE_SENTINEL_NO_PRICE };
