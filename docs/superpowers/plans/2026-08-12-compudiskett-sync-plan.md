# Sincronizador de Compudiskett — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar el catálogo público de Compudiskett (`ecommerce.compudiskett.com.pe`) hacia `products` cada 4-6h vía GitHub Action, escribiendo solo `cost`/`cost_includes_igv`/`category_id`/`supplier_id`/`supplier_sku` y dejando que el trigger de Postgres calcule `final_price`.

**Architecture:** Un cliente HTTP con manejo de sesión/cookies (`lib/compudiskettClient.js`) habla con los endpoints internos del sitio (verificados en vivo: `POST c_productos.php`, `POST paginado.php`, `GET tipo_cambio.php`); un parser puro basado en cheerio (`lib/parseCompudiskettCatalog.js`) convierte el HTML devuelto en filas; un orquestador (`sync_compudiskett.js`) itera la tabla de mapeo de categorías, arma las filas y hace upsert por `(supplier_id, supplier_sku)`.

**Tech Stack:** Node.js ≥20 (para `Headers.getSetCookie()`), `cheerio` (parseo HTML), `@supabase/supabase-js` (ya en package.json), `node --test` (ya configurado).

**Spec:** [docs/superpowers/specs/2026-08-12-compudiskett-sync-design.md](../specs/2026-08-12-compudiskett-sync-design.md)

## Global Constraints

- Nunca escribir `products.final_price` desde el script — lo calcula `trg_compute_final_price` en Postgres.
- Credenciales nunca en código: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` solo por variable de entorno.
- `cost_includes_igv` para Compudiskett siempre `false` (`suppliers.prices_include_igv = false`, confirmado en Supabase).
- El sync solo debe tocar las 7 categorías que ya existen en `categories`; categorías del sitio sin mapeo se cuentan y se reportan, nunca bloquean la corrida.
- Cada corrida abre y cierra una fila en `sync_log` (`status`: success/failed/partial + `items_synced` + `message`).
- No hay test automatizado contra el sitio real en CI — los tests usan fixtures HTML guardados.

---

## Contrato verificado del sitio (para referencia de todas las tareas)

Verificado en vivo el 2026-08-12 contra `https://ecommerce.compudiskett.com.pe`, sin login:

- **Tipo de cambio**: `GET /hora-local/tipo_cambio.php` → texto plano `"TCM:3.380"`.
- **Listado por categoría**: `POST /consultas/cdk_consultas/c_productos.php`, header `Content-Type: application/x-www-form-urlencoded`, body `buscar=<clave exacta con espacios>` → HTML con hasta 30 tarjetas `.card.p-1` y un pie de página `Página {actual} -  {totalPáginas} de {totalResultados} Resultados`.
- **Cambiar de página**: `POST /consultas/cdk_consultas/paginado.php` con body `pag_act=<N>` — **la página se guarda en la sesión (cookie `PHPSESSID`)**, no es un parámetro de `c_productos.php`. Hay que llamar `paginado.php` con `pag_act=1` antes de empezar cada categoría nueva (la sesión no se resetea sola al cambiar de `buscar`), y volver a llamarlo antes de pedir cada página siguiente.
- Estructura real de una tarjeta (verificada, ejemplo real):

```html
<div class="card p-1 " aria-hidden="true" style="width: 17rem;">
  <div class=" d-flex justify-content-center ">
    <div class="position-relative ">
      <a onclick="busqueda_general('bus_rapida', ' ', ' ', '0603-020113')" href=""><img class="img-fluid  " style="height:230px;" src="images/productos/0603-020113/1.jpeg" alt=""></a>
      <div class="position-absolute top-0 end-0">
        <div class="alert alert-danger  d-inline-flex py-0 border-0  text-decoration-line-through m-1" role="alert">
          $346.00</div>
      </div>
    </div>
  </div>
  <div class="card-body  p-1 ">
    <div class="h5 card-title placeholder-glow  ">
      <span class="text-dark">AMD                 </span>
    </div>
    <div class="h6 card-title placeholder-glow " ">
      <span class=" text-break text-black  fw-medium" style=" display: inline-block; height: 65px;" >CPU AMD RYZEN 7 5700G AM4 100-100000263BOX </span>
    </div>
  </div>
</div>
```

- Mapeo verificado de nuestras 7 categorías a claves reales del sitio (confirmado navegando el menú y, para "Estabilizadores y UPS", confirmado leyendo nombres de producto reales bajo esa subcategoría — son estabilizadores/UPS/supresores de pico, no otra cosa):

