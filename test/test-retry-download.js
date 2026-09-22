const assert = require('assert');
const arrService = require('../src/arr-service');
const db = require('../src/db');

async function runTests() {
  console.log('==================================================');
  console.log('🧪 TEST SUITE: REINTENTO DE DESCARGAS COLGADAS');
  console.log('==================================================\n');

  // 1. Probar que retryDownloadByHash valida hash
  try {
    await arrService.retryDownloadByHash('');
    assert.fail('Debería haber fallado con hash vacío');
  } catch (err) {
    assert.strictEqual(err.message, 'Hash no especificado');
    console.log('✅ PASS: Validación de hash no vacío en retryDownloadByHash');
  }

  // 2. Probar que retryStalledDownloads se ejecuta sin errores
  try {
    const actions = await arrService.retryStalledDownloads();
    assert(Array.isArray(actions), 'Debería retornar un arreglo de acciones');
    console.log(`✅ PASS: retryStalledDownloads ejecutado correctamente (${actions.length} acciones)`);
  } catch (err) {
    assert.fail(`Error en retryStalledDownloads: ${err.message}`);
  }

  // 3. Probar que db.getRequestById funciona
  const sampleReq = db.addRequest({
    mediaType: 'movie',
    title: 'Test Movie Retry',
    year: 2024,
    radarrId: 9999,
    userJid: 'test@s.whatsapp.net',
    language: 'latino'
  });

  const retrieved = db.getRequestById(sampleReq.id);
  assert(retrieved, 'Debería recuperar la solicitud por ID');
  assert.strictEqual(retrieved.title, 'Test Movie Retry');
  console.log('✅ PASS: db.getRequestById recupera la solicitud correctamente');

  // Limpiar y purgar solicitud de prueba de la base de datos
  db.requests = db.requests.filter(r => r.id !== sampleReq.id);
  db._save(db.requestsFile, db.requests);

  console.log('\n==================================================');
  console.log('📊 RESULTADOS: Todas las pruebas de reintento pasaron exitosamente');
  console.log('==================================================');
}

runTests().catch(err => {
  console.error('❌ Error en tests:', err);
  process.exit(1);
});
