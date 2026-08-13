'use strict';
const cheerio = require('cheerio');

function parseTipoCambio(rawText) {
  const match = rawText.match(/TCM:\s*([\d.]+)/);
  if (!match) throw new Error(`No se pudo leer el tipo de cambio de: "${rawText}"`);
  return parseFloat(match[1]);
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

function parseProductCards(html) {
  const $ = cheerio.load(html);
  const cards = [];
  $('.card.p-1').each((_, el) => {
    const card = $(el);
    const onclick = card.find('a[onclick*="bus_rapida"]').attr('onclick') || '';
    const skuMatch = onclick.match(/busqueda_general\('bus_rapida', ' ', ' ', '([^']+)'\)/);
    if (!skuMatch) return;

    const brand = card.find('.card-title .text-dark').first().text().trim();
    const rawName = card.find('.card-title .fw-medium').first().text().trim();
    const priceText = card.find('.alert-danger').first().text().trim();
    const priceMatch = priceText.match(/\$([\d.]+)/);
    if (!priceMatch) return;

    cards.push({
      supplierSku: skuMatch[1],
      brand,
      rawName,
      priceUsd: parseFloat(priceMatch[1]),
    });
  });
  return cards;
}

module.exports = { parseTipoCambio, parsePageInfo, splitModelAndPartNumber, parseProductCards };