| Nuestra categoría | Claves `buscar` en Compudiskett |
|---|---|
| Laptops y PCs | ` EQUIPOS INFORMATICOS/NOTEBOOK  `, ` EQUIPOS INFORMATICOS/DESKTOP  `, ` EQUIPOS INFORMATICOS/AIO (ALL IN ONE)  `, ` EQUIPOS INFORMATICOS/MINI DESKTOP  `, ` EQUIPOS INFORMATICOS/CHROMEBOOK  ` |
| Impresoras | ` IMPRESION  ` |
| Suministros | ` SUMINISTROS  ` |
| Estabilizadores y UPS | ` Accesorios y Perifericos/ENERGIA  ` |
| Accesorios y periféricos | ` Accesorios y Perifericos/sonido  `, ` Accesorios y Perifericos/MOUSES  `, ` Accesorios y Perifericos/TECLADO  `, ` Accesorios y Perifericos/FUNDAS, MOCHILAS Y MALETINES  `, ` Accesorios y Perifericos/CARGADORES  `, ` Accesorios y Perifericos/CAMARAS `, ` Accesorios y Perifericos/DOCKING STATION  `, ` Accesorios y Perifericos/CABLES  `, ` Accesorios y Perifericos/DISPOSITIVOS SMART  `, ` Accesorios y Perifericos/GAMING CHAIR  ` |
| Monitores | ` Accesorios y Perifericos/MONITOR  ` |
| Tarjetas de video | ` PARTES Y PIEZAS DE COMPUTADORA/TARJETAS GRAFICAS ` |

Estas claves incluyen espacios exactos al inicio/fin tal como los usa el sitio — deben copiarse literalmente, no recortarse con `trim()` antes de enviarlas.

---

### Task 1: Tabla de mapeo de categorías

**Files:**
- Create: `compudiskettCategoryMap.js`
- Test: `compudiskettCategoryMap.test.js`

**Interfaces:**
- Produces: `CATEGORY_MAP` — `Record<string, string[]>`, clave = nombre exacto en `categories.name`, valor = array de claves `buscar` de Compudiskett (ver tabla arriba).

- [ ] **Step 1: Escribir el archivo de datos**

```js
// compudiskettCategoryMap.js
'use strict';

const CATEGORY_MAP = {
  'Laptops y PCs': [
    ' EQUIPOS INFORMATICOS/NOTEBOOK  ',
    ' EQUIPOS INFORMATICOS/DESKTOP  ',
    ' EQUIPOS INFORMATICOS/AIO (ALL IN ONE)  ',
    ' EQUIPOS INFORMATICOS/MINI DESKTOP  ',
    ' EQUIPOS INFORMATICOS/CHROMEBOOK  ',
  ],
  Impresoras: [' IMPRESION  '],
  Suministros: [' SUMINISTROS  '],
  'Estabilizadores y UPS': [' Accesorios y Perifericos/ENERGIA  '],
  'Accesorios y periféricos': [
    ' Accesorios y Perifericos/sonido  ',
    ' Accesorios y Perifericos/MOUSES  ',
    ' Accesorios y Perifericos/TECLADO  ',
    ' Accesorios y Perifericos/FUNDAS, MOCHILAS Y MALETINES  ',
    ' Accesorios y Perifericos/CARGADORES  ',
    ' Accesorios y Perifericos/CAMARAS ',
    ' Accesorios y Perifericos/DOCKING STATION  ',
    ' Accesorios y Perifericos/CABLES  ',
    ' Accesorios y Perifericos/DISPOSITIVOS SMART  ',
    ' Accesorios y Perifericos/GAMING CHAIR  ',
  ],
  Monitores: [' Accesorios y Perifericos/MONITOR  '],
  'Tarjetas de video': [' PARTES Y PIEZAS DE COMPUTADORA/TARJETAS GRAFICAS '],
};

module.exports = { CATEGORY_MAP };
```

- [ ] **Step 2: Escribir el test**

