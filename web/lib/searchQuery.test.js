import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchWords, buildSearchOrFilters } from './searchQuery.js';

test('buildSearchWords separa por espacios y descarta vacíos', () => {
  assert.deepEqual(buildSearchWords('  monitor   lenovo  27 '), ['monitor', 'lenovo', '27']);
});

test('buildSearchWords devuelve arreglo vacío para query vacío/undefined', () => {
  assert.deepEqual(buildSearchWords(''), []);
  assert.deepEqual(buildSearchWords(undefined), []);
});

test('buildSearchWords elimina caracteres reservados de PostgREST (, ( ) * % _)', () => {
  assert.deepEqual(buildSearchWords('lenovo, (27%)_test*'), ['lenovo', '27test']);
});

test('buildSearchOrFilters arma una cláusula or() por palabra, con las 4 columnas', () => {
  const filters = buildSearchOrFilters(['monitor', 'lenovo'], ['model', 'description', 'brand', 'part_number']);
  assert.deepEqual(filters, [
    'model.ilike.*monitor*,description.ilike.*monitor*,brand.ilike.*monitor*,part_number.ilike.*monitor*',
    'model.ilike.*lenovo*,description.ilike.*lenovo*,brand.ilike.*lenovo*,part_number.ilike.*lenovo*',
  ]);
});

test('buildSearchOrFilters con arreglo de palabras vacío devuelve arreglo vacío', () => {
  assert.deepEqual(buildSearchOrFilters([], ['model']), []);
});
