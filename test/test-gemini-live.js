const axios = require('axios');
const config = require('../src/config');
const normalizer = require('../src/llm-normalizer');

async function main() {
  console.log('Gemini API Key:', config.gemini.apiKey ? config.gemini.apiKey.slice(0, 8) + '...' : 'none');
  console.log('Gemini Model:', config.gemini.model);

  const testQueries = [
    'oye pon la del joker 2',
    'bajate shingeki no kyojin',
    'evangelion cap 1',
    'hola como estas'
  ];

  for (const q of testQueries) {
    console.log('\n--- Input:', q);
    const result = await normalizer.normalize(q);
    console.log('Result (source: ' + result.source + '):', JSON.stringify(result, null, 2));
  }
}

main().catch(err => console.error(err));