```js
// compudiskettCategoryMap.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_MAP } = require('./compudiskettCategoryMap');

test('tiene exactamente las 7 categorías vigentes de Citec Store', () => {
  const expected = [
    'Laptops y PCs',
    'Impresoras',
    'Suministros',
    'Estabilizadores y UPS',
    'Accesorios y periféricos',
    'Monitores',
    'Tarjetas de video',
  ];
  assert.deepEqual(Object.keys(CATEGORY_MAP).sort(), expected.sort());
});

test('ninguna clave de Compudiskett se repite entre categorías', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('cada categoría tiene al menos una clave no vacía', () => {
  for (const keys of Object.values(CATEGORY_MAP)) {
    assert.ok(keys.length > 0);
    for (const key of keys) assert.ok(key.trim().length > 0);
  }
});
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `node --test compudiskettCategoryMap.test.js`
Expected: 3 tests, PASS.

- [ ] **Step 4: Commit**

```bash
git add compudiskettCategoryMap.js compudiskettCategoryMap.test.js
git commit -m "feat: agregar mapeo de categorías Compudiskett -> Citec Store"
```

---

### Task 2: Parsers de texto puros (TCM, paginación, modelo/part number)

**Files:**
- Create: `lib/parseCompudiskettCatalog.js` (solo estas 3 funciones por ahora; el parser de tarjetas se agrega en la Task 3 en el mismo archivo)
- Test: `lib/parseCompudiskettCatalog.test.js`

**Interfaces:**
- Produces:
  - `parseTipoCambio(rawText: string): number`
  - `parsePageInfo(html: string): { currentPage: number, totalPages: number, totalResults: number }`
  - `splitModelAndPartNumber(rawName: string): { model: string, partNumber: string | null }`

- [ ] **Step 1: Escribir los tests (fallando)**

```js
// lib/parseCompudiskettCatalog.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTipoCambio, parsePageInfo, splitModelAndPartNumber } = require('./parseCompudiskettCatalog');

test('parseTipoCambio lee "TCM:3.380" como 3.38', () => {
  assert.equal(parseTipoCambio('TCM:3.380'), 3.38);
});

test('parseTipoCambio soporta espacios extra', () => {
  assert.equal(parseTipoCambio('  TCM:3.5  '), 3.5);
});

test('parsePageInfo lee "Página 1 -  8 de 218 Resultados"', () => {
  const html = '<span id="pag_rig">Página 1 -  8 de 218 Resultados </span>';
  assert.deepEqual(parsePageInfo(html), { currentPage: 1, totalPages: 8, totalResults: 218 });
});

test('parsePageInfo lee página 2 de 4', () => {
  const html = '<span id="pag_rig">Página 2 -  4 de 112 Resultados </span>';
  assert.deepEqual(parsePageInfo(html), { currentPage: 2, totalPages: 4, totalResults: 112 });
});

test('splitModelAndPartNumber separa un part number alfanumérico final', () => {
  assert.deepEqual(
    splitModelAndPartNumber('CPU AMD RYZEN 7 5700G AM4 100-100000263BOX'),
    { model: 'CPU AMD RYZEN 7 5700G AM4', partNumber: '100-100000263BOX' }
  );
});

test('splitModelAndPartNumber deja part number null si no hay token final numérico', () => {
  assert.deepEqual(
    splitModelAndPartNumber('MOUSE INALAMBRICO ERGONOMICO'),
    { model: 'MOUSE INALAMBRICO ERGONOMICO', partNumber: null }
  );
});

