import { getSupabaseClient } from './supabaseClient.js';
import { buildSearchWords, buildSearchOrFilters } from './searchQuery.js';

const PAGE_SIZE = 24;
const SEARCH_COLUMNS = ['model', 'description', 'brand', 'part_number'];

export async function getCategories({ supabaseClient } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const { data, error } = await supabase
    .from('catalog_search')
    .select('category, category_slug')
    .order('category', { ascending: true });
  if (error) throw error;

  const seen = new Map();
  for (const row of data) {
    if (!seen.has(row.category_slug)) {
      seen.set(row.category_slug, { name: row.category, slug: row.category_slug });
    }
  }
  return [...seen.values()];
}

export async function getProductsByCategory({ slug, page = 1, supabaseClient } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error, count } = await supabase
    .from('catalog_search')
    .select('*', { count: 'exact' })
    .eq('category_slug', slug)
    .order('model', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return { products: data, total: count ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getProductById(id, { supabaseClient } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const { data, error } = await supabase.from('catalog_search').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function searchProducts({ query, page = 1, supabaseClient } = {}) {
  const words = buildSearchWords(query);
  if (words.length === 0) {
    return { products: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  const supabase = supabaseClient || getSupabaseClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let builder = supabase.from('catalog_search').select('*', { count: 'exact' });
  for (const filter of buildSearchOrFilters(words, SEARCH_COLUMNS)) {
    builder = builder.or(filter);
  }
  const { data, error, count } = await builder.order('model', { ascending: true }).range(from, to);
  if (error) throw error;
  return { products: data, total: count ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getAllProductsForSitemap({ supabaseClient } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const chunkSize = 1000;
  let from = 0;
  const all = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('catalog_search')
      .select('id, model, last_synced_at')
      .range(from, from + chunkSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < chunkSize) break;
    from += chunkSize;
  }
  return all;
}
