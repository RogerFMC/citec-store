'use strict';

const fs = require('node:fs');

const BASE_URL = 'https://www.deltron.com.pe';
// Verificado en vivo el 2026-08-13: este endpoint NO devuelve el CSV — es la
// página intermedia "Lista de Precios y Stock" (un formulario). El botón CSV
// de esa página dispara un POST a otro endpoint (listaprecios.php) protegido
// por una sesión de aplicación (cookies deltronlogin/razsoc/grupo/cartera)
// que Basic Auth por sí solo no reproduce. `fetchPriceList` queda como
// mecanismo alterno documentado, no en uso por defecto — ver
// readLocalPriceList, que es el mecanismo real mientras no se resuelva la
// automatización del login (decisión de Roger, 2026-08-13: no invertir en
// Playwright por ahora).
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

// Lee la lista de precios desde un archivo local descargado a mano del
// portal de Deltron (botón CSV de "Lista de Precios y Stock"), decodificado
// como Latin-1 igual que la respuesta HTTP real tendría. Mecanismo primario
// mientras la descarga automática no esté resuelta.
function readLocalPriceList(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `No se encontró el archivo de lista de precios de Deltron en "${filePath}". ` +
        'Descárgalo a mano del portal (botón CSV de "Lista de Precios y Stock") y guárdalo en esa ruta.'
    );
  }
  const buffer = fs.readFileSync(filePath);
  return decodeLatin1(buffer);
}

module.exports = { fetchPriceList, decodeLatin1, readLocalPriceList, PRICE_LIST_PATH };
