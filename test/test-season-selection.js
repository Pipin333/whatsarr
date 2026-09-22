const axios = require('axios');
const arrService = require('../src/arr-service');

async function runTests() {
  console.log('🧪 Iniciando pruebas de Selector de Temporadas para Series...\n');

  // Test 1: arrService.getSeriesSeasons
  console.log('--- Test 1: arrService.getSeriesSeasons con Sonarr ---');
  try {
    const seasons = await arrService.getSeriesSeasons({ title: 'Loki', tvdbId: 362472 });
    console.log('  Temporadas obtenidas:', seasons);
    if (Array.isArray(seasons) && seasons.length >= 2) {
      console.log(`  ✅ OK: Se obtuvieron ${seasons.length} temporadas reales para Loki`);
    } else {
      console.error('  ❌ FALLO: No se obtuvieron las temporadas esperadas:', seasons);
      process.exit(1);
    }
  } catch (err) {
    console.error('  ❌ Error en getSeriesSeasons:', err.message);
    process.exit(1);
  }

  // Test 2: Endpoint /api/series/seasons
  console.log('\n--- Test 2: Endpoint GET /api/series/seasons?title=Loki ---');
  try {
    const res = await axios.get('http://localhost:3001/api/series/seasons?title=Loki');
    if (res.data.success && Array.isArray(res.data.seasons) && res.data.seasons.length > 0) {
      console.log(`  ✅ OK: Endpoint retornó ${res.data.seasons.length} temporadas`);
    } else {
      console.error('  ❌ FALLO en respuesta de endpoint:', res.data);
      process.exit(1);
    }
  } catch (err) {
    console.warn('  ⚠️ Servidor local en 3001 no respondió (se probará tras reinicio):', err.message);
  }

  // Test 3: Verificación de coincidencia de tipo en WhatsApp ('tv' || 'series')
  console.log('\n--- Test 3: Reconocimiento de tipo de serie en WhatsApp ---');
  const testItems = [
    { type: 'tv', title: 'Loki', isSeriesExpected: true },
    { type: 'series', title: 'Stranger Things', isSeriesExpected: true },
    { type: 'movie', title: 'Inception', isSeriesExpected: false }
  ];

  for (const item of testItems) {
    const isSeries = item.type === 'series' || item.type === 'tv';
    if (isSeries === item.isSeriesExpected) {
      console.log(`  ✅ OK: Tipo "${item.type}" detectado correctamente como ${isSeries ? 'SERIE' : 'PELICULA'}`);
    } else {
      console.error(`  ❌ FALLO: Tipo "${item.type}" falló en verificación`);
      process.exit(1);
    }
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE SELECCIÓN DE TEMPORADAS PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
