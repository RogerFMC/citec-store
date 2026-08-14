import Link from 'next/link';
import { getCategories } from '../lib/catalogSearch.js';

export const revalidate = 3600;

export default async function HomePage() {
  const categories = await getCategories();

  return (
    <main className="container">
      <section className="hero">
        <h1>Citec Store</h1>
        <p>Encuentra laptops, impresoras, monitores y más al mejor precio.</p>
        <form action="/buscar" method="get" className="search-form">
          <input
            type="text"
            name="q"
            placeholder="Buscar por modelo, marca o número de parte..."
            aria-label="Buscar productos"
            required
          />
          <button type="submit">Buscar</button>
        </form>
      </section>

      <section>
        <h2>Categorías</h2>
        <div className="category-grid">
          {categories.map((category) => (
            <Link key={category.slug} href={`/categoria/${category.slug}`} className="category-card">
              {category.name}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
