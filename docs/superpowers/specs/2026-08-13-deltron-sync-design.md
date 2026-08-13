# Sincronizador de Deltron

Fecha: 2026-08-13
Estado: aprobado por Roger, pendiente de implementación

## Contexto

Segundo proveedor piloto de Fase 2 (`suppliers.is_pilot = true`), replicando
el patrón ya validado en producción con Compudiskett
([2026-08-12-compudiskett-sync-design.md](2026-08-12-compudiskett-sync-design.md)).
Antes de automatizar se confirmó con Roger si Deltron ofrece una alternativa
a scraping: sí — un reporte CSV de lista de precios exportable, que es
justo la alternativa que la propuesta original recomendaba buscar primero.

## Investigación

`https://www.deltron.com.pe` es un sitio PHP clásico (no SPA) similar a
Compudiskett en tecnología, pero con dos diferencias grandes:

1. **El catálogo con precios está detrás de login** (a diferencia de
   Compudiskett, que es público). El login es **HTTP Basic Auth** puro
   (verificado: `GET /login.php` devuelve `401 Unauthorized`, sin ningún
   `<form>` HTML) — no hace falta simular un formulario ni manejar sesión
   compleja, solo un header `Authorization: Basic base64(usuario:clave)`.
2. **Existe un export CSV de lista de precios completo**, en
   `GET https://www.deltron.com.pe/modulos/productos/listaprodnw.php`
   (mismo mecanismo de Basic Auth), que Roger descargó manualmente y
   compartió para este análisis. Esto reemplaza por completo la necesidad
   de scraping HTML — el sync de Deltron es un parser de CSV, no un
   scraper de HTML.

### Formato del CSV (verificado contra un export real)

- **Codificación: Latin-1 / Windows-1252, no UTF-8** (confirmado
  byte a byte: `Ñ` se codifica como `0xD1`, que corrompe a un carácter
  inválido si se decodifica como UTF-8 — ej. "IMPRESION_CORTE_DISEÑO" se ve
  como "IMPRESION_CORTE_DISE�O"). El parser debe decodificar explícitamente
  como `latin1`.
- Encabezado del archivo con metadata global: título, fecha de generación,
  almacenes incluidos (`'PRINCIPAL-CORPAC','CHICLAYO','TRUJILLO'`), y
  `TIPO DE CAMBIO :3.380` — mismo criterio que Compudiskett: se usa el TCM
  que el propio proveedor publica en el archivo de esa corrida.
- El resto del archivo son **bloques repetidos por categoría interna de
  Deltron** ("línea"): una fila separadora, una fila de encabezado de
  columnas (con el nombre de la categoría insertado donde iría
  "DESCRIPCIÓN"), y las filas de datos:

  ```
  "_______________","_______________","__________________________________","__________"
  " ","CODIGO","NOTEBOOK AMD RYZEN 5","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"
  "notebook amd ryzen 5","nbase1504bq5556","nb asus vivobook go 15 e1504fa-...",>20,665.00, ,"","D","asus - consumo"
  ```

  Columnas de cada fila de datos: categoría (redundante, en minúsculas),
  `CODIGO` (SKU interno de Deltron), descripción, `STOCK`, `PREC DISTRIB
  US $`, `PREC S/.` (vacío en el export — no se usa), `FLETE` (vacío),
  `GARAN` (código de garantía, no usado), `MARCA`.
- **Hay 233 categorías internas distintas** en el archivo (mucho más
  granular que Compudiskett). Se mapean a las 7 categorías de Citec Store
  con el mismo criterio ya usado en Compudiskett (ver tabla completa más
  abajo); el resto queda sin mapear, se cuenta y se reporta.
- **`STOCK` sí trae datos reales de inventario**, a diferencia de
  Compudiskett: `>20` (más de 20 unidades), un número exacto (`10`, `1`,
  etc.), o vacío (sin stock). Esto permite poblar `stock_qty`/
  `stock_status` en `products` — Compudiskett no lo hacía.
- **Las descripciones vienen truncadas a ~100 caracteres** (limitación real
  del export de Deltron, verificado: la distribución de longitudes de
  descripción tiene un techo duro en 100-110 caracteres, con 480 filas
  exactamente en 100). No hay forma de recuperar el texto completo desde
  este archivo — es una limitación del origen de datos, no un bug del
  parser.
