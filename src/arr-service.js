const axios = require('axios');
const config = require('./config');

class ArrService {
  constructor() {
    this.radarrUrl = config.radarr.url;
    this.radarrKey = config.radarr.apiKey;
    this.moviesPath = config.moviesPath;

    this.sonarrUrl = config.sonarr.url;
    this.sonarrKey = config.sonarr.apiKey;
    this.seriesPath = config.seriesPath;
  }

  // --- Pruebas de conectividad ---
  async testRadarr() {
    if (!this.radarrKey) return { ok: false, message: 'Falta RADARR_API_KEY en .env' };
    try {
      const res = await axios.get(`${this.radarrUrl}/api/v3/system/status`, {
        headers: { 'X-Api-Key': this.radarrKey },
        timeout: 4000
      });
      return { ok: true, version: res.data.version, appName: res.data.appName };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async testSonarr() {
    if (!this.sonarrKey) return { ok: false, message: 'Falta SONARR_API_KEY en .env' };
    try {
      const res = await axios.get(`${this.sonarrUrl}/api/v3/system/status`, {
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 4000
      });
      return { ok: true, version: res.data.version, appName: res.data.appName };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  // --- Chequeo de estado existente ---
  async checkMovieStatus(media) {
    if (!this.radarrKey) return { exists: false, hasFile: false };
    try {
      const existing = await axios.get(`${this.radarrUrl}/api/v3/movie`, {
        headers: { 'X-Api-Key': this.radarrKey },
        timeout: 6000
      });
      const found = existing.data.find(m => 
        (media.tmdbId && m.tmdbId === media.tmdbId) ||
        (m.title.toLowerCase() === media.title.toLowerCase())
      );
      if (found) {
        return {
          exists: true,
          hasFile: Boolean(found.hasFile),
          radarrId: found.id,
          title: found.title,
          year: found.year
        };
      }
    } catch (err) {
      console.warn('[Radarr] Error comprobando estado de película:', err.message);
    }
    return { exists: false, hasFile: false };
  }

  async checkSeriesStatus(media) {
    if (!this.sonarrKey) return { exists: false, hasFile: false };
    try {
      const existing = await axios.get(`${this.sonarrUrl}/api/v3/series`, {
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 6000
      });
      const found = existing.data.find(s => 
        (media.tvdbId && s.tvdbId === media.tvdbId) ||
        (s.title.toLowerCase() === media.title.toLowerCase())
      );
      if (found) {
        const episodeFileCount = found.statistics?.episodeFileCount || 0;
        return {
          exists: true,
          hasFile: episodeFileCount > 0,
          sonarrId: found.id,
          title: found.title,
          episodeFileCount
        };
      }
    } catch (err) {
      console.warn('[Sonarr] Error comprobando estado de serie:', err.message);
    }
    return { exists: false, hasFile: false };
  }

  // --- Radarr (Películas) ---
  async addMovie(media, languageChoice = 'latino') {
    if (!this.radarrKey) {
      throw new Error('Radarr no está configurado (falta RADARR_API_KEY). Revisa el archivo .env');
    }

    // 1. Obtener detalles de la película desde el lookup de Radarr usando el tmdbId o título
    let movieData = null;
    try {
      let lookupParam = media.title;
      if (media.tmdbId) {
        lookupParam = `tmdb:${media.tmdbId}`;
      } else if (media.imdbId) {
        lookupParam = `imdb:${media.imdbId}`;
      }
      const lookupRes = await axios.get(`${this.radarrUrl}/api/v3/movie/lookup`, {
        params: { term: lookupParam },
        headers: { 'X-Api-Key': this.radarrKey },
        timeout: 10000
      });

      if (Array.isArray(lookupRes.data) && lookupRes.data.length > 0) {
        movieData = lookupRes.data[0];
      }
    } catch (err) {
      console.warn('[Radarr] Error en lookup:', err.message);
    }

    // 2. Si ya existe en Radarr, simplemente ordenar la búsqueda
    try {
      const existing = await axios.get(`${this.radarrUrl}/api/v3/movie`, {
        headers: { 'X-Api-Key': this.radarrKey }
      });
      const found = existing.data.find(m => 
        (media.tmdbId && m.tmdbId === media.tmdbId) ||
        (m.title.toLowerCase() === media.title.toLowerCase())
      );

      if (found) {
        if (found.hasFile) {
          console.log(`[Radarr] Película "${found.title}" ya tiene archivo en disco.`);
          return { success: true, radarrId: found.id, title: found.title, alreadyExists: true, hasFile: true };
        }
        console.log(`[Radarr] Película "${found.title}" ya existe en Radarr sin archivo (ID: ${found.id}). Disparando búsqueda...`);
        await this._triggerRadarrSearch([found.id]);
        return { success: true, radarrId: found.id, title: found.title, alreadyExists: true, hasFile: false };
      }
    } catch (err) {
      console.warn('[Radarr] Error comprobando películas existentes:', err.message);
    }

    // 3. Obtener Quality Profile por defecto (usualmente ID 1 o Any / HD-1080p)
    const qualityProfileId = await this._getRadarrQualityProfile();
    const tagId = await this._getOrCreateTag(this.radarrUrl, this.radarrKey, languageChoice);

    // 4. Construir payload para agregar película
    const payload = {
      title: movieData ? movieData.title : media.title,
      qualityProfileId: qualityProfileId || 1,
      titleSlug: movieData ? movieData.titleSlug : media.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      images: movieData ? movieData.images : [],
      tmdbId: media.tmdbId || (movieData ? movieData.tmdbId : 0),
      year: media.year || (movieData ? movieData.year : new Date().getFullYear()),
      rootFolderPath: this.moviesPath,
      monitored: true,
      tags: tagId ? [tagId] : [],
      addOptions: {
        searchForMovie: true
      }
    };

    const addRes = await axios.post(`${this.radarrUrl}/api/v3/movie`, payload, {
      headers: { 'X-Api-Key': this.radarrKey },
      timeout: 10000
    });

    return {
      success: true,
      radarrId: addRes.data.id,
      title: addRes.data.title,
      alreadyExists: false
    };
  }

  // --- Sonarr (Series) ---
  /**
   * Parsea expresiones de temporadas individuales, listas o rangos (ej: "2-5", "2 a 5", "1, 3, 5", [2, 3])
   * Retorna un array ordenado de enteros sin duplicados (ej: [2, 3, 4, 5]), o null si es 'all' / vacío.
   */
  parseSeasonSelection(input) {
    if (!input || input === 'all' || input === 'todas') return null;

    if (Array.isArray(input)) {
      const nums = input.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
      return nums.length > 0 ? [...new Set(nums)].sort((a, b) => a - b) : null;
    }

    const str = String(input).trim().toLowerCase();
    if (str === 'all' || str === 'todas' || str === 'toda' || str === 'completa') return null;

    const result = new Set();
    const parts = str.split(/[,;]+/);
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;

      // Detectar rango: "2-5", "2 a 5", "2 al 5", "2..5", "2 to 5"
      const rangeMatch = part.match(/(\d+)\s*(?:-|a|al|\.\.|to)\s*(\d+)/i);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let i = min; i <= max; i++) {
            if (i > 0) result.add(i);
          }
          continue;
        }
      }

      // Número individual: "2", "temp 2", "temporada 2"
      const singleMatch = part.match(/\d+/);
      if (singleMatch) {
        const num = parseInt(singleMatch[0], 10);
        if (!isNaN(num) && num > 0) {
          result.add(num);
        }
      }
    }

    const sorted = Array.from(result).sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : null;
  }

