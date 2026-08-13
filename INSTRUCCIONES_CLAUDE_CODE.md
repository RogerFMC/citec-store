# Citec Store — Instrucciones para Claude Code (retomar Fase 2 y Fase 4)

Roger: pega este archivo completo como primer mensaje a Claude Code en tu terminal, dentro del repositorio que ya creaste. Da todo el contexto necesario para que arranque sin tener que volver a explicar nada por chat.

## 1. Contexto del proyecto

Citec Store está migrando su catálogo de un sitio estático (Base44) a un buscador central: base de datos propia en Supabase, motor de precios propio, sincronización periódica con proveedores, y un frontend nuevo con buscador + SEO. El plan completo está en `Propuesta_Citec_Store_final.docx` (Fases 0 a 7). Ya se resolvieron las Fases 0 y 1; lo que sigue es Fase 2 y Fase 4 (Fase 3 — ingesta de PDFs/fotos — la sigue cubriendo Claude en Cowork de forma manual por ahora).

## 2. Estado actual (no repetir este trabajo)

- **Supabase**: proyecto `citec-store`, ref `rqrbgjzdcvieqbpexgen`, región `sa-east-1`, PostgreSQL 17. Esquema completo aplicado (ver `schema.sql` en este repo, o consultar directamente el proyecto — es la fuente de verdad si hay diferencias con el archivo).
- **Vercel**: equipo `CITEC` (slug `citec`) ya existe y está conectado. Sin proyecto desplegado todavía — se crea cuando haya frontend que publicar.
- **GitHub**: repositorio ya creado por Roger, con acceso configurado para ti.
- **Motor de precios**: implementado en dos lugares que deben mantenerse en sync:
  - `pricingEngine.js` — función pura en Node, para pruebas/uso fuera de la base de datos.
  - Trigger `trg_compute_final_price` + función `compute_final_price()` en Postgres — este es el que realmente calcula `products.final_price` en cada insert/update. **Los scripts de sincronización NO deben calcular el precio final ellos mismos**: solo escriben `cost`, `cost_includes_igv`, `category_id`, `supplier_id` en `products`, y el trigger hace el resto.
- **Reglas de negocio vigentes** (confirmadas por Roger, no reinventar):
  - IGV 18% si el costo del proveedor no lo incluye.
  - Margen por categoría (tabla `categories.margin_pct`, hoy: Laptops y PCs 11%, Impresoras 12%, Suministros 15%, Estabilizadores y UPS 15%, Accesorios y periféricos 20%, Monitores 15%, Tarjetas de video 13% — **confirmar contra la base de datos**, esta tabla puede seguir creciendo).
  - Cargo fijo de S/5 sobre el precio final de **todo** producto, de todo proveedor (tabla `pricing_settings.fixed_charge_soles`, editable sin tocar código).
  - Algunos proveedores (los que llegan por lista PDF con precio ya "final") usan `suppliers.pricing_mode = 'final_price'`: para esos, `cost` ya es el precio de venta y el trigger solo le suma el cargo fijo, sin IGV ni margen de categoría.
- **Datos cargados**: 1,391 productos de 6 proveedores (Compudiskett, Deltron, Grupo Igarashi, Asia Trade Perú, catálogo propio de laptops remanufacturadas, Hard PC). Todos con `confidence = 'high'`, sin precios faltantes. Se cargaron a mano/por lista, **no** por sincronización automática todavía — eso es justamente lo que falta construir en Fase 2.
- **Almacenes y plazos de entrega** (tabla `warehouses`, con `supplier_id` para vincular sucursales a su proveedor):
  - Puntos propios de cobertura de CIACITEC: Trujillo y Cajamarca (sin stock físico propio ahí, pedidos salen directo del proveedor).
  - Regla: mismo día si el proveedor tiene stock en la misma ciudad del cliente; si no, máximo 3 días hábiles usando el almacén del proveedor más cercano.
  - Sucursales conocidas de Deltron: Chiclayo, Trujillo, Lima Principal.
  - Almacén de Hard PC: Trujillo.
  - **Importante**: la lógica de "buscar el almacén más cercano según la ciudad del cliente" es dinámica y depende de la dirección que ingrese el comprador — impleméntala en el checkout (Fase 5), no la precalcules por producto.
  - Los 1,377 productos cargados antes de que existiera esta tabla no tienen `warehouse_id` asignado. No es bloqueante, pero es un hueco de datos a tener en cuenta.