test('splitModelAndPartNumber no rompe con un solo token', () => {
  assert.deepEqual(splitModelAndPartNumber('WEBCAM'), { model: 'WEBCAM', partNumber: null });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test lib/parseCompudiskettCatalog.test.js`
Expected: FAIL con `Cannot find module './parseCompudiskettCatalog'`.

- [ ] **Step 3: Implementar**

```js
// lib/parseCompudiskettCatalog.js
'use strict';

function parseTipoCambio(rawText) {
  const match = rawText.match(/TCM:\s*([\d.]+)/);
  if (!match) throw new Error(`No se pudo leer el tipo de cambio de: "${rawText}"`);
  return parseFloat(match[1]);
}

function parsePageInfo(html) {
  const match = html.match(/Página\s*(\d+)\s*-\s*(\d+)\s*de\s*(\d+)\s*Resultados/);
  if (!match) throw new Error('No se encontró el indicador de paginación en el HTML.');
  return {
    currentPage: parseInt(match[1], 10),
    totalPages: parseInt(match[2], 10),
    totalResults: parseInt(match[3], 10),
  };
}

function splitModelAndPartNumber(rawName) {
  const tokens = rawName.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  const looksLikePartNumber = tokens.length > 1 && /^[A-Z0-9][A-Z0-9-]{4,}$/.test(last) && /\d/.test(last);
  if (looksLikePartNumber) {
    return { model: tokens.slice(0, -1).join(' '), partNumber: last };
  }
  return { model: rawName.trim(), partNumber: null };
}

module.exports = { parseTipoCambio, parsePageInfo, splitModelAndPartNumber };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test lib/parseCompudiskettCatalog.test.js`
Expected: 7 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parseCompudiskettCatalog.js lib/parseCompudiskettCatalog.test.js
git commit -m "feat: parsers de TCM, paginación y split modelo/part number"
```

---

### Task 3: Parser de tarjetas de producto (cheerio + fixture real)

**Files:**
- Modify: `lib/parseCompudiskettCatalog.js` (agregar `parseProductCards`)
- Modify: `lib/parseCompudiskettCatalog.test.js` (agregar tests)
- Create: `test/fixtures/compudiskett_category_page.html`
- Modify: `package.json` (agregar dependencia `cheerio`)

**Interfaces:**
- Consumes: nada nuevo de tasks anteriores.
- Produces: `parseProductCards(html: string): Array<{ supplierSku: string, brand: string, rawName: string, priceUsd: number }>`

- [ ] **Step 1: Instalar cheerio**

```bash
npm install cheerio@^1.0.0
```

- [ ] **Step 2: Crear el fixture con markup real capturado del sitio**

```html
<!-- test/fixtures/compudiskett_category_page.html -->
<!-- Fragmento real capturado de POST /consultas/cdk_consultas/c_productos.php el 2026-08-12, recortado a 2 tarjetas + pie de página. -->
<div class="row d-flex justify-content-center ">
  <div id="event-cart" class="col-xxl-10 col-xl-10 col-sm-12  col-12  ">
    <div id="list_product" class="row d-inline-flex justify-content-center grid gap-4  ">
      <div class="card p-1 " aria-hidden="true" style="width: 17rem;">
        <div class=" d-flex justify-content-center ">
          <div class="position-relative ">
            <a onclick="busqueda_general('bus_rapida', ' ', ' ', '0603-020113')" href=""><img class="img-fluid  " style="height:230px;" src="images/productos/0603-020113/1.jpeg" alt=""></a>
            <div class="position-absolute top-0 end-0">
              <div class="alert alert-danger  d-inline-flex py-0 border-0  text-decoration-line-through m-1" role="alert">
                $346.00</div>
            </div>
          </div>
        </div>
        <div class="card-body  p-1 ">
          <div class="h5 card-title placeholder-glow  ">
            <span class="text-dark">AMD                 </span>
          </div>
          <div class="h6 card-title placeholder-glow " ">
            <span class=" text-break text-black  fw-medium" style=" display: inline-block; height: 65px;" >CPU AMD RYZEN 7 5700G AM4 100-100000263BOX </span>
          </div>
        </div>
      </div>
      <div class="card p-1 " aria-hidden="true" style="width: 17rem;">
        <div class=" d-flex justify-content-center ">
          <div class="position-relative ">
            <a onclick="busqueda_general('bus_rapida', ' ', ' ', '0603-020140')" href=""><img class="img-fluid  " style="height:230px;" src="images/productos/0603-020140/1.jpeg" alt=""></a>
            <div class="position-absolute top-0 end-0">
              <div class="alert alert-danger  d-inline-flex py-0 border-0  text-decoration-line-through m-1" role="alert">
                $164.29</div>
            </div>
          </div>
        </div>
        <div class="card-body  p-1 ">
          <div class="h5 card-title placeholder-glow  ">
            <span class="text-dark">AMD                 </span>
          </div>
          <div class="h6 card-title placeholder-glow " ">
            <span class=" text-break text-black  fw-medium" style=" display: inline-block; height: 65px;" >CPU AMD RYZEN 5 8400F AM5 100-100001591BOX </span>
          </div>
        </div>
      </div>
    </div>
    <hr>
    <div class="d-flex align-items-center ">
      <div id="pag_lef" class="col px-2 "></div>
      <div class="d-flex justify-content-center col px-2">
        <button type="button" onclick="paginado(1)" class="btn btn-sm btn-outline-info m-1 active ">1</button>
        <button type="button" onclick="paginado(2)" class="btn btn-sm btn-outline-info m-1 ">2</button>
      </div>
      <div class="col text-end px-2">
        <span id="pag_rig">Página 1 -  8 de 218 Resultados </span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Agregar los tests (fallando)**

Agregar al final de `lib/parseCompudiskettCatalog.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { parseProductCards } = require('./parseCompudiskettCatalog');

test('parseProductCards extrae las 2 tarjetas del fixture', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'fixtures', 'compudiskett_category_page.html'),
    'utf8'
  );
  const cards = parseProductCards(html);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0], {
    supplierSku: '0603-020113',
    brand: 'AMD',
    rawName: 'CPU AMD RYZEN 7 5700G AM4 100-100000263BOX',
    priceUsd: 346.0,
  });
  assert.deepEqual(cards[1], {
    supplierSku: '0603-020140',
    brand: 'AMD',
    rawName: 'CPU AMD RYZEN 5 8400F AM5 100-100001591BOX',
    priceUsd: 164.29,
  });
});

