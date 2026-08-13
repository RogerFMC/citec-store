'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./syncCommon');

test('getSupabaseClient lanza si faltan las variables de entorno', () => {
  assert.throws(() => getSupabaseClient({}), /SUPABASE_URL/);
});

test('getSupabaseClient no lanza si las variables están presentes', () => {
  assert.doesNotThrow(() =>
    getSupabaseClient({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key' })
  );
});

function makeFakeSupabase({ categories, insertedId, updateCalls }) {
  return {
    from(table) {
      if (table === 'categories') {
        return { select: () => Promise.resolve({ data: categories, error: null }) };
      }
      if (table === 'sync_log') {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: insertedId }, error: null }),
            }),
          }),
          update: (payload) => ({
            eq: (_col, _val) => {
              updateCalls.push(payload);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  };
}

test('getCategoryIdMap arma un Map nombre -> id', async () => {
  const supabase = makeFakeSupabase({
    categories: [
      { id: 'cat-1', name: 'Impresoras' },
      { id: 'cat-2', name: 'Monitores' },
    ],
    insertedId: null,
    updateCalls: [],
  });
  const map = await getCategoryIdMap(supabase);
  assert.equal(map.get('Impresoras'), 'cat-1');
  assert.equal(map.get('Monitores'), 'cat-2');
});

test('logSyncStart devuelve el id de la fila creada', async () => {
  const supabase = makeFakeSupabase({ categories: [], insertedId: 'log-123', updateCalls: [] });
  const id = await logSyncStart(supabase, 'supplier-1');
  assert.equal(id, 'log-123');
});

test('logSyncFinish manda status/items_synced/message', async () => {
  const updateCalls = [];
  const supabase = makeFakeSupabase({ categories: [], insertedId: null, updateCalls });
  await logSyncFinish(supabase, 'log-123', { status: 'success', itemsSynced: 42, message: null });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].status, 'success');
  assert.equal(updateCalls[0].items_synced, 42);
});