- **No hay un patrón separable de modelo/número de parte** al final de la
  descripción (a diferencia de Compudiskett). Se guarda la descripción
  completa como `model` y `part_number` queda siempre `null` para Deltron.
- **`PREC DISTRIB US $` es un campo CSV numérico propio, sin coma de
  miles** — a diferencia de Compudiskett (donde el precio vivía dentro de
  texto HTML y sí necesitaba limpieza). Verificación inicial de esto dio un
  falso positivo (`1,766.00` resultó ser `STOCK=1` seguido de
  `PRECIO=766.00`, dos columnas CSV distintas, no un precio con coma);
  se confirmó buscando precios *entre comillas* con coma de miles
  (`"1,766.00"`) y no hay ninguno en el archivo real. Precios reales llegan
  hasta ~$17,638.90 sin necesidad de manejo especial de comas.
- **Valor centinela `9999999.99`** aparece en 14 filas del archivo actual —
  significa "sin precio fijo, requiere cotización" (ej. garantías
  extendidas, servicios de housing). Estas filas se omiten (mismo
  tratamiento que una tarjeta sin precio parseable en Compudiskett): se
  cuentan, no se sincronizan.

## Decisiones confirmadas con Roger

1. **Mecanismo de obtención**: `GET listaprodnw.php` con HTTP Basic Auth,
   no un scraper de HTML. Sin sesión/cookies que mantener.
2. **Credenciales**: usuario = RUC de CIACITEC (`20491767678`), contraseña
   provista por Roger. Se guardan como `DELTRON_USERNAME` y
   `DELTRON_PASSWORD` en GitHub Secrets — nunca en código, mismo patrón que
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Tipo de cambio**: el que trae el propio archivo en esa corrida
   (`TIPO DE CAMBIO :3.380`), mismo criterio ya acordado para Compudiskett.
4. **Stock**: se puebla con datos reales del CSV.
   - Vacío → `stock_qty: 0`, `stock_status: 'out_of_stock'`.
   - Número exacto `N` → `stock_qty: N`, `stock_status`: `'out_of_stock'`
     si `N === 0`, `'low_stock'` si `1 <= N <= 5`, `'in_stock'` si `N > 5`.
   - `>20` → `stock_qty: null` (cantidad exacta desconocida, solo sabemos
     que es mayor a 20), `stock_status: 'in_stock'`.
5. **Categorías sin mapeo**: mismo criterio que Compudiskett — se cuentan
   y se reportan en `sync_log.message`, nunca bloquean la corrida. Tabla
   completa de mapeo (233 categorías de Deltron → 7 de Citec Store, el
   resto sin mapear):

