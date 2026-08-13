# Sincronizador de Deltron

Fecha: 2026-08-13
Estado: implementado y en uso — mecanismo de obtención del archivo pivoteado
post-implementación (ver "Corrección post-implementación" más abajo).

## Corrección post-implementación (2026-08-13, ~22:00)

**La sección "Investigación" de abajo describe la hipótesis original, que
resultó ser incorrecta en un punto clave: `GET listaprodnw.php` con Basic
Auth NO devuelve el CSV.** Se implementó igual (commits hasta `556e90b`),
se corrió contra producción, y falló. Investigación en vivo (ver
`REVISIONES_COWORK.md`, entradas ~21:45-22:00) confirmó:

- `GET listaprodnw.php` con `Authorization: Basic` devuelve `200 OK`, pero
  el cuerpo son 9771 caracteres de una página HTML — el formulario "Lista
  de Precios y Stock" (checkboxes de almacén + botones de formato), no el
  CSV real de ~322KB.
- El botón "CSV" de ese formulario dispara, vía JavaScript, un `POST` a un
  endpoint distinto (`listaprecios.php?tipo=csv&rand=<valor>`). Se intentó
  reproducir ese POST con varias variantes (cookie, `Referer`, `rand`
  fresco tomado de una carga real del formulario) — todas devolvieron
  `200 OK` con **0 bytes**, sin causa identificada.
- `Basic Auth` evita el `401` de `/login.php`, pero el sitio depende de una
  sesión de aplicación real (cookies `deltronlogin`/`razsoc`/`grupo`/
  `cartera`, que el servidor siempre devuelve marcadas como `deleted` en
  estos intentos) que no se logró reproducir con peticiones HTTP sueltas.

**Decisión de Roger (2026-08-13):** no invertir en automatización más
pesada (Playwright reproduciendo el flujo de navegador completo) por
ahora. El sync pasa a leer el CSV desde un **archivo local**
(`data/deltron/lista_precios.csv`, fuera de git) que alguien descarga a
mano del portal cada cierto tiempo — mismo dato, origen distinto. El
parser, el mapeo de categorías y el orquestador (todo lo documentado más
abajo en este spec, salvo la sección de obtención del archivo) siguen
siendo válidos sin cambios; ver "Arquitectura" y "Flujo de datos"
actualizados para el mecanismo real vigente.

`lib/deltronClient.js` conserva `fetchPriceList` (HTTP Basic Auth) como
mecanismo documentado pero no usado por defecto — queda ahí por si en el
futuro se resuelve la sesión de aplicación o se invierte en Playwright.

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

- **Codificación: UTF-8** (corregido 2026-08-13 ~22:30 — se había asumido
  Latin-1/Windows-1252 originalmente, incorrecto: verificado con 457
  secuencias reales de 2 bytes UTF-8 en el archivo, ej. los bytes de
  "término" decodificados como Latin-1 dan el mojibake "tÃ©rmino" que
  aparecía en ~183 de 928 productos activos antes del fix. `readLocalPriceList`
  en `lib/deltronClient.js` decodifica como `utf8`. `fetchPriceList` — el
  mecanismo HTTP alterno, nunca usado en producción porque no llegó a
  descargar el CSV real — sigue asumiendo Latin-1 sin verificar, documentado
  como tal en el código.
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
- **Valores centinela "todo nueves"**: además de `9999999.99` (14 filas),
  se encontraron en producción otras 4 magnitudes del mismo patrón —
  `9999.00` (4 filas), `999.00` (52 filas), `99.00` (10 filas) y `9.00`
  (6 filas) — descubiertas post-sync (2026-08-13, ~18:00) al notar 3
  productos sin relación entre sí (teclado gamer, monitor, mochila)
  compartiendo el mismo `cost` calculado. Se confirmó revisando cada grupo:
  en todos aparecen productos completamente distintos (impresora
  multifuncional junto a polos y bufandas en `9.00`; pack de garantía
  extendida junto a bolsas y cuadernos promocionales en `99.00`; cargador,
  audífonos gamer, parlantes, maletín, case de PC, estabilizador y licencia
  Kaspersky en `999.00`) — la única explicación consistente es que las 5
  magnitudes son el mismo mecanismo de "sin precio fijo, requiere
  cotización" a distintas escalas, no coincidencia de precio real. Estas
  filas se omiten (mismo tratamiento que una tarjeta sin precio parseable
  en Compudiskett): se cuentan, no se sincronizan. Ver
  `PRICE_SENTINELS_NO_PRICE` en `lib/parseDeltronPriceList.js`.

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
sync_deltron.js              -- orquestador: leer CSV local, parsear, mapear, upsert, loggear
lib/deltronClient.js         -- readLocalPriceList (mecanismo real) + fetchPriceList (alterno, no usado por defecto)
lib/parseDeltronPriceList.js -- parseo del CSV en bloques (texto puro, sin cheerio)
deltronCategoryMap.js        -- tabla de mapeo (ver arriba)
data/deltron/                -- carpeta (fuera de git) donde vive lista_precios.csv
```

`readLocalPriceList(filePath)` lee el archivo del disco y lo decodifica
como `utf8` (corregido 2026-08-13, ver "Formato del CSV" arriba) — el resto
del pipeline (parseo, mapeo, upsert) no distingue de dónde vino el texto.

## Flujo de datos

1. Leer `data/deltron/lista_precios.csv` (ruta overrideable con
   `DELTRON_PRICE_LIST_PATH`) → texto crudo, decodificado como `latin1`.
   Alguien lo descargó a mano del portal de Deltron y lo dejó ahí — ver
   `data/deltron/README.md` para el paso a paso.
2. Extraer `TIPO DE CAMBIO` del encabezado del archivo.
3. Parsear el archivo en bloques: cada bloque empieza en una fila
   separadora + fila de encabezado (que trae el nombre de categoría), y
   contiene N filas de datos hasta el siguiente separador.
4. Por cada fila de datos: si el precio coincide con alguno de los 5
   valores centinela (`9.00`, `99.00`, `999.00`, `9999.00`, `9999999.99`),
   se omite (sin precio real, requiere cotización) y se cuenta. Si la categoría del bloque mapea a una
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
`supplier_id` (antes de cualquier llamada que pueda fallar, incluyendo la
lectura del CSV) y se cierra con `status`/`items_synced`/`message`. Si el
archivo local no existe (nadie lo descargó todavía, o la ruta está mal)
`readLocalPriceList` lanza un error claro, que igual que cualquier otro
fallo hace que toda la corrida falle (`status: 'failed'`) — a diferencia de
Compudiskett, aquí no hay "búsquedas" individuales por categoría que puedan
fallar independientemente, porque todo viene en un solo archivo.

**GitHub Action:** sin `schedule` por ahora (solo `workflow_dispatch`) — el
archivo local no existe en el runner de GitHub Actions, así que ni siquiera
un disparo manual funcionaría hoy sin un paso adicional que lo suba/traiga
desde algún lado (ej. Supabase Storage). No se implementó ese paso porque
no hacía falta para el flujo manual actual (correr `node sync_deltron.js`
en la máquina de quien descargó el archivo).

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
