const http = require('http');
const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function configureTrackers() {
  console.log('--- CONFIGURANDO TRACKERS Y OPTIMIZACIÓN EN QBITTORRENT ---');

  // 1. Descargar listas maestras de trackers actualizadas
  console.log('1. Descargando listas de trackers actualizadas...');
  let trackers = new Set();

  try {
    const bestTrackers = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt');
    bestTrackers.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach(t => trackers.add(t));
    console.log(`- trackers_best: ${trackers.size} trackers cargados.`);
  } catch (err) {
    console.warn('Advertencia al descargar trackers_best:', err.message);
  }

  try {
    const allTrackers = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all.txt');
    allTrackers.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach(t => trackers.add(t));
    console.log(`- Total tras trackers_all: ${trackers.size} trackers únicos.`);
  } catch (err) {
    console.warn('Advertencia al descargar trackers_all:', err.message);
  }

  // Lista infalible de respaldo si no hubiera internet
  const fallback = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'http://tracker.qu.ax:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://tracker.srv00.com:6969/announce',
    'udp://p4p.arenabg.com:1337/announce',
    'udp://movies.zsw.ca:6969/announce',
    'udp://tracker.altrosky.nl:6969/announce'
  ];
  fallback.forEach(t => trackers.add(t));

  const trackerArray = Array.from(trackers);
  console.log(`\nTotal de trackers listos para inyección: ${trackerArray.length}`);

  // Formato para qBittorrent: cada tracker en una línea (separados por doble salto o salto simple)
  const trackersString = trackerArray.join('\n\n');

  // 2. Configurar preferencias en qBittorrent vía WebUI API
  console.log('\n2. Aplicando configuración en qBittorrent (Web API)...');
  const prefs = {
    add_trackers_enabled: true,
    add_trackers: trackersString,
    add_trackers_from_url_enabled: true,
    add_trackers_url: 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt',
    announce_to_all_trackers: true,
    announce_to_all_tiers: true,
    preallocate_all: true,
    max_connec: 1000,
    max_connec_per_torrent: 250,
    max_uploads: 50,
    max_uploads_per_torrent: 20
  };

  const postData = 'json=' + encodeURIComponent(JSON.stringify(prefs));

  const options = {
    hostname: '127.0.0.1',
    port: 8080,
    path: '/api/v2/app/setPreferences',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let respBody = '';
      res.on('data', c => respBody += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Preferencias aplicadas exitosamente en qBittorrent.');
          resolve();
        } else {
          reject(new Error(`qBittorrent respondió con código ${res.statusCode}: ${respBody}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  // 3. Verificar preferencias aplicadas
  console.log('\n3. Verificando estado final de configuración...');
  await new Promise((resolve) => {
    http.get('http://127.0.0.1:8080/api/v2/app/preferences', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const current = JSON.parse(d);
          console.log({
            add_trackers_enabled: current.add_trackers_enabled,
            add_trackers_count: current.add_trackers ? current.add_trackers.split('\n').filter(Boolean).length : 0,
            add_trackers_from_url_enabled: current.add_trackers_from_url_enabled,
            add_trackers_url: current.add_trackers_url,
            announce_to_all_trackers: current.announce_to_all_trackers,
            announce_to_all_tiers: current.announce_to_all_tiers,
            preallocate_all: current.preallocate_all,
            max_connec: current.max_connec,
            max_connec_per_torrent: current.max_connec_per_torrent
          });
        } catch (e) {
          console.log('Error parseando respuesta:', e.message);
        }
        resolve();
      });
    });
  });

  console.log('\n🎉 ¡LISTO! qBittorrent ha sido configurado con la lista infalible y optimizaciones de 960 Mbps.');
}

configureTrackers().catch(err => {
  console.error('❌ Error configurando trackers:', err);
  process.exit(1);
});
