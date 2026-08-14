# Fase 4 — Buscador y Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public Next.js frontend for Citec Store — home page, category browsing, product detail, and search — reading only from the Supabase `catalog_search` view, indexable by Google, with a WhatsApp CTA as the only conversion mechanism (no cart/checkout yet).

**Architecture:** Next.js (App Router) as a self-contained subproject in `web/`, deployed to Vercel separately from the root Node.js sync scripts. All data fetching happens in Server Components using the Supabase `anon` client — no client-side Supabase calls, no client JavaScript required to see or use any page (search and pagination are plain HTML `<form>`/`<a>` elements). Pure logic (slugs, formatting, search-filter construction) lives in small testable modules under `web/lib/`, separate from the Supabase-calling data-access layer.

**Tech Stack:** Next.js 15 (App Router), React 19, `@supabase/supabase-js`, plain CSS (no framework), Node's built-in test runner (`node --test`) for `web/lib/*.test.js`, ES modules (`web/package.json` has `"type": "module"`).

**Spec:** `docs/superpowers/specs/2026-08-13-fase4-frontend-design.md`

## Global Constraints

- Frontend queries **only** `catalog_search` — never `products`, `categories`, or `suppliers` directly (per spec correction from Cowork's review: `categories.margin_pct` must never be exposed).
- No cart/checkout/payment logic — Fase 5, out of scope.
- No filters by brand/price, no custom sort, no infinite scroll — MVP scope confirmed with Roger.
- WhatsApp number: `51969328181` (confirmed with Roger).
- Pagination: 24 items per page, offset/limit.
- `/buscar` results pages are `noindex` (not the sitemap, not indexed) — search-result permutations are low-value duplicate content.
- Roger deploys to Vercel himself (team `CITEC`, already exists) — this plan does not include deployment, only code ready to deploy plus documented env vars.

---

## File Structure

```
web/                              -- new Next.js subproject (separate package.json from repo root)
  package.json
  next.config.mjs
  .env.example
  README.md
  app/
    layout.js                     -- root layout: header, footer, global CSS import
    globals.css
    page.js                       -- home: category tiles + search form
    sitemap.js                    -- dynamic sitemap.xml
    robots.js                     -- dynamic robots.txt
    categoria/
      [slug]/
        page.js                   -- category listing, paginated, ISR
    producto/
      [slugId]/
        page.js                   -- product detail, ISR, JSON-LD, WhatsApp CTA
    buscar/
      page.js                     -- search results, SSR, noindex
  lib/
    supabaseClient.js             -- getSupabaseClient() (env-based, DI-friendly)
    slug.js                       -- slugify, buildProductSlug, extractProductId (pure)
    slug.test.js
    format.js                     -- formatPrice, formatLeadTime, stockLabel, buildWhatsappUrl (pure)
    format.test.js
    searchQuery.js                -- buildSearchWords, buildSearchOrFilters (pure)
    searchQuery.test.js
    catalogSearch.js              -- getCategories, getProductsByCategory, getProductById, searchProducts, getAllProductsForSitemap (calls Supabase)
    catalogSearch.test.js
```

Root-level `schema.sql` gets updated in Task 1 to reflect the `categories.slug` column and the new `catalog_search` view definition, matching the project's existing convention of keeping `schema.sql` in sync with the live Supabase schema.

---

### Task 1: Supabase migration — `categories.slug` and `catalog_search.category_slug`

**Files:**
- Modify: `schema.sql` (add `slug` column to the `categories` table definition, update the `catalog_search` view definition)
- No test files — this task is verified by direct SQL queries against Supabase.

**Interfaces:**
- Produces: `catalog_search.category_slug` (text, not null) — consumed by Task 4 (`getCategories`, `getProductsByCategory`).

This task modifies production Supabase schema. Apply it via the Supabase MCP `apply_migration` tool (`project_id: rqrbgjzdcvieqbpexgen`) — **confirm with Roger before running it**, same pattern as every other production change this session.

- [ ] **Step 1: Apply the migration**

Migration name: `add_category_slug`

```sql
alter table categories add column if not exists slug text unique;

update categories set slug = 'laptops-y-pcs' where name = 'Laptops y PCs';
update categories set slug = 'impresoras' where name = 'Impresoras';
update categories set slug = 'suministros' where name = 'Suministros';
update categories set slug = 'estabilizadores-y-ups' where name = 'Estabilizadores y UPS';
update categories set slug = 'accesorios-y-perifericos' where name = 'Accesorios y periféricos';
update categories set slug = 'monitores' where name = 'Monitores';
update categories set slug = 'tarjetas-de-video' where name = 'Tarjetas de video';

alter table categories alter column slug set not null;

create or replace view catalog_search as
 select p.id,
    p.model,
    p.part_number,
    p.brand,
    p.description,
    c.name as category,
    c.slug as category_slug,
    p.final_price,
    p.stock_status,
    w.name as warehouse_name,
    w.city as warehouse_city,
    w.max_lead_days,
    p.last_synced_at,
    p.confidence
   from products p
     join categories c on c.id = p.category_id
     left join warehouses w on w.id = p.warehouse_id
  where p.is_active = true and p.confidence <> 'low'::text;
```

`CREATE OR REPLACE VIEW` only adds a trailing column here (doesn't remove or retype existing ones), so it preserves the existing `GRANT SELECT ON catalog_search TO anon, authenticated` — no new grant needed. `categories` itself gets **no new grants** — `anon` still cannot read `categories` directly (this is the exact point of Cowork's spec correction).

- [ ] **Step 2: Verify against production**

Run this query and confirm all 7 rows have a non-null, unique `category_slug`, and that `anon`'s grants on `categories` are unchanged (still nothing):

```sql
select category, category_slug, count(*) from catalog_search group by category, category_slug order by category;

select grantee, privilege_type from information_schema.role_table_grants where table_name = 'categories' and grantee = 'anon';
```

Expected: 7 rows in the first query (one per category, matching the slugs above), 0 rows in the second query.

- [ ] **Step 3: Update `schema.sql`**

In the `categories` table definition, add:

```sql
slug text unique not null,
```

In the `catalog_search` view definition, add `c.slug as category_slug,` right after `c.name as category,` (matching the migration above exactly).

- [ ] **Step 4: Commit**

```bash
git add schema.sql
git commit -m "feat: agregar categories.slug y catalog_search.category_slug"
```

---

### Task 2: Scaffold the Next.js app in `web/`

**Files:**
- Create: `web/package.json`
- Create: `web/next.config.mjs`
- Create: `web/.env.example`
- Create: `web/README.md`
- Create: `web/lib/supabaseClient.js`
- Create: `web/app/layout.js` (minimal placeholder — Task 5 replaces it with the full header/footer version)
- Create: `web/app/globals.css`
- Create: `web/app/page.js` (minimal placeholder — Task 5 replaces it)

**Interfaces:**
- Produces: `getSupabaseClient()` from `web/lib/supabaseClient.js` — signature `getSupabaseClient(): SupabaseClient`, throws if `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing. Consumed by Task 4.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "citec-store-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --test lib/*.test.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Create `web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

- [ ] **Step 3: Create `web/.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=https://citec-store.vercel.app
```

- [ ] **Step 4: Create `web/lib/supabaseClient.js`**

```js
import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY son obligatorios (ver web/.env.example).'
    );
  }
  return createClient(url, anonKey);
}
```

- [ ] **Step 5: Create `web/app/globals.css`**

```css
:root {
  color-scheme: light;
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --color-muted: #6b7280;
  --color-accent: #0f766e;
  --color-border: #e5e7eb;
  --max-width: 1100px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--color-text);
  background: var(--color-bg);
  line-height: 1.5;
}

a {
  color: inherit;
  text-decoration: none;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.site-header {
  border-bottom: 1px solid var(--color-border);
}

.site-header .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
  padding-bottom: 1rem;
}

.site-header a.brand {
  font-weight: 700;
  font-size: 1.25rem;
}

.site-footer {
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 0.85rem;
}

.hero {
  padding: 2rem 0;
  text-align: center;
}

.hero h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.search-form {
  display: flex;
  gap: 0.5rem;
  max-width: 500px;
  margin: 1.5rem auto 0;
}

.search-form input {
  flex: 1;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
}

.search-form button {
  padding: 0.65rem 1.25rem;
  border: none;
  border-radius: 6px;
  background: var(--color-accent);
  color: white;
  font-size: 1rem;
  cursor: pointer;
}

.category-grid, .product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.category-card, .product-card {
  display: block;
  padding: 1.25rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.category-card {
  text-align: center;
  font-weight: 600;
}

.category-card:hover, .product-card:hover {
  border-color: var(--color-accent);
}

.product-card .product-name {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.product-card .product-price {
  color: var(--color-accent);
  font-weight: 700;
  margin-top: 0.5rem;
}

.product-card .product-stock {
  font-size: 0.85rem;
  color: var(--color-muted);
}

.pagination {
  display: flex;
  gap: 0.5rem;
  margin-top: 2rem;
  justify-content: center;
}

.pagination a, .pagination span {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.pagination .current {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.product-detail {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-width: 600px;
}

.product-detail .price {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-accent);
}

.whatsapp-button {
  display: inline-block;
  margin-top: 1rem;
  padding: 0.85rem 1.5rem;
  background: #25d366;
  color: white;
  border-radius: 6px;
  font-weight: 700;
  text-align: center;
  width: fit-content;
}

.empty-state {
  padding: 3rem 0;
  text-align: center;
  color: var(--color-muted);
}
```

- [ ] **Step 6: Create placeholder `web/app/layout.js`**

```js
import './globals.css';

export const metadata = {
  title: 'Citec Store',
  description: 'Catálogo de tecnología — laptops, impresoras, monitores y más.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create placeholder `web/app/page.js`**

```js
export default function HomePage() {
  return (
    <main className="container">
      <h1>Citec Store</h1>
      <p>En construcción.</p>
    </main>
  );
}
```

- [ ] **Step 8: Create `web/README.md`**

```markdown
# Citec Store — Frontend (Fase 4)

Next.js (App Router) leyendo únicamente la vista `catalog_search` de Supabase.

## Desarrollo local

1. `cd web`
2. `npm install`
3. Copiar `.env.example` a `.env.local` y completar `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave `anon`/publishable del proyecto `rqrbgjzdcvieqbpexgen` — ver Supabase → Settings → API).
4. `npm run dev` — http://localhost:3000
5. `npm test` — corre los tests de `lib/*.test.js`

## Despliegue

Proyecto Vercel del equipo `CITEC` (ya existe). Al crear el proyecto en Vercel:
- Root Directory: `web`
- Variables de entorno: las mismas de `.env.example`, con los valores reales de producción.
- Framework preset: Next.js (autodetectado).
```

- [ ] **Step 9: Install dependencies and verify the app builds**

```bash
cd web
npm install
npm run build
```

Expected: build succeeds (the placeholder home page and layout are enough for a valid Next.js build). This is the verification step for this task — there's no unit-testable logic yet.

- [ ] **Step 10: Commit**

```bash
git add web/
git commit -m "feat: scaffold del frontend Next.js (Fase 4)"
```

---

### Task 3: Pure helpers — slugs, formatting, search-query construction

**Files:**
- Create: `web/lib/slug.js`
- Create: `web/lib/slug.test.js`
- Create: `web/lib/format.js`
- Create: `web/lib/format.test.js`
- Create: `web/lib/searchQuery.js`
- Create: `web/lib/searchQuery.test.js`

**Interfaces:**
- Produces: `slugify(text): string`, `buildProductSlug(model, id): string`, `extractProductId(slugParam): string|null` from `slug.js`.
- Produces: `formatPrice(value): string`, `formatLeadTime(maxLeadDays): string`, `stockLabel(status): string`, `buildWhatsappUrl({phone, productName}): string` from `format.js`.
- Produces: `buildSearchWords(query): string[]`, `buildSearchOrFilters(words, columns): string[]` from `searchQuery.js`.
- Consumed by: Task 4 (`catalogSearch.js`), Task 6/7/8 (page components).

- [ ] **Step 1: Write the failing tests for `slug.js`**

Create `web/lib/slug.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && node --test lib/slug.test.js
```

Expected: FAIL — `Cannot find module './slug.js'`.

- [ ] **Step 3: Implement `web/lib/slug.js`**

```js
const UUID_SUFFIX_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(text) {
  return (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function buildProductSlug(model, id) {
  const base = slugify(model) || 'producto';
  return `${base}-${id}`;
}

export function extractProductId(slugParam) {
  const match = (slugParam ?? '').toString().match(UUID_SUFFIX_RE);
  return match ? match[0] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && node --test lib/slug.test.js
```

Expected: PASS, all 9 tests.

- [ ] **Step 5: Write the failing tests for `format.js`**

Create `web/lib/format.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatLeadTime, stockLabel, buildWhatsappUrl } from './format.js';

test('formatPrice da formato de soles con 2 decimales', () => {
  assert.equal(formatPrice(1234.5), 'S/ 1,234.50');
  assert.equal(formatPrice(9.9), 'S/ 9.90');
});

test('formatLeadTime: sin dato es "consultar"', () => {
  assert.match(formatLeadTime(null), /consultar/i);
  assert.match(formatLeadTime(undefined), /consultar/i);
});

test('formatLeadTime: 0 días es mismo día', () => {
  assert.match(formatLeadTime(0), /mismo día/i);
});

test('formatLeadTime: 1 día es singular', () => {
  assert.equal(formatLeadTime(1), 'Entrega en 1 día hábil');
});

test('formatLeadTime: más de 1 día es plural con el número', () => {
  assert.equal(formatLeadTime(3), 'Entrega en hasta 3 días hábiles');
});

test('stockLabel mapea los 3 estados conocidos y cualquier otro valor a "consultar"', () => {
  assert.match(stockLabel('in_stock'), /en stock/i);
  assert.match(stockLabel('low_stock'), /últimas unidades/i);
  assert.match(stockLabel('out_of_stock'), /consultar/i);
  assert.match(stockLabel('valor-desconocido'), /consultar/i);
});

test('buildWhatsappUrl arma el link wa.me con el mensaje codificado', () => {
  const url = buildWhatsappUrl({ phone: '51969328181', productName: 'Monitor Lenovo 27' });
  assert.ok(url.startsWith('https://wa.me/51969328181?text='));
  assert.ok(url.includes(encodeURIComponent('Monitor Lenovo 27')));
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
cd web && node --test lib/format.test.js
```

Expected: FAIL — `Cannot find module './format.js'`.

- [ ] **Step 7: Implement `web/lib/format.js`**

```js
const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(value) {
  return `S/ ${priceFormatter.format(Number(value))}`;
}

export function formatLeadTime(maxLeadDays) {
  if (maxLeadDays === null || maxLeadDays === undefined) {
    return 'Consultar plazo de entrega';
  }
  if (maxLeadDays <= 0) {
    return 'Entrega el mismo día (según stock y ciudad)';
  }
  if (maxLeadDays === 1) {
    return 'Entrega en 1 día hábil';
  }
  return `Entrega en hasta ${maxLeadDays} días hábiles`;
}

export function stockLabel(status) {
  if (status === 'in_stock') return 'En stock';
  if (status === 'low_stock') return 'Últimas unidades';
  return 'Consultar disponibilidad';
}

export function buildWhatsappUrl({ phone, productName }) {
  const message = `Hola, estoy interesado en: ${productName}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd web && node --test lib/format.test.js
```

Expected: PASS, all 7 tests.

- [ ] **Step 9: Write the failing tests for `searchQuery.js`**

Create `web/lib/searchQuery.test.js`:

```js
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
```

- [ ] **Step 10: Run tests to verify they fail**

```bash
cd web && node --test lib/searchQuery.test.js
```

Expected: FAIL — `Cannot find module './searchQuery.js'`.

- [ ] **Step 11: Implement `web/lib/searchQuery.js`**

```js
const RESERVED_CHARS_RE = /[,()*%_]/g;

export function buildSearchWords(query) {
  return (query ?? '')
    .toString()
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(RESERVED_CHARS_RE, ''))
    .filter(Boolean);
}

export function buildSearchOrFilters(words, columns) {
  return words.map((word) => columns.map((col) => `${col}.ilike.*${word}*`).join(','));
}
```

- [ ] **Step 12: Run tests to verify they pass**

```bash
cd web && node --test lib/searchQuery.test.js
```

Expected: PASS, all 5 tests.

- [ ] **Step 13: Run the full `web/lib` test suite**

```bash
cd web && npm test
```

Expected: all 21 tests passing (9 + 7 + 5).

- [ ] **Step 14: Commit**

```bash
git add web/lib/slug.js web/lib/slug.test.js web/lib/format.js web/lib/format.test.js web/lib/searchQuery.js web/lib/searchQuery.test.js
git commit -m "feat: helpers puros de slugs, formato y búsqueda (Fase 4)"
```

---

### Task 4: Data access layer — `catalogSearch.js`

**Files:**
- Create: `web/lib/catalogSearch.js`
- Create: `web/lib/catalogSearch.test.js`

**Interfaces:**
- Consumes: `getSupabaseClient()` from `web/lib/supabaseClient.js` (Task 2); `buildSearchWords`, `buildSearchOrFilters` from `web/lib/searchQuery.js` (Task 3).
- Produces:
  - `getCategories({ supabaseClient } = {}): Promise<{name: string, slug: string}[]>`
  - `getProductsByCategory({ slug, page = 1, supabaseClient }): Promise<{products: object[], total: number, page: number, pageSize: number}>`
  - `getProductById(id, { supabaseClient } = {}): Promise<object|null>`
  - `searchProducts({ query, page = 1, supabaseClient }): Promise<{products: object[], total: number, page: number, pageSize: number}>`
  - `getAllProductsForSitemap({ supabaseClient } = {}): Promise<{id: string, model: string, last_synced_at: string|null}[]>`
- Consumed by: Task 6 (category page), Task 7 (product page), Task 8 (search page), Task 9 (sitemap).

All functions accept an optional injected `supabaseClient` (same dependency-injection pattern already used in `lib/syncCommon.js` at the repo root) so tests never hit real Supabase.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/catalogSearch.test.js`:

```js
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
  const supabase = makeFakeSupabase({ data: [], error: null, count: 0 });
  const result = await getProductsByCategory({ slug: 'monitores', supabaseClient: supabase });
  assert.equal(result.page, 1);
  const rangeCall = supabase.lastQuery._calls.find(([name]) => name === 'range');
  assert.deepEqual(rangeCall[1], [0, 23]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && node --test lib/catalogSearch.test.js
```

Expected: FAIL — `Cannot find module './catalogSearch.js'`.

- [ ] **Step 3: Implement `web/lib/catalogSearch.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && node --test lib/catalogSearch.test.js
```

Expected: PASS, all 9 tests.

- [ ] **Step 5: Run the full `web/lib` suite**

```bash
cd web && npm test
```

Expected: all 30 tests passing (21 from Task 3 + 9 here).

- [ ] **Step 6: Commit**

```bash
git add web/lib/catalogSearch.js web/lib/catalogSearch.test.js
git commit -m "feat: capa de datos catalogSearch.js sobre catalog_search (Fase 4)"
```

---

### Task 5: Home page + final layout (header/footer)

**Files:**
- Modify: `web/app/layout.js` (replace the Task 2 placeholder)
- Modify: `web/app/page.js` (replace the Task 2 placeholder)

**Interfaces:**
- Consumes: `getCategories()` from `web/lib/catalogSearch.js` (Task 4).

No new pure logic here — verified manually (Step 3) rather than with `node --test`, consistent with the project's stated approach of manual browser verification for page-level UI.

- [ ] **Step 1: Replace `web/app/layout.js`**

```js
import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: {
    default: 'Citec Store',
    template: '%s',
  },
  description:
    'Catálogo de tecnología — laptops, impresoras, monitores y más, con precios y stock actualizados.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              Citec Store
            </Link>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container">
            <p>&copy; {new Date().getFullYear()} Citec Store</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace `web/app/page.js`**

```js
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
```

- [ ] **Step 3: Verify manually**

```bash
cd web && npm run dev
```

Open `http://localhost:3000`, confirm: the 7 category tiles render with the real category names, the search box is present, and submitting a query navigates to `/buscar?q=...` (the page itself is built in Task 8 — a 404 here at this point in the plan is expected and fine).

- [ ] **Step 4: Commit**

```bash
git add web/app/layout.js web/app/page.js
git commit -m "feat: página de inicio con categorías y buscador (Fase 4)"
```

---

### Task 6: Category listing page

**Files:**
- Create: `web/app/categoria/[slug]/page.js`

**Interfaces:**
- Consumes: `getCategories`, `getProductsByCategory` from `web/lib/catalogSearch.js` (Task 4); `formatPrice`, `stockLabel` from `web/lib/format.js` (Task 3); `buildProductSlug` from `web/lib/slug.js` (Task 3).

- [ ] **Step 1: Create `web/app/categoria/[slug]/page.js`**

```js
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
```

- [ ] **Step 2: Verify manually**

```bash
cd web && npm run dev
```

Visit `http://localhost:3000/categoria/monitores` (or any of the 7 slugs from Task 1). Confirm: category name as `<h1>`, product count, product cards with price and stock label, pagination links if there's more than one page, and that each product card links to `/producto/<slug>-<uuid>`. Visit `http://localhost:3000/categoria/no-existe` and confirm it 404s.

- [ ] **Step 3: Commit**

```bash
git add web/app/categoria/
git commit -m "feat: página de listado por categoría, paginada (Fase 4)"
```

---

### Task 7: Product detail page

**Files:**
- Create: `web/app/producto/[slugId]/page.js`

**Interfaces:**
- Consumes: `getProductById` from `web/lib/catalogSearch.js` (Task 4); `extractProductId` from `web/lib/slug.js` (Task 3); `formatPrice`, `formatLeadTime`, `stockLabel`, `buildWhatsappUrl` from `web/lib/format.js` (Task 3).

- [ ] **Step 1: Create `web/app/producto/[slugId]/page.js`**

```js
import { notFound } from 'next/navigation';
import { getProductById } from '../../../lib/catalogSearch.js';
import { extractProductId } from '../../../lib/slug.js';
import { formatPrice, formatLeadTime, stockLabel, buildWhatsappUrl } from '../../../lib/format.js';

export const revalidate = 3600;

const WHATSAPP_PHONE = '51969328181';

export async function generateMetadata({ params }) {
  const { slugId } = await params;
  const id = extractProductId(slugId);
  if (!id) return {};

  const product = await getProductById(id);
  if (!product) return {};

  return {
    title: `${product.model} | Citec Store`,
    description: `${product.model}${product.brand ? ' — ' + product.brand : ''} — ${formatPrice(
      product.final_price
    )}. ${stockLabel(product.stock_status)} en Citec Store.`,
  };
}

export default async function ProductPage({ params }) {
  const { slugId } = await params;
  const id = extractProductId(slugId);
  if (!id) {
    notFound();
  }

  const product = await getProductById(id);
  if (!product) {
    notFound();
  }

  const whatsappUrl = buildWhatsappUrl({ phone: WHATSAPP_PHONE, productName: product.model });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.model,
    brand: product.brand || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'PEN',
      price: product.final_price,
      availability:
        product.stock_status === 'out_of_stock'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
    },
  };

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="product-detail">
        <h1>{product.model}</h1>
        {product.brand && <p>Marca: {product.brand}</p>}
        <p className="price">{formatPrice(product.final_price)}</p>
        <p>{stockLabel(product.stock_status)}</p>
        <p>{formatLeadTime(product.max_lead_days)}</p>
        {product.warehouse_city && (
          <p>
            Despacho desde: {product.warehouse_name} ({product.warehouse_city})
          </p>
        )}
        <a className="whatsapp-button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Consultar por WhatsApp
        </a>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify manually**

```bash
cd web && npm run dev
```

From a category page (Task 6), click into a product. Confirm: model, brand (if present), price in `S/ X,XXX.XX` format, stock label, plazo de entrega, warehouse info (if present), and a WhatsApp button that opens `https://wa.me/51969328181?text=...` with the product name url-encoded in the message. View page source and confirm the `<script type="application/ld+json">` block is present with the product's real price. Visit a URL with a made-up id suffix (e.g. `/producto/algo-00000000-0000-0000-0000-000000000000`) and confirm it 404s.

- [ ] **Step 3: Commit**

```bash
git add web/app/producto/
git commit -m "feat: página de detalle de producto con JSON-LD y CTA de WhatsApp (Fase 4)"
```

---

### Task 8: Search results page

**Files:**
- Create: `web/app/buscar/page.js`

**Interfaces:**
- Consumes: `searchProducts` from `web/lib/catalogSearch.js` (Task 4); `formatPrice`, `stockLabel` from `web/lib/format.js` (Task 3); `buildProductSlug` from `web/lib/slug.js` (Task 3).

- [ ] **Step 1: Create `web/app/buscar/page.js`**

```js
import Link from 'next/link';
import { searchProducts } from '../../lib/catalogSearch.js';
import { formatPrice, stockLabel } from '../../lib/format.js';
import { buildProductSlug } from '../../lib/slug.js';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return {
    title: 'Buscar productos | Citec Store',
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }) {
  const { q, page: pageParam } = await searchParams;
  const query = (q ?? '').toString();
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const { products, total, pageSize } = await searchProducts({ query, page });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="container">
      <h1>Resultados para &ldquo;{query}&rdquo;</h1>
      <p>
        {total} producto{total === 1 ? '' : 's'} encontrado{total === 1 ? '' : 's'}
      </p>

      {products.length === 0 ? (
        <p className="empty-state">No se encontraron productos para esa búsqueda.</p>
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
              <Link key={n} href={`/buscar?q=${encodeURIComponent(query)}&page=${n}`}>
                {n}
              </Link>
            )
          )}
        </nav>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify manually**

```bash
cd web && npm run dev
```

From the home page (Task 5), search for a term you know matches real products (e.g. a brand from the category page you already viewed). Confirm results render with the same product-card layout as the category page, and that pagination works if there are more than 24 results. Search for a nonsense term (e.g. `zzzznoexiste`) and confirm the "no se encontraron productos" empty state renders (200, not an error). View page source and confirm the search page has a `noindex` robots meta tag.

- [ ] **Step 3: Commit**

```bash
git add web/app/buscar/
git commit -m "feat: página de resultados de búsqueda (Fase 4)"
```

---

### Task 9: Sitemap and robots.txt

**Files:**
- Create: `web/app/sitemap.js`
- Create: `web/app/robots.js`

**Interfaces:**
- Consumes: `getCategories`, `getAllProductsForSitemap` from `web/lib/catalogSearch.js` (Task 4); `buildProductSlug` from `web/lib/slug.js` (Task 3).

- [ ] **Step 1: Create `web/app/sitemap.js`**

```js
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
```

- [ ] **Step 2: Create `web/app/robots.js`**

```js
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://citec-store.vercel.app';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/buscar'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

- [ ] **Step 3: Verify manually**

```bash
cd web && npm run dev
```

Visit `http://localhost:3000/sitemap.xml` and confirm it lists the home page, the 7 category URLs, and product URLs (~2,300 `<url>` entries). Visit `http://localhost:3000/robots.txt` and confirm it disallows `/buscar` and points `Sitemap:` at `/sitemap.xml`.

- [ ] **Step 4: Commit**

```bash
git add web/app/sitemap.js web/app/robots.js
git commit -m "feat: sitemap.xml y robots.txt dinámicos (Fase 4)"
```

---

### Task 10: Full manual verification pass

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full test suite**

```bash
cd web && npm test
```

Expected: all 39 tests passing (Task 3: 21, Task 4: 9, plus any adjustments — confirm the actual count matches what Tasks 3–4 left passing).

- [ ] **Step 2: Full build**

```bash
cd web && npm run build
```

Expected: succeeds, including static generation of the home page and the 7 category pages (`generateStaticParams`).

- [ ] **Step 3: Manual browser walkthrough**

With `npm run dev` running, walk the full golden path in a browser: inicio → clic en una categoría → clic en un producto → botón de WhatsApp (confirmar que abre con el mensaje correcto, sin necesidad de completarlo) → volver e ingresar una búsqueda con resultados → una búsqueda sin resultados → una URL de categoría inexistente (404) → una URL de producto inexistente (404).

- [ ] **Step 4: Report to Roger**

Summarize what was verified, note the exact env vars needed (already in `web/.env.example` and `web/README.md`), and hand off for Roger to create the Vercel project (team `CITEC`, Root Directory `web`) and deploy, per the spec's confirmed deployment ownership.

---

## Self-Review Notes

- **Spec coverage:** rutas (Task 6/7/8/1), slugs de categoría vía `catalog_search.category_slug` (Task 1, incorporating Cowork's correction), slug de producto por id completo (Task 3 — refined from the spec's "8 caracteres" sketch to the *full* uuid, since Postgres/PostgREST can't `LIKE`-filter a `uuid` column for a prefix match without an extra cast; using the full id keeps `getProductById` a simple, correct `.eq('id', id)` and still satisfies the spec's actual requirement — resolve by id, not by the cosmetic slug text — so links survive a `model` change), búsqueda ILIKE multi-columna AND-de-ORs (Task 3/4), paginación 24/página (Task 4), SEO metadata + JSON-LD + sitemap/robots (Task 7/9), CTA de WhatsApp (Task 7), manejo de errores/404 (Task 6/7), testing con `node --test` + verificación manual (todas las tareas), variables de entorno documentadas (Task 2). All covered.
- **Placeholder scan:** none found — every step has real code or a concrete manual-verification checklist.
- **Type consistency:** `getProductsByCategory`/`searchProducts` both return `{products, total, page, pageSize}` consistently across Task 4 and their Task 6/8 consumers; `buildProductSlug(model, id)` and `extractProductId(slugParam)` signatures match between Task 3's definition and Task 6/7/8/9's usage.
