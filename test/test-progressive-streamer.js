/**
 * Test Suite for Progressive Streamer Engine
 */

const assert = require('assert');
const progressiveStreamer = require('../src/progressive-streamer');
const axios = require('axios');
const config = require('../src/config');

async function runTests() {
  console.log('=== TEST SUITE: PROGRESSIVE STREAMER ENGINE ===\n');

  // Test 1: Media info parser
  console.log('Test 1: Parsing de nombres de archivo y torrents...');
  const t1 = progressiveStreamer._parseMediaInfoFromFileName(
    'The.Big.Bang.Theory.S01E01.Pilot.1080p.10bit.BluRay.AAC5.1.HEVC-Vyndros.mkv',
    'The Big Bang Theory (2007) Season 1 S01'
  );
  assert.strictEqual(t1.season, 1, 'Temporada debe ser 1');
  assert.strictEqual(t1.episode, 1, 'Episodio debe ser 1');
  assert(t1.seriesTitle.toLowerCase().includes('big bang theory'), 'Título de serie debe contener "big bang theory"');
  console.log('  ✅ Parser S01E01 correcto:', t1);

  const t2 = progressiveStreamer._parseMediaInfoFromFileName(
    'How.I.Met.Your.Mother.S02E09.Slap.Bet.720p.HDTV.x264.mkv',
    'How I Met Your Mother Season 2'
  );
  assert.strictEqual(t2.season, 2, 'Temporada debe ser 2');
  assert.strictEqual(t2.episode, 9, 'Episodio debe ser 9');
  console.log('  ✅ Parser S02E09 correcto:', t2);

  // Test 2: Comprobación de estado de clientes de descarga en Sonarr y Radarr
  console.log('\nTest 2: Verificación de configuración nativa secuencial en Sonarr y Radarr...');
  const [sRes, rRes] = await Promise.all([
    axios.get(`${config.sonarr.url}/api/v3/downloadclient`, { headers: { 'X-Api-Key': config.sonarr.apiKey } }),
    axios.get(`${config.radarr.url}/api/v3/downloadclient`, { headers: { 'X-Api-Key': config.radarr.apiKey } })
  ]);

  const sQb = sRes.data.find(c => (c.implementation || '').toLowerCase() === 'qbittorrent');
  const rQb = rRes.data.find(c => (c.implementation || '').toLowerCase() === 'qbittorrent');

  const sSeq = sQb.fields.find(f => f.name === 'sequentialOrder')?.value;
  const sFl = sQb.fields.find(f => f.name === 'firstAndLast')?.value;
  assert.strictEqual(sSeq, true, 'Sonarr debe tener sequentialOrder=true');
  assert.strictEqual(sFl, true, 'Sonarr debe tener firstAndLast=true');
  console.log('  ✅ Sonarr tiene sequentialOrder y firstAndLast activos');

  const rSeq = rQb.fields.find(f => f.name === 'sequentialOrder')?.value;
  const rFl = rQb.fields.find(f => f.name === 'firstAndLast')?.value;
  assert.strictEqual(rSeq, true, 'Radarr debe tener sequentialOrder=true');
  assert.strictEqual(rFl, true, 'Radarr debe tener firstAndLast=true');
  console.log('  ✅ Radarr tiene sequentialOrder y firstAndLast activos');

  // Test 3: Conexión con qBittorrent Web API
  console.log('\nTest 3: Conexión con qBittorrent...');
  const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/app/version`);
  assert(qbRes.status === 200, 'qBittorrent debe responder con 200');
  console.log(`  ✅ qBittorrent ONLINE (v${qbRes.data})`);

  // Test 4: Conexión y refresco con Plex API
  console.log('\nTest 4: Conexión con Plex...');
  if (config.plex.token) {
    const plexRes = await axios.get(`${config.plex.url}/library/sections`, {
      headers: { 'X-Plex-Token': config.plex.token, 'Accept': 'application/json' }
    });
    assert(plexRes.status === 200, 'Plex debe responder con 200');
    console.log('  ✅ Plex ONLINE y token válido');
  } else {
    console.log('  ⚠️ PLEX_TOKEN no configurado (omitido test de Plex)');
  }

  // Test 5: Simulación de escaneo del ProgressiveStreamer
  console.log('\nTest 5: Ciclo de inspección de ProgressiveStreamer...');
  await progressiveStreamer.checkActiveDownloads();
  console.log('  ✅ Ciclo checkActiveDownloads ejecutado sin excepciones');

  console.log('\n🎉 ¡TODOS LOS TESTS DEL PROGRESSIVE STREAMER PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN TEST SUITE:', err.message);
  process.exit(1);
});