  /**
   * Genera una etiqueta legible para el usuario de las temporadas seleccionadas
   */
  formatSeasonLabel(targetSeasons) {
    if (!targetSeasons) return 'Todas las temporadas';
    const arr = Array.isArray(targetSeasons) ? targetSeasons : this.parseSeasonSelection(targetSeasons);
    if (!arr || arr.length === 0) return 'Todas las temporadas';
    if (arr.length === 1) return `Temporada ${arr[0]}`;

    const isConsecutive = arr.every((val, idx) => idx === 0 || val === arr[idx - 1] + 1);
    if (isConsecutive && arr.length > 1) {
      return `Temporadas ${arr[0]} a ${arr[arr.length - 1]}`;
    }
    return `Temporadas ${arr.join(', ')}`;
  }

  async getSeriesSeasons(media) {
    if (!this.sonarrKey) return [];
    try {
      let lookupTerm = media.title;
      if (media.tvdbId) lookupTerm = `tvdb:${media.tvdbId}`;
      else if (media.imdbId) lookupTerm = `imdb:${media.imdbId}`;

      const lookupRes = await axios.get(`${this.sonarrUrl}/api/v3/series/lookup`, {
        params: { term: lookupTerm },
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 10000
      });

      if (Array.isArray(lookupRes.data) && lookupRes.data.length > 0) {
        const series = lookupRes.data[0];
        const seasons = (series.seasons || [])
          .filter(s => s.seasonNumber > 0)
          .map(s => ({
            seasonNumber: s.seasonNumber,
            totalEpisodes: s.statistics?.totalEpisodeCount || 0
          }));
        return seasons;
      }
    } catch (err) {
      console.warn('[Sonarr] Error obteniendo temporadas:', err.message);
    }
    return [];
  }

  async prioritizeEpisode1(seriesId, seasonNumber = 1) {
    if (!this.sonarrKey || !seriesId) return null;
    try {
      const epRes = await axios.get(`${this.sonarrUrl}/api/v3/episode`, {
        params: { seriesId },
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 6000
      });
      const ep1 = (epRes.data || []).find(e => e.seasonNumber === seasonNumber && e.episodeNumber === 1 && !e.hasFile);
      if (ep1) {
        await axios.post(`${this.sonarrUrl}/api/v3/command`, {
          name: 'EpisodeSearch',
          episodeIds: [ep1.id]
        }, { headers: { 'X-Api-Key': this.sonarrKey }, timeout: 6000 });
        console.log(`[Sonarr] ⚡ On-Demand: EpisodeSearch prioritario disparado para T${seasonNumber}E01 (ID: ${ep1.id})`);
        return ep1.id;
      }
    } catch (err) {
      console.warn(`[Sonarr] Error al priorizar T${seasonNumber}E01:`, err.message);
    }
    return null;
  }