test('parseProductCards devuelve arreglo vacío si no hay tarjetas', () => {
  assert.deepEqual(parseProductCards('<div id="list_product"></div>'), []);
});
```

- [ ] **Step 4: Correr los tests y verificar que fallan**

Run: `node --test lib/parseCompudiskettCatalog.test.js`
Expected: FAIL — `parseProductCards is not a function`.

- [ ] **Step 5: Implementar `parseProductCards`**

Agregar a `lib/parseCompudiskettCatalog.js` (y sumar `cheerio` al `require` y a `module.exports`):

```js
const cheerio = require('cheerio');

function parseProductCards(html) {
  const $ = cheerio.load(html);
  const cards = [];
  $('.card.p-1').each((_, el) => {
    const card = $(el);
    const onclick = card.find('a[onclick*="bus_rapida"]').attr('onclick') || '';
    const skuMatch = onclick.match(/busqueda_general\('bus_rapida', ' ', ' ', '([^']+)'\)/);
    if (!skuMatch) return;

    const brand = card.find('.card-title .text-dark').first().text().trim();
    const rawName = card.find('.card-title .fw-medium').first().text().trim();
    const priceText = card.find('.alert-danger').first().text().trim();
    const priceMatch = priceText.match(/\$([\d.]+)/);
    if (!priceMatch) return;

    cards.push({
      supplierSku: skuMatch[1],
      brand,
      rawName,
      priceUsd: parseFloat(priceMatch[1]),
    });
  });
  return cards;
}
```

Y actualizar el `module.exports` al final del archivo:

```js
module.exports = { parseTipoCambio, parsePageInfo, splitModelAndPartNumber, parseProductCards };
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `node --test lib/parseCompudiskettCatalog.test.js`
Expected: 9 tests, PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/parseCompudiskettCatalog.js lib/parseCompudiskettCatalog.test.js test/fixtures/compudiskett_category_page.html package.json package-lock.json
git commit -m "feat: parser de tarjetas de producto con cheerio + fixture real"
```

---

### Task 4: Cliente HTTP de Compudiskett (sesión/cookies)

**Files:**
- Create: `lib/compudiskettClient.js`
- Test: `lib/compudiskettClient.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (es HTTP puro).
- Produces:
  - `extractSessionCookie(setCookieValues: string[]): string | null` (pura, testeable sin red)
  - `class CompudiskettSession { constructor(baseUrl?: string); fetchTipoCambio(): Promise<string>; setPage(pageNumber: number): Promise<void>; fetchCategoryPage(buscarKey: string): Promise<string>; }`

- [ ] **Step 1: Escribir el test de la parte pura (fallando)**

```js
// lib/compudiskettClient.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSessionCookie } = require('./compudiskettClient');

test('extractSessionCookie toma el primer PHPSESSID de la lista', () => {
  const cookie = extractSessionCookie(['PHPSESSID=abc123; path=/; HttpOnly']);
  assert.equal(cookie, 'PHPSESSID=abc123');
});

test('extractSessionCookie devuelve null si no hay set-cookie', () => {
  assert.equal(extractSessionCookie(undefined), null);
  assert.equal(extractSessionCookie([]), null);
});

test('extractSessionCookie ignora cookies que no son PHPSESSID', () => {
  const cookie = extractSessionCookie(['otra=1; path=/', 'PHPSESSID=xyz789; path=/']);
  assert.equal(cookie, 'PHPSESSID=xyz789');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test lib/compudiskettClient.test.js`
Expected: FAIL con `Cannot find module './compudiskettClient'`.

- [ ] **Step 3: Implementar**

```js
// lib/compudiskettClient.js
'use strict';

const BASE_URL = 'https://ecommerce.compudiskett.com.pe';

function extractSessionCookie(setCookieValues) {
  if (!setCookieValues || setCookieValues.length === 0) return null;
  for (const raw of setCookieValues) {
    const pair = raw.split(';')[0].trim();
    if (pair.startsWith('PHPSESSID=')) return pair;
  }
  return null;
}

class CompudiskettSession {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.cookie = null;
  }

  _headers(extra = {}) {
    return this.cookie ? { ...extra, Cookie: this.cookie } : extra;
  }

  _captureCookie(res) {
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const cookie = extractSessionCookie(setCookie);
    if (cookie) this.cookie = cookie;
  }

  async fetchTipoCambio() {
    const res = await fetch(`${this.baseUrl}/hora-local/tipo_cambio.php`, {
      headers: this._headers(),
    });
    this._captureCookie(res);
    return res.text();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(body).toString(),
    });
    this._captureCookie(res);
    return res.text();
  }

  async setPage(pageNumber) {
    await this._post('/consultas/cdk_consultas/paginado.php', { pag_act: String(pageNumber) });
  }

  async fetchCategoryPage(buscarKey) {
    return this._post('/consultas/cdk_consultas/c_productos.php', { buscar: buscarKey });
  }
}

module.exports = { CompudiskettSession, extractSessionCookie };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test lib/compudiskettClient.test.js`
Expected: 3 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/compudiskettClient.js lib/compudiskettClient.test.js
git commit -m "feat: cliente HTTP de Compudiskett con manejo de sesión/cookies"
```

---

### Task 5: Helpers compartidos de sincronización (Supabase + sync_log)

**Files:**
- Create: `lib/syncCommon.js`
- Test: `lib/syncCommon.test.js`

**Interfaces:**
- Produces:
  - `getSupabaseClient(env?: NodeJS.ProcessEnv): SupabaseClient`
  - `getCategoryIdMap(supabase): Promise<Map<string,string>>`
  - `logSyncStart(supabase, supplierId): Promise<string>` (retorna el `id` de la fila creada en `sync_log`)
  - `logSyncFinish(supabase, logId, { status, itemsSynced, message }): Promise<void>`

- [ ] **Step 1: Escribir los tests con un cliente Supabase falso (fallando)**

```js
// lib/syncCommon.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./syncCommon');

