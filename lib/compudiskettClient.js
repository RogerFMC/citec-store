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
    if (!res.ok) {
      throw new Error(`Compudiskett respondió ${res.status} en ${res.url}`);
    }
    this._captureCookie(res);
    return res.text();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      throw new Error(`Compudiskett respondió ${res.status} en ${res.url}`);
    }
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
