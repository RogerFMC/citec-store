import { getCategories, getAllProductsForSitemap } from '../lib/catalogSearch.js';
import { buildProductSlug } from '../lib/slug.js';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://citec-store.vercel.app';

export default async function sitemap() {
  const categories = await getCategories();
  const products = await getAllProductsForSitemap();

  const staticEntries = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    ...categories.map((category) => ({
      url: `${SITE_URL}/categoria/${category.slug}`,
      changeFrequency: 'daily',
      priority: 0.8,
    })),
  ];

  const productEntries = products.map((product) => ({
    url: `${SITE_URL}/producto/${buildProductSlug(product.model, product.id)}`,
    lastModified: product.last_synced_at ? new Date(product.last_synced_at) : undefined,
    changeFrequency: 'daily',
    priority: 0.5,
  }));

  return [...staticEntries, ...productEntries];
}
