const assert = require('assert');
const arrService = require('../src/arr-service');
const llmNormalizer = require('../src/llm-normalizer');

async function runTests() {
  console.log('🧪 Iniciando pruebas de Soporte de Rangos de Temporadas (ej: 2-5)...\n');

  // --- Test 1: arrService.parseSeasonSelection ---
  console.log('--- Test 1: arrService.parseSeasonSelection ---');
  const parseCases = [
    { input: '2-5', expected: [2, 3, 4, 5] },
    { input: '2 - 5', expected: [2, 3, 4, 5] },
    { input: '2 a 5', expected: [2, 3, 4, 5] },
    { input: '2 al 5', expected: [2, 3, 4, 5] },
    { input: '2..5', expected: [2, 3, 4, 5] },
    { input: '2 to 4', expected: [2, 3, 4] },
    { input: '1, 3, 5', expected: [1, 3, 5] },
    { input: '1, 3-5', expected: [1, 3, 4, 5] },
    { input: '3', expected: [3] },
    { input: 4, expected: [4] },
    { input: [2, 3], expected: [2, 3] },
    { input: 'all', expected: null },
    { input: 'todas', expected: null },
    { input: 'completa', expected: null },
    { input: null, expected: null }
  ];

  for (const tc of parseCases) {
    const result = arrService.parseSeasonSelection(tc.input);
    assert.deepStrictEqual(result, tc.expected, `Fallo en parseSeasonSelection para "${tc.input}"`);
    console.log(`  ✅ "${tc.input}" => ${JSON.stringify(result)}`);
  }

  // --- Test 2: arrService.formatSeasonLabel ---
  console.log('\n--- Test 2: arrService.formatSeasonLabel ---');
  const labelCases = [
    { input: [2, 3, 4, 5], expected: 'Temporadas 2 a 5' },
    { input: '2-5', expected: 'Temporadas 2 a 5' },
    { input: '2 a 5', expected: 'Temporadas 2 a 5' },
    { input: [2], expected: 'Temporada 2' },
    { input: '2', expected: 'Temporada 2' },
    { input: [1, 3, 5], expected: 'Temporadas 1, 3, 5' },
    { input: 'all', expected: 'Todas las temporadas' },
    { input: null, expected: 'Todas las temporadas' }
  ];

  for (const tc of labelCases) {
    const result = arrService.formatSeasonLabel(tc.input);
    assert.strictEqual(result, tc.expected, `Fallo en formatSeasonLabel para "${tc.input}"`);
    console.log(`  ✅ ${JSON.stringify(tc.input)} => "${result}"`);
  }

  // --- Test 3: LLM Normalizer Schema Validation con Rangos ---
  console.log('\n--- Test 3: llmNormalizer._validateAndNormalizeSchema con Rangos ---');
  const schemaCases = [
    {
      raw: { canonical_title: 'Loki', media_type: 'tv', season: '2-5' },
      expectedSeason: '2-5'
    },
    {
      raw: { canonical_title: 'Loki', media_type: 'tv', season: 3 },
      expectedSeason: 3
    },
    {
      raw: { canonical_title: 'Loki', media_type: 'tv', season: 'all' },
      expectedSeason: 'all'
    },
    {
      raw: { canonical_title: 'Inception', media_type: 'movie', season: 2 },
      expectedSeason: null
    }
  ];

  for (const tc of schemaCases) {
    const validated = llmNormalizer._validateAndNormalizeSchema(tc.raw, 'test raw');
    assert.strictEqual(validated.season, tc.expectedSeason, `Fallo en season para ${JSON.stringify(tc.raw)}`);
    console.log(`  ✅ Input season ${tc.raw.season} => Validated season: ${validated.season}`);
  }

  // --- Test 4: LLM Normalizer Fallback Regex con Rangos ---
  console.log('\n--- Test 4: llmNormalizer._fallbackParse con Rangos ---');
  const fallbackCases = [
    { text: 'descargar loki temporadas 1 a 2', expectedSeason: '1-2' },
    { text: 'stranger things temp 2-4', expectedSeason: '2-4' },
    { text: 'breaking bad season 3 al 5', expectedSeason: '3-5' },
    { text: 'the boys s1..3', expectedSeason: '1-3' }
  ];

  for (const tc of fallbackCases) {
    const result = llmNormalizer._fallbackParse(tc.text);
    assert.strictEqual(result.season, tc.expectedSeason, `Fallo en _fallbackParse para "${tc.text}"`);
    console.log(`  ✅ "${tc.text}" => Extracted season: ${result.season}`);
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE RANGO DE TEMPORADAS PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