## 3. Qué construir ahora — Fase 2: sincronización real de proveedores piloto

Proveedores piloto (`suppliers.is_pilot = true`): **Compudiskett** y **Deltron**. (Ingram Micro también está marcado piloto pero queda en pausa — ver sección 5.)

- Compudiskett: `https://ecommerce.compudiskett.com.pe/indexcdk.php`
- Deltron: `https://www.deltron.com.pe/index_ant.php`

Para cada uno:
1. Confirmar con Roger si el proveedor ofrece una alternativa a scraping (API, feed CSV/Excel exportable, EDI) antes de automatizar el portal — es la recomendación explícita de la propuesta (sección 5) y evita romper la relación comercial.
2. Si no hay alternativa, construir el sincronizador (Playwright si el sitio es SPA, o scraping simple si es HTML plano) siguiendo el patrón ya esbozado en `sync_ingrammicro.skeleton.js` de este repo: credenciales por variables de entorno (nunca en código ni en el repo), nunca hardcodear IDs generados, y registrar cada corrida en la tabla `sync_log` (éxito/fallo/cantidad de items) para que las alertas por correo funcionen.
3. Empaquetarlo como GitHub Action programada (sugerido cada 4-6 horas, ajustable según movimiento real de cada proveedor).
4. Validar con Compudiskett primero como prueba de concepto antes de replicar el patrón a Deltron.
5. Los scripts deben escribir `cost` (mayorista, tal como lo entrega el proveedor) y dejar que el trigger calcule `final_price` — no dupliques la lógica de precios en el script de sync.

## 4. Qué construir después — Fase 4: buscador, frontend y SEO

- Vive en el stack propio (ya se descartó continuar sobre Base44), desplegado en el equipo Vercel `CITEC`.
- Página de inicio con categorías de referencia + buscador central por modelo/número de parte/marca/descripción.
- El frontend consulta **únicamente** la vista `catalog_search` (no expone costo ni proveedor — así está diseñada a propósito).
- Página de resultado/detalle de producto con precio final, procedencia/almacén de despacho, y plazo estimado.
- Renderizado que genere páginas indexables por Google (no solo resultados de buscador interno tipo SPA) — el SEO se construye junto con el frontend, no después, según la sección 9 de la propuesta.
- Cuando haya algo desplegable, crear el proyecto en el equipo Vercel `CITEC` (ya existe, no crear uno nuevo).
- El dominio `ciacitec.com` se apunta a Vercel más adelante, cuando el sitio esté listo para reemplazar al actual — coordinar con Roger antes de tocar el DNS.

## 5. En pausa / fuera de alcance por ahora

- **Ingram Micro Perú**: descartado del proyecto (decisión de Roger, 13/08/2026). Ingram Micro confirmó que no ofrecen API/feed propio. Se evaluó automatizar por scraping de todas formas, pero su portal (`pe.ingrammicro.com`) resultó ser una SPA de React con protección activa Akamai Bot Manager detectada en vivo — el riesgo de que la automatización quede bloqueada, incluso en el script de producción y no solo en la exploración, hizo que Roger decidiera no construir este sync. `sync_ingrammicro.skeleton.js` queda como referencia histórica del patrón de sync, no se retoma.
- **Intcomex**: proveedor registrado en `suppliers` pero sin productos cargados. No hay lista ni acceso todavía.
- **Carrito, checkout y pasarela de pago (Niubiz/Culqi)**: Fase 5, no ahora.

## 6. Cómo coordinar con Cowork

Claude (este espacio de trabajo con Roger) sigue procesando listas nuevas de proveedores en PDF/foto y cargándolas directo a Supabase con precio final ya calculado — no dupliques ese trabajo. Si durante la Fase 2 encuentras huecos de datos (categorías faltantes, proveedores sin margen configurado, almacenes sin confirmar), repórtaselo a Roger para que lo resuelva con Cowork o directamente contigo, según corresponda.
