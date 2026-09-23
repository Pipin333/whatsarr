/**
 * Reset WhatsApp Session & Display Fresh QR Code
 * Cleans corrupted session ratchets (Bad MAC) and generates a fresh pairing QR.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const authDir = path.join(__dirname, '..', 'data', 'auth_info_baileys');

console.log('======================================================');
console.log('🔄 REINICIALIZANDO SESIÓN DE WHATSAPP');
console.log('======================================================');

// 1. Detener procesos previos
console.log('1. Deteniendo instancias previas del bot...');
try {
  const serviceManager = require('./service-manager');
  execSync('node scripts/service-manager.js stop', { stdio: 'inherit' });
} catch (_) {}

// 2. Limpiar directorio de autenticación
console.log('\n2. Limpiando llaves de sesión desincronizadas...');
if (fs.existsSync(authDir)) {
  fs.rmSync(authDir, { recursive: true, force: true });
  console.log('✅ Directorio data/auth_info_baileys eliminado limpiamente.');
}

console.log('\n3. Iniciando bot para generar nuevo código QR...');
console.log('👉 Abre WhatsApp en tu celular:');
console.log('   Ajustes / Menú (tres puntos) -> Dispositivos vinculados -> Vincular un dispositivo');
console.log('   (Si ves una sesión previa llamada WhatsArr o Chrome, dale "Cerrar sesión" primero)\n');

// 3. Ejecutar node src/index.js con stdio inherit para ver el QR
const child = spawn('node', ['src/index.js'], {
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  console.log(`\nProceso finalizado con código ${code}`);
});
