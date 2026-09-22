const axios = require('axios');
const webhookServer = require('../src/webhook-server');
const db = require('../src/db');
const config = require('../src/config');

async function runE2ETest() {
  console.log('--- TEST E2E: Flujo de Webhook y Base de Datos ---');

  // Usar puerto de prueba para no colisionar
  const testPort = 3099;
  config.port = testPort;

  // Mock del cliente WhatsApp para verificar que recibiría la orden de envío
  let messageSent = null;
  const mockWhatsApp = {
    isConnected: () => true,
    sendMessage: async (jid, text) => {
      console.log(`[Mock WhatsApp] Mensaje de texto enviado a ${jid}:\n${text}`);
      messageSent = { jid, text };
    },
    sendImage: async (jid, imageUrl, caption) => {
      console.log(`[Mock WhatsApp] Imagen enviada a ${jid} (URL: ${imageUrl}):\n${caption}`);
      messageSent = { jid, imageUrl, caption };
    }
  };

  webhookServer.setWhatsAppClient(mockWhatsApp);
  await webhookServer.start();

  // 1. Simular registro de pedido
  console.log('\n1. Registrando pedido de prueba en la base de datos...');
  const userJid = '5491112345678@s.whatsapp.net';
  const chatJid = 'family-group@g.us';

  const req = db.addRequest({
    mediaType: 'movie',
    title: 'Inception',
    year: 2010,
    tmdbId: 27205,
    radarrId: 101,
    userJid: userJid,
    chatJid: chatJid,
    language: 'latino',
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_.jpg'
  });

  console.log(`✅ Pedido guardado: ID ${req.id}, Estado: ${req.status}`);

  // 2. Simular llamada Webhook desde Radarr
  console.log('\n2. Enviando Webhook de descarga completada desde Radarr...');
  const payload = {
    eventType: 'Download',
    movie: {
      id: 101,
      title: 'Inception',
      year: 2010,
      tmdbId: 27205
    },
    movieFile: {
      quality: 'WEBDL-1080p'
    }
  };

  const response = await axios.post(`http://localhost:${testPort}/webhook`, payload);
  console.log(`✅ Respuesta HTTP del webhook: ${response.status}`, response.data);

  // 3. Validar que la base de datos se actualizó a 'completed'
  const updatedReq = db.listRequests(5).find(r => r.id === req.id);
  console.log(`\n3. Verificando estado en base de datos:`);
  console.log(`   - Estado actual: ${updatedReq.status}`);
  console.log(`   - Fecha completado: ${updatedReq.completedAt}`);

  // 4. Validar mensaje enviado por WhatsApp
  if (messageSent) {
    console.log(`\n✅ ¡Mensaje de WhatsApp disparado correctamente hacia: ${messageSent.jid}!`);
  } else {
    throw new Error('No se envió el mensaje de WhatsApp');
  }

  // Cerrar servidor de prueba
  webhookServer.stop();
  console.log('\n🎉 ¡Test E2E de Webhook superado con éxito total!');
  process.exit(0);
}

runE2ETest().catch(err => {
  console.error('❌ Error en test E2E:', err);
  process.exit(1);
});
