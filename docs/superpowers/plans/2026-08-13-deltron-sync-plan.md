# Sincronizador de Deltron — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar la lista de precios de Deltron (CSV autenticado con HTTP Basic Auth) hacia `products` cada 4-6h vía GitHub Action, escribiendo solo `cost`/`cost_includes_igv`/`category_id`/`supplier_id`/`supplier_sku`/`stock_qty`/`stock_status` y dejando que el trigger de Postgres calcule `final_price`.

**Architecture:** Un cliente HTTP con autenticación Basic (`lib/deltronClient.js`) descarga el CSV completo de `listaprodnw.php` (sin sesión/cookies, un único GET); un parser puro basado en `csv-parse` (`lib/parseDeltronPriceList.js`) convierte el texto (decodificado como Latin-1) en filas tipadas; un orquestador (`sync_deltron.js`) mapea categorías y hace upsert. Reutiliza `lib/syncCommon.js` y `pricingEngine.js` sin cambios (ya existen del sync de Compudiskett).

**Tech Stack:** Node.js ≥22 (ya configurado), `csv-parse` (nueva dependencia), `@supabase/supabase-js` (ya en package.json), `node --test` (ya configurado).

**Spec:** [docs/superpowers/specs/2026-08-13-deltron-sync-design.md](../specs/2026-08-13-deltron-sync-design.md)

## Global Constraints

- Nunca escribir `products.final_price` desde el script — lo calcula `trg_compute_final_price` en Postgres.
- Credenciales nunca en código: `DELTRON_USERNAME` / `DELTRON_PASSWORD` (nuevas) y `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (ya existentes) solo por variable de entorno.
- `cost_includes_igv` para Deltron siempre `false`, leído en vivo de `suppliers.prices_include_igv` (no hardcodeado).
- El CSV se decodifica como `latin1`, nunca como UTF-8 (el archivo real usa esa codificación; UTF-8 corrompe tildes y Ñ).
- Filas con precio exactamente `9999999.99` (sin precio fijo, requiere cotización) se omiten y se cuentan, nunca se sincronizan como si fueran un precio real.
- Categorías de Deltron sin mapeo a una de las 7 categorías existentes se cuentan y se reportan en `sync_log.message`, nunca bloquean la corrida.
- `sync_log` se abre apenas se conoce el `supplier_id` (antes de cualquier llamada que pueda fallar) y se cierra con `status`/`items_synced`/`message`.
- No hay test automatizado contra el sitio/CSV real en CI — los tests usan un fixture sintético (no el archivo real de precios, que es información propietaria y no se commitea).

---

## Contrato verificado del CSV real (para referencia de todas las tareas)

Verificado el 2026-08-13 contra un export real de `https://www.deltron.com.pe/modulos/productos/listaprodnw.php` (HTTP Basic Auth), compartido por Roger:

- **Codificación**: Latin-1 / Windows-1252. Confirmado byte a byte: el carácter `Ñ` es el byte `0xD1`, que corrompe si se decodifica como UTF-8.
- **Encabezado del archivo** (primeras ~10 líneas): título, fecha de generación, almacenes, y una línea con el tipo de cambio: `,"TIPO DE CAMBIO :3.380"` (nótese la coma inicial de campo vacío antes del campo citado).
- **Cuerpo del archivo**: bloques repetidos por categoría interna de Deltron ("línea"). Cada bloque:
  1. Fila separadora de 4 campos: `"_______________","_______________","__________________________________","__________"`.
  2. Fila de encabezado de 9 campos, con el nombre de la categoría en la 3ª posición en vez de "DESCRIPCION": `" ","CODIGO","<CATEGORIA>","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"`.
  3. N filas de datos de 9 campos: `"<categoria en minúsculas>","<codigo>","<descripcion>",<stock>,<precio_usd>, ,"","<garan>","<marca>"`.
- **Cada fila de datos repite su categoría en el campo 1** (en minúsculas) — no hace falta rastrear "categoría actual" fila a fila; cada fila trae su propia categoría.
- **`STOCK`** (campo 4, sin comillas): vacío (sin stock), un entero exacto (`1`, `10`, etc.), o `>20` (más de 20, cantidad exacta desconocida).
- **`PREC DISTRIB US $`** (campo 5, sin comillas): número decimal simple, sin coma de miles (verificado: precios reales llegan hasta ~$17,638.90 sin necesitar limpieza de comas — a diferencia de Compudiskett, donde el precio vivía en texto HTML).
- **Valor centinela `9999999.99`**: aparece quince... 14 filas del archivo de referencia, significa "sin precio fijo, requiere cotización" (ej. garantías extendidas, servicios). Deben omitirse.
- **`PREC S/.` y `FLETE ` están siempre vacíos** en el export — no se usan.
- **`MARCA`** (campo 9, último): la marca del producto, limpia.
- Ejemplo real de un bloque completo (con datos anonimizados para este documento — la estructura es fiel al archivo real):

