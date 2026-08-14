import { cache } from 'react';
import { getSupabaseClient } from './supabaseClient.js';
import { buildSearchWords, buildSearchOrFilters } from './searchQuery.js';

const PAGE_SIZE = 24;
const SEARCH_COLUMNS = ['model', 'description', 'brand', 'part_number'];

export const getCategories = cache(async ({ supabaseClient } = {}) => {
  const supabase = supabaseClient || getSupabaseClient();
  const chunkSize = 1000;
  let from = 0;
  const all = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('catalog_search')
      .select('category, category_slug')
      .order('category', { ascending: true })
      .range(from, from + chunkSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < chunkSize) break;
    from += chunkSize;
  }

  const seen = new Map();
  for (const row of all) {
    if (!seen.has(row.category_slug)) {
      seen.set(row.category_slug, { name: row.category, slug: row.category_slug });
    }
  }
  return [...seen.values()];
});

export async function getProductsByCategory({ slug, page = 1, supabaseClient } = {}) {
  const supabase = supabaseClient || getSupabaseClient();

  const { count, error: countError } = await supabase
    .from('catalog_search')
    .select('*', { count: 'exact', head: true })
    .eq('category_slug', slug);
  if (countError) throw countError;

  const total = count ?? 0;
  if (total === 0) {
    return { products: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const from = (clampedPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('catalog_search')
    .select('*')
    .eq('category_slug', slug)
    .order('model', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return { products: data, total, page: clampedPage, pageSize: PAGE_SIZE };
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
  const filters = buildSearchOrFilters(words, SEARCH_COLUMNS);

  let countBuilder = supabase.from('catalog_search').select('*', { count: 'exact', head: true });
  for (const filter of filters) {
    countBuilder = countBuilder.or(filter);
  }
  const { count, error: countError } = await countBuilder;
  if (countError) throw countError;

  const total = count ?? 0;
  if (total === 0) {
    return { products: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const from = (clampedPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let builder = supabase.from('catalog_search').select('*');
  for (const filter of filters) {
    builder = builder.or(filter);
  }
  const { data, error } = await builder.order('model', { ascending: true }).range(from, to);
  if (error) throw error;
  return { products: data, total, page: clampedPage, pageSize: PAGE_SIZE };
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
