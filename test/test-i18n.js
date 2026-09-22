const assert = require('assert');
const i18n = require('../src/i18n');

console.log('🧪 Running i18n Localization Tests...\n');

// 1. Language switching
i18n.setLanguage('es');
assert.strictEqual(i18n.getLanguage(), 'es', 'Language should be es');
let msgES = i18n.t('no_results', { query: 'Matrix' });
assert(msgES.includes('No encontré resultados para "*Matrix*"'), 'Spanish no_results failed: ' + msgES);
console.log('  ✅ Spanish translation: ' + msgES);

i18n.setLanguage('en');
assert.strictEqual(i18n.getLanguage(), 'en', 'Language should be en');
let msgEN = i18n.t('no_results', { query: 'Matrix' });
assert(msgEN.includes('No results found for "*Matrix*"'), 'English no_results failed: ' + msgEN);
console.log('  ✅ English translation: ' + msgEN);

// 2. Download completed interpolation
const completedEN = i18n.t('download_completed', {
  title: 'Gladiator II',
  year: '2024',
  extraInfo: '\n(Season 1)\n'
}, 'en');
assert(completedEN.includes('*Gladiator II* (2024)'), 'Title & year interpolation failed: ' + completedEN);
assert(completedEN.includes('Enjoy watching!'), 'English closing failed');
console.log('  ✅ English download_completed template verified');

const completedES = i18n.t('download_completed', {
  title: 'Gladiator II',
  year: '2024',
  extraInfo: '\n(Temporada 1)\n'
}, 'es');
assert(completedES.includes('¡A disfrutar!'), 'Spanish closing failed');
console.log('  ✅ Spanish download_completed template verified');

// 3. Supported languages
const supported = i18n.getSupportedLanguages();
assert(supported.some(l => l.code === 'en'), 'English should be supported');
assert(supported.some(l => l.code === 'es'), 'Spanish should be supported');
console.log('  ✅ Supported languages:', JSON.stringify(supported));

// 4. Fallback on invalid language
const invalid = i18n.setLanguage('de');
assert.strictEqual(invalid, false, 'Invalid language code should return false');
assert.strictEqual(i18n.getLanguage(), 'en', 'Language should remain unchanged');
console.log('  ✅ Fallback on invalid language code verified');

console.log('\n🎉 ALL i18n TESTS PASSED SUCCESSFULLY!');