```
"_______________","_______________","__________________________________","__________"
" ","CODIGO","MONITOR PLANO 27","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"
"monitor plano 27","montest0001","monitor de prueba 27 fhd ips 100hz hdmi vga negro",>20,150.00, ,"","W","marca test"
```

---

### Task 1: Tabla de mapeo de categorías

**Files:**
- Create: `deltronCategoryMap.js`
- Test: `deltronCategoryMap.test.js`

**Interfaces:**
- Produces: `CATEGORY_MAP` — `Record<string, string[]>`, clave = nombre exacto en `categories.name`, valor = array de nombres de categoría de Deltron **en MAYÚSCULAS**, tal como aparecen en el CSV (campo 3 de la fila de encabezado de cada bloque, o campo 1 de cada fila de datos en mayúsculas).

- [ ] **Step 1: Escribir el archivo de datos**

```js
// deltronCategoryMap.js
'use strict';

const CATEGORY_MAP = {
  'Laptops y PCs': [
    'BAREBONE',
    'BAREBONES PARA PC',
    'COMPUTADORA AIO CORE 5',
    'COMPUTADORA AIO CORE 7',
    'COMPUTADORA AIO CORE i5',
    'COMPUTADORA AIO CORE I7',
    'COMPUTADORA AIO RYZEN 5',
    'COMPUTADORA AIO RYZEN 7',
    'COMPUTADORA AIO ULTRA 7',
    'COMPUTADORA AMD RYZEN 5',
    'COMPUTADORA AMD RYZEN 7',
    'COMPUTADORA CORE 5',
    'COMPUTADORA CORE i5',
    'COMPUTADORA CORE i7',
    'COMPUTADORA ULTRA 5',
    'COMPUTADORA ULTRA 7',
    'COMPUTADORA ULTRA 9',
    'COMPUTADORA WORKSTATION',
    'NOTEBOOK AMD ATHLON',
    'NOTEBOOK AMD RYZEN 3',
    'NOTEBOOK AMD RYZEN 5',
    'NOTEBOOK AMD RYZEN 7',
    'NOTEBOOK AMD RYZEN AI 7',
    'NOTEBOOK CELERON',
    'NOTEBOOK CORE 5',
    'NOTEBOOK CORE 7',
    'NOTEBOOK CORE 9',
    'NOTEBOOK CORE i3',
    'NOTEBOOK CORE i5',
    'NOTEBOOK CORE i7',
    'NOTEBOOK CORE ULTRA 5',
    'NOTEBOOK CORE ULTRA 5 AI',
    'NOTEBOOK CORE ULTRA 7',
    'NOTEBOOK CORE ULTRA 7 AI',
    'NOTEBOOK CORE ULTRA 9',
    'NOTEBOOK GAM CORE ULTRA 9',
    'NOTEBOOK GAMING CORE 7',
    'NOTEBOOK GAMING CORE i5',
    'NOTEBOOK GAMING CORE i7',
    'NOTEBOOK GAMING CORE i9',
    'NOTEBOOK GAMING RYZEN 5',
    'NOTEBOOK GAMING RYZEN 7',
    'NOTEBOOK GAMING RYZEN 9',
    'NOTEBOOK GM CORE ULT 9 AI',
    'NOTEBOOK GM CORE ULTX9 AI',
    'NOTEBOOK GM RYZEN AI 7',
    'NOTEBOOK WORKSTATION',
  ],
  Impresoras: [
    'COMERCIAL LASER',
    'COMERCIAL MATRICIAL',
    'COMERCIAL TANQUE TINTA',
    'COMERCIAL TANQUE TINTA MU',
    'COMERCIAL TICKETERA',
    'CONSUMO TANQUE TINTA',
    'CONSUMO TANQUE TINTA MULT',
    'IMAGENES, ESCANER DE',
    'IMPRESORA LASER/LED',
    'IMPRESORA MULTIFUN LASER',
    'IMPRESORA MULTIFUN TINTA',
    'IMPRESORA TERMICA',
    'IMPRESORA, ACCESORIOS DE',
  ],
  Suministros: [
    'MATERIALES_SUMINISTROS',
    'SUMINIST P/ PLOTTERS',
    'SUMINIST P/IMPR, BOTELLAS',
    'SUMINIST P/IMPRES, BOLSAS',
    'SUMINIST P/IMPRES, CINTAS',
    'SUMINIST P/IMPRES, TINTAS',
  ],
  'Estabilizadores y UPS': [
    'ESTABILIZADOR DE TENSION',
    'UPS INTERACTIVO',
    'UPS ONLINE',
    'UPS, ACCESORIOS',
    'UPS, OTROS',
  ],
  'Accesorios y periféricos': [
    'ACC, MUEBLES DE COMPUTO',
    'ACCESORIOS',
    'ACCESORIOS USB',
    'AUDIO, ACCESORIOS DE',
    'AUDIO, AURICULAR C/MIC',
    'AUDIO, AURICULAR C/MIC GM',
    'AUDIO, AURICULAR INALAM',
    'AUDIO, MICROFONO USB',
    'AUDIO, PARLANTE INALAMBRC',
    'CAMARA, WEBCAM',
    'CARTUCHERA / PORTACABLES',
    'MEM FLASH, COMPACT FLASH',
    'MEM FLASH, SECURE DIGITAL',
    'MEM FLASH, USB DRIVE',
    'MOCHILA / BACKPACK',
    'MOUSE INALAMBRICO',
    'MOUSE PAD/MAT, ACCESORIOS',
    'MOUSE PARA GAMERS',
    'MOUSE USB',
    'NOTEBOOK, ACC PROPIETARIO',
    'NOTEBOOK, ACCESORIOS DE',
    'NOTEBOOK, MALETIN/MOCHILA',
    'SILLAS GAMER',
    'SMART HOME - CAMARAS',
    'SMART HOME - DISPOSITIVOS',
    'TECLADO INALAMBRICO',
    'TECLADO PARA GAMERS',
    'TECLADO USB',
    'TECLADO+MOUSE COMBO KIT',
    'TECLADO+MOUSE KIT INALAMB',
  ],
  Monitores: [
    'MONITOR CURVO 23',
    'MONITOR CURVO 27',
    'MONITOR CURVO 34',
    'MONITOR GAMING CURVO 23',
    'MONITOR GAMING CURVO 27',
    'MONITOR GAMING CURVO 31.5',
    'MONITOR GAMING CURVO 34',
    'MONITOR GAMING PLANO 23',
    'MONITOR GAMING PLANO 25',
    'MONITOR GAMING PLANO 27',
    'MONITOR GAMING PLANO 31.5',
    'MONITOR GAMING PLANO 34',
    'MONITOR PLANO 21.45',
    'MONITOR PLANO 23',
    'MONITOR PLANO 25',
    'MONITOR PLANO 27',
    'MONITOR PLANO 29',
    'MONITOR PLANO 31.5',
    'MONITOR PLANO 34',
    'MONITOR PORTABLE 14',
    'MONITORES TFT 24 - 28',
    'MONITORES, ACCESORIOS',
    'MONITORES, RACK SOPORTE',
    'MONITORES/PANTALLAS, ACC',
  ],
  'Tarjetas de video': [
    'VIDEO, PCI EXP INTEL GAM',
    'VIDEO, PCI EXP NVIDIA GAM',
    'VIDEO, PCI EXP RADEON GAM',
    'VIDEO, PCI EXPRESS NVIDIA',
  ],
};

module.exports = { CATEGORY_MAP };
```

