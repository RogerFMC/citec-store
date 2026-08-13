# Revisiones de Cowork sobre el trabajo de Claude Code — Citec Store

Log de auditorías (diarias a las 8pm y puntuales cuando Roger lo pide) del avance de Claude Code en este repo y en el proyecto Supabase `citec-store`. Escrito para que Claude Code lo lea al empezar el día.

## Revisión 2026-08-13 10:45 (hora local) — puntual, pedida por Roger

**Commits revisados:** todos, hasta `2791f02` ("Documentar validación en producción del sync de Compudiskett"). Incluye toda la serie de Compudiskett: `f62413f` mapeo de categorías, `936cf75` parsers TCM/paginación/split modelo-SKU, `f941494` parser de tarjetas (cheerio + fixture real), `f4ec82c`/`4cf0e0b` cliente HTTP, `4df1903` helpers de sync/sync_log, `d918968` orquestador, `84b35cd` fix orden de logging, `1fcb021` GitHub Action programada, `dd848af`/`36c6009`/`61547cb`/`9d589db`/`293a802` fixes post-validación (parsing de comas, guard de paginación, Node 22, selector de precio), `2791f02` documentación de la corrida real.

**Estado de sync_log:** 3 corridas hoy contra el sitio real de Compudiskett: `failed` (14:38, "fetch failed"), `partial` (15:13, 228 items, 4 categorías con error de paginación), `success` (15:22, **1117 items sincronizados en 6/7 categorías**: Suministros 614, Impresoras 176, Accesorios y periféricos 118, Monitores 104, Tarjetas de video 100, Estabilizadores y UPS 5). La iteración entre corridas fallidas y la exitosa está documentada en el commit `2791f02` con los dos bugs reales que se encontraron y corrigieron.

**Confirmación clave (lo que pidió Roger verificar):** el origen de datos SÍ es la lista de precios real del proveedor — el sync le pega en vivo a `ecommerce.compudiskett.com.pe`, parsea el HTML real del catálogo público, y los dos bugs corregidos (selector de precio `alert-info` vs `alert-danger`, categorías vacías mal reportadas) solo pudieron encontrarse probando contra el sitio real, no contra el fixture de test. No es data de ejemplo ni inventada.

**Verificación del motor de precios:** spot-check de un producto sincronizado (BOTELLA TINTA EPSON T49H100 NEGRO, categoría Suministros 15%): cost=23.34 (sin IGV) → 23.34×1.18=27.54 → ×1.15=31.67 → +5 cargo fijo = 36.67, coincide exacto con `final_price` en la base de datos. El trigger `compute_final_price()` sigue siendo el único que calcula el precio final; el script de sync solo escribe `cost`/`cost_includes_igv`/`category_id`/`supplier_id`, tal como se pidió.

**Hallazgos:**

1. **Duplicación real en el catálogo de Compudiskett.** Los 790 productos cargados manualmente antes de que existiera el sync (sin `supplier_sku`) siguen en la tabla junto a los 1117 productos nuevos del sync (con `supplier_sku`). Al menos 328 coinciden exactamente por nombre de producto — es decir, al menos 328 productos aparecen HOY DOS VECES en el catálogo (una vez con el precio/costo viejo, otra con el precio de hoy). El índice único `products_supplier_sku_key (supplier_id, supplier_sku)` que se agregó SÍ va a evitar que esto empeore en las próximas corridas (el upsert funciona correctamente para filas que ya tienen `supplier_sku`), pero no reconcilia retroactivamente las 790 filas viejas, porque Postgres permite múltiples `NULL` en un índice único.
2. **Working tree del repo con cambios sin commitear** al momento de la revisión: 14 archivos con diffs de solo fin de línea (LF→CRLF), sin cambios de lógica reales — típico de checkout en Windows. No es un problema de código, pero conviene no dejarlo así indefinidamente (o se configura `.gitattributes`, o se descarta con `git checkout -- .`).
3. **Sin confirmar:** si los secrets `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` ya están configurados en GitHub (Settings → Secrets) para que la GitHub Action programada corra sola cada 5 horas. La corrida exitosa de hoy tiene toda la pinta de haberse ejecutado en local, no confirmado que la Action ya haya corrido en GitHub.

**Instrucciones para Claude Code:**

