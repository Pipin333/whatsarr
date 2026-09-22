const assert = require('assert');
const scorer = require('../src/release-scorer');

function runTests() {
  console.log('🧪 Iniciando pruebas de Fase 2: Release Scorer (Fuzzball)...\n');

  const movieIntent = {
    canonical_title: 'Joker: Folie à Deux',
    original_title: 'Joker: Folie à Deux',
    year: 2024,
    media_type: 'movie',
    season: null,
    episode: null,
    search_keywords: ['Joker Folie a Deux', 'Joker 2', 'Joker Folie a Deux 2024']
  };

  // Test 1: Descalificación inmediata de calidades basura (CAM/TS/Screener)
  console.log('Test 1: Descarte inmediato de CAM y Telesync');
  const camRelease = {
    title: 'Joker.Folie.a.Deux.2024.CAMRip.x264-WAR',
    size: 1.5 * 1024 * 1024 * 1024,
    seeders: 500
  };
  const camResult = scorer.calculateScore(camRelease, movieIntent);
  assert.strictEqual(camResult.disqualified, true, 'CAMRip debe ser descalificado inmediatamente');
  assert.strictEqual(camResult.score, -100, 'Score de CAM debe ser -100');
  console.log('  ✅ OK: Descalificado CAMRip:', camResult.reasons[0]);

  // Test 2: Descalificación de archivos no de video (Artbook, Manga, OST)
  console.log('\nTest 2: Descarte inmediato de Artbook / Manga / OST');
  const artbookRelease = {
    title: '[Artbook] Shin Seiki Evangelion DIE STERNE',
    size: 110 * 1024 * 1024,
    seeders: 150
  };
  const evaIntent = {
    canonical_title: 'Neon Genesis Evangelion',
    original_title: 'Shin Seiki Evangelion',
    year: 1995,
    media_type: 'tv',
    season: null,
    episode: 1,
    search_keywords: ['Neon Genesis Evangelion', 'Shin Seiki Evangelion']
  };
  const artbookResult = scorer.calculateScore(artbookRelease, evaIntent);
  assert.strictEqual(artbookResult.disqualified, true, 'Artbook debe ser descalificado');
  console.log('  ✅ OK: Descalificado Artbook:', artbookResult.reasons[0]);

  // Test 3: Control de tamaño máximo (> 10GB en películas penalizado, > 25GB descartado)
  console.log('\nTest 3: Control estricto de tamaño en películas');
  const remuxRelease = {
    title: 'Joker.Folie.a.Deux.2024.UHD.Remux.2160p.TrueHD.Atmos-FraMeSToR',
    size: 55 * 1024 * 1024 * 1024, // 55 GB
    seeders: 45
  };
  const remuxResult = scorer.calculateScore(remuxRelease, movieIntent);
  assert.strictEqual(remuxResult.disqualified, true, 'Remux masivo de 55GB debe ser descalificado');
  console.log('  ✅ OK: Descalificado >25GB:', remuxResult.reasons[0]);

  const heavy1080p = {
    title: 'Joker.Folie.a.Deux.2024.1080p.BluRay.AVC.DTS-HD.MA.5.1',
    size: 14 * 1024 * 1024 * 1024, // 14 GB (>10 GB límite sugerido)
    seeders: 120
  };
  const heavyResult = scorer.calculateScore(heavy1080p, movieIntent);
  assert.ok(heavyResult.reasons.some(r => r.includes('excede límite de 10GB')), 'Debe penalizar por superar 10GB');
  console.log('  ✅ OK: Penalizado tamaño > 10GB (-30)');

  // Test 4: Selección óptima de release 1080p WebRip x265 con alta disponibilidad de semillas
  console.log('\nTest 4: Release óptimo 1080p WebRip x265 (Fuzzball matching)');
  const optimalRelease = {
    title: 'Joker Folie a Deux (2024) (1080p) [WEBRip] [x265] [10bit] [5 1] [YTS MX]',
    size: 2.3 * 1024 * 1024 * 1024, // 2.3 GB (ideal)
    seeders: 10459
  };
  const optimalResult = scorer.calculateScore(optimalRelease, movieIntent);
  assert.strictEqual(optimalResult.disqualified, false);
  assert.ok(optimalResult.score >= 85, `Score debe ser alto (obtenido: ${optimalResult.score})`);
  console.log('  ✅ OK: Score obtenido:', optimalResult.score, '| Razones:', optimalResult.reasons.join(', '));

  // Test 5: Episodio exacto vs Episodio discordante
  console.log('\nTest 5: Coincidencia de episodio exacto vs discordante');
  const epIntent = {
    canonical_title: 'Neon Genesis Evangelion',
    original_title: 'Shin Seiki Evangelion',
    year: 1995,
    media_type: 'tv',
    season: 1,
    episode: 1,
    search_keywords: ['Neon Genesis Evangelion E01']
  };

  const matchingEp = {
    title: '[SubsPlease] Neon Genesis Evangelion - 01 (1080p) [x264]',
    size: 450 * 1024 * 1024,
    seeders: 80
  };
  const mismatchingEp = {
    title: '[SubsPlease] Neon Genesis Evangelion - 08 (1080p) [x264]',
    size: 450 * 1024 * 1024,
    seeders: 80
  };

  const matchRes = scorer.calculateScore(matchingEp, epIntent);
  const mismatchRes = scorer.calculateScore(mismatchingEp, epIntent);

  assert.ok(matchRes.score > mismatchRes.score, 'Episodio 01 debe tener puntaje significativamente superior a Episodio 08');
  assert.ok(matchRes.reasons.some(r => r.includes('Episodio exacto')), 'Debe detectar episodio exacto');
  assert.ok(mismatchRes.reasons.some(r => r.includes('Episodio discordante')), 'Debe penalizar episodio discordante');
  console.log('  ✅ OK: Match E01 score:', matchRes.score, 'vs Mismatch E08 score:', mismatchRes.score);

  // Test 6: selectBestRelease sobre umbral de 75
  console.log('\nTest 6: selectBestRelease con umbral');
  const candidatePool = [camRelease, heavy1080p, optimalRelease];
  const best = scorer.selectBestRelease(candidatePool, movieIntent, 75);
  assert.ok(best, 'Debe retornar un release');
  assert.strictEqual(best.release.title, optimalRelease.title, 'Debe elegir el release óptimo de 1080p');
  console.log('  ✅ OK: Release seleccionado con éxito:', best.release.title);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL RELEASE SCORER PASARON EXITOSAMENTE!');
}

runTests();