| Nuestra categoría | Categorías de Deltron mapeadas |
|---|---|
| Laptops y PCs | BAREBONE, BAREBONES PARA PC, COMPUTADORA AIO CORE 5/7/i5/I7, COMPUTADORA AIO RYZEN 5/7, COMPUTADORA AIO ULTRA 7, COMPUTADORA AMD RYZEN 5/7, COMPUTADORA CORE 5/i5/i7, COMPUTADORA ULTRA 5/7/9, COMPUTADORA WORKSTATION, NOTEBOOK AMD ATHLON, NOTEBOOK AMD RYZEN 3/5/7/AI 7, NOTEBOOK CELERON, NOTEBOOK CORE 5/7/9/i3/i5/i7, NOTEBOOK CORE ULTRA 5/5 AI/7/7 AI/9, NOTEBOOK GAM CORE ULTRA 9, NOTEBOOK GAMING CORE 7/i5/i7/i9, NOTEBOOK GAMING RYZEN 5/7/9, NOTEBOOK GM CORE ULT 9 AI, NOTEBOOK GM CORE ULTX9 AI, NOTEBOOK GM RYZEN AI 7, NOTEBOOK WORKSTATION |
| Impresoras | COMERCIAL LASER, COMERCIAL MATRICIAL, COMERCIAL TANQUE TINTA, COMERCIAL TANQUE TINTA MU, COMERCIAL TICKETERA, CONSUMO TANQUE TINTA, CONSUMO TANQUE TINTA MULT, IMAGENES, ESCANER DE, IMPRESORA LASER/LED, IMPRESORA MULTIFUN LASER, IMPRESORA MULTIFUN TINTA, IMPRESORA TERMICA, IMPRESORA, ACCESORIOS DE |
| Suministros | MATERIALES_SUMINISTROS, SUMINIST P/ PLOTTERS, SUMINIST P/IMPR, BOTELLAS, SUMINIST P/IMPRES, BOLSAS, SUMINIST P/IMPRES, CINTAS, SUMINIST P/IMPRES, TINTAS |
| Estabilizadores y UPS | ESTABILIZADOR DE TENSION, UPS INTERACTIVO, UPS ONLINE, UPS, ACCESORIOS, UPS, OTROS |
| Accesorios y periféricos | ACC, MUEBLES DE COMPUTO, ACCESORIOS, ACCESORIOS USB, AUDIO, ACCESORIOS DE, AUDIO, AURICULAR C/MIC, AUDIO, AURICULAR C/MIC GM, AUDIO, AURICULAR INALAM, AUDIO, MICROFONO USB, AUDIO, PARLANTE INALAMBRC, CAMARA, WEBCAM, CARTUCHERA / PORTACABLES, MEM FLASH, COMPACT FLASH, MEM FLASH, SECURE DIGITAL, MEM FLASH, USB DRIVE, MOCHILA / BACKPACK, MOUSE INALAMBRICO, MOUSE PAD/MAT, ACCESORIOS, MOUSE PARA GAMERS, MOUSE USB, NOTEBOOK, ACC PROPIETARIO, NOTEBOOK, ACCESORIOS DE, NOTEBOOK, MALETIN/MOCHILA, SILLAS GAMER, SMART HOME - CAMARAS, SMART HOME - DISPOSITIVOS, TECLADO INALAMBRICO, TECLADO PARA GAMERS, TECLADO USB, TECLADO+MOUSE COMBO KIT, TECLADO+MOUSE KIT INALAMB |
| Monitores | MONITOR CURVO 23/27/34, MONITOR GAMING CURVO 23/27/31.5/34, MONITOR GAMING PLANO 23/25/27/31.5/34, MONITOR PLANO 21.45/23/25/27/29/31.5/34, MONITOR PORTABLE 14, MONITORES TFT 24 - 28, MONITORES, ACCESORIOS, MONITORES, RACK SOPORTE, MONITORES/PANTALLAS, ACC |
| Tarjetas de video | VIDEO, PCI EXP INTEL GAM, VIDEO, PCI EXP NVIDIA GAM, VIDEO, PCI EXP RADEON GAM, VIDEO, PCI EXPRESS NVIDIA |

   Sin mapear (se cuentan, no bloquean): CPU *, MB *, MEM DDR* (no-flash),
   SSD *, DISCO DURO *, CASES *, COOLER LIQUIDO *, FAN COOLER CPU, RED *,
   SERVIDORES *, MS */KASPERSKY */SOFT*/SOFTWARE* (licencias), TABLET *,
   T CELULARES ACCESORIOS, REP TB *, SERV, * (repuestos propietarios),
   SERVICIO*, GARANTIA EXTENDIDA, MERCHANDISING, MUESTRA *, PRECIO
   STANDARD, PRODUCTOS SIN CLASIFICAR, PROTEC - MASCARAS KN95, PANTALLAS/
   PIZARRAS TACTILES INTERC, AIRE ACOND. DE PRECISION, ASTERISK
   ACCESORIOS, MEDIDOR DE AISLAMIENTO, MULTIMETRO DIGITAL, PINZA
   AMPERIMETRICA DIG, INTERNET, SERVICIOS, TELEVISORES RACKS PARA,
   IMAGENES PROYECTOR, IMAGENES SCAN/COD/BARRAS, IMAGENES ACCESORIOS
   DISP, IMPRESION_CORTE_DISEÑO, CARRY-ON/EQUIPAJE DE MANO, ACCESORIOS
   ENSAMBLAJE, COMPONENTES REPUESTOS, DISCO DURO ACCESORIOS, Y PATCH
   CORD - COBRE, Y RACK, STORAGE * (NAS/almacenamiento/accesorios).

## Arquitectura

Mismo patrón de archivos que Compudiskett, reutilizando `lib/syncCommon.js`
y `pricingEngine.js` sin cambios:

