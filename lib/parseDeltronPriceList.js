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

// Verificado contra el archivo real (2026-08-13): Deltron usa varios valores
// "todo nueves" como precio placeholder cuando no hay precio fijo (requiere
// cotización). No es solo 9999999.99: se encontraron también 4 filas en
// 9999.00 (ej. teclado gamer, monitor y mochila con costo idéntico —
// productos sin ninguna relación entre sí), y el mismo patrón de "productos
// totalmente distintos compartiendo un precio exacto y sospechosamente
// redondo" se repite en 999.00 (52 filas: cargador, audífonos, parlantes,
// maletín, case de PC, estabilizador, licencia Kaspersky, merchandising),
// 99.00 (10 filas: pack de garantía extendida junto con bolsas y cuadernos
// promocionales) y 9.00 (6 filas: una impresora multifuncional junto con
// polos y bufandas promocionales — una impresora real nunca cuesta lo mismo
// que una bufanda). Se tratan las 5 magnitudes como centinela de "sin precio
// fijo" en vez de precio real.
const PRICE_SENTINELS_NO_PRICE = new Set([9.0, 99.0, 999.0, 9999.0, 9999999.99]);

// `relax_quotes` (necesario: el archivo real tiene comillas mal formadas
// que sin esa opción hacen tronar el parseo completo, ej. un tab pegado
// justo después de una comilla de cierre) hace que csv-parse, en esos casos
// límite, no separe la comilla literal del contenido del campo. Verificado
// contra el archivo real: 1891 de 1894 filas traen `marca` como '"deltron"'
// en vez de 'deltron'. Se limpia manualmente después de parsear.
function stripWrappingQuotes(value) {
  const trimmed = (value || '').trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

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
    let fields = record;

    // Verificado contra el archivo real (2026-08-13): algunas categorías con
    // coma interna (ej. "acc, muebles de computo") salen SIN comillas en el
    // export de Deltron, así que csv-parse las separa en dos columnas en vez
    // de una — la fila queda con 10 campos en vez de 9, desplazando todo lo
    // demás. Se reconstruye uniendo las dos primeras columnas con una coma
    // antes de seguir; con eso la categoría vuelve a calzar exactamente con
    // las entradas de deltronCategoryMap.js (ej. "ACC, MUEBLES DE COMPUTO").
    if (fields.length === 10) {
      fields = [`${fields[0]},${fields[1]}`, ...fields.slice(2)];
    }

    if (fields.length !== 9) {
      // El separador de bloque ("_______________",...) es ruido estructural
      // esperado, no una fila de datos rota: no se cuenta como malformada.
      if (fields[0] !== '_______________') {
        skippedMalformed += 1;
      }
      continue;
    }
    if (fields[1] === 'CODIGO') continue; // fila de encabezado de bloque

    const category = (fields[0] || '').trim().toUpperCase();
    if (!category) {
      skippedMalformed += 1;
      continue;
    }

    // Validar la forma numérica estricta antes de parsear: un campo citado
    // con separador de miles ("1,766.00") haría que parseFloat se detenga
    // en la coma y devuelva 1 en vez de 1766, silenciosamente. Cualquier
    // formato inesperado se cuenta como omisión en vez de coercionarse.
    const rawPrice = (fields[4] || '').trim();
    if (!/^\d+(\.\d+)?$/.test(rawPrice)) {
      skippedMalformed += 1;
      continue;
    }
    const priceUsd = parseFloat(rawPrice);
    if (PRICE_SENTINELS_NO_PRICE.has(priceUsd)) {
      skippedNoPrice += 1;
      continue;
    }

    rows.push({
      category,
      codigo: (fields[1] || '').trim(),
      descripcion: (fields[2] || '').trim(),
      stock: parseStockInfo(fields[3]),
      priceUsd,
      marca: stripWrappingQuotes(fields[8]),
    });
  }

  return { rows, skippedNoPrice, skippedMalformed };
}

module.exports = {
  parseTipoCambio,
  parseStockInfo,
  parsePriceListRows,
  PRICE_SENTINELS_NO_PRICE,
  stripWrappingQuotes,
};
