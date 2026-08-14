import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatLeadTime, stockLabel, buildWhatsappUrl } from './format.js';

test('formatPrice da formato de soles con 2 decimales', () => {
  assert.equal(formatPrice(1234.5), 'S/ 1,234.50');
  assert.equal(formatPrice(9.9), 'S/ 9.90');
});

test('formatLeadTime: sin dato es "consultar"', () => {
  assert.match(formatLeadTime(null), /consultar/i);
  assert.match(formatLeadTime(undefined), /consultar/i);
});

test('formatLeadTime: 0 días es mismo día', () => {
  assert.match(formatLeadTime(0), /mismo día/i);
});

test('formatLeadTime: 1 día es singular', () => {
  assert.equal(formatLeadTime(1), 'Entrega en 1 día hábil');
});

test('formatLeadTime: más de 1 día es plural con el número', () => {
  assert.equal(formatLeadTime(3), 'Entrega en hasta 3 días hábiles');
});

test('stockLabel mapea los 3 estados conocidos y cualquier otro valor a "consultar"', () => {
  assert.match(stockLabel('in_stock'), /en stock/i);
  assert.match(stockLabel('low_stock'), /últimas unidades/i);
  assert.match(stockLabel('out_of_stock'), /consultar/i);
  assert.match(stockLabel('valor-desconocido'), /consultar/i);
});

test('buildWhatsappUrl arma el link wa.me con el mensaje codificado', () => {
  const url = buildWhatsappUrl({ phone: '51969328181', productName: 'Monitor Lenovo 27' });
  assert.ok(url.startsWith('https://wa.me/51969328181?text='));
  assert.ok(url.includes(encodeURIComponent('Monitor Lenovo 27')));
});