```
sync_deltron.js            -- orquestador: fetch CSV, parsear, mapear, upsert, loggear
lib/deltronClient.js        -- GET con HTTP Basic Auth (sin sesión/cookies)
lib/parseDeltronPriceList.js -- parseo del CSV en bloques (texto puro, sin cheerio)
deltronCategoryMap.js       -- tabla de mapeo (ver arriba)
```

`lib/deltronClient.js` es más simple que su equivalente de Compudiskett: un
único `GET` con header `Authorization: Basic ...`, sin `setPage`/paginación.

## Flujo de datos

1. `GET listaprodnw.php` con Basic Auth → texto crudo, decodificado como
   `latin1`.
2. Extraer `TIPO DE CAMBIO` del encabezado del archivo.
3. Parsear el archivo en bloques: cada bloque empieza en una fila
   separadora + fila de encabezado (que trae el nombre de categoría), y
   contiene N filas de datos hasta el siguiente separador.
4. Por cada fila de datos: si el precio es exactamente `9999999.99`, se
   omite (sin precio real, requiere cotización) y se cuenta. Si la categoría del bloque mapea a una
   de las 7 categorías existentes: mapear a fila de `products` (`model` =
   descripción completa, `part_number: null`, `brand` = columna MARCA,
   `category_id`, `supplier_id`, `supplier_sku` = columna CODIGO,
   `cost = round(precio_usd * tcm, 2)`, `cost_includes_igv: false`,
   `stock_qty`/`stock_status` según la regla de la sección anterior,
   `source_type: 'web_sync'`, `confidence: 'high'`). **Nunca** se escribe
   `final_price`.
5. Categorías sin mapeo: se cuentan, no se sincronizan.
6. `upsert` a `products` con conflicto en `(supplier_id, supplier_sku)` —
   mismo índice único ya usado por Compudiskett, deduplicado y en chunks de
   500 (mismo patrón ya construido y corregido en Compudiskett tras la
   revisión final de ese plan).

## Manejo de errores y logging

Mismo contrato que Compudiskett: `sync_log` se abre apenas se conoce
`supplier_id` (antes de cualquier llamada que pueda fallar, incluyendo el
fetch del CSV) y se cierra con `status`/`items_synced`/`message`. Un fallo
de autenticación (401) o de red en el `GET` del CSV completo hace que toda
la corrida falle (`status: 'failed'`) — a diferencia de Compudiskett, aquí
no hay "búsquedas" individuales por categoría que puedan fallar
independientemente, porque todo viene en un solo archivo.

## Testing

`node --test`, mismo patrón que Compudiskett:
- Parser del CSV en bloques, contra un fixture real (un recorte pequeño y
  representativo del archivo compartido por Roger, no el archivo completo
  — el archivo completo tiene datos de precios mayoristas reales de
  Deltron y no se commitea al repo).
- Mapeo de categorías (incluye caso de categoría no mapeada).
- Regla de `stock_qty`/`stock_status` (los 3 casos: vacío, número exacto,
  `>20`).
- Decodificación Latin-1 (un caso con `Ñ`/tilde en la descripción o marca).

No hay test end-to-end contra el sitio real en CI. La validación contra el
archivo real se hace manualmente (ejecutando el script con las credenciales
reales) antes de programar la GitHub Action, mismo proceso que se siguió
con Compudiskett — incluyendo la lección aprendida ahí: un fixture pequeño
no expone todos los casos reales, así que la corrida manual contra
producción es la que realmente valida el parser.

## Fuera de alcance de este spec

- Ingram Micro e Intcomex: siguen fuera de alcance (ver instrucciones
  generales).
- Alerta por correo ante `sync_log.status = 'failed'`.
- Refinar la clasificación de las categorías sin mapear (CPU, RAM,
  motherboards, redes, servidores, software, tablets, celulares): decisión
  pendiente de Roger, igual que con Compudiskett.
- Reconciliar diferencias de mapeo entre el criterio de Compudiskett y el
  de Deltron para productos que ambos proveedores venden bajo taxonomías
  distintas (no es necesario: cada producto vive en su propia fila de
  `products`, con su propio `supplier_id`, y ambos mapean a las mismas 7
  categorías de destino).