- [ ] **Step 2: Escribir el test**

```js
// deltronCategoryMap.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_MAP } = require('./deltronCategoryMap');

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

test('ninguna categoría de Deltron se repite entre nuestras categorías', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('todas las claves de Deltron están en mayúsculas (deben calzar con categoría.toUpperCase() del CSV)', () => {
  const allKeys = Object.values(CATEGORY_MAP).flat();
  for (const key of allKeys) {
    assert.equal(key, key.toUpperCase(), `"${key}" debería estar en mayúsculas`);
  }
});

test('cada categoría tiene al menos una entrada', () => {
  for (const keys of Object.values(CATEGORY_MAP)) {
    assert.ok(keys.length > 0);
  }
});
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `node --test deltronCategoryMap.test.js`
Expected: 4 tests, PASS.

- [ ] **Step 4: Commit**

```bash
git add deltronCategoryMap.js deltronCategoryMap.test.js
git commit -m "feat: agregar mapeo de categorías Deltron -> Citec Store"
```

---

### Task 2: Parsers de texto puros (tipo de cambio, stock)

**Files:**
- Create: `lib/parseDeltronPriceList.js` (solo estas 2 funciones por ahora; el parser de filas CSV se agrega en la Task 3 en el mismo archivo)
- Test: `lib/parseDeltronPriceList.test.js`

**Interfaces:**
- Produces:
  - `parseTipoCambio(rawText: string): number`
  - `parseStockInfo(stockRaw: string): { qty: number | null, status: 'out_of_stock' | 'low_stock' | 'in_stock' }`

- [ ] **Step 1: Escribir los tests (fallando)**

```js
// lib/parseDeltronPriceList.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTipoCambio, parseStockInfo } = require('./parseDeltronPriceList');

test('parseTipoCambio lee "TIPO DE CAMBIO :3.380" como 3.38', () => {
  assert.equal(parseTipoCambio(',"TIPO DE CAMBIO :3.380"'), 3.38);
});

