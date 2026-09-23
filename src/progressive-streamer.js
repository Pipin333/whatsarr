/**
 * Progressive Streamer Service
 * Enables on-demand streaming experience for season packs and large downloads:
 * 1. Automatically enforces sequential download & first/last piece priority on active torrents.
 * 2. Detects individual episodes that reach 100% completion while the pack is still downloading.
 * 3. Immediately triggers Sonarr Manual Import / hardlinks and refreshes Plex.
 * 4. Notifies the user via WhatsApp when Chapter 1 is ready to play.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

class ProgressiveStreamer {
  constructor() {
    this.intervalId = null;
    this.pollIntervalMs = 15000; // 15 segundos
    this.whatsappClient = null;
    this.isChecking = false;

    // Rastrear archivos ya procesados para evitar re-importaciones: `${torrentHash}:${fileIndex}`
    this.processedFiles = new Set();
    // Rastrear torrents cuyo "Capítulo 1" ya fue notificado a WhatsApp: `${torrentHash}`
    this.notifiedEpisode1 = new Set();
    // Torrents a los que ya se les forzó la descarga secuencial
    this.sequentialEnforced = new Set();
  }

  setWhatsAppClient(client) {
    this.whatsappClient = client;
  }

  start(intervalMs = 15000) {
    if (this.intervalId) return;
    this.pollIntervalMs = intervalMs;
    console.log(`[ProgressiveStreamer] 🚀 Iniciando motor de streaming progresivo (intervalo: ${this.pollIntervalMs / 1000}s)...`);
    
    // Ejecutar chequeo inicial inmediato
    this.checkActiveDownloads().catch(err => {
      console.warn('[ProgressiveStreamer] Error en chequeo inicial:', err.message);
    });

    this.intervalId = setInterval(() => {
      this.checkActiveDownloads().catch(err => {
        console.warn('[ProgressiveStreamer] Error en ciclo periódico:', err.message);
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ProgressiveStreamer] Motor de streaming progresivo detenido.');
    }
  }

  async checkActiveDownloads() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // 1. Obtener todos los torrents de qBittorrent
      let torrents = [];
      try {
        const res = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, {
          timeout: 4000
        });
        torrents = res.data || [];
      } catch (qbErr) {
        // qBittorrent puede no estar abierto aún
        return;
      }

      if (torrents.length === 0) return;

      // Filtrar torrents activos (descargando o donde aún no se ha verificado el capítulo 1)
      const relevantTorrents = torrents.filter(t => 
        t.progress < 1 || 
        !this.notifiedEpisode1.has(t.hash) ||
        ['downloading', 'stalledDL', 'metaDL', 'forcedDL', 'queuedDL', 'checkingDL'].includes(t.state)
      );

      for (const torrent of relevantTorrents) {
        await this._processTorrent(torrent);
      }
    } finally {
      this.isChecking = false;
    }
  }

  async _processTorrent(torrent) {
    const hash = torrent.hash;

    // 1. Garantizar descarga secuencial y prioridad de cabeceras en qBittorrent sin toggle involuntario
    try {
      const postData = `hashes=${encodeURIComponent(hash)}`;
      const toggles = [];
      if (!torrent.seq_dl) {
        toggles.push(axios.post(`${config.qbittorrent.url}/api/v2/torrents/toggleSequentialDownload`, postData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 3000
        }).catch(() => null));
      }
      if (!torrent.f_l_piece_prio) {
        toggles.push(axios.post(`${config.qbittorrent.url}/api/v2/torrents/toggleFirstLastPiecePrio`, postData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 3000
        }).catch(() => null));
      }
      if (toggles.length > 0) {
        await Promise.all(toggles);
        console.log(`[ProgressiveStreamer] ⚡ Descarga secuencial y cabeceras garantizadas para "${torrent.name}"`);
      }
    } catch (_) {}

    // Solo procesamos importación progresiva para packs de series (Sonarr)
    const isTv = (torrent.category || '').includes('sonarr') || (torrent.category || '').includes('tv') ||
                 /s\d+/i.test(torrent.name) || /season/i.test(torrent.name);

    if (!isTv) return;

    // 2. Obtener lista de archivos del torrent
    let files = [];
    try {
      const filesRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/files`, {
        params: { hash },
        timeout: 4000
      });
      files = filesRes.data || [];
    } catch (err) {
      console.warn(`[ProgressiveStreamer] Error leyendo archivos de torrent ${hash}:`, err.message);
      return;
    }

    const videoExtensions = ['.mkv', '.mp4', '.m4v', '.avi', '.ts', '.webm', '.mov'];
    const videoFiles = files.filter(f => {
      const ext = path.extname(f.name || '').toLowerCase();
      return videoExtensions.includes(ext) && !f.name.toLowerCase().includes('sample');
    });

    if (videoFiles.length === 0) return;

    // 2.1 PRIORIZACIÓN ON-DEMAND EN QBITTORRENT:
    // Identificar el primer episodio incompleto y darle prioridad máxima (7)
    // para que el ancho de banda se concentre en el próximo capítulo a ver
    const nextIncomplete = videoFiles.find(f => f.progress < 0.999 && !f.is_seed);
    if (nextIncomplete && nextIncomplete.priority !== 7) {
      try {
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/filePrio`, 
          `hash=${encodeURIComponent(hash)}&id=${nextIncomplete.index}&priority=7`,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 3000 }
        );
        console.log(`[ProgressiveStreamer] 🚀 On-Demand: Prioridad máxima (7) asignada a "${path.basename(nextIncomplete.name)}"`);
      } catch (_) {}
    }

    // 3. Procesar cada archivo de video completado que no haya sido procesado
    const completedVideoFiles = videoFiles.filter(f => f.progress >= 0.999 || f.is_seed);
    for (const f of completedVideoFiles) {
      const fileKey = `${hash}_${f.index}`;
      if (this.processedFiles.has(fileKey)) continue;

      try {
        const imported = await this._importCompletedEpisode(torrent, f);
        if (imported) {
          this.processedFiles.add(fileKey);
          console.log(`[ProgressiveStreamer] ✅ Capítulo indexado progresivamente: "${f.name.split('/').pop()}"`);

          // 4. Si es el Capítulo 1 (o primer capítulo del pack) y aún no se notificó, avisar por WhatsApp
          const isEpisode1 = /s\d+e0?1\b/i.test(f.name) || !this.notifiedEpisode1.has(hash);
          if (isEpisode1 && !this.notifiedEpisode1.has(hash)) {
            this.notifiedEpisode1.add(hash);
            await this._notifyEpisode1Ready(torrent, f, imported.seriesTitle || torrent.name);
          }
        }
      } catch (importErr) {
        console.warn(`[ProgressiveStreamer] Error importando "${f.name}":`, importErr.message);
      }
    }
  }

  async _importCompletedEpisode(torrent, file) {
    const sourceFilePath = path.join(torrent.save_path, file.name);
    if (!fs.existsSync(sourceFilePath)) return null;

    // Estrategia 1 (Rápida y no bloqueante): Creación directa de Hardlink NTFS
    try {
      const parsed = this._parseMediaInfoFromFileName(file.name, torrent.name);
      if (parsed.season && parsed.episode) {
        const headers = config.sonarr.apiKey ? { 'X-Api-Key': config.sonarr.apiKey } : {};
        let series = null;
        if (config.sonarr.apiKey) {
          try {
            const seriesListRes = await axios.get(`${config.sonarr.url}/api/v3/series`, { headers, timeout: 5000 });
            series = seriesListRes.data.find(s => 
              s.title.toLowerCase().includes(parsed.seriesTitle.toLowerCase()) ||
              parsed.seriesTitle.toLowerCase().includes(s.title.toLowerCase())
            );
          } catch (_) {}
        }

        const seriesTitle = series ? series.title : parsed.seriesTitle;
        const seriesPath = series?.path || path.join(config.seriesPath, seriesTitle);
        const seasonFolder = path.join(seriesPath, `Season ${parsed.season}`);

        if (!fs.existsSync(seasonFolder)) {
          fs.mkdirSync(seasonFolder, { recursive: true });
        }

        const destFilePath = path.join(seasonFolder, path.basename(file.name));
        if (!fs.existsSync(destFilePath)) {
          try {
            fs.linkSync(sourceFilePath, destFilePath);
            console.log(`[ProgressiveStreamer] 🔗 Hardlink creado: ${destFilePath}`);
          } catch (linkErr) {
            // Si falla el link (unidades distintas), copiar o fallback
            if (!fs.existsSync(destFilePath)) {
              fs.copyFileSync(sourceFilePath, destFilePath);
              console.log(`[ProgressiveStreamer] 📋 Copia creada: ${destFilePath}`);
            }
          }
        }

        // Notificar a Sonarr para registrar el episodio en su base de datos
        if (series?.id) {
          axios.post(`${config.sonarr.url}/api/v3/command`, {
            name: 'RescanSeries',
            seriesId: series.id
          }, { headers, timeout: 5000 }).catch(() => null);
        }

        // Notificar a Plex inmediatamente
        await this._triggerPlexScan();

        return {
          success: true,
          seriesTitle,
          seasonNumber: parsed.season,
          episodeNumber: parsed.episode
        };
      }
    } catch (directErr) {
      console.warn('[ProgressiveStreamer] Estrategia de enlace directo falló:', directErr.message);
    }

    // Estrategia 2 (Fallback): Manual Import en Sonarr
    if (config.sonarr.apiKey) {
      const headers = { 'X-Api-Key': config.sonarr.apiKey };
      const torrentFolder = torrent.content_path || path.join(torrent.save_path, torrent.name);
      try {
        const manualRes = await axios.get(`${config.sonarr.url}/api/v3/manualimport`, {
          params: { folder: torrentFolder },
          headers,
          timeout: 5000
        });

        const manualItems = manualRes.data || [];
        const cleanFileName = path.basename(file.name);
        const matchedItem = manualItems.find(item => {
          const itemBase = path.basename(item.path);
          return itemBase.toLowerCase() === cleanFileName.toLowerCase() &&
                 item.series &&
                 Array.isArray(item.episodes) && item.episodes.length > 0;
        });

        if (matchedItem && (!matchedItem.rejections || matchedItem.rejections.length === 0)) {
          await axios.post(`${config.sonarr.url}/api/v3/command`, {
            name: 'ManualImport',
            files: [{
              path: matchedItem.path,
              seriesId: matchedItem.series.id,
              episodeIds: matchedItem.episodes.map(e => e.id),
              quality: matchedItem.quality,
              languages: matchedItem.languages,
              releaseGroup: matchedItem.releaseGroup || '',
              indexerFlags: matchedItem.indexerFlags || 0
            }],
            importMode: 'Auto'
          }, { headers, timeout: 6000 });

          await this._triggerPlexScan();

          return {
            success: true,
            seriesTitle: matchedItem.series.title,
            seasonNumber: matchedItem.seasonNumber,
            episodeNumber: matchedItem.episodes[0]?.episodeNumber
          };
        }
      } catch (_) {}
    }

    return null;
  }

  _parseMediaInfoFromFileName(fileName, torrentName) {
    const base = path.basename(fileName);
    const sMatch = base.match(/s0?(\d+)e0?(\d+)/i) || torrentName.match(/s0?(\d+)/i);
    const season = sMatch ? parseInt(sMatch[1], 10) : 1;
    const episode = sMatch && sMatch[2] ? parseInt(sMatch[2], 10) : 1;

    // Limpiar título de serie
    const cleanTitle = (torrentName || base)
      .replace(/\(?(19\d\d|20\d\d)\)?/g, '')
      .replace(/s\d+.*/i, '')
      .replace(/season\s*\d+.*/i, '')
      .replace(/[\._]/g, ' ')
      .trim();

    return { seriesTitle: cleanTitle, season, episode };
  }

  async _notifyEpisode1Ready(torrent, file, seriesTitle) {
    if (!this.whatsappClient || !this.whatsappClient.isConnected()) {
      return;
    }

    try {
      // Buscar en DB la solicitud pendiente para obtener el chat/usuario solicitante
      const pending = db.findPendingRequest({ title: seriesTitle });
      if (!pending || (!pending.chatJid && !pending.userJid)) {
        return;
      }

      // Evitar notificaciones duplicadas para la misma solicitud
      if (pending.ep1Notified) {
        return;
      }

      const targetJid = pending.chatJid || pending.userJid;
      const message = 
        `🍿 *¡El Capítulo 1 de ${pending.title || seriesTitle} ya está listo en Plex!*\n\n` +
        `Ya puedes ponerle Play ahora mismo en tu televisor o celular mientras los siguientes capítulos se continúan descargando en segundo plano. ¡A disfrutar! 🎬`;

      if (pending.posterUrl) {
        await this.whatsappClient.sendImage(targetJid, pending.posterUrl, message);
      } else {
        await this.whatsappClient.sendMessage(targetJid, message);
      }

      db.updateRequest(pending.id, { ep1Notified: true });
      console.log(`[ProgressiveStreamer] 📲 Notificación de Capítulo 1 enviada exitosamente a WhatsApp (${targetJid})`);
    } catch (err) {
      console.warn('[ProgressiveStreamer] Error enviando notificación de Capítulo 1:', err.message);
    }
  }

  async _triggerPlexScan() {
    const token = config.plex.token;
    if (!token) return;

    try {
      // Refrescar sección de Series (ID 2 o buscada por API)
      await axios.get(`${config.plex.url}/library/sections/2/refresh`, {
        params: { 'X-Plex-Token': token },
        timeout: 4000
      });
      console.log('[ProgressiveStreamer] 📡 Refresco de biblioteca de Series disparado en Plex.');
    } catch (err) {
      console.warn('[ProgressiveStreamer] Advertencia refrescando Plex:', err.message);
    }
  }
}

module.exports = new ProgressiveStreamer();
