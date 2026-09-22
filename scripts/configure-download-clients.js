/**
 * Configure Sonarr & Radarr Download Clients for Native Sequential Download
 * Sets sequentialOrder = true and firstAndLast = true on qBittorrent download clients.
 */

const axios = require('axios');
const config = require('../src/config');

async function configureClient(app, url, apiKey) {
  if (!apiKey) {
    console.warn(`[${app}] Falta API key, omitiendo.`);
    return;
  }

  const headers = { 'X-Api-Key': apiKey };
  const res = await axios.get(`${url}/api/v3/downloadclient`, { headers });
  const clients = res.data;
  const qb = clients.find(c => (c.implementation || '').toLowerCase() === 'qbittorrent');

  if (!qb) {
    console.warn(`[${app}] No se encontró cliente qBittorrent.`);
    return;
  }

  let modified = false;
  qb.fields = qb.fields.map(f => {
    if (f.name === 'sequentialOrder' && f.value !== true) {
      f.value = true;
      modified = true;
    }
    if (f.name === 'firstAndLast' && f.value !== true) {
      f.value = true;
      modified = true;
    }
    return f;
  });

  if (modified) {
    await axios.put(`${url}/api/v3/downloadclient/${qb.id}`, qb, { headers });
    console.log(`[${app}] ✅ Configuración actualizada: sequentialOrder=true, firstAndLast=true.`);
  } else {
    console.log(`[${app}] ✨ Ya tenía activada la descarga secuencial.`);
  }
}

async function main() {
  console.log('--- CONFIGURANDO CLIENTES DE DESCARGA PARA STREAMING SECUENCIAL ---');
  try {
    await configureClient('Sonarr', config.sonarr.url, config.sonarr.apiKey);
    await configureClient('Radarr', config.radarr.url, config.radarr.apiKey);
    console.log('🎉 Clientes de descarga configurados exitosamente.');
  } catch (err) {
    console.error('Error configurando clientes:', err.response ? err.response.data : err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { configureClient };
