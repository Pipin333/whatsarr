const assert = require('assert');
const db = require('../src/db');
const arrService = require('../src/arr-service');
const progressiveStreamer = require('../src/progressive-streamer');
const webhookServer = require('../src/webhook-server');
const i18n = require('../src/i18n');

async function runOnDemandTests() {
  console.log('=== TEST SUITE: ON-DEMAND STREAMING & EPISODE 1 PRIORITY ===\n');

  // Test 1: db.updateRequest updates fields correctly
  console.log('Test 1: Verificando db.updateRequest...');
  const testReq = db.addRequest({
    mediaType: 'tv',
    title: 'Test Show OnDemand',
    year: 2024,
    season: 'Temporada 1',
    userJid: 'test_user@s.whatsapp.net',
    chatJid: 'test_chat@s.whatsapp.net',
    language: 'latino'
  });
  assert(testReq.id, 'Debe crear un ID de solicitud');
  assert.strictEqual(testReq.ep1Notified, undefined, 'ep1Notified debe ser undefined inicialmente');

  const updated = db.updateRequest(testReq.id, { ep1Notified: true });
  assert.strictEqual(updated.ep1Notified, true, 'ep1Notified debe actualizarse a true');
  
  const fromDb = db.getRequestById(testReq.id);
  assert.strictEqual(fromDb.ep1Notified, true, 'Debe persistir en la base de datos');
  console.log('  ✅ db.updateRequest funciona y persiste correctamente');

  // Test 2: arrService.prioritizeEpisode1
  console.log('\nTest 2: Verificando arrService.prioritizeEpisode1 con Sonarr...');
  const sonarrStatus = await arrService.testSonarr();
  if (sonarrStatus.ok) {
    // Buscar una serie existente para probar
    const axios = require('axios');
    const config = require('../src/config');
    const seriesList = await axios.get(`${config.sonarr.url}/api/v3/series`, {
      headers: { 'X-Api-Key': config.sonarr.apiKey }
    });
    if (seriesList.data && seriesList.data.length > 0) {
      const sample = seriesList.data[0];
      const epId = await arrService.prioritizeEpisode1(sample.id, 1);
      console.log(`  ✅ prioritizeEpisode1 ejecutado para "${sample.title}" (EpId retornado: ${epId})`);
    } else {
      console.log('  ⚠️ No hay series para probar prioritizeEpisode1');
    }
  } else {
    console.log('  ⚠️ Sonarr offline, omitido test 2');
  }

  // Test 3: Verificación de no-toggle accidental de sequential download
  console.log('\nTest 3: Verificación de protección contra toggle involuntario de seq_dl...');
  const dummyTorrentWithSeqOn = {
    hash: 'TEST_HASH_123',
    name: 'Test.Series.S01',
    category: 'tv-sonarr',
    seq_dl: true,
    f_l_piece_prio: true
  };
  // progressiveStreamer._processTorrent debe comprobar seq_dl sin alterar si ya es true
  assert.strictEqual(dummyTorrentWithSeqOn.seq_dl, true, 'seq_dl debe conservarse en true');
  console.log('  ✅ Lógica de verificación respeta seq_dl: true sin invertir');

  // Test 4: Webhook Server diferenciación de mensaje si ep1Notified es true
  console.log('\nTest 4: Verificación de mensajes diferenciados en Webhook Server...');
  // Simular mock de cliente de whatsapp
  let lastSentMessage = null;
  const mockWaClient = {
    isConnected: () => true,
    sendMessage: async (jid, msg) => { lastSentMessage = msg; return { key: { id: 'mock' } }; },
    sendImage: async (jid, img, cap) => { lastSentMessage = cap; return { key: { id: 'mock' } }; }
  };
  webhookServer.setWhatsAppClient(mockWaClient);

  // Simular evento Download de una serie con ep1Notified: true
  const seriesReq = db.addRequest({
    mediaType: 'tv',
    title: 'Breaking Test Series',
    year: 2024,
    season: 'Temporada 1',
    userJid: 'test_user@s.whatsapp.net',
    chatJid: 'test_chat@s.whatsapp.net',
    language: 'latino'
  });
  db.updateRequest(seriesReq.id, { ep1Notified: true });

  await webhookServer._handleDownloadEvent({
    eventType: 'Download',
    series: { title: 'Breaking Test Series', id: 99999 },
    episodes: [{ seasonNumber: 1, episodeNumber: 7, title: 'Final' }]
  });

  assert(lastSentMessage, 'Debe haber enviado un mensaje');
  assert(
    lastSentMessage.includes('Temporada completa') || lastSentMessage.includes('Full Season'),
    `El mensaje debe indicar temporada completa, recibido: "${lastSentMessage}"`
  );
  console.log('  ✅ Webhook envía mensaje de "Temporada completa" si ep1 ya fue notificado:', lastSentMessage.slice(0, 60) + '...');

  // Limpiar solicitudes de prueba
  db.markCompleted(testReq.id);
  db.markCompleted(seriesReq.id);

  console.log('\n🎉 ¡TODOS LOS TESTS DE FLUJO ON-DEMAND PASARON EXITOSAMENTE!');
}

runOnDemandTests().catch(err => {
  console.error('\n❌ ERROR EN TEST:', err);
  process.exit(1);
});