  async addSeries(media, languageChoice = 'latino', selectedSeasons = 'all') {
    if (!this.sonarrKey) {
      throw new Error('Sonarr no está configurado (falta SONARR_API_KEY). Revisa el archivo .env');
    }

    let seriesData = null;
    try {
      let lookupTerm = media.title;
      if (media.tvdbId) {
        lookupTerm = `tvdb:${media.tvdbId}`;
      } else if (media.imdbId) {
        lookupTerm = `imdb:${media.imdbId}`;
      }
      const lookupRes = await axios.get(`${this.sonarrUrl}/api/v3/series/lookup`, {
        params: { term: lookupTerm },
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 10000
      });
      if (Array.isArray(lookupRes.data) && lookupRes.data.length > 0) {
        seriesData = lookupRes.data[0];
      }
    } catch (err) {
      console.warn('[Sonarr] Error en lookup:', err.message);
    }

    // Normalizar temporadas seleccionadas (soporta rangos ej: "2-5", "2 a 5", arrays o individuales)
    const targetSeasons = this.parseSeasonSelection(selectedSeasons);
    const firstSeason = (targetSeasons && targetSeasons.length > 0) ? targetSeasons[0] : 1;

    // Comprobar si ya existe
    try {
      const existing = await axios.get(`${this.sonarrUrl}/api/v3/series`, {
        headers: { 'X-Api-Key': this.sonarrKey }
      });
      const found = existing.data.find(s => 
        (seriesData && seriesData.tvdbId && s.tvdbId === seriesData.tvdbId) ||
        (s.title.toLowerCase() === media.title.toLowerCase())
      );

      if (found) {
        if (targetSeasons && targetSeasons.length > 0) {
          console.log(`[Sonarr] Serie "${found.title}" ya existe. Ajustando monitoreo a temporadas: ${targetSeasons.join(', ')}`);
          try {
            const fullSeriesRes = await axios.get(`${this.sonarrUrl}/api/v3/series/${found.id}`, {
              headers: { 'X-Api-Key': this.sonarrKey },
              timeout: 6000
            });
            const fullSeries = fullSeriesRes.data;
            fullSeries.seasons = (fullSeries.seasons || []).map(s => ({
              ...s,
              monitored: s.seasonNumber > 0 && targetSeasons.includes(s.seasonNumber)
            }));
            await axios.put(`${this.sonarrUrl}/api/v3/series/${found.id}`, fullSeries, {
              headers: { 'X-Api-Key': this.sonarrKey },
              timeout: 8000
            });
          } catch (putErr) {
            console.warn('[Sonarr] Advertencia actualizando temporadas en serie existente:', putErr.message);
          }

          // Priorizar capítulo 1 on-demand
          await this.prioritizeEpisode1(found.id, firstSeason);

          for (const sNum of targetSeasons) {
            try {
              await axios.post(`${this.sonarrUrl}/api/v3/command`, {
                name: 'SeasonSearch',
                seriesId: found.id,
                seasonNumber: sNum
              }, { headers: { 'X-Api-Key': this.sonarrKey }, timeout: 6000 });
              console.log(`[Sonarr] SeasonSearch T${sNum} disparado para serie existente "${found.title}"`);
            } catch (_) {}
          }
          return { success: true, sonarrId: found.id, title: found.title, alreadyExists: true, selectedSeasons: targetSeasons };
        }

        const episodeFileCount = found.statistics?.episodeFileCount || 0;
        if (episodeFileCount > 0) {
          console.log(`[Sonarr] Serie "${found.title}" ya tiene ${episodeFileCount} episodios descargados.`);
          return { success: true, sonarrId: found.id, title: found.title, alreadyExists: true, hasFile: true };
        }
        console.log(`[Sonarr] Serie "${found.title}" ya existe en Sonarr sin episodios. Disparando búsqueda on-demand...`);
        await this.prioritizeEpisode1(found.id, 1);
        await this._triggerSonarrSearch([found.id]);
        return { success: true, sonarrId: found.id, title: found.title, alreadyExists: true, hasFile: false };
      }
    } catch (err) {
      console.warn('[Sonarr] Error comprobando series existentes:', err.message);
    }

    const qualityProfileId = await this._getSonarrQualityProfile();
    const tagId = await this._getOrCreateTag(this.sonarrUrl, this.sonarrKey, languageChoice);

    let seasonsList = [];
    if (seriesData && Array.isArray(seriesData.seasons)) {
      seasonsList = seriesData.seasons.map(s => {
        const isMonitored = s.seasonNumber > 0 && (
          !targetSeasons || targetSeasons.includes(s.seasonNumber)
        );
        return {
          ...s,
          monitored: isMonitored
        };
      });
    }

    const payload = {
      title: seriesData ? seriesData.title : media.title,
      qualityProfileId: qualityProfileId || 1,
      titleSlug: seriesData ? seriesData.titleSlug : media.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      images: seriesData ? seriesData.images : [],
      tvdbId: seriesData ? seriesData.tvdbId : (media.tvdbId || 0),
      year: media.year || (seriesData ? seriesData.year : new Date().getFullYear()),
      rootFolderPath: this.seriesPath,
      monitored: true,
      seasons: seasonsList.length > 0 ? seasonsList : undefined,
      tags: tagId ? [tagId] : [],
      seasonFolder: true,
      addOptions: {
        searchForMissingEpisodes: false // Lo controlamos explícitamente abajo para ordenar el pipeline on-demand
      }
    };

    const addRes = await axios.post(`${this.sonarrUrl}/api/v3/series`, payload, {
      headers: { 'X-Api-Key': this.sonarrKey },
      timeout: 10000
    });

    const newSeriesId = addRes.data?.id;
    if (newSeriesId) {
      // 1. DISPARAR PRIORITARIAMENTE EL CAPÍTULO 1 ON-DEMAND
      await this.prioritizeEpisode1(newSeriesId, firstSeason);

      // 2. DISPARAR LA BÚSQUEDA DE LA TEMPORADA INICIAL (Temporada objetivo)
      try {
        await axios.post(`${this.sonarrUrl}/api/v3/command`, {
          name: 'SeasonSearch',
          seriesId: newSeriesId,
          seasonNumber: firstSeason
        }, { headers: { 'X-Api-Key': this.sonarrKey }, timeout: 6000 });
        console.log(`[Sonarr] 🎯 SeasonSearch T${firstSeason} disparado prioritariamente para serie #${newSeriesId}`);
      } catch (cmdErr) {
        console.warn(`[Sonarr] Advertencia al disparar SeasonSearch T${firstSeason}:`, cmdErr.message);
      }

      // 3. SI HAY MÁS TEMPORADAS, DISPARARLAS DIFERIDAS PARA NO SATURAR EL ANCHO DE BANDA
      if (targetSeasons && targetSeasons.length > 1) {
        const otherSeasons = targetSeasons.filter(s => s !== firstSeason);
        setTimeout(async () => {
          for (const sNum of otherSeasons) {
            try {
              await axios.post(`${this.sonarrUrl}/api/v3/command`, {
                name: 'SeasonSearch',
                seriesId: newSeriesId,
                seasonNumber: sNum
              }, { headers: { 'X-Api-Key': this.sonarrKey }, timeout: 6000 });
              console.log(`[Sonarr] SeasonSearch diferido T${sNum} disparado para serie #${newSeriesId}`);
            } catch (_) {}
          }
        }, 15000);
      } else if (!targetSeasons || selectedSeasons === 'all' || selectedSeasons === 'todas') {
        // Si fue "todas", buscar el resto de temporadas después de que T1 tome el liderazgo
        setTimeout(async () => {
          try {
            await axios.post(`${this.sonarrUrl}/api/v3/command`, {
              name: 'SeriesSearch',
              seriesId: newSeriesId
            }, { headers: { 'X-Api-Key': this.sonarrKey }, timeout: 6000 });
            console.log(`[Sonarr] SeriesSearch diferido disparado para serie #${newSeriesId}`);
          } catch (_) {}
        }, 20000);
      }
    }

    return {
      success: true,
      sonarrId: newSeriesId,
      title: addRes.data.title,
      alreadyExists: false,
      selectedSeasons: targetSeasons || 'all'
    };
  }

