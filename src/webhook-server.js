const express = require('express');
const axios = require('axios');
const path = require('path');
const config = require('./config');
const db = require('./db');
const arrService = require('./arr-service');
const tmdb = require('./tmdb');
const i18n = require('./i18n');

// Buffer en memoria para los ultimos eventos de log
const recentLogs = [];
function addLog(level, message) {
  const item = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  recentLogs.push(item);
  if (recentLogs.length > 80) recentLogs.shift();
}

class WebhookServer {
  constructor() {
    this.app = express();
    this.app.use(express.json());
    // Servir la interfaz web estatica desde /public
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
    this.whatsappClient = null; // Inyectado al iniciar el bot
    this._setupRoutes();
  }

  setWhatsAppClient(client) {
    this.whatsappClient = client;
  }

  _setupRoutes() {
    // 1. Estado general del sistema (API para el Dashboard)
    this.app.get('/api/status', async (req, res) => {
      const radarrStatus = await arrService.testRadarr();
      const sonarrStatus = await arrService.testSonarr();
      const isWaConnected = this.whatsappClient ? this.whatsappClient.isConnected() : false;

      // Estado de qBittorrent
      let qbStatus = { ok: false, version: null, dlSpeed: 0, upSpeed: 0 };
      try {
        const [verRes, xferRes] = await Promise.all([
          axios.get(`${config.qbittorrent.url}/api/v2/app/webapiVersion`, { timeout: 2500 }),
          axios.get(`${config.qbittorrent.url}/api/v2/transfer/info`, { timeout: 2500 }).catch(() => null)
        ]);
        qbStatus.ok = true;
        qbStatus.version = verRes.data;
        if (xferRes && xferRes.data) {
          qbStatus.dlSpeed = xferRes.data.dl_info_speed || 0;
          qbStatus.upSpeed = xferRes.data.up_info_speed || 0;
        }
      } catch (_) {}

      // Estado de Plex
      let plexStatus = { ok: false };
      try {
        await axios.get(`${config.plex.url}/identity`, { timeout: 2500 });
        plexStatus.ok = true;
      } catch (_) {}

      res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          whatsapp: { connected: isWaConnected },
          radarr: radarrStatus,
          sonarr: sonarrStatus,
          qbittorrent: qbStatus,
          plex: plexStatus
        },
        paths: {
          movies: config.moviesPath,
          series: config.seriesPath
        },
        whitelist: {
          enabled: config.allowedNumbers && config.allowedNumbers.length > 0,
          count: config.allowedNumbers ? config.allowedNumbers.length : 0,
          numbers: (config.allowedNumbers || []).map(n => n.length > 4 ? `+${n.slice(0, 2)}***${n.slice(-4)}` : '***')
        },
        language: i18n.getLanguage(),
        supportedLanguages: i18n.getSupportedLanguages(),
        stats: {
          totalRequests: db.listRequests(1000).length,
          pendingRequests: db.listRequests(1000).filter(r => r.status === 'downloading').length
        }
      });
    });

    // 1.1 Configuración de Idioma (i18n)
    this.app.get('/api/config/language', (req, res) => {
      res.json({
        success: true,
        language: i18n.getLanguage(),
        supported: i18n.getSupportedLanguages()
      });
    });

    this.app.post('/api/config/language', (req, res) => {
      const { language } = req.body;
      const ok = i18n.setLanguage(language);
      if (ok) {
        addLog('info', `[Config] Idioma cambiado a: ${language}`);
        res.json({ success: true, language: i18n.getLanguage() });
      } else {
        res.status(400).json({ success: false, error: 'Código de idioma no soportado. Usa "en" o "es".' });
      }
    });

    // 2. Descargas activas en tiempo real desde qBittorrent
    this.app.get('/api/downloads', async (req, res) => {
      try {
        const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, {
          timeout: 4000
        });
        const torrents = (qbRes.data || []).map(t => {
          const isStalled = t.state === 'stalledDL' || t.state === 'metaDL' || (t.progress < 1 && t.dlspeed === 0 && (t.num_seeds === 0 || !t.num_seeds) && t.state !== 'pausedDL');
          const isError = t.state === 'error' || t.state === 'missingFiles';
          const isCompleted = (t.progress >= 1) || ['uploading', 'pausedUP', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP'].includes(t.state);
          return {
            hash: t.hash,
            name: t.name,
            progress: Math.round((t.progress || 0) * 1000) / 10, // 0.0 a 100.0%
            size: t.size,
            dlspeed: t.dlspeed,
            upspeed: t.upspeed,
            eta: t.eta,
            state: t.state,
            num_seeds: t.num_seeds || 0,
            num_leechs: t.num_leechs || 0,
            is_stalled: isStalled,
            is_error: isError,
            is_completed: isCompleted,
            category: t.category || '',
            added_on: t.added_on
          };
        });
        res.json({ success: true, torrents });
      } catch (err) {
        res.json({ success: false, error: err.message, torrents: [] });
      }
    });

    // 2.1 Cancelar y eliminar descarga de qBittorrent
    this.app.post('/api/downloads/cancel', async (req, res) => {
      const { hash, deleteFiles } = req.body;
      if (!hash) {
        return res.status(400).json({ success: false, error: 'Falta parámetro hash' });
      }

      try {
        const formData = `hashes=${encodeURIComponent(hash)}&deleteFiles=${deleteFiles !== false ? 'true' : 'false'}`;
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/delete`, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 6000
        });

        addLog('info', `Descarga eliminada desde Web UI (Hash: ${hash}, Borrar archivos: ${deleteFiles !== false})`);
        res.json({ success: true, message: deleteFiles !== false ? 'Descarga cancelada y eliminada de qBittorrent' : 'Descarga removida de la lista (archivos conservados en disco)' });
      } catch (err) {
        console.error('[qBittorrent] Error al cancelar descarga:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 2.1.1 Eliminar de la lista de qBittorrent todas las descargas completadas
    this.app.post('/api/downloads/clear-completed', async (req, res) => {
      try {
        const deleteFiles = req.body?.deleteFiles === true;
        const result = await arrService.clearCompletedDownloads(deleteFiles);
        addLog('info', `Limpieza de descargas completadas: ${result.message}`);
        res.json({ success: true, ...result });
      } catch (err) {
        console.error('[Downloads] Error al limpiar descargas completadas:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 2.2 Reintentar descarga individual fallida o colgada
    this.app.post('/api/downloads/retry', async (req, res) => {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({ success: false, error: 'Falta parámetro hash' });
      }

      try {
        const result = await arrService.retryDownloadByHash(hash);
        addLog('info', `Reintento de descarga aplicado (${result.source}): ${result.title || hash}`);
        res.json({ success: true, ...result });
      } catch (err) {
        console.error('[Downloads] Error al reintentar descarga:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 2.3 Reintentar todas las descargas colgadas o fallidas en lote
    this.app.post('/api/downloads/retry-stalled', async (req, res) => {
      try {
        const actions = await arrService.retryStalledDownloads();
        addLog('info', `Reintento global de colgadas completado (${actions.length} acciones ejecutadas)`);
        res.json({ success: true, count: actions.length, actions });
      } catch (err) {
        console.error('[Downloads] Error al reintentar colgadas en lote:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 2.4 Reintentar búsqueda de una solicitud por ID
    this.app.post('/api/requests/retry', async (req, res) => {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ success: false, error: 'Falta parámetro id' });
      }

      try {
        const result = await arrService.retryRequest(id);
        addLog('info', `Reintento de solicitud activado: ${id}`);
        res.json({ success: true, ...result });
      } catch (err) {
        console.error('[Requests] Error al reintentar solicitud:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 3. Historial de solicitudes
    this.app.get('/api/requests', (req, res) => {
      const limit = parseInt(req.query.limit || '50', 10);
      res.json({
        success: true,
        requests: db.listRequests(limit).reverse()
      });
    });

    // 3.1 Gestión de Whitelist
    this.app.get('/api/whitelist', (req, res) => {
      res.json({ success: true, whitelist: db.getWhitelist() });
    });

    this.app.post('/api/whitelist/add', (req, res) => {
      const { number, label } = req.body;
      if (!number) {
        return res.status(400).json({ success: false, error: 'Número no especificado' });
      }
      try {
        const updated = db.addWhitelistNumber(number, label);
        addLog('info', `Número añadido a la whitelist: ${number} (${label || 'Sin etiqueta'})`);
        res.json({ success: true, whitelist: updated });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/whitelist/remove', (req, res) => {
      const { number } = req.body;
      if (!number) {
        return res.status(400).json({ success: false, error: 'Número no especificado' });
      }
      const updated = db.removeWhitelistNumber(number);
      addLog('info', `Número eliminado de la whitelist: ${number}`);
      res.json({ success: true, whitelist: updated });
    });

    this.app.post('/api/whitelist/toggle', (req, res) => {
      const { enabled } = req.body;
      const updated = db.toggleWhitelist(enabled);
      addLog('info', `Whitelist ${enabled ? 'habilitada' : 'deshabilitada'} desde Web UI`);
      res.json({ success: true, whitelist: updated });
    });

    // 3.2 Episodios faltantes y sincronización con Sonarr/Radarr
    this.app.get('/api/series/missing', async (req, res) => {
      try {
        const summary = await arrService.getMissingEpisodesSummary();
        res.json({ success: true, ...summary });
      } catch (err) {
        console.error('[Series] Error obteniendo faltantes:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/series/restore-missing', async (req, res) => {
      const { seriesId, seasonNumber, action } = req.body;
      try {
        const result = await arrService.restoreAndDownloadMissing({ seriesId, seasonNumber, action });
        addLog('info', `Restauración y búsqueda de episodios faltantes ejecutada: ${result.message}`);
        res.json({ success: true, ...result });
      } catch (err) {
        console.error('[Series] Error restaurando faltantes:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 4. Busqueda interactiva con FuzzyWuzzy
    this.app.get('/api/search', async (req, res) => {
      const query = (req.query.q || '').trim();
      if (!query) return res.json({ success: true, results: [] });

      try {
        const results = await tmdb.search(query);
        res.json({ success: true, query, results: results.slice(0, 10) });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 4.1 Obtener temporadas de una serie
    this.app.get('/api/series/seasons', async (req, res) => {
      const title = (req.query.title || '').trim();
      const tvdbId = req.query.tvdbId ? parseInt(req.query.tvdbId, 10) : null;
      if (!title && !tvdbId) {
        return res.status(400).json({ success: false, error: 'Se requiere title o tvdbId' });
      }
      try {
        const seasons = await arrService.getSeriesSeasons({ title, tvdbId });
        res.json({ success: true, seasons });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message, seasons: [] });
      }
    });

    // 5. Encolar pedido manualmente desde la Web UI (soporta seasonSelection)
    this.app.post('/api/request-media', async (req, res) => {
      const { media, languageChoice, seasonSelection } = req.body;
      if (!media || !media.title) {
        return res.status(400).json({ success: false, error: 'Media inválida' });
      }

      try {
        let arrResult = null;
        if (media.type === 'movie') {
          arrResult = await arrService.addMovie(media, languageChoice || 'latino');
        } else {
          arrResult = await arrService.addSeries(media, languageChoice || 'latino', seasonSelection || 'all');
        }

        const parsedSeasons = arrService.parseSeasonSelection(seasonSelection);
        const seasonLabel = parsedSeasons ? arrService.formatSeasonLabel(parsedSeasons) : null;
        db.addRequest({
          mediaType: media.type,
          title: media.title,
          year: media.year,
          season: seasonLabel,
          tmdbId: media.tmdbId,
          radarrId: arrResult.radarrId,
          sonarrId: arrResult.sonarrId,
          userJid: 'web_dashboard',
          chatJid: 'web_dashboard',
          language: languageChoice || 'latino',
          posterUrl: media.posterUrl
        });

        const logDetail = seasonLabel ? ` [${seasonLabel}]` : '';
        addLog('info', `Pedido manual desde Web UI: "${media.title}"${logDetail} (${languageChoice || 'latino'})`);
        res.json({ success: true, result: arrResult, seasonLabel });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 6. Forzar escaneo de biblioteca de Plex
    this.app.post('/api/plex/refresh', async (req, res) => {
      const section = req.body && req.body.section ? req.body.section : null;
      await this._triggerPlexScan(section);
      addLog('info', 'Escaneo manual de biblioteca Plex disparado desde Web UI');
      res.json({ success: true, message: 'Escaneo de biblioteca disparado' });
    });

    // 7. Eventos de log recientes
    this.app.get('/api/logs', (req, res) => {
      res.json({ success: true, logs: recentLogs.slice().reverse() });
    });

    // Endpoint clasico de salud
    this.app.get('/health', async (req, res) => {
      const radarrStatus = await arrService.testRadarr();
      const sonarrStatus = await arrService.testSonarr();
      const isWaConnected = this.whatsappClient ? this.whatsappClient.isConnected() : false;

      res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        whatsapp: { connected: isWaConnected },
        radarr: radarrStatus,
        sonarr: sonarrStatus,
        paths: {
          movies: config.moviesPath,
          series: config.seriesPath
        }
      });
    });

    // Endpoint clasico de solicitudes
    this.app.get('/requests', (req, res) => {
      res.json({
        total: db.listRequests().length,
        requests: db.listRequests(50)
      });
    });

    // Endpoint de Webhook para Radarr y Sonarr
    this.app.post('/webhook', async (req, res) => {
      const payload = req.body;
      addLog('info', `Webhook recibido: evento "${payload.eventType}"`);
      console.log(`[Webhook] Evento recibido: "${payload.eventType}"`);

      // Manejo de prueba de conexion desde la interfaz de Radarr/Sonarr
      if (payload.eventType === 'Test') {
        console.log('[Webhook] ✅ Prueba de webhook recibida exitosamente.');
        return res.status(200).json({ success: true, message: 'Test recibido correctamente' });
      }

      // Procesar descargas o upgrades completados
      if (payload.eventType === 'Download' || payload.eventType === 'Upgrade') {
        try {
          await this._handleDownloadEvent(payload);
          return res.status(200).json({ success: true, notified: true });
        } catch (err) {
          console.error('[Webhook] Error procesando evento Download/Upgrade:', err.message);
          return res.status(500).json({ success: false, error: err.message });
        }
      }

      // Otros eventos (Grab, Rename, etc.)
      res.status(200).json({ success: true, ignored: true });
    });
  }

  async _handleDownloadEvent(payload) {
    const isMovie = !!payload.movie;
    const isSeries = !!payload.series;

    let title = '';
    let year = '';
    let tmdbId = null;
    let radarrId = null;
    let sonarrId = null;
    let extraDetails = '';

    if (isMovie) {
      title = payload.movie.title;
      year = payload.movie.year;
      tmdbId = payload.movie.tmdbId;
      radarrId = payload.movie.id;
      const quality = payload.movieFile ? payload.movieFile.quality : '';
      if (quality) extraDetails = `📺 Calidad: ${quality}`;
    } else if (isSeries) {
      title = payload.series.title;
      sonarrId = payload.series.id;
      if (Array.isArray(payload.episodes) && payload.episodes.length > 0) {
        const ep = payload.episodes[0];
        extraDetails = `📺 Temporada ${ep.seasonNumber}, Episodio ${ep.episodeNumber}: "${ep.title}"`;
      }
    }

    console.log(`[Webhook] 📥 Descarga completada: "${title}" (${year || 'Serie'})`);

    // 1. Forzar escaneo en Plex
    await this._triggerPlexScan(isMovie ? 'movie' : (isSeries ? 'show' : null));

    // 2. Buscar si alguien de la familia pidió este contenido
    const pending = db.findPendingRequest({
      tmdbId,
      radarrId,
      sonarrId,
      title
    });

    if (!pending) {
      console.log(`[Webhook] No se encontró una solicitud pendiente en la base de datos para "${title}".`);
      return;
    }

    console.log(`[Webhook] Solicitud encontrada para el usuario: ${pending.userJid} (Chat: ${pending.chatJid})`);

    // 3. Notificar por WhatsApp
    if (this.whatsappClient && this.whatsappClient.isConnected()) {
      const message = i18n.t('download_completed', {
        title: pending.title,
        year: pending.year || '',
        extraInfo: extraDetails ? `\n${extraDetails}` : ''
      });

      const targetJid = pending.chatJid || pending.userJid;

      if (pending.posterUrl) {
        await this.whatsappClient.sendImage(targetJid, pending.posterUrl, message);
      } else {
        await this.whatsappClient.sendMessage(targetJid, message);
      }

      db.markCompleted(pending.id);
      console.log(`[Webhook] ✅ Notificación enviada exitosamente a WhatsApp (${targetJid})`);
    } else {
      console.warn('[Webhook] WhatsApp no está conectado actualmente. Se guardó como completado pero no se pudo enviar el mensaje.');
      db.markCompleted(pending.id);
    }
  }

  async _triggerPlexScan(mediaType = null) {
    const token = config.plex.token;
    if (!token) {
      console.warn('[Webhook] ⚠️ No se pudo refrescar la biblioteca de Plex: PLEX_TOKEN no está configurado.');
      return;
    }
    try {
      let sectionKey = null;
      if (mediaType) {
        try {
          const sectionsRes = await axios.get(`${config.plex.url}/library/sections`, {
            params: { 'X-Plex-Token': token },
            timeout: 3000
          });
          const dirs = sectionsRes.data?.MediaContainer?.Directory || [];
          const targetType = (mediaType === 'movie' || mediaType === 'pelicula') ? 'movie' : 'show';
          const found = dirs.find(d => d.type === targetType);
          if (found) sectionKey = found.key;
        } catch (_) {}
      }

      const refreshUrl = sectionKey 
        ? `${config.plex.url}/library/sections/${sectionKey}/refresh`
        : `${config.plex.url}/library/sections/all/refresh`;

      await axios.get(refreshUrl, {
        params: { 'X-Plex-Token': token },
        timeout: 5000
      });
      const targetDesc = sectionKey ? `Sección #${sectionKey} (${mediaType})` : 'Todas las secciones';
      console.log(`[Webhook] 🔄 Biblioteca de Plex actualizada exitosamente (${targetDesc}).`);
      addLog('info', `Plex: Biblioteca actualizada (${targetDesc})`);
    } catch (err) {
      console.warn('[Webhook] No se pudo refrescar la biblioteca de Plex:', err.message);
      addLog('error', `Plex: Error al actualizar biblioteca (${err.message})`);
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(config.port, () => {
        console.log(`[Webhook Server] 🚀 Escuchando en http://localhost:${config.port}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = new WebhookServer();