test('parseTipoCambio soporta espacios extra alrededor de los dos puntos', () => {
  assert.equal(parseTipoCambio('TIPO DE CAMBIO   :  3.5'), 3.5);
});

test('parseTipoCambio lanza si no encuentra el patrón', () => {
  assert.throws(() => parseTipoCambio('sin tipo de cambio aquí'), /tipo de cambio/i);
});

test('parseStockInfo: vacío es out_of_stock con qty 0', () => {
  assert.deepEqual(parseStockInfo(' '), { qty: 0, status: 'out_of_stock' });
  assert.deepEqual(parseStockInfo(''), { qty: 0, status: 'out_of_stock' });
});

test('parseStockInfo: ">20" es in_stock con qty null (cantidad exacta desconocida)', () => {
  assert.deepEqual(parseStockInfo('>20'), { qty: null, status: 'in_stock' });
});

test('parseStockInfo: 1 a 5 unidades es low_stock', () => {
  assert.deepEqual(parseStockInfo('1'), { qty: 1, status: 'low_stock' });
  assert.deepEqual(parseStockInfo('5'), { qty: 5, status: 'low_stock' });
});

test('parseStockInfo: más de 5 unidades exactas es in_stock', () => {
  assert.deepEqual(parseStockInfo('10'), { qty: 10, status: 'in_stock' });
});

