const https = require('https');

const DEFAULT_FALLBACK_USD = 950.5;
const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = {
  value: null,
  fetchedAt: 0,
  fecha: null,
  historico: [] 
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

async function getUsdHoy() {
  const now = Date.now();

  if (cache.value != null && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { valor: cache.value, fecha: cache.fecha, historico: cache.historico, fuente: 'cache' };
  }

  try {
    const data = await getJson('https://mindicador.cl/api/dolar');
    const serie = Array.isArray(data?.serie) ? data.serie : [];
    const ultimo = serie[0];
    const valor = Number(ultimo?.valor);

    if (!Number.isFinite(valor)) {
      throw new Error('Respuesta inválida');
    }

    // Tomamos los últimos 10 días y los invertimos para el gráfico
    const historico = serie.slice(0, 10).reverse();

    cache = {
      value: valor,
      fetchedAt: now,
      fecha: typeof ultimo?.fecha === 'string' ? ultimo.fecha : null,
      historico: historico
    };

    return { valor, fecha: cache.fecha, historico: cache.historico, fuente: 'mindicador' };
  } catch (err) {
    if (cache.value != null) {
      return { valor: cache.value, fecha: cache.fecha, historico: cache.historico, fuente: 'cache-stale' };
    }
    return { valor: DEFAULT_FALLBACK_USD, fecha: null, historico: [], fuente: 'fallback' };
  }
}

module.exports = { getUsdHoy };