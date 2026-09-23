const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function getPlexToken() {
  if (process.env.PLEX_TOKEN) return process.env.PLEX_TOKEN.trim();
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const res = execSync('powershell -NoProfile -Command "(Get-ItemProperty -Path \'HKCU:\\Software\\Plex, Inc.\\Plex Media Server\' -Name \'PlexOnlineToken\' -ErrorAction SilentlyContinue).PlexOnlineToken"', { encoding: 'utf8', timeout: 3000 });
      if (res && res.trim()) return res.trim();
    } catch (_) {}
  }
  return '';
}

function getProwlarrApiKey() {
  if (process.env.PROWLARR_API_KEY) return process.env.PROWLARR_API_KEY.trim();
  try {
    const fs = require('fs');
    const pPath = 'C:\\ProgramData\\Prowlarr\\config.xml';
    if (fs.existsSync(pPath)) {
      const xml = fs.readFileSync(pPath, 'utf8');
      const m = xml.match(/<ApiKey>(.*?)<\/ApiKey>/i);
      if (m && m[1]) return m[1].trim();
    }
  } catch (_) {}
  return '';
}

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  language: (process.env.BOT_LANGUAGE || 'en').toLowerCase(),
  moviesPath: process.env.MOVIES_PATH || 'G:\\Media\\Peliculas',
  seriesPath: process.env.SERIES_PATH || 'G:\\Media\\Series',
  
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY || '').trim(),
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest'
  },
  
  prowlarr: {
    url: (process.env.PROWLARR_URL || 'http://localhost:9696').replace(/\/$/, ''),
    apiKey: getProwlarrApiKey()
  },
  
  radarr: {
    url: (process.env.RADARR_URL || 'http://localhost:7878').replace(/\/$/, ''),
    apiKey: process.env.RADARR_API_KEY || ''
  },
  
  sonarr: {
    url: (process.env.SONARR_URL || 'http://localhost:8989').replace(/\/$/, ''),
    apiKey: process.env.SONARR_API_KEY || ''
  },
  
  tmdb: {
    apiKey: process.env.TMDB_API_KEY || ''
  },
  
  plex: {
    url: (process.env.PLEX_URL || 'http://localhost:32400').replace(/\/$/, ''),
    token: getPlexToken()
  },
  
  qbittorrent: {
    url: (process.env.QBITTORRENT_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
  },
  
  triggerKeywords: (process.env.TRIGGER_KEYWORDS || 'quiero ver,!pedir,!ver,descargar,búscame,buscame')
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean),
    
  // Whitelist de números de teléfono autorizados (separados por coma)
  // Si está vacío, permite interacción abierta. Si contiene números, restringe exclusivamente a ellos.
  allowedNumbers: (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map(n => n.replace(/\D/g, ''))
    .filter(Boolean),
    
  paths: {
    dataDir: path.join(__dirname, '..', 'data'),
    authDir: path.join(__dirname, '..', 'data', 'auth_info_baileys'),
    requestsDb: path.join(__dirname, '..', 'data', 'requests.json'),
    sessionsDb: path.join(__dirname, '..', 'data', 'user_sessions.json'),
    whitelistDb: path.join(__dirname, '..', 'data', 'whitelist.json')
  }
};
