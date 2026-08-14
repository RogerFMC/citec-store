# Fase 4 — Buscador y frontend de Citec Store

Fecha: 2026-08-13
Estado: diseño aprobado, pendiente de plan de implementación.

## Contexto

Fases 0-3 y la primera etapa de Fase 2 (sync de Compudiskett y Deltron) ya
están resueltas. Citec Store tiene ~2,300 productos activos en la vista
`catalog_search` (Supabase, proyecto `rqrbgjzdcvieqbpexgen`), repartidos en
7 categorías:

| Categoría | Productos |
|---|---|
| Suministros | 705 |
| Accesorios y periféricos | 587 |
| Laptops y PCs | 292 |
| Impresoras | 268 |
| Monitores | 215 |
| Tarjetas de video | 142 |
| Estabilizadores y UPS | 90 |

Fase 4 construye el frontend público que reemplaza al sitio estático
Base44 actual: un buscador central con páginas indexables por Google,
consultando únicamente la vista `catalog_search` (nunca `products`
directo — esa vista está diseñada a propósito para no exponer costo ni
proveedor). Ver `INSTRUCCIONES_CLAUDE_CODE.md` sección 4 para el mandato
original.

**No incluye** carrito, checkout ni pasarela de pago — eso es Fase 5. El
único mecanismo de conversión en este corte es un botón de WhatsApp en la
página de producto.

## Decisiones confirmadas con Roger (brainstorming 2026-08-13)

1. **CTA de producto:** botón de WhatsApp (`https://wa.me/51969328181`)
   con el nombre del producto precargado en el mensaje. Sin formulario de
   cotización, sin tabla de leads — no hace falta backend adicional para
   esto.
2. **Identidad visual:** diseño libre/minimalista, sin atarse a la
   estética del sitio Base44 actual.
3. **Alcance del MVP:** solo lo esencial — inicio, buscador, listado por
   categoría, detalle de producto. Sin filtros de marca/precio ni orden
   personalizado en este corte (YAGNI; se agregan después si hace falta).
4. **Despliegue:** Roger lo hace él mismo (crear el proyecto en el equipo
   Vercel `CITEC` y desplegar) una vez que el código esté listo y probado
   localmente — mismo patrón de "yo preparo, tú confirmas/ejecutas pasos
   con consecuencias externas" usado en el resto de esta sesión.

## Stack

**Next.js (App Router) + Vercel + Supabase**, con `@supabase/supabase-js`
usando la clave `anon` (publishable), consultada **solo desde Server
Components** — nunca desde el navegador. Razones (evaluadas contra Astro
y una SPA con prerender manual, ver discusión de brainstorming):

- Next.js es el framework de Vercel: ISR de primera clase (páginas
  estáticas que se regeneran solas, sin redeploy, cuando corre un sync),
  Server Components que devuelven HTML ya armado con los datos (SEO real,
  no depende de JS del cliente).
- Encaja mejor que Astro con el roadmap de Fase 5 (carrito/checkout,
  formularios, rutas de servidor) — Astro es más fuerte para contenido
  puramente estático, pero este sitio va a necesitar interacción real
  pronto.
- Evita reconstruir a mano la indexabilidad que ya viene resuelta en
  Next.js (vs. una SPA con prerender manual).

`anon` ya tiene `SELECT` confirmado sobre `catalog_search` (verificado
contra Supabase antes de este diseño) — no hace falta ninguna política
RLS nueva.

## Rutas y páginas

| Ruta | Contenido | Renderizado |
|---|---|---|
| `/` | Tiles de las 7 categorías + buscador central | Estático (build time) |
| `/categoria/[slug]` | Listado paginado de una categoría | ISR (revalidate cada 1h) |
| `/producto/[slug]-[id]` | Detalle: modelo, marca, precio final, stock, almacén/procedencia, plazo estimado, botón WhatsApp | ISR (revalidate cada 1h) |
| `/buscar?q=...&page=N` | Resultados de búsqueda | Dinámico (SSR por request), `noindex` |
| `/sitemap.xml` | Categorías + todos los productos activos | Generado dinámicamente (`app/sitemap.ts`) |
| `/robots.txt` | Permite crawl completo salvo `/buscar` | Generado dinámicamente (`app/robots.ts`) |

**Slugs de categoría:** se agrega una columna `slug text unique` a
`categories` (migración chica en Supabase) en vez de duplicar un mapeo
categoría→slug en el frontend — fuente única de verdad, mismo criterio
que el resto del proyecto (Supabase como fuente de verdad). Valores
iniciales (7 filas, generados por slugify del nombre):

```
Laptops y PCs             -> laptops-y-pcs
Impresoras                -> impresoras
Suministros                -> suministros
Estabilizadores y UPS      -> estabilizadores-y-ups
Accesorios y periféricos   -> accesorios-y-perifericos
Monitores                  -> monitores
Tarjetas de video          -> tarjetas-de-video
```

