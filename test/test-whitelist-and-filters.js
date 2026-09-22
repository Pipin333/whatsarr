const config = require('../src/config');
const whatsappBot = require('../src/whatsapp');
const arrService = require('../src/arr-service');
const db = require('../src/db');

async function runTests() {
  console.log('==================================================');
  console.log('🧪 TEST SUITE: WHITELIST WEB, FILTROS Y TEMPORADAS');
  console.log('==================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
    }
  }

  // --- 1. Test de Whitelist & Persistencia en DB ---
  console.log('--- 1. Pruebas de Autorización y Whitelist en DB ---');
  const initialWl = db.getWhitelist();
  assert(initialWl && initialWl.enabled === true, 'Whitelist inicializada correctamente en db.js');

  // Agregar número de prueba
  db.addWhitelistNumber('56911223344', 'Número de Prueba');
  assert(
    whatsappBot._isSenderAllowed('56911223344@s.whatsapp.net', false),
    'Número añadido dinámicamente a la whitelist (56911223344) es autorizado de inmediato'
  );

  const ownerNum = (config.allowedNumbers && config.allowedNumbers[0]) || '56911223344';
  assert(
    whatsappBot._isSenderAllowed(`${ownerNum}@s.whatsapp.net`, false),
    `Número configurado/autorizado (${ownerNum}) es verificado con éxito`
  );

  assert(
    whatsappBot._isSenderAllowed('cualquier_cosa@s.whatsapp.net', true),
    'Mensaje propio del bot (fromMe: true) siempre es autorizado'
  );

  assert(
    !whatsappBot._isSenderAllowed('5491199999999@s.whatsapp.net', false),
    'Número no autorizado (5491199999999) es rechazado en silencio'
  );

  // Eliminar número de prueba
  db.removeWhitelistNumber('56911223344');
  assert(
    !whatsappBot._isSenderAllowed('56911223344@s.whatsapp.net', false),
    'Número eliminado de la whitelist (56911223344) es revocado inmediatamente'
  );

  // Probar toggle de whitelist
  db.toggleWhitelist(false);
  assert(
    whatsappBot._isSenderAllowed('5491199999999@s.whatsapp.net', false),
    'Cuando la whitelist está deshabilitada (modo abierto), cualquier número es autorizado'
  );
  db.toggleWhitelist(true);
  assert(
    !whatsappBot._isSenderAllowed('5491199999999@s.whatsapp.net', false),
    'Al reactivar la whitelist, los números no autorizados vuelven a ser bloqueados'
  );

  // --- 2. Test de Filtro Conversacional y Lenguaje Natural ---
  console.log('\n--- 2. Pruebas de Lenguaje Natural vs Conversación Casual ---');

  const testCases = [
    // Lenguaje natural que SÍ debe pasar
    { text: 'quiero ver Gladiator 2', expectedQuery: 'Gladiator 2', expectedSeason: null, desc: 'Frase directa "quiero ver Gladiator 2"' },
    { text: 'quiero ver: Incredibles 2', expectedQuery: 'Incredibles 2', expectedSeason: null, desc: 'Frase con dos puntos "quiero ver: Incredibles 2"' },
    { text: 'descárgame Inception', expectedQuery: 'Inception', expectedSeason: null, desc: 'Comando natural "descárgame Inception"' },
    { text: 'puedes descargar The Batman', expectedQuery: 'The Batman', expectedSeason: null, desc: 'Pregunta natural "puedes descargar The Batman"' },
    { text: 'búscame Stranger Things', expectedQuery: 'Stranger Things', expectedSeason: null, desc: 'Petición natural "búscame Stranger Things"' },
    { text: 'tienes la película Oppenheimer?', expectedQuery: 'Oppenheimer', expectedSeason: null, desc: 'Consulta natural "tienes la película Oppenheimer"' },
    { text: '!pedir Dune 2', expectedQuery: 'Dune 2', expectedSeason: null, desc: 'Comando tradicional "!pedir Dune 2"' },

    // Detección automática de temporada
    { text: 'quiero ver Stranger Things temporada 4', expectedQuery: 'Stranger Things', expectedSeason: 4, desc: 'Detección temporada: "Stranger Things temporada 4"' },
    { text: 'descárgame Breaking Bad temp 2', expectedQuery: 'Breaking Bad', expectedSeason: 2, desc: 'Detección temporada: "Breaking Bad temp 2"' },
    { text: 'puedes bajar The Boys s3', expectedQuery: 'The Boys', expectedSeason: 3, desc: 'Detección temporada: "The Boys s3"' },

    // Charlas cotidianas que DEBEN SER IGNORADAS (retornar null)
    { text: 'quiero ver si nos vemos mañana en la tarde', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver si nos vemos mañana"' },
    { text: 'quiero ver si vamos al cine el viernes', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver si vamos al cine"' },
    { text: 'quiero ver que onda hoy', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver que onda hoy"' },
    { text: 'quiero ver qué hacemos al rato', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver qué hacemos al rato"' },
    { text: 'quiero ver como estás amigo', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver como estás"' },
    { text: 'quiero ver cuándo sale el nuevo capítulo', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver cuándo sale"' },
    { text: 'quiero ver dónde dejamos las llaves', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver dónde dejamos"' },
    { text: 'quiero ver una peli en el cine hoy', expectedQuery: null, expectedSeason: null, desc: 'Casual: "quiero ver una peli en el cine"' },
    { text: '¿tienes tiempo para hablar?', expectedQuery: null, expectedSeason: null, desc: 'Casual: "¿tienes tiempo para hablar?"' }
  ];

  for (const tc of testCases) {
    const extracted = whatsappBot._extractQuery(tc.text, false, '12345@s.whatsapp.net');
    const query = extracted ? extracted.query : null;
    const season = extracted ? extracted.targetSeason : null;

    const queryMatches = query === tc.expectedQuery;
    const seasonMatches = season === tc.expectedSeason;

    assert(
      queryMatches && seasonMatches,
      `${tc.desc} -> ${query === null ? 'IGNORADO' : `QUERY: "${query}" (Temp: ${season})`}`
    );
  }

  // --- 3. Test de Chequeo de Películas y Temporadas de Series en Radarr/Sonarr ---
  console.log('\n--- 3. Pruebas de Radarr y Temporadas en Sonarr ---');
  try {
    const statusDownloaded = await arrService.checkMovieStatus({
      title: 'Incredibles 2',
      tmdbId: 260513
    });
    assert(
      statusDownloaded.exists === true && statusDownloaded.hasFile === true,
      'Incredibles 2 detectada como ya existente y con archivo descargado en Radarr'
    );

    const seasons = await arrService.getSeriesSeasons({ title: 'Stranger Things' });
    console.log(`Temporadas detectadas para Stranger Things: ${seasons.length} temporadas`);
    assert(
      Array.isArray(seasons) && seasons.length > 0,
      'Obtención de temporadas de serie en Sonarr funcionando (detectó temporadas)'
    );
  } catch (err) {
    console.error('Error probando Radarr/Sonarr:', err.message);
  }

  console.log(`\n==================================================`);
  console.log(`📊 RESULTADOS: ${passed} / ${total} pruebas exitosas`);
  console.log(`==================================================`);
}

runTests().catch(console.error);
