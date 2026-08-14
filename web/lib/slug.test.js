import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, buildProductSlug, extractProductId } from './slug.js';

test('slugify pasa a minúsculas y reemplaza espacios por guiones', () => {
  assert.equal(slugify('Monitor Lenovo 27'), 'monitor-lenovo-27');
});

test('slugify quita tildes y ñ', () => {
  assert.equal(slugify('Diseño técnico compacto'), 'diseno-tecnico-compacto');
});

test('slugify colapsa caracteres especiales consecutivos en un solo guión', () => {
  assert.equal(slugify('Cable USB-C, 3A / 60W!!'), 'cable-usb-c-3a-60w');
});

test('slugify recorta guiones al inicio/final y trunca a 60 caracteres', () => {
  const largo = 'a'.repeat(80);
  const resultado = slugify(largo);
  assert.equal(resultado.length, 60);
  assert.ok(!resultado.startsWith('-') && !resultado.endsWith('-'));
});

test('slugify de vacío/undefined no lanza, devuelve string vacío', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(undefined), '');
});

test('buildProductSlug combina el slug del modelo con el id completo', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.equal(buildProductSlug('Monitor Lenovo 27', id), `monitor-lenovo-27-${id}`);
});

test('buildProductSlug usa "producto" si el modelo queda vacío tras slugify', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.equal(buildProductSlug('!!!', id), `producto-${id}`);
});

test('extractProductId extrae el uuid del final de un slug válido', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.equal(extractProductId(`monitor-lenovo-27-${id}`), id);
});

test('extractProductId devuelve null si no hay un uuid al final', () => {
  assert.equal(extractProductId('monitor-lenovo-27'), null);
  assert.equal(extractProductId(''), null);
  assert.equal(extractProductId(undefined), null);
});
