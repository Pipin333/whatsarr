const fuzzball = require('fuzzball');

class ReleaseScorer {
  constructor(options = {}) {
    this.minScoreThreshold = options.threshold || 75;
    this.maxMovieSize = options.maxMovieSize || 10 * 1024 * 1024 * 1024; // 10 GB
    this.maxEpisodeSize = options.maxEpisodeSize || 3.5 * 1024 * 1024 * 1024; // 3.5 GB
  }

  /**
   * Normaliza un string para comparación difusa eliminando signos de puntuación y separadores técnicos.
   * @param {string} str
   * @returns {string}
   */
  normalizeString(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[._\-+/[\](),:;!?'"¿¡~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extrae información estructurada de temporada y episodio desde el título de un release.
   * @param {string} rawTitle
   * @returns {{
   *   season: number|null,
   *   episode: number|null,
   *   seasonStart?: number,
   *   seasonEnd?: number,
   *   isSeasonRange: boolean,
   *   isSeasonPack: boolean,
   *   isSingleEpisode: boolean,
   *   isCompleteSeries: boolean
   * }}
   */
  parseReleaseSeasonAndEpisode(rawTitle) {
    if (!rawTitle) return { season: null, episode: null, isSeasonPack: false, isSingleEpisode: false, isCompleteSeries: false };

    const norm = String(rawTitle).trim();

    // 1. Detección de serie completa (All Seasons / Complete Series)
    if (/\b(?:complete\s*series|series\s*complete|all\s*seasons?|serie\s*completa|todas\s*las\s*temporadas)\b/i.test(norm)) {
      return { season: null, episode: null, isSeasonPack: true, isSingleEpisode: false, isCompleteSeries: true, isSeasonRange: false };
    }

    // 2. Rango de temporadas (ej: S01-S03, S01-03, Season 1-3, Seasons 1 to 5)
    const rangeMatch = norm.match(/\b(?:seasons?|temporadas?|temp|s)\s*0*(\d+)\s*(?:-|a|\.\.|to)\s*s?0*(\d+)\b/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      return {
        season: Math.min(start, end),
        seasonStart: Math.min(start, end),
        seasonEnd: Math.max(start, end),
        episode: null,
        isSeasonRange: true,
        isSeasonPack: true,
        isSingleEpisode: false,
        isCompleteSeries: false
      };
    }

    // 3. Estándar de escena SxxExx o Sxx.Exx o xxXxx (ej: S29E04, S03E01, 3x01, 29x04)
    const seMatch = norm.match(/\bS0*(\d{1,2})[._\-\s]*E0*(\d{1,3})\b/i) ||
                    norm.match(/\b0*(\d{1,2})x0*(\d{1,3})\b/i);
    if (seMatch) {
      return {
        season: parseInt(seMatch[1], 10),
        episode: parseInt(seMatch[2], 10),
        isSeasonRange: false,
        isSeasonPack: false,
        isSingleEpisode: true,
        isCompleteSeries: false
      };
    }

    // 4. Temporada individual (ej: S03, Season 3, Temporada 3, S3, Temp 3)
    const sMatch = norm.match(/\b(?:season|temporada|temp)\s*0*(\d{1,2})\b/i) ||
                   norm.match(/\bS0*(\d{1,2})\b(?![._\-\s]*(?:E\d+|x\d+))/i);
    if (sMatch) {
      const epMatch = norm.match(/\b(?:ep|cap|episode|episodio|e)\s*0*(\d{1,3})\b/i);
      if (epMatch) {
        return {
          season: parseInt(sMatch[1], 10),
          episode: parseInt(epMatch[1], 10),
          isSeasonRange: false,
          isSeasonPack: false,
          isSingleEpisode: true,
          isCompleteSeries: false
        };
      }
      return {
        season: parseInt(sMatch[1], 10),
        episode: null,
        isSeasonRange: false,
        isSeasonPack: true,
        isSingleEpisode: false,
        isCompleteSeries: false
      };
    }

    // 5. Episodio individual sin temporada explícita (ej: E04, Ep 04, Cap 4, - 04)
    const standaloneEp = norm.match(/\b(?:ep|cap|episode|episodio|e)0*(\d{1,3})\b/i) ||
                         norm.match(/(?:^|\s)-\s*0*(\d{1,3})(?:v\d+)?(?:\s|\[|\.|$)/i);
    if (standaloneEp) {
      return {
        season: null,
        episode: parseInt(standaloneEp[1], 10),
        isSeasonRange: false,
        isSeasonPack: false,
        isSingleEpisode: true,
        isCompleteSeries: false
      };
    }

    return {
      season: null,
      episode: null,
      isSeasonRange: false,
      isSeasonPack: false,
      isSingleEpisode: false,
      isCompleteSeries: false
    };
  }

  /**
   * Calcula el puntaje de similitud y calidad para un release frente a la intención estructurada.
   * @param {object} release Objeto de release con { title, size, seeders, downloadUrl, indexer, ... }
   * @param {object} intent Objeto de intención { canonical_title, original_title, year, media_type, season, episode, search_keywords }
   * @returns {{
   *   score: number,
   *   baseFuzzyScore: number,
   *   disqualified: boolean,
   *   reasons: string[],
   *   release: object
   * }}
   */
  calculateScore(release, intent) {
    const rawTitle = release.title || '';
    const normReleaseTitle = this.normalizeString(rawTitle);
    const size = release.size || 0;
    const seeders = release.seeders || 0;

    const reasons = [];
    let disqualified = false;

    // 1. FILTROS DE DESCARTE INMEDIATO: Calidades basura (CAM, TS, Telesync, Screener) y archivos no de video (Manga, OST, Artbook)
    const junkPatterns = /\b(?:cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|scr|screener|dvdscr|r5|artbook|art\s*book|manga|ost|soundtrack|flac|mp3|album|scans?|wallpaper|light\s*novel)\b/i;
    if (junkPatterns.test(rawTitle)) {
      return {
        score: -100,
        baseFuzzyScore: 0,
        disqualified: true,
        reasons: ['Descartado: Calidad indeseada (CAM/TS) o archivo no de video (Artbook/Manga/OST)'],
        release
      };
    }

    // 2. Control estricto de tamaño
    const isMovie = intent.media_type === 'movie';
    const isEpisode = intent.media_type === 'tv' && intent.episode !== null;

    if (isMovie) {
      if (size > 25 * 1024 * 1024 * 1024) {
        return {
          score: -100,
          baseFuzzyScore: 0,
          disqualified: true,
          reasons: ['Tamaño masivo excesivo para película (> 25 GB)'],
          release
        };
      }
      if (size > 0 && size < 350 * 1024 * 1024) {
        return {
          score: -100,
          baseFuzzyScore: 0,
          disqualified: true,
          reasons: ['Tamaño demasiado pequeño para una película (< 350 MB)'],
          release
        };
      }
    } else if (isEpisode) {
      if (size > 8 * 1024 * 1024 * 1024) {
        return {
          score: -100,
          baseFuzzyScore: 0,
          disqualified: true,
          reasons: ['Tamaño masivo excesivo para un solo episodio (> 8 GB)'],
          release
        };
      }
      if (size > 0 && size < 60 * 1024 * 1024) {
        return {
          score: -100,
          baseFuzzyScore: 0,
          disqualified: true,
          reasons: ['Tamaño demasiado pequeño para un episodio de video (< 60 MB)'],
          release
        };
      }
    }

    // 3. CÁLCULO DE SIMILITUD DIFUSA (Fuzzball)
    // Probamos token_set_ratio y partial_ratio contra los search_keywords y títulos
    const candidatesToMatch = [
      intent.canonical_title,
      intent.original_title,
      ...(intent.search_keywords || [])
    ].filter(Boolean);

    let maxTokenSet = 0;
    let maxPartial = 0;

    for (const cand of candidatesToMatch) {
      const normCand = this.normalizeString(cand);
      if (!normCand) continue;

      const tokenSet = fuzzball.token_set_ratio(normCand, normReleaseTitle);
      const partial = fuzzball.partial_ratio(normCand, normReleaseTitle);

      if (tokenSet > maxTokenSet) maxTokenSet = tokenSet;
      if (partial > maxPartial) maxPartial = partial;
    }

    // El puntaje base combina lo mejor de ambos algoritmos de conjunto
    // token_set_ratio es ideal cuando el release tiene metadatos extra
    // partial_ratio es ideal cuando el título está completamente contenido
    let score = Math.max(maxTokenSet, Math.round(maxPartial * 0.95));
    const baseFuzzyScore = score;
    reasons.push(`Puntaje difuso base: ${score}`);

    // 4. BONIFICACIONES Y PENALIZACIONES DE AÑO
    if (intent.year) {
      const yearStr = String(intent.year);
      const hasExactYear = rawTitle.includes(yearStr);

      if (hasExactYear) {
        score += 10;
        reasons.push(`Año exacto ${yearStr} (+10)`);
      } else {
        // Buscar si el release tiene otro año de 4 dígitos diferente
        const otherYearMatch = rawTitle.match(/\b(19\d\d|20[0-2]\d)\b/);
        if (otherYearMatch && otherYearMatch[1] !== yearStr) {
          score -= 35;
          reasons.push(`Año discordante ${otherYearMatch[1]} vs ${yearStr} (-35)`);
        }
      }
    }

    // 5. BONIFICACIONES Y PENALIZACIONES DE TEMPORADA Y EPISODIO
    if (intent.media_type === 'tv') {
      const relInfo = this.parseReleaseSeasonAndEpisode(rawTitle);

      // Determinar targetSeasons (puede ser número, array, rango ej: "2-5", o null/'all')
      let targetSeasons = null;
      if (intent.season !== null && intent.season !== undefined && intent.season !== 'all') {
        if (Array.isArray(intent.season)) {
          targetSeasons = intent.season.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
        } else if (typeof intent.season === 'number' && intent.season > 0) {
          targetSeasons = [intent.season];
        } else if (typeof intent.season === 'string') {
          const rm = intent.season.match(/(\d+)\s*(?:-|a|\.\.|to)\s*(\d+)/i);
          if (rm) {
            const start = parseInt(rm[1], 10);
            const end = parseInt(rm[2], 10);
            targetSeasons = [];
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              if (i > 0) targetSeasons.push(i);
            }
          } else {
            const num = parseInt(intent.season, 10);
            if (!isNaN(num) && num > 0) targetSeasons = [num];
          }
        }
      }

      // 5.1 Si el release tiene temporada detectada
      if (relInfo.season !== null) {
        if (targetSeasons && targetSeasons.length > 0) {
          if (relInfo.isSeasonRange) {
            // Verificar si hay solapamiento entre rangos
            const overlaps = targetSeasons.some(s => s >= relInfo.seasonStart && s <= relInfo.seasonEnd);
            if (!overlaps) {
              return {
                score: -100,
                baseFuzzyScore: 0,
                disqualified: true,
                reasons: [`Descartado: Rango de temporadas S${relInfo.seasonStart}-S${relInfo.seasonEnd} no coincide con temporada(s) solicitada(s) (${targetSeasons.join(',')})`],
                release
              };
            }
            score += 20;
            reasons.push(`Rango de temporadas S${relInfo.seasonStart}-S${relInfo.seasonEnd} coincidente (+20)`);
          } else {
            if (!targetSeasons.includes(relInfo.season)) {
              // TEMPORADA DISCORDANTE -> DESCARTE INMEDIATO
              return {
                score: -100,
                baseFuzzyScore: 0,
                disqualified: true,
                reasons: [`Descartado: Temporada discordante S${relInfo.season} vs temporada(s) solicitada(s) (${targetSeasons.join(',')})`],
                release
              };
            }
            score += 25;
            reasons.push(`Temporada ${relInfo.season} coincidente (+25)`);
          }
        } else {
          // No se pidió temporada específica (serie completa o general)
          if (relInfo.isSingleEpisode) {
            score -= 60;
            reasons.push(`Episodio individual suelto (S${relInfo.season}E${relInfo.episode}) para búsqueda general de serie (-60)`);
          } else if (relInfo.isCompleteSeries) {
            score += 25;
            reasons.push('Serie completa (All Seasons) (+25)');
          }
        }
      }

      // 5.2 Evaluación de Episodio
      if (intent.episode !== null && intent.episode !== undefined) {
        const targetEp = parseInt(intent.episode, 10);
        const epPad = String(targetEp).padStart(2, '0');

        if (relInfo.episode !== null) {
          if (relInfo.episode === targetEp) {
            score += 30;
            reasons.push(`Episodio exacto E${epPad} (+30)`);
          } else {
            return {
              score: -100,
              baseFuzzyScore: 0,
              disqualified: true,
              reasons: [`Descartado: Episodio discordante E${relInfo.episode} vs E${targetEp}`],
              release
            };
          }
        } else {
          score -= 40;
          reasons.push(`Sin indicación de episodio específico E${epPad} (-40)`);
        }
      } else {
        // El usuario NO pidió un episodio específico (quiere temporada completa o serie completa)
        if (relInfo.isSingleEpisode) {
          // Es un episodio suelto (ej: S03E04) cuando se pidió la temporada completa o la serie
          score -= 70;
          score = Math.min(score, 55);
          reasons.push(`Es solo 1 episodio suelto (E${relInfo.episode}) cuando se solicitó temporada o serie completa (-70, tope 55)`);
        } else if (relInfo.isSeasonPack) {
          score += 20;
          reasons.push('Pack de temporada completa (+20)');
        }
      }
    }

    // 6. PREFERENCIAS DE CALIDAD Y CÓDEC
    // Resolución 1080p
    if (/\b(?:1080p|1080i|fhd)\b/i.test(rawTitle)) {
      score += 15;
      reasons.push('Resolución 1080p (+15)');
    } else if (/\b(?:720p|hd)\b/i.test(rawTitle)) {
      score += 8;
      reasons.push('Resolución 720p (+8)');
    } else if (/\b(?:2160p|4k|uhd)\b/i.test(rawTitle)) {
      // 4K: Si supera el tamaño deseado, penalizar
      if (size > this.maxMovieSize) {
        score -= 40;
        reasons.push('4K con tamaño superior a límite (-40)');
      }
    }

    // Fuentes deseadas (WEB-DL, WEBRip, BluRay, BDRip)
    if (/\b(?:web-?dl|web-?rip|bluray|bdrip|brrip)\b/i.test(rawTitle)) {
      score += 10;
      reasons.push('Fuente Web/BluRay de alta calidad (+10)');
    }

    // Códecs eficientes (x264, x265, HEVC, AVC, 10bit)
    if (/\b(?:x264|h264|x265|hevc|h265|10bit)\b/i.test(rawTitle)) {
      score += 5;
      reasons.push('Códec estándar x264/x265 (+5)');
    }

    // 7. PENALIZACIÓN POR TAMAÑO EXCESIVO SEGÚN REGLA DEL USUARIO
    if (isMovie && size > this.maxMovieSize) {
      score -= 30;
      reasons.push(`Película excede límite de 10GB (${(size / 1073741824).toFixed(1)}GB) (-30)`);
    } else if (isEpisode && size > this.maxEpisodeSize) {
      score -= 30;
      reasons.push(`Episodio excede límite de 3.5GB (${(size / 1073741824).toFixed(1)}GB) (-30)`);
    }

    // 8. PONDERACIÓN POR SEMILLAS (SEEDERS)
    if (seeders >= 20) {
      score += 12;
      reasons.push(`Alta disponibilidad de semillas (${seeders} seeds) (+12)`);
    } else if (seeders >= 5) {
      score += 6;
      reasons.push(`Semillas activas (${seeders} seeds) (+6)`);
    } else if (seeders === 0) {
      score -= 30;
      reasons.push('Torrent sin semillas (0 seeds) (-30)');
    }

    let finalScore = Math.max(0, Math.min(100, Math.round(score)));
    // Si se solicitó una temporada completa o la serie completa, un episodio individual nunca debe superar el umbral
    if (intent.media_type === 'tv' && (intent.episode === null || intent.episode === undefined)) {
      const relInfo = this.parseReleaseSeasonAndEpisode(rawTitle);
      if (relInfo.isSingleEpisode) {
        finalScore = Math.min(finalScore, 45);
      }
    }

    return {
      score: finalScore,
      baseFuzzyScore,
      disqualified,
      reasons,
      release
    };
  }

  /**
   * Clasifica una lista de releases ordenados por puntaje decreciente.
   * @param {object[]} releases Lista de torrents
   * @param {object} intent Intención estructurada del LLM
   * @returns {object[]} Lista de releases con metadata de scoring ordenada
   */
  rankReleases(releases, intent) {
    if (!Array.isArray(releases) || releases.length === 0) return [];

    return releases
      .map(rel => this.calculateScore(rel, intent))
      .filter(item => !item.disqualified)
      .sort((a, b) => {
        // Orden principal por score
        if (b.score !== a.score) return b.score - a.score;
        // Desempate por semillas
        const seedsA = a.release.seeders || 0;
        const seedsB = b.release.seeders || 0;
        return seedsB - seedsA;
      });
  }

  /**
   * Selecciona el release óptimo que supere el umbral configurado.
   * @param {object[]} releases Lista de torrents
   * @param {object} intent Intención estructurada del LLM
   * @param {number} [threshold] Umbral mínimo opcional
   * @returns {object|null} Mejor release o null si ninguno califica
   */
  selectBestRelease(releases, intent, threshold = null) {
    const limit = threshold !== null ? threshold : this.minScoreThreshold;
    const ranked = this.rankReleases(releases, intent);

    if (ranked.length === 0) return null;

    const best = ranked[0];
    if (best.score >= limit) {
      return best;
    }

    return null;
  }
}

module.exports = new ReleaseScorer();
