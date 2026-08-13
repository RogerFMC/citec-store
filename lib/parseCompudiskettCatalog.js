'use strict';
const cheerio = require('cheerio');

function parseTipoCambio(rawText) {
  // El TCM se ha visto publicado con coma decimal (p.ej. "3,380" == 3.38),
  // a diferencia de los precios que usan coma como separador de miles.
  // Aceptamos un único separador (coma o punto) y lo normalizamos a punto.
  const match = rawText.match(/TCM:\s*(\d+(?:[.,]\d+)?)/);
  if (!match) throw new Error(`No se pudo leer el tipo de cambio de: "${rawText}"`);
  return parseFloat(match[1].replace(',', '.'));
}

// El sitio no devuelve un footer de paginación cuando una categoría no
// tiene resultados — en su lugar muestra este mensaje (verificado en vivo
// el 2026-08-13, ej. EQUIPOS INFORMATICOS/DESKTOP y CHROMEBOOK están vacías
// en el catálogo actual). Sin esto, parsePageInfo lanzaría un error genérico
// que sync_compudiskett.js reportaría como "búsqueda fallida" en vez de
// "categoría vacía".
function isEmptyResultPage(html) {
  return html.includes('No tenemos información de su búsqueda.');
}

function parsePageInfo(html) {
  const match = html.match(/Página\s*(\d+)\s*-\s*(\d+)\s*de\s*(\d+)\s*Resultados/);
  if (!match) throw new Error('No se encontró el indicador de paginación en el HTML.');
  return {
    currentPage: parseInt(match[1], 10),
    totalPages: parseInt(match[2], 10),
    totalResults: parseInt(match[3], 10),
  };
}

function splitModelAndPartNumber(rawName) {
  const tokens = rawName.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  const looksLikePartNumber = tokens.length > 1 && /^[A-Z0-9][A-Z0-9-]{4,}$/.test(last) && /\d/.test(last);
  if (looksLikePartNumber) {
    return { model: tokens.slice(0, -1).join(' '), partNumber: last };
  }
  return { model: rawName.trim(), partNumber: null };
}

// Devuelve { cards, skipped } — `skipped` cuenta las tarjetas descartadas por
// no tener SKU u precio parseables, para que el llamador pueda reportarlo
// en lugar de perderlas en silencio.
function parseProductCards(html) {
  const $ = cheerio.load(html);
  const cards = [];
  let skipped = 0;
  $('.card.p-1').each((_, el) => {
    const card = $(el);
    const onclick = card.find('a[onclick*="bus_rapida"]').attr('onclick') || '';
    const skuMatch = onclick.match(/busqueda_general\('bus_rapida', ' ', ' ', '([^']+)'\)/);
    if (!skuMatch) {
      skipped += 1;
      return;
    }

    const brand = card.find('.card-title .text-dark').first().text().trim();
    const rawName = card.find('.card-title .fw-medium').first().text().trim();
    // El badge de precio cambia de color (alert-danger vs alert-info) según
    // el producto (verificado en vivo: CPUs/Suministros usan alert-danger,
    // la mayoría del resto usa alert-info) pero siempre lleva
    // text-decoration-line-through, así que ese es el selector estable.
    const priceText = card.find('[class*="text-decoration-line-through"]').first().text().trim();
    const priceMatch = priceText.match(/\$([\d,]+\.?\d*)/);
    if (!priceMatch) {
      skipped += 1;
      return;
    }

    cards.push({
      supplierSku: skuMatch[1],
      brand,
      rawName,
      priceUsd: parseFloat(priceMatch[1].replace(/,/g, '')),
    });
  });
  return { cards, skipped };
}

module.exports = { parseTipoCambio, parsePageInfo, splitModelAndPartNumber, parseProductCards, isEmptyResultPage };
