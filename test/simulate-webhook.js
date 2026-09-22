const axios = require('axios');
const db = require('../src/db');
const config = require('../src/config');

async function testWebhook() {
  console.log('--- SIMULADOR DE WEBHOOK RADARR / SONARR ---');

  // 1. Simular que un usuario pidió una película previamente por WhatsApp
  const mockUserJid = '5491112345678@s.whatsapp.net';
  const mockChatJid = '120363028391234@g.us'; // O chat privado

  console.log('1. Creando solicitud pendiente en la base de datos local...');
  const req = db.addRequest({
    mediaType: 'movie',
    title: 'Inception',
    year: 2010,
    tmdbId: 27205,
    radarrId: 99,
    userJid: mockUserJid,
    chatJid: mockChatJid,
    language: 'latino',
    posterUrl: 'https://image.tmdb.org/t/p/w500/o29wN13V3r0j24zU88iQe2i2gN.jpg'
  });

  console.log(`✅ Solicitud registrada con ID: ${req.id}`);

  // 2. Simular el payload que Radarr envía al completar la descarga
  const radarrPayload = {
    eventType: 'Download',
    movie: {
      id: 99,
      title: 'Inception',
      year: 2010,
      filePath: 'G:\\Media\\Peliculas\\Inception (2010)\\Inception (2010).mkv',
      tmdbId: 27205
    },
    movieFile: {
      quality: 'WEBDL-1080p',
      qualityVersion: 1,
      releaseGroup: 'PlexDubs'
    }
  };

  console.log(`2. Enviando Webhook de descarga a http://localhost:${config.port}/webhook...`);

  try {
    const res = await axios.post(`http://localhost:${config.port}/webhook`, radarrPayload);
    console.log('✅ Respuesta del servidor Webhook:', res.data);

    // 3. Verificar estado en la DB
    const updated = db.listRequests(5).find(r => r.id === req.id);
    console.log(`3. Estado final de la solicitud: "${updated.status}" (Completado a las: ${updated.completedAt})`);
    console.log('\n🎉 ¡La simulación del webhook fue exitosa!');
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`⚠️ El servidor del bot no está encendido en el puerto ${config.port}.`);
      console.log('Inicia primero el bot con "npm start" y vuelve a ejecutar este test en otra terminal.');
    } else {
      console.error('❌ Error en la prueba:', err.message);
    }
  }
}

testWebhook();
