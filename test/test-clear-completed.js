const axios = require('axios');
const arrService = require('../src/arr-service');

async function runTests() {
  console.log('🧪 Iniciando pruebas de Ocultar / Eliminar Descargas Completadas...\n');

  // Test 1: Regex de comandos WhatsApp
  console.log('--- Test 1: Reconocimiento de comandos de WhatsApp ---');
  const testPhrases = [
    { text: 'limpiar completadas', shouldMatch: true },
    { text: 'limpiar las descargas completadas', shouldMatch: true },
    { text: 'borrar completadas', shouldMatch: true },
    { text: 'eliminar descargas completadas', shouldMatch: true },
    { text: 'quitar completadas', shouldMatch: true },
    { text: 'oye pon la del joker 2', shouldMatch: false },
    { text: 'hola como estas', shouldMatch: false }
  ];

  const regex = /(?:limpiar|borrar|quitar|eliminar)\s+(?:las\s+)?descargas\s+completadas|(?:limpiar|borrar|quitar)\s+completadas/i;
  for (const item of testPhrases) {
    const matched = regex.test(item.text);
    if (matched === item.shouldMatch) {
      console.log(`  ✅ OK: "${item.text}" -> ${matched ? 'Detectado' : 'Ignorado'}`);
    } else {
      console.error(`  ❌ FALLO: "${item.text}" esperado ${item.shouldMatch} pero dio ${matched}`);
      process.exit(1);
    }
  }

  // Test 2: arrService.clearCompletedDownloads
  console.log('\n--- Test 2: arrService.clearCompletedDownloads(false) en qBittorrent ---');
  try {
    const result = await arrService.clearCompletedDownloads(false);
    console.log('  ✅ OK: clearCompletedDownloads ejecutado con éxito');
    console.log('  Resultado:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('  ❌ Error en clearCompletedDownloads:', err.message);
    process.exit(1);
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE LIMPIEZA DE COMPLETADAS PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('Error fatal en pruebas:', err);
  process.exit(1);
});
