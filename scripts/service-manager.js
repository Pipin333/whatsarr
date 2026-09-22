/**
 * Service Manager & Status Checker for WhatsArr
 * Reliable process control & health diagnostics without shell parsing errors.
 */

const http = require('http');
const cp = require('child_process');

const PORT = 3001;

function checkHealth(timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}/health`, { timeout: timeoutMs }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function getBotPids() {
  const pids = new Set();

  // 1. Query WMI via PowerShell without commandline escaping issues
  try {
    const psScript = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src/index.js*' } | Select-Object -ExpandProperty ProcessId`;
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      encoding: 'utf8',
      timeout: 4000
    });
    out.trim().split(/\r?\n/).forEach(line => {
      const pid = parseInt(line.trim(), 10);
      if (pid && !isNaN(pid)) pids.add(pid);
    });
  } catch (_) {}

  // 2. Query port 3001 from netstat as fallback
  try {
    const netstat = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 3000 });
    const lines = netstat.split('\n').filter(l => l.includes(`:${PORT}`) && l.includes('LISTENING'));
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid && !isNaN(pid) && pid !== 0) pids.add(pid);
    }
  } catch (_) {}

  return Array.from(pids);
}

async function main() {
  const cmd = (process.argv[2] || 'check').toLowerCase();

  if (cmd === 'is-running') {
    try {
      await checkHealth(1500);
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  }

  if (cmd === 'stop') {
    const pids = getBotPids();
    if (pids.length === 0) {
      console.log('No se encontraron instancias activas del bot.');
      process.exit(0);
    }
    for (const pid of pids) {
      try {
        cp.execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`\x1b[33mDetenido proceso PID: ${pid}\x1b[0m`);
      } catch (_) {}
    }
    process.exit(0);
  }

  if (cmd === 'check' || cmd === 'status') {
    let health = null;
    let attempts = 0;
    const maxAttempts = cmd === 'check' ? 5 : 1;

    while (attempts < maxAttempts) {
      try {
        health = await checkHealth(2000);
        if (health) break;
      } catch (_) {}
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (health) {
      console.log(`\x1b[32m [OK] Servidor Web: ONLINE (http://localhost:${PORT})\x1b[0m`);
      
      const waStatus = health.whatsapp?.connected ? 'CONECTADO' : 'Iniciando / Escanear QR';
      const waColor = health.whatsapp?.connected ? '\x1b[32m' : '\x1b[33m';
      console.log(`${waColor} [OK] WhatsApp:     ${waStatus}\x1b[0m`);

      const sonStatus = health.sonarr?.ok ? 'CONECTADO' : 'No disponible';
      const sonColor = health.sonarr?.ok ? '\x1b[32m' : '\x1b[33m';
      console.log(`${sonColor} [OK] Sonarr:       ${sonStatus}\x1b[0m`);

      const radStatus = health.radarr?.ok ? 'CONECTADO' : 'No disponible';
      const radColor = health.radarr?.ok ? '\x1b[32m' : '\x1b[33m';
      console.log(`${radColor} [OK] Radarr:       ${radStatus}\x1b[0m`);

      process.exit(0);
    } else {
      console.log('\x1b[33m [!] El bot esta arrancando... puedes verificar en unos segundos en http://localhost:' + PORT + '\x1b[0m');
      process.exit(1);
    }
  }

  console.log(`Comando desconocido: ${cmd}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Error en Service Manager:', err.message);
  process.exit(1);
});
