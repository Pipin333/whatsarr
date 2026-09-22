const assert = require('assert');
const arrService = require('../src/arr-service');
const normalizer = require('../src/llm-normalizer');

async function runTests() {
  console.log('==================================================');
  console.log('🧪 TEST SUITE: RESTAURAR Y DESCARGAR EPISODIOS FALTANTES');
  console.log('==================================================\n');

  // 1. Detección de intención en lenguaje natural
  console.log('--- 1. Pruebas de Detección de Intención ---');
  const q1 = await normalizer.normalize('faltan capítulos de Stranger Things');
  assert.strictEqual(q1.is_media_request, true, 'Debe ser solicitud de media');
  assert.strictEqual(q1.is_restore_missing, true, 'Debe ser marcada como restore_missing');
  assert.ok(q1.canonical_title.toLowerCase().includes('stranger things'), 'Debe extraer Stranger Things');
  console.log('✅ PASS: "faltan capítulos de Stranger Things" -> is_restore_missing:', q1.is_restore_missing, '| Título:', q1.canonical_title);

  const q2 = await normalizer.normalize('descarga los episodios faltantes de Stranger Things temp 2');
  assert.strictEqual(q2.is_restore_missing, true);
  assert.strictEqual(q2.season, 2);
  console.log('✅ PASS: "descarga los episodios faltantes de Stranger Things temp 2" -> Temp:', q2.season);

  // 2. Consulta de resumen de episodios faltantes en Sonarr
  console.log('\n--- 2. Pruebas de Resumen de Faltantes (Sonarr) ---');
  const summary = await arrService.getMissingEpisodesSummary();
  assert.strictEqual(summary.ok, true, 'getMissingEpisodesSummary debe responder ok');
  assert.ok(typeof summary.totalMissing === 'number', 'totalMissing debe ser numérico');
  assert.ok(Array.isArray(summary.series), 'series debe ser un array');
  console.log(`✅ PASS: Resumen obtenido: ${summary.seriesCount} serie(s) con faltantes, ${summary.totalMissing} episodios faltantes en total`);

  if (summary.series.length > 0) {
    const st = summary.series.find(s => s.title.toLowerCase().includes('stranger things'));
    if (st) {
      assert.ok(st.missingEpisodes > 0, 'Stranger Things debe tener episodios faltantes');
      assert.ok(st.seasons.length > 0, 'Debe listar temporadas con faltantes');
      console.log(`✅ PASS: Stranger Things detectada con ${st.missingEpisodes} episodios faltantes en ${st.seasons.length} temporadas`);
    }
  }

  // 3. Ejecución de Restauración (Re-escaneo de disco)
  console.log('\n--- 3. Pruebas de Re-escaneo y Restauración en Disco ---');
  const rescanResult = await arrService.restoreAndDownloadMissing({ action: 'rescan' });
  assert.strictEqual(rescanResult.success, true, 'Re-escaneo debe ser exitoso');
  assert.ok(rescanResult.actions.length > 0, 'Debe registrar acciones ejecutadas');
  console.log('✅ PASS: Re-escaneo ejecutado exitosamente:', rescanResult.actions.join(' • '));

  // 4. Ejecución de Búsqueda de Faltantes
  console.log('\n--- 4. Pruebas de Búsqueda de Episodios Faltantes ---');
  const searchResult = await arrService.restoreAndDownloadMissing({ seriesId: 1, seasonNumber: 1, action: 'search' });
  assert.strictEqual(searchResult.success, true, 'Búsqueda debe ser exitosa');
  assert.ok(searchResult.actions.some(a => a.includes('Búsqueda automática')), 'Debe iniciar búsqueda');
  console.log('✅ PASS: Búsqueda iniciada exitosamente:', searchResult.actions.join(' • '));

  console.log('\n==================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE RESTAURAR Y DESCARGAR FALTANTES PASARON EXITOSAMENTE');
  console.log('==================================================');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
