const fs = require('fs');
const path = require('path');
const config = require('./config');

// Asegurar que el directorio de datos existe
if (!fs.existsSync(config.paths.dataDir)) {
  fs.mkdirSync(config.paths.dataDir, { recursive: true });
}

class Storage {
  constructor() {
    this.requestsFile = config.paths.requestsDb;
    this.sessionsFile = config.paths.sessionsDb;
    this.whitelistFile = config.paths.whitelistDb;
    
    this.requests = this._load(this.requestsFile, []);
    this.sessions = this._load(this.sessionsFile, {});
    this.whitelist = this._load(this.whitelistFile, null);

    if (!this.whitelist) {
      this.whitelist = {
        enabled: true,
        numbers: (config.allowedNumbers || []).map((n, idx) => ({
          number: n,
          label: idx === 0 ? 'Tú (Dueño)' : 'Usuario Autorizado',
          addedAt: new Date().toISOString()
        }))
      };
      this._save(this.whitelistFile, this.whitelist);
    }
    this._syncConfig();
  }

  _syncConfig() {
    if (this.whitelist && this.whitelist.enabled) {
      config.allowedNumbers = this.whitelist.numbers.map(item => item.number);
    } else if (this.whitelist && !this.whitelist.enabled) {
      config.allowedNumbers = []; // Si está deshabilitada, opera en modo abierto
    }
  }

  getWhitelist() {
    return this.whitelist;
  }

  addWhitelistNumber(numberStr, label = '') {
    const clean = (numberStr || '').replace(/\D/g, '');
    if (!clean || clean.length < 8) {
      throw new Error('El número debe tener al menos 8 dígitos numéricos (incluyendo código de país)');
    }
    const existing = this.whitelist.numbers.find(n => n.number === clean);
    if (existing) {
      if (label) existing.label = label.trim();
    } else {
      this.whitelist.numbers.push({
        number: clean,
        label: label.trim() || 'Familiar / Amigo',
        addedAt: new Date().toISOString()
      });
    }
    this._save(this.whitelistFile, this.whitelist);
    this._syncConfig();
    return this.whitelist;
  }

  removeWhitelistNumber(numberStr) {
    const clean = (numberStr || '').replace(/\D/g, '');
    this.whitelist.numbers = this.whitelist.numbers.filter(n => n.number !== clean);
    this._save(this.whitelistFile, this.whitelist);
    this._syncConfig();
    return this.whitelist;
  }

  toggleWhitelist(enabled) {
    this.whitelist.enabled = Boolean(enabled);
    this._save(this.whitelistFile, this.whitelist);
    this._syncConfig();
    return this.whitelist;
  }

  _load(filePath, defaultValue) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error(`[DB] Error leyendo ${filePath}:`, err.message);
    }
    return defaultValue;
  }

  _save(filePath, data) {
    try {
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.error(`[DB] Error guardando ${filePath}:`, err.message);
    }
  }

  // --- Manejo de sesiones activas (estado conversacional) ---
  getSession(userJid) {
    const session = this.sessions[userJid];
    // Expirar sesiones de más de 30 minutos
    if (session && Date.now() - session.timestamp > 30 * 60 * 1000) {
      this.clearSession(userJid);
      return null;
    }
    return session || null;
  }

  setSession(userJid, data) {
    this.sessions[userJid] = {
      ...data,
      timestamp: Date.now()
    };
    this._save(this.sessionsFile, this.sessions);
  }

  clearSession(userJid) {
    if (this.sessions[userJid]) {
      delete this.sessions[userJid];
      this._save(this.sessionsFile, this.sessions);
    }
  }

  // --- Manejo de solicitudes de descarga ---
  addRequest({ mediaType, title, year, tmdbId, radarrId, sonarrId, season, userJid, chatJid, language, posterUrl }) {
    const request = {
      id: `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      mediaType, // 'movie' | 'tv' | 'series'
      title,
      year: parseInt(year, 10) || null,
      season: season || null,
      tmdbId: tmdbId ? parseInt(tmdbId, 10) : null,
      radarrId: radarrId ? parseInt(radarrId, 10) : null,
      sonarrId: sonarrId ? parseInt(sonarrId, 10) : null,
      userJid,
      chatJid,
      language, // 'latino' | 'castellano' | 'subtitulado'
      posterUrl: posterUrl || null,
      status: 'downloading',
      createdAt: new Date().toISOString(),
      completedAt: null
    };

    this.requests.push(request);
    this._save(this.requestsFile, this.requests);
    return request;
  }

  findPendingRequest({ tmdbId, title, radarrId, sonarrId, mediaType }) {
    return this.requests.find(r => {
      if (r.status !== 'downloading') return false;

      if (tmdbId && r.tmdbId && r.tmdbId === parseInt(tmdbId, 10)) return true;
      if (radarrId && r.radarrId && r.radarrId === parseInt(radarrId, 10)) return true;
      if (sonarrId && r.sonarrId && r.sonarrId === parseInt(sonarrId, 10)) return true;

      if (title && r.title) {
        const normReq = r.title.toLowerCase().trim();
        const normIncoming = title.toLowerCase().trim();
        if (normReq === normIncoming || normIncoming.includes(normReq) || normReq.includes(normIncoming)) {
          return true;
        }
      }

      return false;
    });
  }

  updateRequest(requestId, updates = {}) {
    const req = this.requests.find(r => r.id === requestId);
    if (req) {
      Object.assign(req, updates);
      this._save(this.requestsFile, this.requests);
      return req;
    }
    return null;
  }

  markCompleted(requestId) {
    const req = this.requests.find(r => r.id === requestId);
    if (req) {
      req.status = 'completed';
      req.completedAt = new Date().toISOString();
      this._save(this.requestsFile, this.requests);
      return req;
    }
    return null;
  }

  markCancelled(requestId) {
    const req = this.requests.find(r => r.id === requestId);
    if (req) {
      req.status = 'cancelled';
      req.cancelledAt = new Date().toISOString();
      this._save(this.requestsFile, this.requests);
      return req;
    }
    return null;
  }

  getRequestById(requestId) {
    return this.requests.find(r => r.id === requestId) || null;
  }

  listRequests(limit = 20) {
    return this.requests.slice(-limit);
  }
}

module.exports = new Storage();
