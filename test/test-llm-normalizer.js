const assert = require('assert');
const normalizer = require('../src/llm-normalizer');

async function runTests() {
  console.log('🧪 Iniciando pruebas de Fase 1: LLM Normalizer...\n');

  // Test 1: Slang y modismos de películas
  console.log('Test 1: "oye pon la del joker 2"');
  const joker = await normalizer.normalize('oye pon la del joker 2');
  assert.strictEqual(joker.is_media_request, true, 'Debe ser reconocido como solicitud de media');
  assert.ok(joker.canonical_title.toLowerCase().includes('joker'), 'Título canonical debe contener Joker');
  assert.strictEqual(joker.media_type, 'movie', 'Debe ser clasificado como movie');
  assert.strictEqual(joker.year, 2024, 'Debe inferir año 2024');
  console.log('  ✅ OK: Canonical:', joker.canonical_title, '| Año:', joker.year, '| Fuente:', joker.source);

  // Test 2: Anime con título en japonés y modismo "bájate"
  console.log('\nTest 2: "bajate shingeki no kyojin"');
  const snk = await normalizer.normalize('bajate shingeki no kyojin');
  assert.strictEqual(snk.is_media_request, true, 'Debe ser solicitud de media');
  assert.ok(
    snk.canonical_title.toLowerCase().includes('attack on titan') || snk.canonical_title.toLowerCase().includes('shingeki'),
    'Debe traducir o asociar Attack on Titan / Shingeki'
  );
  assert.strictEqual(snk.media_type, 'tv', 'Anime debe ser tipo tv');
  console.log('  ✅ OK: Canonical:', snk.canonical_title, '| Original:', snk.original_title, '| Tipo:', snk.media_type);

  // Test 3: Anime con número de capítulo explícito ("cap 1")
  console.log('\nTest 3: "evangelion cap 1"');
  const eva = await normalizer.normalize('evangelion cap 1');
  assert.strictEqual(eva.is_media_request, true, 'Debe ser solicitud de media');
  assert.ok(eva.canonical_title.toLowerCase().includes('evangelion'), 'Título debe contener Evangelion');
  assert.strictEqual(eva.episode, 1, 'Debe extraer episodio 1');
  assert.strictEqual(eva.media_type, 'tv', 'Debe ser clasificado como tv');
  console.log('  ✅ OK: Canonical:', eva.canonical_title, '| Episodio:', eva.episode, '| Keywords:', eva.search_keywords);

  // Test 4: Conversación casual no debe generar descargas (Filtro anti-falsos positivos)
  console.log('\nTest 4: Conversación casual ("hola como estas")');
  const chat1 = await normalizer.normalize('hola como estas');
  assert.strictEqual(chat1.is_media_request, false, 'No debe ser considerado solicitud de media');
  console.log('  ✅ OK: is_media_request:', chat1.is_media_request);

  console.log('\nTest 5: Conversación sobre el cine ("vamos al cine a ver una peli")');
  const chat2 = await normalizer.normalize('vamos al cine a ver una peli');
  assert.strictEqual(chat2.is_media_request, false, 'No debe confundirse con una petición de descarga');
  console.log('  ✅ OK: is_media_request:', chat2.is_media_request);

  // Test 6: Sanitización de JSON resiliente (Markdown blocks, trailing commas)
  console.log('\nTest 6: Sanitización segura de JSON');
  const rawWithMarkdown = '```json\n{\n  "is_media_request": true,\n  "canonical_title": "Interstellar",\n  "original_title": "Interstellar",\n  "year": 2014,\n  "media_type": "movie",\n  "season": null,\n  "episode": null,\n  "search_keywords": ["Interstellar 2014", "Interstellar",],\n}\n```';
  const parsed = normalizer._safeParseJSON(rawWithMarkdown);
  assert.ok(parsed, 'Debe parsear JSON con comas sobrantes y bloques markdown');
  assert.strictEqual(parsed.canonical_title, 'Interstellar');
  assert.strictEqual(parsed.year, 2014);
  console.log('  ✅ OK: Markdown y trailing commas sanitizados exitosamente');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL LLM NORMALIZER PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
