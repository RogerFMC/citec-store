# Sincronizador de Compudiskett (piloto de Fase 2)

Fecha: 2026-08-12
Estado: aprobado por Roger, pendiente de implementación

## Contexto

Fase 2 de `Propuesta_Citec_Store_final.docx` pide sincronización real con los
proveedores piloto (`suppliers.is_pilot = true`): Compudiskett y Deltron.
Compudiskett se construye primero como prueba de concepto (instrucción
explícita: "validar con Compudiskett primero antes de replicar el patrón a
Deltron"). Ingram Micro también es piloto pero está en pausa (sección 5 de
`INSTRUCCIONES_CLAUDE_CODE.md`).

Antes de automatizar el portal se confirmó con Roger si Compudiskett ofrece
una alternativa a scraping (API/feed/EDI): no la tiene, solo el portal web.

## Investigación del portal

`https://ecommerce.compudiskett.com.pe/indexcdk.php` es un sitio PHP clásico
con jQuery, **no una SPA**. El listado de productos por categoría se obtiene
vía `POST /consultas/cdk_consultas/c_productos.php`, que devuelve un
fragmento HTML ya armado (no JSON) que el frontend inyecta directo en el DOM.
El catálogo con precios es público, no requiere login.

Cada card de producto trae:
- Un código interno estable del proveedor (ej. `0603-020113`), visible en la
  ruta de la imagen (`images/productos/{codigo}/...`) y en el atributo
  `onclick` (`busqueda_general('bus_rapida', ' ', ' ', '0603-020113')`).
- Marca (`AMD`, `INTEL`, ...).
- Un texto único que mezcla modelo y part number del fabricante
  (`"CPU AMD RYZEN 7 5700G AM4 100-100000263BOX"`), sin separar.
- Precio en USD.

La portada muestra un tipo de cambio publicado por el propio proveedor
("TCM: 3.380").

## Decisiones confirmadas con Roger

1. **Motor de scraping**: HTTP simple (`axios` + `cheerio`) contra los
   endpoints internos del sitio, no Playwright — el sitio no es una SPA y no
   requiere sesión para leer precios.
2. **Tipo de cambio**: se usa el TCM que Compudiskett publica en su propia
   portada el día de la corrida (no una tasa oficial externa, que sí se usa
   para las listas en PDF de otros proveedores). Razón: es la tasa que el
   proveedor mismo aplica ese día y no depende de una fuente externa
   adicional para un sync recurrente.
3. **Clave de upsert**: se agrega `products.supplier_sku` (código interno del
   proveedor) con índice único simple `(supplier_id, supplier_sku)` — ya
   aplicado en Supabase (migraciones `add_supplier_sku_for_sync_upsert` y
   `fix_supplier_sku_index_to_non_partial_for_upsert`, 2026-08-12). No se usó
   un índice parcial (`where supplier_sku is not null`): Postgres ya permite
   múltiples `NULL` en una columna única sin chocar entre sí, así que los
   productos cargados por PDF/foto (sin este dato) conviven sin problema, y
   un índice simple sí sirve como target directo de `ON CONFLICT` para el
   `upsert()` de supabase-js — uno parcial no, salvo que la consulta repita
   el mismo `WHERE`, cosa que supabase-js no hace.
4. **Categorías sin mapeo**: el sitio vende productos en categorías que no
   existen en `categories` (Procesadores, Placas Madre, RAM, Gabinetes,
   Almacenamiento). El piloto sincroniza solo lo que mapea a una categoría
   existente (Laptops y PCs, Impresoras, Suministros, Estabilizadores y UPS,
   Accesorios y periféricos, Monitores, Tarjetas de video); lo que no mapea
   se cuenta y se reporta en `sync_log.message`, sin bloquear la corrida.
   Decisión de agregar esas categorías queda pendiente para más adelante.

## Arquitectura

Un script Node por proveedor, mismo patrón que `sync_ingrammicro.skeleton.js`
(que queda documentado pero sigue en pausa). Lógica común (cliente de
Supabase con `service_role`, ciclo de vida de `sync_log`, `round2`/conversión
de moneda) se extrae a `lib/syncCommon.js` para no duplicarla entre
Compudiskett y Deltron.

```
sync_compudiskett.js       -- orquestador: fetch TCM, fetch por categoría, mapear, upsert, loggear
lib/syncCommon.js          -- cliente Supabase, helpers de sync_log, round2
lib/parseCompudiskett.js   -- parseo de HTML (cheerio) a filas crudas
```

## Flujo de datos

1. `GET indexcdk.php` → extraer el TCM del día desde el HTML de la portada.
2. Por cada categoría del sitio mapeada a una `categories.id` existente,
   `POST c_productos.php` paginado → parsear cada card con cheerio:
   `supplier_sku`, `brand`, texto crudo del nombre, precio USD.
3. Heurística para separar modelo / part number del texto crudo (best
   effort; casos ambiguos quedan con `part_number = null` en vez de
   adivinar mal).
4. `cost = round(precio_usd * tcm, 2)`.
5. Armar fila para `products`: `model`, `part_number`, `brand`, `description`,
   `category_id`, `supplier_id`, `supplier_sku`, `cost`,
   `cost_includes_igv: false`, `source_type: 'web_sync'`,
   `confidence: 'high'`. **Nunca** se escribe `final_price` — lo calcula
   `trg_compute_final_price` en Postgres.
6. `upsert` a `products` con conflicto en `(supplier_id, supplier_sku)`.
7. Categorías sin mapeo: se cuentan, no se sincronizan, van al mensaje final.

## Manejo de errores y logging

Cada corrida abre una fila en `sync_log` (`status: 'partial'`) al iniciar y
la cierra con `status` final (`success` / `failed` / `partial`),
`items_synced`, y `message` (incluye conteo de categorías omitidas por falta
de mapeo). `status: 'failed'` es lo que debe disparar la alerta por correo
(fuera del alcance de este spec — la alerta ya está prevista en las
instrucciones generales, se conecta cuando exista).

Credenciales: ninguna requerida para leer Compudiskett (catálogo público).
`SUPABASE_SERVICE_ROLE_KEY` sigue siendo obligatoria por variable de entorno,
nunca en código.

## Empaquetado

GitHub Action programada, cada 4-6 horas (ajustable después según
movimiento real del proveedor, mismo criterio que `suppliers.sync_frequency`).

## Testing

`node --test` (ya configurado en `package.json`):
- Parser HTML → filas, contra un fixture HTML real guardado del sitio (no se
  golpea el sitio en vivo en CI).
- Mapeo de categorías (incluye caso de categoría no mapeada).
- Conversión de moneda / redondeo.

No hay test end-to-end contra el sitio real en CI; la validación contra el
sitio real se hace manualmente antes de programar la GitHub Action.

## Fuera de alcance de este spec

- Deltron: se replica el mismo patrón después de validar Compudiskett en
  producción (instrucción explícita de Roger).
- Ingram Micro: sigue en pausa.
- Agregar las categorías faltantes (Procesadores, Placas Madre, RAM,
  Gabinetes, Almacenamiento) a `categories`: decisión pendiente de Roger.
- Alerta por correo ante `sync_log.status = 'failed'`.