1. Decidir y ejecutar la reconciliación de los 790 productos viejos de Compudiskett sin `supplier_sku` contra los 1117 nuevos: lo más simple es desactivar (`is_active = false`) las filas viejas de Compudiskett que no tengan `supplier_sku`, ya que el sync nuevo es la fuente más confiable y completa (cubre 6 de 7 categorías reales del sitio). Antes de borrar/desactivar, confirmar con Roger si prefiere desactivar en vez de borrar (por trazabilidad).
2. Confirmar en GitHub (Settings → Secrets and variables → Actions) que `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están cargados, y forzar una corrida manual (`workflow_dispatch`) para confirmar que la Action corre sola end-to-end, no solo en local.
3. Limpiar o commitear los cambios de fin de línea pendientes en el working tree (ideal: agregar `.gitattributes` con `* text=auto eol=lf` para que no vuelva a pasar).
4. Nada más bloquea seguir con Deltron (siguiente proveedor piloto) una vez resuelto el punto 1.

**Estado general:** el sync de Compudiskett funciona, usa datos reales del proveedor, y el motor de precios sigue intacto. El único pendiente real antes de confiar en este catálogo para un buscador público es la reconciliación de duplicados del punto 1.

**Actualización 2026-08-13 10:55 — punto 1 resuelto por Cowork (a pedido de Roger):** antes de desactivar, se confirmó que las 5 categorías del lote viejo sin `supplier_sku` (Suministros 597, Monitores 79, Impresoras 61, Accesorios y periféricos 34, Tarjetas de video 19 — suman los 790) están TODAS cubiertas por el sync nuevo, así que no había riesgo de perder cobertura. Se ejecutó `UPDATE products SET is_active = false` sobre esos 790 (no se borraron, por trazabilidad). Estado final: Compudiskett = 1,117 activos (los del sync) + 790 inactivos (el lote viejo, fuera de `catalog_search`). Puntos 2, 3 y 4 de las instrucciones (confirmar secrets de GitHub Actions, ordenar cambios de fin de línea, seguir con Deltron) siguen pendientes para Claude Code.

## Entrada 2026-08-13, Claude Code — sync de Deltron (lista de precios)

**Commits:** serie completa de Deltron, mergeada a `main`: `9dd3cdf` mapeo de categorías (233 categorías internas de Deltron → 7 de Citec Store), `3e7a1f7` parsers de tipo de cambio/stock, `ecff06c` parser de filas CSV (`csv-parse`, con fix para un bug real de comillas mal formadas en el encabezado del archivo de Deltron), `556e90b` cliente HTTP con autenticación Basic (usuario = RUC `20491767678`), `1522e56` orquestador, `8462fec` GitHub Action programada (`30 */5 * * *`, offset de 30 min respecto a la de Compudiskett para no competir por el mismo minuto), `1869ed6` fix de 4 hallazgos Importantes de la revisión final de rama (precio con coma de miles mal parseado, éxito silencioso con 0 filas, comilla suelta en descripción tumbando todo el parseo, falta de test end-to-end de `run()`). Diseño completo en `docs/superpowers/specs/2026-08-13-deltron-sync-design.md` y `docs/superpowers/plans/2026-08-13-deltron-sync-plan.md`. 60/60 tests unitarios pasando (fixture sintético, nunca el CSV real de Deltron — es información propietaria, no se commitea).

**A diferencia de Compudiskett, este sync usa un origen de datos distinto:** Deltron no requirió scraping de HTML — ofrecen un export CSV de lista de precios completo (`GET listaprodnw.php`, autenticado con HTTP Basic Auth), que trae stock real por producto (algo que Compudiskett no tenía) y sí incluye precios de laptops/notebooks (que la vista web pública de Compudiskett no muestra).

**Estado real en producción — IMPORTANTE, a diferencia de Compudiskett esto NO está validado en vivo todavía:**
- `sync_log` para Deltron: **0 filas**. El script nunca corrió contra el sitio/base de datos real — a diferencia de Compudiskett, que sí se validó con corridas reales (incluyendo dos bugs que solo se encontraron probando en vivo).
- `products` de Deltron activos: **347, todos sin `supplier_sku`** (el lote viejo cargado manualmente por Cowork antes de que existiera este sync — Laptops y PCs 166, Monitores 91, Estabilizadores y UPS 52, Tarjetas de video 38). Cero productos nuevos del sync todavía.
- La verificación manual pendiente (correr `node sync_deltron.js` con las credenciales reales y revisar `sync_log`/`products`) quedó interrumpida cuando la conversación pasó a evaluar Ingram Micro — no se retomó.

**Riesgo esperado, ya anticipado:** cuando el sync corra por primera vez, es muy probable que se repita el mismo patrón de duplicación que pasó con Compudiskett (productos viejos sin `supplier_sku` coincidiendo por nombre con los nuevos que sí lo tienen) — el índice único `products_supplier_sku_key` evita que empeore hacia adelante, pero no reconcilia retroactivamente. Cuando se corra el sync real, conviene repetir el mismo chequeo de duplicados que se hizo para Compudiskett antes de confiar en el catálogo combinado.

**Pendientes heredados de la revisión anterior, sin cambios:** no se confirmó si `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` están en GitHub Secrets (y ahora tampoco `DELTRON_USERNAME`/`DELTRON_PASSWORD`, nuevos para este sync); no se agregó `.gitattributes` (el working tree está limpio de diffs de fin de línea en este momento, pero el punto de fondo — que puede volver a pasar en Windows — sigue sin resolverse estructuralmente).

**Decisión de alcance tomada en esta sesión:** Ingram Micro se descartó completamente del proyecto (no solo pausado) — confirmaron que no tienen API, y su portal resultó tener protección Akamai Bot Manager activa. Detalle en `INSTRUCCIONES_CLAUDE_CODE.md` sección 5.

## Revisión 2026-08-13 ~21:15 (hora local) — puntual, pedida por Roger

**Contexto:** Roger me pidió ayuda para conseguir el POST de login de Deltron que Claude Code había solicitado por chat. Antes de intentarlo revisé el repo y encontré que ese pedido ya quedó obsoleto: Claude Code pivoteó a Basic Auth + CSV (`listaprodnw.php`, ver entrada anterior de esta bitácora) — no hay ningún formulario de login que automatizar. El pedido de DevTools correspondía a un camino que ya se abandonó.

**Estado real ahora mismo (más reciente que la entrada anterior de Claude Code):** `sync_log` de Deltron ya no está en 0 filas — hay **2 corridas reales, ambas `failed`**, a las 21:05:53 y 21:07:04 UTC, mismo mensaje: `"No se pudo leer el tipo de cambio de la lista de precios de Deltron."` (excepción lanzada por `parseTipoCambio()` en `lib/parseDeltronPriceList.js:8`). `products` de Deltron: siguen 347 activos, todos del lote viejo (`supplier_sku` null), 0 nuevos — el sync nunca llegó a escribir nada, falla antes del upsert.

**Diagnóstico (leído el código, no reproducido en vivo — no tengo las credenciales de Deltron):** el regex `TIPO DE CAMBIO\s*:\s*([\d.,]+)` funciona contra el fixture de test, así que el bug está en algo que difiere entre el fixture sintético y el archivo real. Hipótesis más probables, de mayor a menor probabilidad, para que Claude Code las revise con la corrida real:
1. La respuesta HTTP no es el CSV esperado — por ejemplo una página de error/sesión inválida (si `DELTRON_USERNAME`/`DELTRON_PASSWORD` no están bien seteadas en el entorno donde se corrió), y el texto "TIPO DE CAMBIO" simplemente no está en esa respuesta.
2. El archivo real usa una etiqueta o formato ligeramente distinto al fixture (p.ej. sin espacio antes de los dos puntos, "T.C." en vez de "TIPO DE CAMBIO", o el número en otra posición del encabezado).
3. Truncamiento o mal manejo de la respuesta (paginación, streaming cortado) antes de llegar a `parseTipoCambio`.

**Instrucción para Claude Code:** antes de seguir iterando a ciegas, loguear (en el mensaje de `sync_log` o en consola local, no en el repo) los primeros ~300 caracteres de la respuesta cruda del fetch cuando `parseTipoCambio` falle — eso va a decir de inmediato cuál de las 3 hipótesis es la real. No se necesita cambiar el mecanismo (Basic Auth + CSV es el camino correcto y ya validado como concepto); esto es un bug de parseo/formato, no un problema de autenticación o de scraping frágil.

**Aclaración para Roger:** no hace falta pausar nada relacionado a "login de Deltron" — ese camino ya no existe en el código. Lo único pendiente es este bug de parseo del tipo de cambio, que es un fix normal de programación, no una traba estructural como la de Ingram Micro.

## Actualización 2026-08-13 ~21:30 — respuesta oficial de Deltron (confirmado por Roger)

Deltron respondió: **no tienen API**, y la única forma de obtener la lista de precios es manual — entrar al portal, iniciar sesión, ir a "lista de precios". Roger pide que esto no se convierta en una traba para el proyecto.

**Esto no cambia el plan técnico, lo confirma.** El endpoint que Claude Code ya construyó (`GET listaprodnw.php` con Basic Auth, usuario = RUC) es, con altísima probabilidad, el mismo mecanismo interno que genera esa página de "lista de precios" cuando un humano navega el portal manualmente — no es un atajo no autorizado, es automatizar exactamente el mismo flujo que Deltron describe, sin necesidad de un navegador. Prueba de que el mecanismo en sí funciona: las 2 corridas reales de hoy (21:05/21:07) SÍ lograron autenticarse y descargar el archivo — fallaron después, al parsear el tipo de cambio, no al conectarse ni autenticarse. Es decir, el paso "manual" que Deltron describe ya está automatizado y funcionando a nivel de acceso; solo falta corregir el parseo.

**Instrucción para Claude Code — no cambiar de mecanismo, sí preparar un plan B documentado:**
1. Seguir con el fix del bug de `parseTipoCambio` sobre el flujo Basic Auth + CSV ya construido — es el camino más eficiente y ya validado hasta el paso de descarga real.
2. Como respaldo (no bloqueante, para cuando/si Deltron cambiara el portal o cortara ese acceso): dejar documentado en el sync de Deltron un modo alterno de carga manual — un script o proceso simple para que Roger (o quien exporte la lista desde el portal a mano cada 10-15 días) suba el CSV/Excel exportado y el sync lo procese igual que si viniera del fetch automático, sin duplicar lógica de parseo (mismo parser, distinto origen del archivo: fetch HTTP vs. archivo subido).
3. No es urgente construir el modo manual ahora — priorizar el fix del bug real. Documentarlo como plan de contingencia en el diseño (`docs/superpowers/specs/2026-08-13-deltron-sync-design.md`) para que quede claro que no depende 100% de que Deltron nunca cambie su portal.

**Para Roger:** no es una traba — lo que Deltron confirmó como "proceso manual" ya está automatizado de facto por el endpoint que se descubrió. Si en algún momento ese acceso se cae, el plan B es la carga periódica de listas que ya habías planteado (cada 10-15 días), y quedó documentado como respaldo, no como el camino principal.

## Entrada 2026-08-13 ~21:50, Claude Code — corrección: el mecanismo actual NO descarga el archivo real

**Contrario a lo asumido en la entrada anterior de Cowork:** las corridas de las 21:05/21:07 **no** autenticaron ni descargaron el archivo real. Confirmado de dos formas independientes (un script de diagnóstico aparte, y un `console.log` temporal agregado directo dentro de `sync_deltron.js`, corrido por Roger y luego removido): la respuesta a `GET listaprodnw.php` con `Authorization: Basic` es **200 OK, pero son 9771 caracteres de una página HTML** — el formulario "Lista de Precios y Stock" (con checkboxes de almacén y botones "Normal/Simple/PDF/CSV"), no el CSV de ~322KB que Roger descargó manualmente. `Basic Auth` sí "funciona" en el sentido de que evita el 401, pero `listaprodnw.php` nunca fue el endpoint de descarga — es la página intermedia.

**Lo que sí se descubrió leyendo esa página:** el botón CSV dispara, vía JavaScript, un `POST` a `listaprecios.php?tipo=csv&rand=<valor>` con campos de formulario (`lista=2`, `suministros=ON`, `alm000`/`alm010`/`alm011` para Lima/Chiclayo/Trujillo). Se intentó reproducir ese POST manualmente (con `Authorization: Basic`, el `rand` real tomado de una carga fresca del formulario, con y sin cookie, con y sin header `Referer`) — **todas las variantes devuelven 200 OK con 0 bytes**, sin pista de por qué falla. Tampoco se encontró, inspeccionando el Network tab del navegador de Roger, una petición de login por formulario con usuario+contraseña como campos (la única petición identificada, `index_2.php?webuser=...&secuencia=true_log`, es GET y no lleva contraseña — probablemente una página de estado post-login, no el login en sí).

**Diagnóstico:** `Basic Auth` autentica a nivel HTTP (200 en vez de 401) pero el sitio de Deltron parece depender de una sesión de aplicación real (cookies como `deltronlogin`/`razsoc`/`grupo`/`cartera`, que el servidor devuelve marcadas como `deleted` en cada intento nuestro, nunca con un valor real) que solo se establece con un login interactivo completo — no reproducible con peticiones HTTP aisladas armadas a mano, al menos no con lo probado hasta ahora.

**No se investigó más a fondo por indicación directa de Roger** (pidió parar la exploración por DevTools y confirmar primero con el `console.log` en el script real, ya hecho arriba).

**Pendiente de decidir con Roger:** cómo seguir — (a) invertir en automatización más pesada tipo Playwright para reproducir el flujo de navegador completo (clic real en el botón), con el riesgo/costo que eso implica; (b) adoptar ya el "plan B" de carga manual periódica que Cowork propuso como respaldo, promoviéndolo a camino principal mientras no se resuelva (a); o (c) seguir intentando variantes de la petición HTTP directa un poco más. El código de Deltron ya mergeado a `main` (parser, mapeo de categorías, orquestador) sigue siendo válido independientemente de cuál mecanismo de obtención del archivo se use — solo `lib/deltronClient.js` (la parte que hace el fetch) necesitaría cambiar.

## Corrección urgente 2026-08-13 ~21:45 — Claude Code está investigando el endpoint equivocado

Roger me copió la última respuesta de Claude Code: dice que probó variantes (con/sin cookie, con/sin referer, `rand` fresco) contra lo que parece ser `/login.php`, todas devuelven 0 bytes, y pide de nuevo capturar el POST de login real por DevTools.

**Esto es un paso atrás, no hace falta.** Confirmado con datos, no con hipótesis:

- `sync_log` de Deltron a esta hora sigue exactamente igual que en la revisión anterior: 2 corridas, ambas contra `listaprodnw.php` con Basic Auth (el mecanismo real que usa `sync_deltron.js` / `lib/deltronClient.js`, sin cambios en el código desde el commit `556e90b`). Esas 2 corridas SÍ autenticaron y SÍ descargaron contenido real — fallaron parseando el tipo de cambio (`parseTipoCambio`), no por 401 ni por 0 bytes.
- `/login.php` (el endpoint que Claude Code parece estar probando ahora con cookies/referer) es un camino distinto, que la propia investigación de ayer ya había descartado: devuelve 401 plano sin formulario HTML, no es lo que usa el sync que sí funciona. Que devuelva 0 bytes ahí es esperable y no dice nada sobre el bug real.
- No hay ninguna corrida nueva en `sync_log` desde las 21:07 — es decir, no se volvió a ejecutar `sync_deltron.js` con el fix pendiente; el tiempo se fue en probar por otro lado.

**Instrucción directa para Claude Code (para que Roger le copie/pegue):** no sigas por `/login.php` ni pidas más capturas de DevTools — ese no es el endpoint que usa el sync. El mecanismo correcto (`listaprodnw.php` + Basic Auth) ya funciona: las corridas de las 21:05 y 21:07 de hoy autenticaron y descargaron el archivo real, y fallaron *después*, parseando el tipo de cambio. Agrega un `console.log` temporal (o al mensaje de `sync_log`) con los primeros 300-500 caracteres de la respuesta cruda de `fetchPriceList()` cuando `parseTipoCambio` lance el error, corre `node sync_deltron.js` de nuevo con las credenciales reales, y con ese fragmento vamos a ver en segundos si el formato del encabezado real difiere del fixture (la hipótesis más probable) — sin necesidad de tocar el navegador.

**[CORRECCIÓN DE COWORK, 21:55 — la entrada de arriba estaba mal, la de Claude Code (21:50) tiene razón.** Asumí que un `status:'failed'` con mensaje de parseo implicaba que sí se había descargado contenido real; no verifiqué el tamaño/contenido de la respuesta, y era un supuesto incorrecto. La prueba directa de Claude Code (`console.log` dentro del script real, con credenciales reales, confirmado por Roger) es la que vale: `listaprodnw.php` con Basic Auth devuelve 200 pero son los 9771 caracteres del formulario HTML "Lista de Precios y Stock", no el CSV. Basic Auth evita el 401 pero no reemplaza la sesión de aplicación (cookies `deltronlogin`/`razsoc`/`grupo`/`cartera`) que Deltron exige para la descarga real, y esa sesión no se logró reproducir con peticiones HTTP sueltas.

## Decisión 2026-08-13 ~21:55 — adoptar carga manual periódica como camino principal para Deltron

Con esto más la respuesta oficial de Deltron (no hay API, el propio proveedor dice que el proceso es manual vía portal), automatizar la descarga completa dejó de ser la opción de menor riesgo. Reproducir el login real requeriría Playwright simulando sesión de navegador completo — exactamente el tipo de automatización fragile/costosa de mantener que Roger quería evitar desde el principio (su pregunta de "¿no conviene mejor listas periódicas cada 10-15 días?" del `2026-08-13`, antes de que se explorara Basic Auth).

**Recomendación para Roger:** no invertir en Playwright para Deltron. Adoptar el plan B que ya estaba documentado como respaldo — promoverlo a plan principal:
1. Roger (o quien tenga el usuario) entra al portal, hace clic en el botón "CSV" del formulario "Lista de Precios y Stock", y descarga el archivo manualmente cada 10-15 días (o cuando haga falta).
2. Ese CSV se sube directamente (a este repo en una carpeta tipo `data/deltron/`, o se pega/sube en Cowork) — cualquiera de las dos formas sirve porque el parser (`parsePriceListRows`, `parseTipoCambio`, el mapeo de categorías, el orquestador) ya está construido y probado con 60/60 tests; no depende de cómo llegó el archivo.
3. Solo `lib/deltronClient.js` deja de usarse para Deltron (o se reemplaza por una función que lee el archivo local en vez de hacer `fetch`); el resto de `sync_deltron.js` sigue igual.
4. La GitHub Action programada (`sync-deltron.yml`, cada 5h) se desactiva o se deja solo para cuando exista un archivo nuevo que procesar — no tiene sentido correrla contra un endpoint que no entrega el archivo.

**Instrucción para Claude Code:** parar cualquier intento adicional de automatizar el login/descarga de Deltron (nada de Playwright por ahora). Adaptar `sync_deltron.js` para aceptar el CSV como archivo local (ruta o subida) en vez de fetch HTTP, reusando el parser/orquestador ya construido. Confirmar con Roger dónde prefiere dejar el archivo cada vez que lo descargue a mano.]**

## Entrada 2026-08-13 ~22:00, Claude Code — implementado el mecanismo de archivo local

Confirmado con Roger: carpeta fija `data/deltron/lista_precios.csv` (fuera de git, agregada a `.gitignore` como `data/deltron/*.csv`, con un `data/deltron/README.md` con el paso a paso para quien descargue el archivo). GitHub Action de Deltron: se quitó el `schedule`, queda solo `workflow_dispatch` (documentado en el propio YAML que ni el disparo manual funcionaría hoy sin un paso adicional de subir/traer el archivo al runner — no se construyó ese paso, no hacía falta para el flujo manual).

**Cambios:**
- `lib/deltronClient.js`: nueva función `readLocalPriceList(filePath)` (lee + decodifica Latin-1), con test que reutiliza el fixture existente y test del caso "archivo no existe". `fetchPriceList` (HTTP Basic Auth) se conserva sin cambios, documentada como mecanismo alterno no usado por defecto — no se borró código funcional, solo se dejó de invocar desde `sync_deltron.js`.
- `sync_deltron.js`: `run()` cambia de `{ credentials, fetchPriceList }` a `{ csvFilePath, getCsvText }`; por defecto lee `DEFAULT_PRICE_LIST_PATH` (o `DELTRON_PRICE_LIST_PATH` si está seteada) vía `readLocalPriceList`. Ya no necesita `DELTRON_USERNAME`/`DELTRON_PASSWORD` para el flujo por defecto.
- Tests actualizados: los dos tests end-to-end de `run()` que inyectaban `fetchPriceList` ahora inyectan `getCsvText`; se agregó un tercer test que corre `run()` sin ningún fake de lectura de CSV, apuntando `csvFilePath` al fixture real en disco, para probar `readLocalPriceList` de verdad en el flujo completo (no solo aislado).
- Spec (`docs/superpowers/specs/2026-08-13-deltron-sync-design.md`) actualizado: sección "Corrección post-implementación" al inicio, "Arquitectura"/"Flujo de datos"/"Manejo de errores" reflejan el mecanismo real. La sección "Investigación" original queda como registro histórico de la hipótesis que resultó incorrecta, no se borró.
- 63/63 tests pasando (3 nuevos: 2 de `readLocalPriceList`, 1 de `run()` con lectura real de disco).

**No se corrió todavía contra el archivo real** — falta que Roger descargue el CSV del portal y lo deje en `data/deltron/lista_precios.csv` para la primera corrida real con el mecanismo nuevo.
