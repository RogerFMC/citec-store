'use strict';

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

module.exports = { parseTipoCambio, parseStockInfo };
