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
