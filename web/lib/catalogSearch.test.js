import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCategories,
  getProductsByCategory,
  getProductById,
  searchProducts,
  getAllProductsForSitemap,
} from './catalogSearch.js';

function makeFakeQuery(result) {
  const calls = [];
  const builder = {
    select(...args) {
      calls.push(['select', args]);
      return builder;
    },
    eq(...args) {
      calls.push(['eq', args]);
      return builder;
    },
    or(...args) {
      calls.push(['or', args]);
      return builder;
    },
    order(...args) {
      calls.push(['order', args]);
      return builder;
    },
    range(...args) {
      calls.push(['range', args]);
      return builder;
    },
    maybeSingle() {
      calls.push(['maybeSingle', []]);
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
    _calls: calls,
  };
  return builder;
}

function makeFakeSupabase(result) {
  let lastQuery = null;
  const fromCalls = [];
  return {
    from(table) {
      fromCalls.push(table);
      lastQuery = makeFakeQuery(result);
      return lastQuery;
    },
    get lastQuery() {
      return lastQuery;
    },
    _fromCalls: fromCalls,
  };
}

test('getCategories deduplica por category_slug y devuelve {name, slug}', async () => {
  const supabase = makeFakeSupabase({
    data: [
      { category: 'Monitores', category_slug: 'monitores' },
      { category: 'Monitores', category_slug: 'monitores' },
      { category: 'Impresoras', category_slug: 'impresoras' },
    ],
    error: null,
  });
  const categories = await getCategories({ supabaseClient: supabase });
  assert.deepEqual(categories, [
    { name: 'Monitores', slug: 'monitores' },
    { name: 'Impresoras', slug: 'impresoras' },
  ]);
});

test('getCategories lanza si Supabase devuelve error', async () => {
  const supabase = makeFakeSupabase({ data: null, error: new Error('boom') });
  await assert.rejects(() => getCategories({ supabaseClient: supabase }), /boom/);
});

test('getCategories pagina más allá de 1000 filas y no pierde categorías que caen después del primer chunk', async () => {
  let call = 0;
  const pages = [
    Array.from({ length: 1000 }, () => ({
      category: 'Accesorios y periféricos',
      category_slug: 'accesorios-y-perifericos',
    })),
    Array.from({ length: 1000 }, () => ({ category: 'Monitores', category_slug: 'monitores' })),
    Array.from({ length: 300 }, () => ({ category: 'Suministros', category_slug: 'suministros' })),
  ];
  const supabase = {
    from() {
      const data = pages[call];
      call += 1;
      return makeFakeQuery({ data, error: null });
    },
  };
  const categories = await getCategories({ supabaseClient: supabase });
  assert.equal(call, 3);
  assert.deepEqual(categories, [
    { name: 'Accesorios y periféricos', slug: 'accesorios-y-perifericos' },
    { name: 'Monitores', slug: 'monitores' },
    { name: 'Suministros', slug: 'suministros' },
  ]);
});

test('getProductsByCategory filtra por category_slug y pagina con range correcto', async () => {
  const supabase = makeFakeSupabase({ data: [{ id: '1' }], error: null, count: 30 });
  const result = await getProductsByCategory({ slug: 'monitores', page: 2, supabaseClient: supabase });
  assert.deepEqual(result, { products: [{ id: '1' }], total: 30, page: 2, pageSize: 24 });
  const eqCall = supabase.lastQuery._calls.find(([name]) => name === 'eq');
  assert.deepEqual(eqCall[1], ['category_slug', 'monitores']);
  const rangeCall = supabase.lastQuery._calls.find(([name]) => name === 'range');
  assert.deepEqual(rangeCall[1], [24, 47]);
});

test('getProductsByCategory por defecto pide la página 1', async () => {
  // count alto a propósito (200 -> 9 páginas): con un total chico el clamp a
  // totalPages podía dar página 1 sin importar cuál fuera el default real,
  // dejando de probar lo que el nombre del test dice.
  const supabase = makeFakeSupabase({ data: [{ id: '1' }], error: null, count: 200 });
  const result = await getProductsByCategory({ slug: 'monitores', supabaseClient: supabase });
  assert.equal(result.page, 1);
  const rangeCall = supabase.lastQuery._calls.find(([name]) => name === 'range');
  assert.deepEqual(rangeCall[1], [0, 23]);
});

test('getProductsByCategory con page mucho más allá del total no lanza y limita a la última página', async () => {
  let call = 0;
  const responses = [
    { data: null, error: null, count: 30 }, // query de conteo (head: true)
    { data: [{ id: 'ultimo' }], error: null, count: 30 }, // query real, ya con page recortada
  ];
  const supabase = {
    from() {
      const result = responses[call];
      call += 1;
      return makeFakeQuery(result);
    },
  };
  const result = await getProductsByCategory({ slug: 'monitores', page: 999, supabaseClient: supabase });
  assert.equal(call, 2, 'debe hacer una query de conteo y luego la query de la página recortada');
  assert.equal(result.page, 2, 'ceil(30/24) = 2 páginas; 999 se recorta a la última');
  assert.deepEqual(result.products, [{ id: 'ultimo' }]);
  assert.equal(result.total, 30);
});

test('getProductsByCategory con total 0 no intenta un range() inválido', async () => {
  let call = 0;
  const supabase = {
    from() {
      call += 1;
      return makeFakeQuery({ data: null, error: null, count: 0 });
    },
  };
  const result = await getProductsByCategory({ slug: 'categoria-vacia', page: 1, supabaseClient: supabase });
  assert.equal(call, 1, 'solo debe llamar from() una vez (el conteo); no debe intentar la query de rango');
  assert.deepEqual(result, { products: [], total: 0, page: 1, pageSize: 24 });
});

test('getProductById devuelve el producto si existe', async () => {
  const supabase = makeFakeSupabase({ data: { id: 'abc', model: 'Monitor X' }, error: null });
  const product = await getProductById('abc', { supabaseClient: supabase });
  assert.deepEqual(product, { id: 'abc', model: 'Monitor X' });
});

test('getProductById devuelve null si no existe', async () => {
  const supabase = makeFakeSupabase({ data: null, error: null });
  const product = await getProductById('id-inexistente', { supabaseClient: supabase });
  assert.equal(product, null);
});

test('searchProducts con query vacío devuelve 0 resultados sin llamar a Supabase', async () => {
  const supabase = makeFakeSupabase({ data: [], error: null, count: 0 });
  const result = await searchProducts({ query: '   ', page: 1, supabaseClient: supabase });
  assert.deepEqual(result, { products: [], total: 0, page: 1, pageSize: 24 });
  assert.equal(supabase._fromCalls.length, 0, 'no debe llamar a Supabase si no hay palabras de búsqueda');
});

test('searchProducts arma un filtro or() por cada palabra de la búsqueda', async () => {
  const supabase = makeFakeSupabase({ data: [{ id: '1' }], error: null, count: 1 });
  await searchProducts({ query: 'monitor lenovo', page: 1, supabaseClient: supabase });
  const orCalls = supabase.lastQuery._calls.filter(([name]) => name === 'or');
  assert.equal(orCalls.length, 2);
  assert.equal(
    orCalls[0][1][0],
    'model.ilike.*monitor*,description.ilike.*monitor*,brand.ilike.*monitor*,part_number.ilike.*monitor*'
  );
  assert.equal(
    orCalls[1][1][0],
    'model.ilike.*lenovo*,description.ilike.*lenovo*,brand.ilike.*lenovo*,part_number.ilike.*lenovo*'
  );
});

test('searchProducts con page mucho más allá del total no lanza y limita a la última página', async () => {
  let call = 0;
  const responses = [
    { data: null, error: null, count: 10 }, // query de conteo (head: true)
    { data: [{ id: 'ultimo' }], error: null, count: 10 }, // query real, ya con page recortada
  ];
  const supabase = {
    from() {
      const result = responses[call];
      call += 1;
      return makeFakeQuery(result);
    },
  };
  const result = await searchProducts({ query: 'monitor', page: 999, supabaseClient: supabase });
  assert.equal(call, 2, 'debe hacer una query de conteo y luego la query de la página recortada');
  assert.equal(result.page, 1, 'ceil(10/24) = 1 página; 999 se recorta a la última');
  assert.deepEqual(result.products, [{ id: 'ultimo' }]);
  assert.equal(result.total, 10);
});

test('searchProducts sin resultados (count 0) no intenta un range() inválido', async () => {
  let call = 0;
  const supabase = {
    from() {
      call += 1;
      return makeFakeQuery({ data: null, error: null, count: 0 });
    },
  };
  const result = await searchProducts({ query: 'zzzznoexiste', page: 2, supabaseClient: supabase });
  assert.equal(call, 1, 'solo debe llamar from() una vez (el conteo); no debe intentar la query de rango');
  assert.deepEqual(result, { products: [], total: 0, page: 2, pageSize: 24 });
});

test('getAllProductsForSitemap junta páginas de 1000 hasta que una vuelve incompleta', async () => {
  let call = 0;
  const pages = [
    Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` })),
    Array.from({ length: 300 }, (_, i) => ({ id: `p${1000 + i}` })),
  ];
  const supabase = {
    from() {
      const data = pages[call];
      call += 1;
      return makeFakeQuery({ data, error: null });
    },
  };
  const all = await getAllProductsForSitemap({ supabaseClient: supabase });
  assert.equal(all.length, 1300);
  assert.equal(call, 2);
});