test('parseStockInfo: "0" es out_of_stock', () => {
  assert.deepEqual(parseStockInfo('0'), { qty: 0, status: 'out_of_stock' });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test lib/parseDeltronPriceList.test.js`
Expected: FAIL con `Cannot find module './parseDeltronPriceList'`.

- [ ] **Step 3: Implementar**

```js
// lib/parseDeltronPriceList.js
'use strict';

function parseTipoCambio(rawText) {
  const match = rawText.match(/TIPO DE CAMBIO\s*:\s*([\d.,]+)/);
  if (!match) {
    throw new Error('No se pudo leer el tipo de cambio de la lista de precios de Deltron.');
  }
  return parseFloat(match[1].replace(',', '.'));
}

function parseStockInfo(stockRaw) {
  const trimmed = (stockRaw || '').trim();
  if (trimmed === '') {
    return { qty: 0, status: 'out_of_stock' };
  }
  if (trimmed.startsWith('>')) {
    return { qty: null, status: 'in_stock' };
  }
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n === 0) {
    return { qty: 0, status: 'out_of_stock' };
  }
  if (n <= 5) {
    return { qty: n, status: 'low_stock' };
  }
  return { qty: n, status: 'in_stock' };
}

module.exports = { parseTipoCambio, parseStockInfo };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test lib/parseDeltronPriceList.test.js`
Expected: 8 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/parseDeltronPriceList.js lib/parseDeltronPriceList.test.js
git commit -m "feat: parsers de tipo de cambio y stock para Deltron"
```

---

### Task 3: Parser de filas del CSV (csv-parse + fixture sintético)

**Files:**
- Modify: `lib/parseDeltronPriceList.js` (agregar `parsePriceListRows` y `PRICE_SENTINEL_NO_PRICE`)
- Modify: `lib/parseDeltronPriceList.test.js` (agregar tests)
- Create: `test/fixtures/deltron_price_list_sample.csv`
- Modify: `package.json` (agregar dependencia `csv-parse`)

**Interfaces:**
- Consumes: nada nuevo de tasks anteriores (usa `parseStockInfo` de la Task 2, dentro del mismo archivo).
- Produces: `parsePriceListRows(csvText: string): { rows: Array<{ category: string, codigo: string, descripcion: string, stock: {qty:number|null,status:string}, priceUsd: number, marca: string }>, skippedNoPrice: number }`, y la constante `PRICE_SENTINEL_NO_PRICE = 9999999.99`.

- [ ] **Step 1: Instalar csv-parse**

```bash
npm install csv-parse@^5.5.0
```

- [ ] **Step 2: Crear el fixture (datos sintéticos, estructura real del CSV de Deltron)**

Este fixture usa datos inventados (marca/modelo/precios de prueba) — **nunca** datos reales de la lista de precios de Deltron, que es información propietaria y no se commitea al repo. La estructura (comillas, columnas, filas separadoras, codificación) sí replica fielmente el archivo real.

```
,"LISTA DE PRECIOS DELTRON"

,"Generada el :"2026-08-13 11:05:14
,"Almacen(es) :,'PRINCIPAL-CORPAC','CHICLAYO','TRUJILLO'"
,"Almacen(es) :"
,"TIPO DE CAMBIO :3.380"
,"__________________________________"


"_______________","_______________","__________________________________","__________"
" ","CODIGO","MONITOR PLANO 27","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"
"monitor plano 27","montest0001","monitor de prueba 27 fhd ips 100hz hdmi vga negro",>20,150.00, ,"","W","marca test"
"monitor plano 27","montest0002","monitor de prueba premium 27 4k uhd hdr diseño avanzado",3,1250.00, ,"","W","marca test"
"_______________","_______________","__________________________________","__________"
" ","CODIGO","GARANTIA EXTENDIDA","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"
"garantia extendida","gartest0001","garantia extendida de prueba 3 años",>20,9999999.99, ,"","Z","marca test"
"_______________","_______________","__________________________________","__________"
" ","CODIGO","CPU CI5 14XXX S1700","STOCK","PREC DISTRIB US $","PREC S/.","FLETE ","GARAN","MARCA"
"cpu ci5 14xxx s1700","cputest0001","procesador de prueba core i5 generico", ,320.00, ,"","D","marca test"
```

Guardar este contenido tal cual (con codificación de archivo **Latin-1/Windows-1252**, no UTF-8 — importante por la "ñ" en "años") en `test/fixtures/deltron_price_list_sample.csv`.

- [ ] **Step 3: Agregar los tests (fallando)**

Agregar al final de `lib/parseDeltronPriceList.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { parsePriceListRows, PRICE_SENTINEL_NO_PRICE } = require('./parseDeltronPriceList');

function loadFixture() {
  const buffer = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'fixtures', 'deltron_price_list_sample.csv')
  );
  return buffer.toString('latin1');
}

test('PRICE_SENTINEL_NO_PRICE es 9999999.99', () => {
  assert.equal(PRICE_SENTINEL_NO_PRICE, 9999999.99);
});

test('parsePriceListRows extrae las filas con precio real del fixture', () => {
  const { rows, skippedNoPrice } = parsePriceListRows(loadFixture());

  assert.equal(rows.length, 3);
  assert.equal(skippedNoPrice, 1);

  assert.deepEqual(rows[0], {
    category: 'MONITOR PLANO 27',
    codigo: 'montest0001',
    descripcion: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
    stock: { qty: null, status: 'in_stock' },
    priceUsd: 150.0,
    marca: 'marca test',
  });

  assert.deepEqual(rows[1], {
    category: 'MONITOR PLANO 27',
    codigo: 'montest0002',
    descripcion: 'monitor de prueba premium 27 4k uhd hdr diseño avanzado',
    stock: { qty: 3, status: 'low_stock' },
    priceUsd: 1250.0,
    marca: 'marca test',
  });

  assert.deepEqual(rows[2], {
    category: 'CPU CI5 14XXX S1700',
    codigo: 'cputest0001',
    descripcion: 'procesador de prueba core i5 generico',
    stock: { qty: 0, status: 'out_of_stock' },
    priceUsd: 320.0,
    marca: 'marca test',
  });
});

test('parsePriceListRows omite y cuenta filas con el precio centinela 9999999.99', () => {
  const { rows, skippedNoPrice } = parsePriceListRows(loadFixture());
  assert.ok(!rows.some((r) => r.codigo === 'gartest0001'));
  assert.equal(skippedNoPrice, 1);
});

test('parsePriceListRows devuelve vacío para un texto sin filas de datos', () => {
  const result = parsePriceListRows(',"LISTA DE PRECIOS DELTRON"\n,"TIPO DE CAMBIO :3.380"\n');
  assert.deepEqual(result, { rows: [], skippedNoPrice: 0 });
});
```

- [ ] **Step 4: Correr los tests y verificar que fallan**

Run: `node --test lib/parseDeltronPriceList.test.js`
Expected: FAIL — `parsePriceListRows is not a function`.

- [ ] **Step 5: Implementar `parsePriceListRows`**

Agregar a `lib/parseDeltronPriceList.js` (sumar el `require` de `csv-parse/sync` al inicio del archivo):

```js
const { parse } = require('csv-parse/sync');

const PRICE_SENTINEL_NO_PRICE = 9999999.99;

function parsePriceListRows(csvText) {
  // El encabezado del archivo (título, fecha, almacenes, tipo de cambio)
  // tiene comillas mal formadas para un parser CSV estricto (verificado:
  // `,"Generada el :"2026-08-13 11:05:14` — texto pegado directo a una
  // comilla de cierre, sin delimitador). csv-parse lanza
  // "Invalid Closing Quote" si se le pasa el archivo completo. Como el
  // encabezado no tiene filas de datos reales, se recorta el texto para
  // empezar en el primer bloque (que sí es CSV válido) antes de parsear.
  const firstBlockIndex = csvText.indexOf('"_______________"');
  const blocksText = firstBlockIndex >= 0 ? csvText.slice(firstBlockIndex) : csvText;

  const records = parse(blocksText, { relax_column_count: true, skip_empty_lines: true });
  const rows = [];
  let skippedNoPrice = 0;

  for (const record of records) {
    if (record.length !== 9) continue;
    if (record[1] === 'CODIGO') continue; // fila de encabezado de bloque

    const category = (record[0] || '').trim().toUpperCase();
    if (!category) continue;

    const priceUsd = parseFloat(record[4]);
    if (Number.isNaN(priceUsd) || priceUsd === PRICE_SENTINEL_NO_PRICE) {
      skippedNoPrice += 1;
      continue;
    }

    rows.push({
      category,
      codigo: (record[1] || '').trim(),
      descripcion: (record[2] || '').trim(),
      stock: parseStockInfo(record[3]),
      priceUsd,
      marca: (record[8] || '').trim(),
    });
  }

  return { rows, skippedNoPrice };
}
```

Y actualizar el `module.exports` al final del archivo:

```js
module.exports = { parseTipoCambio, parseStockInfo, parsePriceListRows, PRICE_SENTINEL_NO_PRICE };
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `node --test lib/parseDeltronPriceList.test.js`
Expected: 13 tests, PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/parseDeltronPriceList.js lib/parseDeltronPriceList.test.js test/fixtures/deltron_price_list_sample.csv package.json package-lock.json
git commit -m "feat: parser de filas de la lista de precios de Deltron (CSV) + fixture"
```

---

### Task 4: Cliente HTTP de Deltron (Basic Auth)

**Files:**
- Create: `lib/deltronClient.js`
- Test: `lib/deltronClient.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (es HTTP puro).
- Produces:
  - `decodeLatin1(buffer: Buffer): string` (pura, testeable sin red)
  - `fetchPriceList({ username: string, password: string, baseUrl?: string }): Promise<string>`
  - `PRICE_LIST_PATH: string`

- [ ] **Step 1: Escribir el test de la parte pura (fallando)**

```js
// lib/deltronClient.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeLatin1, fetchPriceList, PRICE_LIST_PATH } = require('./deltronClient');

test('decodeLatin1 decodifica correctamente una Ñ (byte 0xD1)', () => {
  const buffer = Buffer.from([0x44, 0x49, 0x53, 0x45, 0xd1, 0x4f]); // "DISE" + 0xD1 + "O"
  assert.equal(decodeLatin1(buffer), 'DISEÑO');
});

test('decodeLatin1 decodifica texto ASCII simple sin cambios', () => {
  const buffer = Buffer.from('TIPO DE CAMBIO :3.380', 'ascii');
  assert.equal(decodeLatin1(buffer), 'TIPO DE CAMBIO :3.380');
});

test('PRICE_LIST_PATH apunta al endpoint real verificado', () => {
  assert.equal(PRICE_LIST_PATH, '/modulos/productos/listaprodnw.php');
});

test('fetchPriceList lanza si faltan usuario o contraseña', async () => {
  await assert.rejects(() => fetchPriceList({}), /DELTRON_USERNAME|usuario/i);
  await assert.rejects(() => fetchPriceList({ username: 'x' }), /DELTRON_PASSWORD|contraseña/i);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test lib/deltronClient.test.js`
Expected: FAIL con `Cannot find module './deltronClient'`.

- [ ] **Step 3: Implementar**

```js
// lib/deltronClient.js
'use strict';

const BASE_URL = 'https://www.deltron.com.pe';
const PRICE_LIST_PATH = '/modulos/productos/listaprodnw.php';

function decodeLatin1(buffer) {
  return buffer.toString('latin1');
}

async function fetchPriceList({ username, password, baseUrl = BASE_URL } = {}) {
  if (!username) {
    throw new Error('DELTRON_USERNAME (usuario) es obligatorio.');
  }
  if (!password) {
    throw new Error('DELTRON_PASSWORD (contraseña) es obligatorio.');
  }

  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const res = await fetch(`${baseUrl}${PRICE_LIST_PATH}`, {
    headers: { Authorization: auth },
  });

  if (!res.ok) {
    throw new Error(`Deltron respondió ${res.status} en ${res.url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return decodeLatin1(buffer);
}

module.exports = { fetchPriceList, decodeLatin1, PRICE_LIST_PATH };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test lib/deltronClient.test.js`
Expected: 4 tests, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deltronClient.js lib/deltronClient.test.js
git commit -m "feat: cliente HTTP de Deltron con autenticación Basic y decodificación Latin-1"
```

---

### Task 5: Orquestador `sync_deltron.js`

**Files:**
- Create: `sync_deltron.js`
- Test: `sync_deltron.test.js`

**Interfaces:**
- Consumes:
  - `CATEGORY_MAP` de `./deltronCategoryMap` (Task 1)
  - `parseTipoCambio`, `parsePriceListRows` de `./lib/parseDeltronPriceList` (Tasks 2-3)
  - `fetchPriceList` de `./lib/deltronClient` (Task 4)
  - `getSupabaseClient`, `getCategoryIdMap`, `logSyncStart`, `logSyncFinish` de `./lib/syncCommon` (ya existente, de la Task 5 del plan de Compudiskett)
  - `round2` de `./pricingEngine` (ya existente)
- Produces: `run(options?): Promise<void>`, `buildProductRow(row, ctx): object`, `buildCategoryLookup(categoryMap): Map<string,string>`

- [ ] **Step 1: Escribir los tests de las funciones puras (fallando)**

```js
// sync_deltron.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProductRow, buildCategoryLookup, run } = require('./sync_deltron');

test('buildCategoryLookup invierte el mapa: categoría de Deltron -> nuestra categoría', () => {
  const lookup = buildCategoryLookup({
    Monitores: ['MONITOR PLANO 27', 'MONITOR CURVO 27'],
    Impresoras: ['IMPRESORA LASER/LED'],
  });
  assert.equal(lookup.get('MONITOR PLANO 27'), 'Monitores');
  assert.equal(lookup.get('MONITOR CURVO 27'), 'Monitores');
  assert.equal(lookup.get('IMPRESORA LASER/LED'), 'Impresoras');
  assert.equal(lookup.get('CPU CI5 14XXX S1700'), undefined);
});

test('buildProductRow arma la fila de products sin final_price, con part_number null y stock real', () => {
  const row = buildProductRow(
    {
      category: 'MONITOR PLANO 27',
      codigo: 'montest0001',
      descripcion: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
      stock: { qty: 3, status: 'low_stock' },
      priceUsd: 150.0,
      marca: 'marca test',
    },
    { categoryId: 'cat-1', supplierId: 'sup-1', tcm: 3.38, pricesIncludeIgv: false }
  );

  assert.ok(row.last_synced_at, 'debe incluir last_synced_at');
  assert.equal(typeof row.last_synced_at, 'string');
  const { last_synced_at, ...rest } = row;

  assert.deepEqual(rest, {
    model: 'monitor de prueba 27 fhd ips 100hz hdmi vga negro',
    part_number: null,
    brand: 'marca test',
    category_id: 'cat-1',
    supplier_id: 'sup-1',
    supplier_sku: 'montest0001',
    cost: 507.0,
    cost_includes_igv: false,
    stock_qty: 3,
    stock_status: 'low_stock',
    source_type: 'web_sync',
    confidence: 'high',
  });
  assert.equal('final_price' in row, false);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test sync_deltron.test.js`
Expected: FAIL con `Cannot find module './sync_deltron'`.

- [ ] **Step 3: Implementar**

```js
// sync_deltron.js
'use strict';

const { fetchPriceList } = require('./lib/deltronClient');
const { parseTipoCambio, parsePriceListRows } = require('./lib/parseDeltronPriceList');
const { CATEGORY_MAP } = require('./deltronCategoryMap');
const { round2 } = require('./pricingEngine');
const { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish } = require('./lib/syncCommon');

const SUPPLIER_NAME = 'Deltron';
const UPSERT_CHUNK_SIZE = 500;

function buildCategoryLookup(categoryMap) {
  const lookup = new Map();
  for (const [ourCategoryName, deltronCategories] of Object.entries(categoryMap)) {
    for (const deltronCategory of deltronCategories) {
      lookup.set(deltronCategory, ourCategoryName);
    }
  }
  return lookup;
}

function buildProductRow(row, { categoryId, supplierId, tcm, pricesIncludeIgv }) {
  return {
    model: row.descripcion,
    part_number: null,
    brand: row.marca,
    category_id: categoryId,
    supplier_id: supplierId,
    supplier_sku: row.codigo,
    cost: round2(row.priceUsd * tcm),
    cost_includes_igv: pricesIncludeIgv,
    stock_qty: row.stock.qty,
    stock_status: row.stock.status,
    source_type: 'web_sync',
    confidence: 'high',
    last_synced_at: new Date().toISOString(),
  };
}

async function run({ supabaseClient, credentials } = {}) {
  const supabase = supabaseClient || getSupabaseClient();
  const username = credentials?.username ?? process.env.DELTRON_USERNAME;
  const password = credentials?.password ?? process.env.DELTRON_PASSWORD;

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, prices_include_igv')
    .eq('name', SUPPLIER_NAME)
    .single();
  if (supplierError) throw supplierError;

  const logId = await logSyncStart(supabase, supplier.id);

  try {
    const categoryIdByName = await getCategoryIdMap(supabase);
    const categoryLookup = buildCategoryLookup(CATEGORY_MAP);

    const csvText = await fetchPriceList({ username, password });
    const tcm = parseTipoCambio(csvText);
    const { rows, skippedNoPrice } = parsePriceListRows(csvText);

    const productRows = [];
    let skippedCategories = 0;

    for (const row of rows) {
      const ourCategoryName = categoryLookup.get(row.category);
      const categoryId = ourCategoryName ? categoryIdByName.get(ourCategoryName) : undefined;
      if (!categoryId) {
        skippedCategories += 1;
        continue;
      }
      productRows.push(
        buildProductRow(row, {
          categoryId,
          supplierId: supplier.id,
          tcm,
          pricesIncludeIgv: supplier.prices_include_igv,
        })
      );
    }

    const dedupedRows = [...new Map(productRows.map((r) => [r.supplier_sku, r])).values()];

    for (let i = 0; i < dedupedRows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = dedupedRows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error: upsertError } = await supabase
        .from('products')
        .upsert(chunk, { onConflict: 'supplier_id,supplier_sku' });
      if (upsertError) throw upsertError;
    }

    const messageParts = [];
    if (skippedCategories > 0) {
      messageParts.push(`${skippedCategories} fila(s) de categoría(s) de Deltron sin mapeo local, omitidas.`);
    }
    if (skippedNoPrice > 0) {
      messageParts.push(`${skippedNoPrice} fila(s) sin precio fijo (cotización o dato inválido), omitidas.`);
    }

    await logSyncFinish(supabase, logId, {
      status: 'success',
      itemsSynced: dedupedRows.length,
      message: messageParts.length > 0 ? messageParts.join(' ') : null,
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

module.exports = { run, buildProductRow, buildCategoryLookup };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test sync_deltron.test.js`
Expected: 2 tests, PASS.

- [ ] **Step 5: Correr TODA la suite de tests del repo**

Run: `node --test`
Expected: todos los tests (Compudiskett + Deltron, Tasks 1-5) PASS, ninguno golpea la red.

- [ ] **Step 6: Commit**

```bash
git add sync_deltron.js sync_deltron.test.js
git commit -m "feat: orquestador de sincronización de Deltron"
```

---

### Task 6: Verificación manual + GitHub Action programada

**Files:**
- Create: `.github/workflows/sync-deltron.yml`

**Interfaces:**
- Consumes: `run()` de `./sync_deltron` (Task 5).

**Nota de alcance:** al igual que en el plan de Compudiskett, este task se limita a los pasos que son edición de archivos (Step 1) — la corrida manual contra la base de datos y el CSV reales (Step 2) y la confirmación de secrets en GitHub (Step 3) requieren credenciales que el ejecutor de este plan probablemente no tiene; repórtalas como pendientes para el humano si no las tienes, no las simules ni las omitas silenciosamente.

- [ ] **Step 1: Crear la GitHub Action programada**

```yaml
# .github/workflows/sync-deltron.yml
name: Sync Deltron

on:
  schedule:
    - cron: '30 */5 * * *'
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node sync_deltron.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          DELTRON_USERNAME: ${{ secrets.DELTRON_USERNAME }}
          DELTRON_PASSWORD: ${{ secrets.DELTRON_PASSWORD }}
```

(El cron usa el minuto 30 en vez de 0, a diferencia de `sync-compudiskett.yml`, para que ambas Actions no compitan por los mismos minutos en la misma hora.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/sync-deltron.yml
git commit -m "feat: GitHub Action programada para sync de Deltron"
```

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Verificación manual contra el CSV y la base de datos reales (requiere credenciales — repórtalo pendiente si no las tienes)**

Con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DELTRON_USERNAME` y `DELTRON_PASSWORD` reales como variables de entorno, correr:

```bash
node sync_deltron.js
```

Verificar en Supabase (`select * from sync_log sl join suppliers s on s.id = sl.supplier_id where s.name = 'Deltron' order by started_at desc limit 1;`) que la fila quedó en `status = 'success'` con `items_synced > 0`, y revisar 5-10 filas de `products` con `supplier_id` de Deltron para confirmar que `cost`, `final_price`, `stock_qty` y `stock_status` tienen valores razonables — en particular un producto de precio alto (para descartar cualquier problema de conversión de moneda) y uno de cada categoría mapeada.

- [ ] **Step 5: Confirmar los secrets en GitHub (requiere acceso a la configuración del repo — repórtalo pendiente si no lo tienes)**

Confirmar en GitHub → `RogerFMC/citec-store` → Settings → Secrets and variables → Actions que existen `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ya deberían existir de Compudiskett), `DELTRON_USERNAME` y `DELTRON_PASSWORD` (nuevos, hay que crearlos). Sin `DELTRON_USERNAME`/`DELTRON_PASSWORD`, la Action falla en el primer paso.

## Fuera de alcance de este plan

- Reconciliar duplicados entre Compudiskett y Deltron cuando ambos venden el mismo producto físico bajo códigos internos distintos: cada uno vive en su propia fila de `products` (distinto `supplier_id`), tal como está diseñado — no es un defecto a resolver aquí.
- Refinar la clasificación de las categorías de Deltron sin mapear (CPU, RAM, motherboards, redes, servidores, software, tablets, celulares, etc.): decisión pendiente de Roger.
- Alerta por correo ante `sync_log.status = 'failed'`.
