import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategories, getProductsByCategory } from '../../../lib/catalogSearch.js';
import { formatPrice, stockLabel } from '../../../lib/format.js';
import { buildProductSlug } from '../../../lib/slug.js';

export const revalidate = 3600;

export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) return {};
  return {
    title: `${category.name} | Citec Store`,
    description: `Catálogo de ${category.name} en Citec Store: precios actualizados, stock y plazo de entrega.`,
  };
}

export default async function CategoryPage({ params, searchParams }) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;

  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) {
    notFound();
  }

  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const { products, total, pageSize } = await getProductsByCategory({ slug, page });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="container">
      <h1>{category.name}</h1>
      <p>
        {total} producto{total === 1 ? '' : 's'}
      </p>

      {products.length === 0 ? (
        <p className="empty-state">No hay productos activos en esta categoría por ahora.</p>
      ) : (
        <div className="product-grid">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/producto/${buildProductSlug(product.model, product.id)}`}
              className="product-card"
            >
              <div className="product-name">{product.model}</div>
              <div className="product-price">{formatPrice(product.final_price)}</div>
              <div className="product-stock">{stockLabel(product.stock_status)}</div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pagination" aria-label="Paginación">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) =>
            n === page ? (
              <span key={n} className="current">
                {n}
              </span>
            ) : (
              <Link key={n} href={`/categoria/${slug}?page=${n}`}>
                {n}
              </Link>
            )
          )}
        </nav>
      )}
    </main>
  );
}
