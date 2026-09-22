const cp = require('child_process');

function audit() {
  const netstat = cp.execSync('netstat -ano -p tcp').toString();
  const lines = netstat.split('\n').filter(l => l.includes('LISTENING'));

  const results = [];
  const pids = new Set();

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      const localAddr = parts[1];
      const pid = parts[4];
      const port = parseInt(localAddr.split(':').pop(), 10);

      results.push({ port, localAddr, pid });
      pids.add(pid);
    }
  }

  // Obtener nombres de procesos para cada PID
  const taskMap = {};
  for (const pid of pids) {
    try {
      const taskOut = cp.execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).toString();
      const name = taskOut.trim().replace(/"/g, '').split(',')[0];
      taskMap[pid] = name || 'Desconocido';
    } catch (_) {
      taskMap[pid] = 'Desconocido';
    }
  }

  const table = results.map(r => ({
    Puerto: r.port,
    Direccion: r.localAddr,
    PID: r.pid,
    Proceso: taskMap[r.pid] || 'Desconocido'
  }));

  // Ordenar por puerto
  table.sort((a, b) => a.Puerto - b.Puerto);

  console.log('--- PUERTOS EN ESCUCHA ACTUALMENTE ---');
  console.table(table.filter(t => t.Puerto > 1000));
}

audit();