test('getSupabaseClient lanza si faltan las variables de entorno', () => {
  assert.throws(() => getSupabaseClient({}), /SUPABASE_URL/);
});

test('getSupabaseClient no lanza si las variables están presentes', () => {
  assert.doesNotThrow(() =>
    getSupabaseClient({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key' })
  );
});

function makeFakeSupabase({ categories, insertedId, updateCalls }) {
  return {
    from(table) {
      if (table === 'categories') {
        return { select: () => Promise.resolve({ data: categories, error: null }) };
      }
      if (table === 'sync_log') {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: insertedId }, error: null }),
            }),
          }),
          update: (payload) => ({
            eq: (_col, _val) => {
              updateCalls.push(payload);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  };
}

test('getCategoryIdMap arma un Map nombre -> id', async () => {
  const supabase = makeFakeSupabase({
    categories: [
      { id: 'cat-1', name: 'Impresoras' },
      { id: 'cat-2', name: 'Monitores' },
    ],
    insertedId: null,
    updateCalls: [],
  });
  const map = await getCategoryIdMap(supabase);
  assert.equal(map.get('Impresoras'), 'cat-1');
  assert.equal(map.get('Monitores'), 'cat-2');
});

test('logSyncStart devuelve el id de la fila creada', async () => {
  const supabase = makeFakeSupabase({ categories: [], insertedId: 'log-123', updateCalls: [] });
  const id = await logSyncStart(supabase, 'supplier-1');
  assert.equal(id, 'log-123');
});

test('logSyncFinish manda status/items_synced/message', async () => {
  const updateCalls = [];
  const supabase = makeFakeSupabase({ categories: [], insertedId: null, updateCalls });
  await logSyncFinish(supabase, 'log-123', { status: 'success', itemsSynced: 42, message: null });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].status, 'success');
  assert.equal(updateCalls[0].items_synced, 42);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test lib/syncCommon.test.js`
Expected: FAIL con `Cannot find module './syncCommon'`.

- [ ] **Step 3: Implementar**

```js
// lib/syncCommon.js
'use strict';
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios (nunca hardcodear).');
  }
  return createClient(url, serviceRoleKey);
}

async function getCategoryIdMap(supabase) {
  const { data, error } = await supabase.from('categories').select('id, name');
  if (error) throw error;
  return new Map(data.map((c) => [c.name, c.id]));
}

