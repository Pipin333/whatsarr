const webhookServer = require('./webhook-server');
const whatsappBot = require('./whatsapp');
const arrService = require('./arr-service');
const config = require('./config');

async function main() {
  console.log('====================================================');
  console.log('🎬 PLEX WHATSAPP BOT - FLUJO DE DESCARGAS AUTOMÁTICO');
  console.log('====================================================');
  console.log(`📁 Carpeta de Películas: ${config.moviesPath}`);
  console.log(`📁 Carpeta de Series:    ${config.seriesPath}`);
  console.log('----------------------------------------------------');

  // 1. Iniciar servidor de webhooks
  webhookServer.setWhatsAppClient(whatsappBot);
  await webhookServer.start();

  // 2. Comprobar conexiones a Radarr y Sonarr
  const radarrStatus = await arrService.testRadarr();
  if (radarrStatus.ok) {
    console.log(`[Radarr] ✅ Conectado a Radarr v${radarrStatus.version}`);
  } else {
    console.log(`[Radarr] ⚠️ No conectado: ${radarrStatus.message}`);
  }

  const sonarrStatus = await arrService.testSonarr();
  if (sonarrStatus.ok) {
    console.log(`[Sonarr] ✅ Conectado a Sonarr v${sonarrStatus.version}`);
  } else {
    console.log(`[Sonarr] ⚠️ No conectado: ${sonarrStatus.message}`);
  }

  // 3. Iniciar el bot de WhatsApp
  console.log('[WhatsApp] Iniciando cliente WhatsApp...');
  await whatsappBot.start();
}

main().catch(err => {
  console.error('Error fatal al iniciar la aplicación:', err);
  process.exit(1);
});
