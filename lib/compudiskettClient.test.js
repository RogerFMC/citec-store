'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSessionCookie } = require('./compudiskettClient');

test('extractSessionCookie toma el primer PHPSESSID de la lista', () => {
  const cookie = extractSessionCookie(['PHPSESSID=abc123; path=/; HttpOnly']);
  assert.equal(cookie, 'PHPSESSID=abc123');
});

test('extractSessionCookie devuelve null si no hay set-cookie', () => {
  assert.equal(extractSessionCookie(undefined), null);
  assert.equal(extractSessionCookie([]), null);
});

test('extractSessionCookie ignora cookies que no son PHPSESSID', () => {
  const cookie = extractSessionCookie(['otra=1; path=/', 'PHPSESSID=xyz789; path=/']);
  assert.equal(cookie, 'PHPSESSID=xyz789');
});
