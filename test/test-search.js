const tmdb = require('../src/tmdb');

async function run() {
  console.log('--- TEST: Búsqueda de contenido (TMDB / Arr Lookup) ---');
  
  const testQueries = ['Gladiator 2', 'Breaking Bad', 'Inception'];

  for (const q of testQueries) {
    console.log(`\n🔍 Buscando: "${q}"...`);
    const results = await tmdb.search(q);
    if (results.length === 0) {
      console.log('❌ Sin resultados.');
    } else {
      const top = results[0];
      console.log(`✅ Encontrado: [${top.type.toUpperCase()}] "${top.title}" (${top.year})`);
      console.log(`⭐ Calificación: ${top.voteAverage || 'N/A'}`);
      console.log(`🖼️ Póster: ${top.posterUrl || 'Sin póster'}`);
      console.log(`📖 Sinopsis: ${top.overview ? top.overview.slice(0, 100) + '...' : 'N/A'}`);
    }
  }
}

run();
