const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const sonarrExe = 'C:\\ProgramData\\Sonarr\\bin\\Sonarr.exe';
const configFile = 'C:\\ProgramData\\Sonarr\\config.xml';

async function main() {
  console.log('=== DIAGNÓSTICO E INICIO DE SONARR ===');

  if (!fs.existsSync(sonarrExe)) {
    console.error(`❌ No se encontró Sonarr en ${sonarrExe}`);
    return;
  }

  // 1. Comprobar si ya está escuchando
  try {
    const res = await axios.get('http://localhost:8989', { timeout: 2000 });
    console.log('✅ Sonarr ya está respondiendo en http://localhost:8989 (Status:', res.status, ')');
    printApiKey();
    return;
  } catch (_) {
    console.log('ℹ️ Sonarr no está respondiendo en el puerto 8989. Procediendo a iniciarlo...');
  }

  // 2. Iniciar Sonarr en segundo plano
  console.log(`▶ Iniciando proceso: ${sonarrExe}...`);
  const child = spawn(sonarrExe, ['/nobrowser'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  console.log('⏳ Esperando a que Sonarr inicialice la base de datos y levante el servidor web en el puerto 8989...');

  // 3. Polling hasta que responda
  let attempts = 0;
  const maxAttempts = 30; // 30 x 2s = 60s
  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    try {
      const res = await axios.get('http://localhost:8989', { timeout: 2000 });
      console.log(`\n🎉 ¡SONARR ESTÁ VIVO Y CORRIENDO EN http://localhost:8989! (HTTP ${res.status})`);
      printApiKey();
      return;
    } catch (err) {
      process.stdout.write(`.`);
    }
  }

  console.log('\n⚠️ Tardó más de 60s en responder. Revisando log...');
  const logFile = 'C:\\ProgramData\\Sonarr\\logs\\sonarr.txt';
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(-15);
    console.log('Últimas líneas del log:\n', lines.join('\n'));
  }
}

function printApiKey() {
  try {
    if (fs.existsSync(configFile)) {
      const xml = fs.readFileSync(configFile, 'utf8');
      const match = xml.match(/<ApiKey>(.*?)<\/ApiKey>/);
      if (match && match[1]) {
        console.log(`🔑 Tu Sonarr API Key es: ${match[1]}`);
      }
    }
  } catch (_) {}
}

main();