**Slugs de producto:** generados en el momento de renderizar/enlazar
(sin columna nueva), a partir de `model` pasado por slugify (minúsculas,
sin tildes, espacios a guiones, truncado a ~60 caracteres) + `-` + los
primeros 8 caracteres del `id` (uuid) como sufijo de unicidad. Ejemplo:
`monitor-de-prueba-27-fhd-ips-100hz-a1b2c3d4`. La página de producto
resuelve por el sufijo del `id` (últimos 8 caracteres de la URL), no por
el slug completo — así un cambio de `model` en un futuro sync no rompe
enlaces ya indexados por Google (el slug es cosmético, el id manda).

## Datos y búsqueda

- Toda consulta a Supabase ocurre en Server Components / Route Handlers
  de Next.js, con la clave `anon`, apuntando siempre a `catalog_search`.
- **Búsqueda:** la query del usuario se separa en palabras (espacios),
  cada palabra se busca con `ILIKE %palabra%` contra `model`,
  `description`, `brand` y `part_number` (un `OR` entre las 4 columnas
  por palabra), y las palabras se combinan con `AND` — así "monitor
  lenovo 27" exige que las 3 palabras aparezcan en alguna de esas
  columnas, en cualquier orden. Sin `tsvector` ni índices nuevos: a
  ~2,300 filas un `ILIKE` sin índice es sobradamente rápido. Si la
  calidad de resultados se queda corta más adelante, se puede migrar a
  `tsvector`/trigram sin cambiar la interfaz de la función de búsqueda.
- **Paginación:** offset/limit, 24 productos por página tanto en
  categoría como en búsqueda. Sin scroll infinito (YAGNI).
- **Orden:** por `model` (alfabético) en categoría; por relevancia simple
  (coincidencias en `model`/`part_number` antes que en `description`) en
  búsqueda — sin selector de orden manual en este corte.

## SEO

- `generateMetadata` por página: `<title>`/`<meta description>` únicos
  por categoría (ej. "Monitores | Citec Store") y por producto (ej.
  "Monitor Lenovo 27 FHD IPS | Citec Store — S/ 850.00").
- JSON-LD tipo `Product` (`name`, `brand`, `offers.price`,
  `offers.availability` según `stock_status`) en cada página de
  producto — habilita resultados enriquecidos (precio/stock) en Google.
- Open Graph básico (título, descripción, imagen genérica del sitio —
  no hay fotos de producto individuales todavía; eso depende de que
  Fase 3/Cowork las incorpore a `products`, fuera de alcance de este
  spec).
- `/sitemap.xml` dinámico listando `/`, las 7 categorías y todos los
  productos activos de `catalog_search`. `/robots.txt` permite el crawl
  completo salvo `/buscar` (resultados de búsqueda marcados `noindex` vía
  metadata — contenido duplicado de bajo valor SEO, no aporta indexar
  cada combinación de query).

## Manejo de errores

- Producto no encontrado (id inválido, o desactivado desde el último
  build) → página 404 estándar de Next.js (`notFound()`).
- Categoría con slug inválido → 404.
- Búsqueda sin resultados → página normal (200) con mensaje "no se
  encontraron productos", nunca error — es un estado válido, no una
  falla.
- Fallo de conexión a Supabase en una página ISR → Next.js sirve la
  última versión cacheada (comportamiento default de ISR) en vez de
  romper; en SSR puro (`/buscar`) se muestra una página de error genérica
  sin filtrar detalles internos.

## Testing

- `node --test` para funciones puras: slugify de categoría/producto,
  construcción de la cláusula de búsqueda (dado un query string, qué
  `ILIKE`s genera), extracción del id desde un slug de producto,
  formateo de precio (`S/ 1,234.56`) y de plazo estimado.
- Verificación manual en navegador (obligatoria antes de dar por cerrado
  este corte, según las instrucciones generales del proyecto): inicio,
  una página de categoría, una página de producto, una búsqueda con
  resultados y una sin resultados, y el botón de WhatsApp abriendo con el
  mensaje correcto.
- Sin suite E2E (Playwright, etc.) en este primer corte — YAGNI, coincide
  con el alcance "solo lo esencial" acordado.

## Despliegue

- Next.js se despliega en Vercel sin configuración especial (preset
  automático). Variables de entorno necesarias en el proyecto Vercel:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave
  `anon`/publishable — segura de exponer al cliente, la seguridad real la
  da RLS, aunque en este diseño ni siquiera se llama desde el navegador).
- Roger crea el proyecto en el equipo Vercel `CITEC` (ya existe, no se
  crea uno nuevo) y despliega — Claude Code deja el código listo,
  probado localmente, con las variables de entorno documentadas en un
  `.env.example` actualizado.
- Dominio `ciacitec.com`: fuera de alcance de este spec (se coordina con
  Roger cuando el sitio esté listo para reemplazar al actual, según
  `INSTRUCCIONES_CLAUDE_CODE.md`).

## Fuera de alcance de este spec

- Carrito, checkout, pasarela de pago (Fase 5).
- Formulario de cotización / captura de leads (se descartó a favor de
  WhatsApp en este corte).
- Filtros por marca/precio, ordenar manualmente, scroll infinito.
- Fotos de producto (depende de Fase 3 / Cowork).
- Autenticación de usuarios / cuentas.
- Dominio propio (`ciacitec.com`) y corte de DNS.
- Migración/reescritura del historial de git del CSV de Deltron
  (pendiente de housekeeping, sin relación con este spec).
