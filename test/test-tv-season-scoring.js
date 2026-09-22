const assert = require('assert');
const releaseScorer = require('../src/release-scorer');
const arrService = require('../src/arr-service');

async function runTests() {
  console.log('🧪 Iniciando pruebas de Scoring y Selección de Temporadas para Series TV...\n');

  // --- Test 1: Descarte inmediato de temporada discordante ---
  console.log('--- Test 1: Descarte de temporada discordante (S29 vs Season 3) ---');
  const intentSeason3 = {
    canonical_title: 'Top Gear',
    original_title: 'Top Gear BBC',
    year: 2002,
    media_type: 'tv',
    season: 3,
    episode: null,
    search_keywords: ['Top Gear', 'Top Gear Season 3', 'Top Gear S03']
  };

  const releaseS29E04 = {
    title: 'Top Gear S29E04 1080p iP WEB DL AAC2 0 H 264 NTb',
    size: 1.5 * 1024 * 1024 * 1024,
    seeders: 150
  };

  const scoreS29 = releaseScorer.calculateScore(releaseS29E04, intentSeason3);
  assert.strictEqual(scoreS29.disqualified, true, 'S29E04 debe ser descalificado para Temporada 3');
  assert.strictEqual(scoreS29.score, -100, 'Score de temporada discordante debe ser -100');
  console.log('  ✅ OK: S29E04 descalificado con éxito (-100):', scoreS29.reasons[0]);

  // --- Test 2: Pack completo de temporada coincidente recibe puntaje alto ---
  console.log('\n--- Test 2: Pack completo de Temporada 3 recibe puntaje alto ---');
  const releaseS03Pack = {
    title: 'Top Gear UK Series 3 S03 (2003) WEB-DL 576p.x264.aac.engsub.djd',
    size: 8 * 1024 * 1024 * 1024,
    seeders: 60
  };

  const scoreS03 = releaseScorer.calculateScore(releaseS03Pack, intentSeason3);
  assert.strictEqual(scoreS03.disqualified, false, 'Pack S03 no debe ser descalificado');
  assert.ok(scoreS03.score >= 90, `Score esperado >= 90, obtenido: ${scoreS03.score}`);
  console.log(`  ✅ OK: Pack S03 calificado con score ${scoreS03.score}/100`);

  // --- Test 3: Episodio suelto no debe calificar para temporada completa ---
  console.log('\n--- Test 3: Episodio suelto topeado a <= 45 si se pide temporada completa ---');
  const releaseS03E04 = {
    title: 'Top Gear S03E04 1080p Web-DL AAC2.0',
    size: 1.5 * 1024 * 1024 * 1024,
    seeders: 50
  };

  const scoreS03E04 = releaseScorer.calculateScore(releaseS03E04, intentSeason3);
  assert.ok(scoreS03E04.score <= 45, `Score esperado <= 45, obtenido: ${scoreS03E04.score}`);
  console.log(`  ✅ OK: Episodio suelto topeado a score ${scoreS03E04.score}/100 (umbral de aceptación es 70)`);

  // --- Test 4: Parse Release Season and Episode helper ---
  console.log('\n--- Test 4: releaseScorer.parseReleaseSeasonAndEpisode helper ---');
  const cases = [
    { title: 'Top Gear S29E04 1080p', expectedSeason: 29, expectedEp: 4, isSingle: true },
    { title: 'Top Gear S03 Complete 1080p', expectedSeason: 3, expectedEp: null, isSingle: false },
    { title: 'Top Gear Season 3 720p', expectedSeason: 3, expectedEp: null, isSingle: false },
    { title: 'Top Gear S01-S05 Complete', expectedSeason: 1, isRange: true, isSingle: false },
    { title: 'Stranger Things Complete Series', isComplete: true, isSingle: false }
  ];

  for (const c of cases) {
    const info = releaseScorer.parseReleaseSeasonAndEpisode(c.title);
    if (c.expectedSeason !== undefined) assert.strictEqual(info.season, c.expectedSeason);
    if (c.expectedEp !== undefined) assert.strictEqual(info.episode, c.expectedEp);
    if (c.isSingle !== undefined) assert.strictEqual(info.isSingleEpisode, c.isSingle);
    if (c.isRange !== undefined) assert.strictEqual(info.isSeasonRange, c.isRange);
    if (c.isComplete !== undefined) assert.strictEqual(info.isCompleteSeries, c.isComplete);
    console.log(`  ✅ "${c.title}" => season: ${info.season}, ep: ${info.episode}, isSingle: ${info.isSingleEpisode}`);
  }

  // --- Test 5: Selección de número de temporada '3' no debe dar 'all' ---
  console.log('\n--- Test 5: arrService.parseSeasonSelection("3") debe ser [3] ---');
  const parsed3 = arrService.parseSeasonSelection('3');
  assert.deepStrictEqual(parsed3, [3], 'parseSeasonSelection("3") debe retornar [3]');
  const label3 = arrService.formatSeasonLabel(parsed3);
  assert.strictEqual(label3, 'Temporada 3', 'Label debe ser "Temporada 3"');
  console.log(`  ✅ "3" => ${JSON.stringify(parsed3)} ("${label3}")`);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE SELECCIÓN Y SCORING DE SERIES PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