  // --- Auxiliares ---
  async _getRadarrQualityProfile() {
    try {
      const res = await axios.get(`${this.radarrUrl}/api/v3/qualityprofile`, {
        headers: { 'X-Api-Key': this.radarrKey }
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        // Preferir perfil 1080p para limitar el peso a menos de 10GB
        const hdProfile = res.data.find(p => p.name === 'HD-1080p' || p.name.includes('1080p'));
        return hdProfile ? hdProfile.id : res.data[0].id;
      }
    } catch (_) {}
    return 1;
  }

  async _getSonarrQualityProfile() {
    try {
      const res = await axios.get(`${this.sonarrUrl}/api/v3/qualityprofile`, {
        headers: { 'X-Api-Key': this.sonarrKey }
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        // Usar perfil 'Any' (id: 1) para aceptar calidades broadcast estándar (576p/480p) en series clásicas
        // y calidades HD (720p/1080p) en series modernas, evitando el descarte de packs de temporada.
        const anyProfile = res.data.find(p => p.name.toLowerCase() === 'any');
        if (anyProfile) return anyProfile.id;
        const hdProfile = res.data.find(p => p.name === 'HD - 720p/1080p' || p.name === 'HD-1080p');
        return hdProfile ? hdProfile.id : res.data[0].id;
      }
    } catch (_) {}
    return 1;
  }

  async _triggerRadarrSearch(movieIds) {
    try {
      await axios.post(`${this.radarrUrl}/api/v3/command`, {
        name: 'MoviesSearch',
        movieIds: movieIds
      }, {
        headers: { 'X-Api-Key': this.radarrKey }
      });
    } catch (err) {
      console.warn('[Radarr] Error al iniciar MoviesSearch:', err.message);
    }
  }

  async _triggerSonarrSearch(seriesIds) {
    try {
      await axios.post(`${this.sonarrUrl}/api/v3/command`, {
        name: 'SeriesSearch',
        seriesIds: seriesIds
      }, {
        headers: { 'X-Api-Key': this.sonarrKey }
      });
    } catch (err) {
      console.warn('[Sonarr] Error al iniciar SeriesSearch:', err.message);
    }
  }

  async _getOrCreateTag(baseUrl, apiKey, label) {
    if (!label) return null;
    try {
      const tagsRes = await axios.get(`${baseUrl}/api/v3/tag`, {
        headers: { 'X-Api-Key': apiKey }
      });
      const found = (tagsRes.data || []).find(t => t.label.toLowerCase() === label.toLowerCase());
      if (found) return found.id;

      const createRes = await axios.post(`${baseUrl}/api/v3/tag`, { label: label.toLowerCase() }, {
        headers: { 'X-Api-Key': apiKey }
      });
      return createRes.data.id;
    } catch (_) {
      return null;
    }
  }

  // --- Búsqueda de Torrents en Prowlarr ---

  async searchProwlarr(queryTerms) {
    const prowlarrUrl = config.prowlarr?.url || 'http://localhost:9696';
    const prowlarrKey = config.prowlarr?.apiKey;

    if (!prowlarrKey) {
      console.warn('[Prowlarr] API Key no configurada para búsqueda de torrents');
      return [];
    }

    const terms = Array.isArray(queryTerms) ? queryTerms : [queryTerms];
    const uniqueTerms = Array.from(new Set(terms.filter(Boolean))).slice(0, 3);
    const resultsMap = new Map();

    for (const term of uniqueTerms) {
      try {
        console.log(`[Prowlarr] Buscando en indexers: "${term}"`);
        const res = await axios.get(`${prowlarrUrl}/api/v1/search`, {
          params: { query: term, type: 'search' },
          headers: { 'X-Api-Key': prowlarrKey },
          timeout: 8000
        });

        if (Array.isArray(res.data)) {
          for (const item of res.data) {
            const key = item.guid || item.downloadUrl || item.title;
            if (!resultsMap.has(key)) {
              resultsMap.set(key, {
                title: item.title,
                size: item.size || 0,
                seeders: item.seeders || 0,
                leechers: item.leechers || 0,
                downloadUrl: item.downloadUrl || item.magnetUrl,
                magnetUrl: item.magnetUrl,
                guid: item.guid,
                infoUrl: item.infoUrl,
                protocol: item.protocol || 'torrent',
                indexer: item.indexer || 'Prowlarr',
                publishDate: item.publishDate
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Prowlarr] Error buscando "${term}":`, err.message);
      }
    }

    const allReleases = Array.from(resultsMap.values());
    console.log(`[Prowlarr] Total de releases consolidados: ${allReleases.length}`);
    return allReleases;
  }

  // --- Envío de Torrent Seleccionado al Cliente (qBittorrent) ---

  async sendTorrentToClient(downloadUrl, mediaType = 'movie', title = '') {
    if (!downloadUrl) throw new Error('URL de descarga o magnet no especificado');

    const qbUrl = config.qbittorrent.url;
    const isMovie = mediaType === 'movie';
    const category = isMovie ? 'radarr' : 'tv-sonarr';
    const savePath = isMovie ? config.moviesPath : config.seriesPath;

    const params = new URLSearchParams();
    params.append('urls', downloadUrl);
    params.append('category', category);
    if (savePath) {
      params.append('savepath', savePath);
    }

    await axios.post(`${qbUrl}/api/v2/torrents/add`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000
    });

    console.log(`[qBittorrent] 🚀 Torrent enviado con éxito: "${title}" (Categoría: ${category})`);
    return { success: true, message: `Torrent enviado a qBittorrent (${category})` };
  }

  // --- Métodos de Reintento para Descargas Fallidas o Colgadas ---

  async retryDownloadByHash(hash) {
    if (!hash) throw new Error('Hash no especificado');
    const cleanHash = hash.trim().toLowerCase();

    // 1. Buscar en cola de Radarr (Películas)
    if (this.radarrKey) {
      try {
        const radarrQueue = await axios.get(`${this.radarrUrl}/api/v3/queue`, {
          headers: { 'X-Api-Key': this.radarrKey },
          timeout: 5000
        });
        const found = (radarrQueue.data.records || []).find(r => 
          r.downloadId && r.downloadId.toLowerCase() === cleanHash
        );
        if (found) {
          console.log(`[ArrService] Reintentando descarga colgada en Radarr: "${found.title}" (Queue ID: ${found.id})`);
          await axios.delete(`${this.radarrUrl}/api/v3/queue/${found.id}`, {
            headers: { 'X-Api-Key': this.radarrKey },
            params: { removeFromClient: true, blocklist: true }
          });
          if (found.movieId) {
            await this._triggerRadarrSearch([found.movieId]);
          }
          return {
            success: true,
            source: 'radarr',
            title: found.title,
            action: 'blocklisted_and_researched',
            message: `Torrent colgado descartado y bloqueado en Radarr. Buscando automáticamente un release alternativo para "${found.title}".`
          };
        }
      } catch (err) {
        console.warn('[ArrService] Error al buscar en cola de Radarr:', err.message);
      }
    }

    // 2. Buscar en cola de Sonarr (Series)
    if (this.sonarrKey) {
      try {
        const sonarrQueue = await axios.get(`${this.sonarrUrl}/api/v3/queue`, {
          headers: { 'X-Api-Key': this.sonarrKey },
          timeout: 5000
        });
        const found = (sonarrQueue.data.records || []).find(r => 
          r.downloadId && r.downloadId.toLowerCase() === cleanHash
        );
        if (found) {
          console.log(`[ArrService] Reintentando descarga colgada en Sonarr: "${found.title}" (Queue ID: ${found.id})`);
          await axios.delete(`${this.sonarrUrl}/api/v3/queue/${found.id}`, {
            headers: { 'X-Api-Key': this.sonarrKey },
            params: { removeFromClient: true, blocklist: true }
          });
          if (found.episodeId) {
            await axios.post(`${this.sonarrUrl}/api/v3/command`, {
              name: 'EpisodeSearch',
              episodeIds: [found.episodeId]
            }, {
              headers: { 'X-Api-Key': this.sonarrKey }
            });
          } else if (found.seriesId && found.seasonNumber !== undefined) {
            await axios.post(`${this.sonarrUrl}/api/v3/command`, {
              name: 'SeasonSearch',
              seriesId: found.seriesId,
              seasonNumber: found.seasonNumber
            }, {
              headers: { 'X-Api-Key': this.sonarrKey }
            });
          } else if (found.seriesId) {
            await this._triggerSonarrSearch([found.seriesId]);
          }
          return {
            success: true,
            source: 'sonarr',
            title: found.title,
            action: 'blocklisted_and_researched',
            message: `Torrent colgado descartado y bloqueado en Sonarr. Buscando automáticamente un release alternativo para "${found.title}".`
          };
        }
      } catch (err) {
        console.warn('[ArrService] Error al buscar en cola de Sonarr:', err.message);
      }
    }

    // 3. Fallback directo en qBittorrent (re-anunciar trackers, recomprobar e iniciar forzado)
    try {
      const qbUrl = config.qbittorrent.url;
      const formData = `hashes=${encodeURIComponent(cleanHash)}`;
      
      await axios.post(`${qbUrl}/api/v2/torrents/recheck`, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 4000
      });
      await axios.post(`${qbUrl}/api/v2/torrents/reannounce`, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 4000
      });
      await axios.post(`${qbUrl}/api/v2/torrents/start`, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 4000
      });
      await axios.post(`${qbUrl}/api/v2/torrents/setForceStart`, `${formData}&value=true`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 4000
      });

      return {
        success: true,
        source: 'qbittorrent',
        action: 'force_reannounce',
        message: 'Recomprobación forzada, reanuncio a trackers y arranque forzado aplicados en qBittorrent.'
      };
    } catch (err) {
      throw new Error(`No se pudo reintentar en qBittorrent: ${err.message}`);
    }
  }

  async retryStalledDownloads() {
    const actions = [];

    // 1. Escanear y liberar items con warning/error/stalled en Sonarr
    if (this.sonarrKey) {
      try {
        const sonarrQueue = await axios.get(`${this.sonarrUrl}/api/v3/queue`, {
          headers: { 'X-Api-Key': this.sonarrKey },
          timeout: 5000
        });
        const records = sonarrQueue.data.records || [];
        const stalledSonarr = records.filter(r => 
          r.status === 'warning' || 
          r.status === 'error' || 
          r.trackedDownloadStatus === 'warning' || 
          r.trackedDownloadStatus === 'error' ||
          (r.errorMessage && r.errorMessage.toLowerCase().includes('stalled'))
        );

        for (const item of stalledSonarr) {
          try {
            await axios.delete(`${this.sonarrUrl}/api/v3/queue/${item.id}`, {
              headers: { 'X-Api-Key': this.sonarrKey },
              params: { removeFromClient: true, blocklist: true }
            });
            if (item.episodeId) {
              await axios.post(`${this.sonarrUrl}/api/v3/command`, {
                name: 'EpisodeSearch',
                episodeIds: [item.episodeId]
              }, {
                headers: { 'X-Api-Key': this.sonarrKey }
              });
            } else if (item.seriesId) {
              await this._triggerSonarrSearch([item.seriesId]);
            }
            actions.push({ source: 'sonarr', title: item.title, action: 're-searched' });
          } catch (e) {
            console.warn(`[ArrService] Error reintentando Sonarr #${item.id}:`, e.message);
          }
        }
      } catch (err) {
        console.warn('[ArrService] Error obteniendo cola de Sonarr:', err.message);
      }
    }

    // 2. Escanear y liberar items con warning/error/stalled en Radarr
    if (this.radarrKey) {
      try {
        const radarrQueue = await axios.get(`${this.radarrUrl}/api/v3/queue`, {
          headers: { 'X-Api-Key': this.radarrKey },
          timeout: 5000
        });
        const records = radarrQueue.data.records || [];
        const stalledRadarr = records.filter(r => 
          r.status === 'warning' || 
          r.status === 'error' || 
          r.trackedDownloadStatus === 'warning' || 
          r.trackedDownloadStatus === 'error' ||
          (r.errorMessage && r.errorMessage.toLowerCase().includes('stalled'))
        );

        for (const item of stalledRadarr) {
          try {
            await axios.delete(`${this.radarrUrl}/api/v3/queue/${item.id}`, {
              headers: { 'X-Api-Key': this.radarrKey },
              params: { removeFromClient: true, blocklist: true }
            });
            if (item.movieId) {
              await this._triggerRadarrSearch([item.movieId]);
            }
            actions.push({ source: 'radarr', title: item.title, action: 're-searched' });
          } catch (e) {
            console.warn(`[ArrService] Error reintentando Radarr #${item.id}:`, e.message);
          }
        }
      } catch (err) {
        console.warn('[ArrService] Error obteniendo cola de Radarr:', err.message);
      }
    }

    // 3. Revisar torrents colgados directamente en qBittorrent
    try {
      const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, { timeout: 4000 });
      const torrents = qbRes.data || [];
      const stalledQb = torrents.filter(t => 
        t.state === 'stalledDL' || 
        t.state === 'metaDL' || 
        t.state === 'error' || 
        (t.progress < 1 && t.dlspeed === 0 && t.num_seeds === 0 && t.state !== 'pausedDL')
      );

      if (stalledQb.length > 0) {
        const hashes = stalledQb.map(t => t.hash).join('|');
        const formData = `hashes=${encodeURIComponent(hashes)}`;
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/reannounce`, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000
        });
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/start`, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000
        });
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/setForceStart`, `${formData}&value=true`, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000
        });
        actions.push({ source: 'qbittorrent', count: stalledQb.length, action: 'reannounced_and_forced' });
      }
    } catch (err) {
      console.warn('[ArrService] Error reintentando torrents en qBittorrent:', err.message);
    }

    return actions;
  }

  async retryRequest(requestId) {
    const db = require('./db');
    const req = db.getRequestById(requestId);
    if (!req) throw new Error(`Solicitud "${requestId}" no encontrada`);

    if (req.mediaType === 'movie') {
      if (req.radarrId) {
        await this._triggerRadarrSearch([req.radarrId]);
        return { success: true, message: `Búsqueda automática reiniciada en Radarr para "${req.title}".` };
      }
    } else {
      if (req.sonarrId) {
        if (req.season) {
          await axios.post(`${this.sonarrUrl}/api/v3/command`, {
            name: 'SeasonSearch',
            seriesId: req.sonarrId,
            seasonNumber: parseInt(req.season, 10)
          }, {
            headers: { 'X-Api-Key': this.sonarrKey }
          });
          return { success: true, message: `Búsqueda de temporada ${req.season} reiniciada en Sonarr para "${req.title}".` };
        } else {
          await this._triggerSonarrSearch([req.sonarrId]);
          return { success: true, message: `Búsqueda de serie completa reiniciada en Sonarr para "${req.title}".` };
        }
      }
    }

    throw new Error('No se encontraron IDs de Radarr o Sonarr vinculados a esta solicitud');
  }

  // --- Restaurar y Descargar Episodios Faltantes ---

  async getMissingEpisodesSummary() {
    if (!this.sonarrKey) {
      return { ok: false, message: 'Sonarr no está configurado (falta SONARR_API_KEY)', series: [] };
    }

    try {
      const res = await axios.get(`${this.sonarrUrl}/api/v3/series`, {
        headers: { 'X-Api-Key': this.sonarrKey },
        timeout: 8000
      });

      const seriesList = [];
      let totalMissingCount = 0;

      for (const s of (res.data || [])) {
        const total = s.statistics?.totalEpisodeCount || 0;
        const files = s.statistics?.episodeFileCount || 0;
        const missing = Math.max(0, total - files);

        const seasonsWithMissing = (s.seasons || [])
          .filter(se => se.seasonNumber > 0 && se.monitored)
          .map(se => {
            const seTotal = se.statistics?.totalEpisodeCount || 0;
            const seFiles = se.statistics?.episodeFileCount || 0;
            const seMissing = Math.max(0, seTotal - seFiles);
            return {
              seasonNumber: se.seasonNumber,
              files: seFiles,
              total: seTotal,
              missing: seMissing,
              percent: seTotal > 0 ? Math.round((seFiles / seTotal) * 100) : 0
            };
          })
          .filter(se => se.missing > 0);

        if (seasonsWithMissing.length > 0 || missing > 0) {
          totalMissingCount += missing;
          seriesList.push({
            id: s.id,
            title: s.title,
            year: s.year,
            path: s.path,
            monitored: s.monitored,
            status: s.status,
            filesOnDisk: files,
            totalEpisodes: total,
            missingEpisodes: missing,
            percentComplete: total > 0 ? Math.round((files / total) * 100) : 0,
            seasons: seasonsWithMissing,
            images: s.images
          });
        }
      }

      return {
        ok: true,
        totalMissing: totalMissingCount,
        seriesCount: seriesList.length,
        series: seriesList
      };
    } catch (err) {
      console.warn('[Sonarr] Error obteniendo resumen de episodios faltantes:', err.message);
      return { ok: false, message: err.message, series: [] };
    }
  }

  async restoreAndDownloadMissing(options = {}) {
    const { seriesId, seasonNumber, action = 'all' } = options;
    const actionsTaken = [];

    // 1. Restaurar / Re-escanear archivos en disco y carpetas de descarga
    if (action === 'all' || action === 'rescan') {
      // 1.1 Escanear descargas pendientes en Sonarr
      try {
        await axios.post(`${this.sonarrUrl}/api/v3/command`, {
          name: 'DownloadedEpisodesScan'
        }, {
          headers: { 'X-Api-Key': this.sonarrKey },
          timeout: 6000
        });
        actionsTaken.push('Escaneo de descargas completadas iniciado en Sonarr');
      } catch (_) {}

      // 1.2 Re-escanear carpetas de series en disco
      try {
        const payload = { name: 'RescanSeries' };
        if (seriesId) payload.seriesId = parseInt(seriesId, 10);
        await axios.post(`${this.sonarrUrl}/api/v3/command`, payload, {
          headers: { 'X-Api-Key': this.sonarrKey },
          timeout: 6000
        });
        actionsTaken.push(`Re-escaneo de carpetas en disco ejecutado en Sonarr ${seriesId ? `(Serie #${seriesId})` : '(Todas las series)'}`);
      } catch (err) {
        console.warn('[Sonarr] Error en RescanSeries:', err.message);
      }

      // 1.3 Actualizar metadatos
      try {
        const refreshPayload = { name: 'RefreshSeries' };
        if (seriesId) refreshPayload.seriesId = parseInt(seriesId, 10);
        await axios.post(`${this.sonarrUrl}/api/v3/command`, refreshPayload, {
          headers: { 'X-Api-Key': this.sonarrKey },
          timeout: 6000
        });
        actionsTaken.push('Actualización de metadata y episodios ejecutada en Sonarr');
      } catch (_) {}

      // 1.4 Refrescar películas en Radarr que no reporten archivo
      if (!seriesId && this.radarrKey) {
        try {
          await axios.post(`${this.radarrUrl}/api/v3/command`, {
            name: 'RefreshMovie'
          }, {
            headers: { 'X-Api-Key': this.radarrKey },
            timeout: 6000
          });
          actionsTaken.push('Actualización y re-escaneo de películas en Radarr ejecutado');
        } catch (_) {}
      }
    }

    // 2. Buscar y descargar episodios faltantes
    if (action === 'all' || action === 'search') {
      try {
        if (seriesId && seasonNumber) {
          // Búsqueda de temporada puntual
          await axios.post(`${this.sonarrUrl}/api/v3/command`, {
            name: 'SeasonSearch',
            seriesId: parseInt(seriesId, 10),
            seasonNumber: parseInt(seasonNumber, 10)
          }, {
            headers: { 'X-Api-Key': this.sonarrKey },
            timeout: 6000
          });
          actionsTaken.push(`Búsqueda automática de Temporada ${seasonNumber} iniciada en Sonarr (Serie #${seriesId})`);
        } else if (seriesId) {
          // Búsqueda de episodios faltantes de esa serie
          await axios.post(`${this.sonarrUrl}/api/v3/command`, {
            name: 'MissingEpisodeSearch',
            seriesId: parseInt(seriesId, 10)
          }, {
            headers: { 'X-Api-Key': this.sonarrKey },
            timeout: 6000
          });
          actionsTaken.push(`Búsqueda automática de episodios faltantes iniciada en Sonarr (Serie #${seriesId})`);
        } else {
          // Búsqueda global de episodios faltantes
          await axios.post(`${this.sonarrUrl}/api/v3/command`, {
            name: 'MissingEpisodeSearch'
          }, {
            headers: { 'X-Api-Key': this.sonarrKey },
            timeout: 6000
          });
          actionsTaken.push('Búsqueda automática de todos los episodios faltantes iniciada en Sonarr');
        }
      } catch (err) {
        console.warn('[Sonarr] Error en MissingEpisodeSearch:', err.message);
      }
    }

    // 3. Forzar actualización de Plex para reflejar cualquier archivo restaurado
    try {
      await this.triggerPlexScan('show');
      actionsTaken.push('Bibliotecas de Plex notificadas para actualización');
    } catch (_) {}

    return {
      success: true,
      actions: actionsTaken,
      message: actionsTaken.join('. ')
    };
  }

  async triggerPlexScan(mediaType = null) {
    const token = config.plex.token;
    if (!token) return { ok: false, message: 'Falta PLEX_TOKEN' };

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
      return { ok: true, message: 'Biblioteca de Plex actualizada exitosamente' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async clearCompletedDownloads(deleteFiles = false) {
    try {
      const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, { timeout: 4000 });
      const completed = (qbRes.data || []).filter(t => {
        const isFinished = (t.progress >= 1) || ['uploading', 'pausedUP', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP'].includes(t.state);
        return isFinished;
      });

      if (completed.length === 0) {
        return { count: 0, titles: [], message: 'No hay descargas completadas en la cola.' };
      }

      const hashes = completed.map(t => t.hash).join('|');
      const formData = `hashes=${encodeURIComponent(hashes)}&deleteFiles=${deleteFiles ? 'true' : 'false'}`;
      await axios.post(`${config.qbittorrent.url}/api/v2/torrents/delete`, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000
      });

      return {
        count: completed.length,
        titles: completed.map(t => t.name),
        message: `Se eliminaron ${completed.length} descarga(s) completada(s) de la lista (${deleteFiles ? 'archivos borrados' : 'archivos conservados en disco'}).`
      };
    } catch (err) {
      console.error('[ArrService] Error en clearCompletedDownloads:', err.message);
      throw err;
    }
  }
}

module.exports = new ArrService();