async function logSyncStart(supabase, supplierId) {
  const { data, error } = await supabase
    .from('sync_log')
    .insert({ supplier_id: supplierId, status: 'partial', started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function logSyncFinish(supabase, logId, { status, itemsSynced, message }) {
  const { error } = await supabase
    .from('sync_log')
    .update({
      status,
      items_synced: itemsSynced,
      message: message ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', logId);
  if (error) throw error;
}

module.exports = { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test lib/syncCommon.test.js`
Expected: 5 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/syncCommon.js lib/syncCommon.test.js
git commit -m "feat: helpers compartidos de Supabase y sync_log para scripts de sync"
```

---

### Task 6: Orquestador `sync_compudiskett.js`

**Files:**
- Create: `sync_compudiskett.js`
- Test: `sync_compudiskett.test.js`

**Interfaces:**
- Consumes:
  - `CATEGORY_MAP` de `./compudiskettCategoryMap` (Task 1)
  - `parseTipoCambio`, `parsePageInfo`, `parseProductCards`, `splitModelAndPartNumber` de `./lib/parseCompudiskettCatalog` (Tasks 2-3)
  - `CompudiskettSession` de `./lib/compudiskettClient` (Task 4)
  - `getSupabaseClient`, `getCategoryIdMap`, `logSyncStart`, `logSyncFinish` de `./lib/syncCommon` (Task 5)
  - `round2` de `./pricingEngine` (ya existente)
- Produces: `run(): Promise<void>`, `fetchAllCardsForKey(session, buscarKey): Promise<Array<{supplierSku,brand,rawName,priceUsd}>>`, `buildProductRow(card, {categoryId, supplierId, tcm, pricesIncludeIgv}): object`

- [ ] **Step 1: Escribir el test de `buildProductRow` y `fetchAllCardsForKey` (fallando)**

```js
// sync_compudiskett.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductRow, fetchAllCardsForKey } = require('./sync_compudiskett');

test('buildProductRow arma la fila de products sin final_price', () => {
  const row = buildProductRow(
    { supplierSku: '0603-020113', brand: 'AMD', rawName: 'CPU AMD RYZEN 7 5700G AM4 100-100000263BOX', priceUsd: 346.0 },
    { categoryId: 'cat-1', supplierId: 'sup-1', tcm: 3.38, pricesIncludeIgv: false }
  );
  assert.deepEqual(row, {
    model: 'CPU AMD RYZEN 7 5700G AM4',
    part_number: '100-100000263BOX',
    brand: 'AMD',
    category_id: 'cat-1',
    supplier_id: 'sup-1',
    supplier_sku: '0603-020113',
    cost: 1169.48,
    cost_includes_igv: false,
    source_type: 'web_sync',
    confidence: 'high',
  });
  assert.equal('final_price' in row, false);
});

test('fetchAllCardsForKey junta las tarjetas de todas las páginas', async () => {
  const calls = { setPage: [], fetchCategoryPage: [] };
  const fakeSession = {
    setPage: async (n) => calls.setPage.push(n),
    fetchCategoryPage: async (key) => {
      calls.fetchCategoryPage.push(key);
      const page = calls.setPage.length; // página actual tras el último setPage
      if (page <= 1) {
        return '<span id="pag_rig">Página 1 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-A\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO A</span></div><div class="alert-danger">$10.00</div></div>';
      }
      return '<span id="pag_rig">Página 2 -  2 de 4 Resultados </span><div class="card p-1"><a onclick="busqueda_general(\'bus_rapida\', \' \', \' \', \'SKU-B\')"></a><div class="card-title"><span class="text-dark">MARCA</span></div><div class="card-title"><span class="fw-medium">PRODUCTO B</span></div><div class="alert-danger">$20.00</div></div>';
    },
  };

  const cards = await fetchAllCardsForKey(fakeSession, ' IMPRESION  ');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].supplierSku, 'SKU-A');
  assert.equal(cards[1].supplierSku, 'SKU-B');
  assert.deepEqual(calls.setPage, [1, 2]);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test sync_compudiskett.test.js`
Expected: FAIL con `Cannot find module './sync_compudiskett'`.

- [ ] **Step 3: Implementar**

```js
// sync_compudiskett.js
'use strict';

const { CompudiskettSession } = require('./lib/compudiskettClient');
const {
  parseTipoCambio,
  parsePageInfo,
  parseProductCards,
  splitModelAndPartNumber,
} = require('./lib/parseCompudiskettCatalog');
const { CATEGORY_MAP } = require('./compudiskettCategoryMap');
const { round2 } = require('./pricingEngine');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./lib/syncCommon');

const SUPPLIER_NAME = 'Compudiskett';

async function fetchAllCardsForKey(session, buscarKey) {
  await session.setPage(1);
  const allCards = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    const html = await session.fetchCategoryPage(buscarKey);
    const info = parsePageInfo(html);
    currentPage = info.currentPage;
    totalPages = info.totalPages;
    allCards.push(...parseProductCards(html));

    if (currentPage < totalPages) {
      await session.setPage(currentPage + 1);
    }
  } while (currentPage < totalPages);

  return allCards;
}

function buildProductRow(card, { categoryId, supplierId, tcm, pricesIncludeIgv }) {
  const { model, partNumber } = splitModelAndPartNumber(card.rawName);
  return {
    model,
    part_number: partNumber,
    brand: card.brand,
    category_id: categoryId,
    supplier_id: supplierId,
    supplier_sku: card.supplierSku,
    cost: round2(card.priceUsd * tcm),
    cost_includes_igv: pricesIncludeIgv,
    source_type: 'web_sync',
    confidence: 'high',
  };
}

async function run() {
  const supabase = getSupabaseClient();

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (supplierError) throw supplierError;

  const categoryIdByName = await getCategoryIdMap(supabase);
  const logId = await logSyncStart(supabase, supplier.id);
  const session = new CompudiskettSession();

  try {
    const tcmRaw = await session.fetchTipoCambio();
    const tcm = parseTipoCambio(tcmRaw);

    const rows = [];
    let skippedCategories = 0;

    for (const [ourCategoryName, buscarKeys] of Object.entries(CATEGORY_MAP)) {
      const categoryId = categoryIdByName.get(ourCategoryName);
      if (!categoryId) {
        skippedCategories += 1;
        continue;
      }
      for (const buscarKey of buscarKeys) {
        const cards = await fetchAllCardsForKey(session, buscarKey);
        for (const card of cards) {
          rows.push(
            buildProductRow(card, {
              categoryId,
              supplierId: supplier.id,
              tcm,
              pricesIncludeIgv: supplier.prices_include_igv,
            })
          );
        }
      }
    }

    const { error: upsertError } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'supplier_id,supplier_sku' });
    if (upsertError) throw upsertError;

    await logSyncFinish(supabase, logId, {
      status: 'success',
      itemsSynced: rows.length,
      message:
        skippedCategories > 0
          ? `${skippedCategories} categoría(s) local(es) sin mapeo en Compudiskett, omitidas.`
          : null,
    });
  } catch (err) {
    await logSyncFinish(supabase, logId, { status: 'failed', itemsSynced: 0, message: err.message });
    throw err;
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { run, fetchAllCardsForKey, buildProductRow };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test sync_compudiskett.test.js`
Expected: 2 tests, PASS.

- [ ] **Step 5: Correr TODA la suite de tests del repo**

Run: `node --test`
Expected: todos los tests (Tasks 1-6) PASS, ninguno golpea la red.

- [ ] **Step 6: Commit**

```bash
git add sync_compudiskett.js sync_compudiskett.test.js
git commit -m "feat: orquestador de sincronización de Compudiskett"
```

---

### Task 7: Verificación manual contra el sitio real + GitHub Action

**Files:**
- Create: `.github/workflows/sync-compudiskett.yml`
- Modify: `package.json` (confirmar `"engines": { "node": ">=20" }`)

**Interfaces:**
- Consumes: `run()` de `./sync_compudiskett` (Task 6).

- [ ] **Step 1: Agregar el requisito de versión de Node a `package.json`**

Agregar esta clave al nivel raíz del JSON (junto a `"scripts"`):

```json
"engines": { "node": ">=20" }
```

- [ ] **Step 2: Verificación manual contra el sitio real (una sola vez, local, antes de programar la Action)**

Con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` como variables de entorno reales del proyecto `citec-store`, correr:

```bash
node sync_compudiskett.js
```

Verificar en Supabase (`select * from sync_log order by started_at desc limit 1;`) que la fila quedó en `status = 'success'` con `items_synced > 0`, y revisar 5-10 filas de `products` con `supplier_sku is not null and supplier_id = (select id from suppliers where name = 'Compudiskett')` para confirmar que `cost` y `final_price` tienen valores razonables (comparar `final_price` contra el precio mostrado en el sitio web para el mismo `supplier_sku`).

Este paso es manual y no se automatiza — el spec ya establece que no hay test end-to-end contra el sitio real en CI.

- [ ] **Step 3: Crear la GitHub Action programada**

```yaml
# .github/workflows/sync-compudiskett.yml
name: Sync Compudiskett

on:
  schedule:
    - cron: '0 */5 * * *'
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: node sync_compudiskett.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4: Documentar los secrets requeridos**

Confirmar manualmente (en GitHub, Settings → Secrets and variables → Actions del repo `RogerFMC/citec-store`) que existen `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Si no existen, crearlos con los valores del proyecto `citec-store` (ref `rqrbgjzdcvieqbpexgen`) antes de habilitar el schedule — sin esto la Action falla en el primer paso.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/sync-compudiskett.yml package.json
git commit -m "feat: GitHub Action programada para sync de Compudiskett"
```

- [ ] **Step 6: Push**

```bash
git push
```

## Fuera de alcance de este plan

- Stock/cantidad por producto (`stock_qty`, `stock_status`): requeriría una petición extra por producto a `c_producto_card.php` (N+1), no se implementa en este piloto.
- Deltron: se replica este mismo patrón de archivos (`lib/deltronClient.js`, `deltronCategoryMap.js`, `sync_deltron.js`) después de validar Compudiskett en producción durante al menos una corrida programada exitosa.
- Alerta por correo ante `sync_log.status = 'failed'`.
- Agregar a `categories` las secciones de Compudiskett sin mapeo (Procesadores, Placas Madre, RAM, Case para PC, Almacenamiento Interno).
