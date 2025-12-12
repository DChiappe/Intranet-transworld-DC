const https = require('https');

// Servicio simple para obtener el USD/CLP ("Dólar observado") desde mindicador.cl
// - No requiere API key
// - Con cache en memoria para evitar pedir el valor en cada request

const DEFAULT_FALLBACK_USD = 950.5; // mismo valor fijo que ya tenías, por si falla la API
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

let cache = {
  value: null,
  fetchedAt: 0,
  fecha: null
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              return reject(new Error(`HTTP ${res.statusCode} al consultar ${url}`));
            }
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Retorna el valor de USD/CLP (dólar observado).
 * @returns {Promise<{valor:number, fecha:string|null, fuente:string}>}
 */
async function getUsdHoy() {
  const now = Date.now();

  // 1) Cache en memoria
  if (cache.value != null && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { valor: cache.value, fecha: cache.fecha, fuente: 'cache' };
  }

  // 2) API (mindicador)
  try {
    const data = await getJson('https://mindicador.cl/api/dolar');

    const serie = Array.isArray(data?.serie) ? data.serie : [];
    const ultimo = serie[0];
    const valor = Number(ultimo?.valor);

    if (!Number.isFinite(valor)) {
      throw new Error('Respuesta inválida: no viene "valor" numérico');
    }

    cache = {
      value: valor,
      fetchedAt: now,
      fecha: typeof ultimo?.fecha === 'string' ? ultimo.fecha : null
    };

    return { valor, fecha: cache.fecha, fuente: 'mindicador' };
  } catch (err) {
    // 3) Si falla, devolvemos cache anterior (si existe) o el fallback
    if (cache.value != null) {
      return { valor: cache.value, fecha: cache.fecha, fuente: 'cache-stale' };
    }
    return { valor: DEFAULT_FALLBACK_USD, fecha: null, fuente: 'fallback' };
  }
}

module.exports = { getUsdHoy };
