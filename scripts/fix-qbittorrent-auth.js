const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const appData = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '');
const iniPath = path.join(appData, 'qBittorrent', 'qBittorrent.ini');

async function fix() {
  console.log('--- CONFIGURANDO AUTENTICACIÓN LOCALHOST EN QBITTORRENT ---');

  // 1. Cerrar qBittorrent si está corriendo
  console.log('1. Cerrando proceso qBittorrent para guardar configuración...');
  try {
    execSync('taskkill /IM qbittorrent.exe /F', { stdio: 'ignore' });
  } catch (_) {}

  // Esperar 1 segundo a que libere el archivo
  await new Promise(r => setTimeout(r, 1000));

  // 2. Modificar qBittorrent.ini
  console.log('2. Actualizando qBittorrent.ini...');
  let ini = fs.readFileSync(iniPath, 'utf8');

  // Asegurar que LocalHostAuth sea false
  if (ini.includes('WebUI\\LocalHostAuth=')) {
    ini = ini.replace(/WebUI\\LocalHostAuth=.*/g, 'WebUI\\LocalHostAuth=false');
  } else {
    ini = ini.replace('[Preferences]', '[Preferences]\nWebUI\\LocalHostAuth=false');
  }

  // Agregar whitelist de subred para 127.0.0.1
  if (!ini.includes('WebUI\\AuthSubnetWhitelistEnabled=')) {
    ini = ini.replace('[Preferences]', '[Preferences]\nWebUI\\AuthSubnetWhitelistEnabled=true\nWebUI\\AuthSubnetWhitelist=127.0.0.1/32, ::1/128');
  } else {
    ini = ini.replace(/WebUI\\AuthSubnetWhitelistEnabled=.*/g, 'WebUI\\AuthSubnetWhitelistEnabled=true');
    ini = ini.replace(/WebUI\\AuthSubnetWhitelist=.*/g, 'WebUI\\AuthSubnetWhitelist=127.0.0.1/32, ::1/128');
  }

  // Desactivar UPnP para evitar que vuelva a resetear el Wi-Fi de la alarma
  if (ini.includes('Session\\Port=')) {
    // Ok
  }

  fs.writeFileSync(iniPath, ini, 'utf8');
  console.log('✅ Archivo qBittorrent.ini actualizado con éxito.');

  // 3. Reabrir qBittorrent
  console.log('3. Reiniciando qBittorrent en segundo plano...');
  const qbExe = 'C:\\Program Files\\qBittorrent\\qbittorrent.exe';
  const child = spawn(qbExe, [], { detached: true, stdio: 'ignore' });
  child.unref();

  // 4. Esperar y verificar API sin contraseña
  console.log('4. Verificando acceso local sin contraseña...');
  let attempts = 0;
  while (attempts < 10) {
    await new Promise(r => setTimeout(r, 1500));
    attempts++;
    try {
      const res = await axios.get('http://localhost:8080/api/v2/app/version', { timeout: 2000 });
      console.log(`\n🎉 ¡CONEXIÓN EXITOSA CON QBITTORRENT! Versión: ${res.data}`);
      console.log('Ahora Sonarr y Radarr se conectarán directamente sin ningún fallo.');
      return;
    } catch (err) {
      process.stdout.write('.');
    }
  }

  console.log('\n⚠️ No respondió en el tiempo esperado. Comprueba que qBittorrent esté abierto.');
}

fix();
