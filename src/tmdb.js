const axios = require('axios');
const fuzz = require('fuzzball');
const config = require('./config');

function normalizeString(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateFuzzyScore(query, item) {
  const cleanQ = normalizeString(query);
  const qWords = cleanQ.split(' ').filter(Boolean).length;

  const candidates = [
    item.title,
    item.originalTitle,
    ...(item.alternateTitles || [])
  ].filter(Boolean);

  let bestScore = 0;
  for (const c of candidates) {
    const cleanC = normalizeString(c);
    if (!cleanC) continue;

    const tWords = cleanC.split(' ').filter(Boolean).length;
    const sortRatio = fuzz.token_sort_ratio(cleanQ, cleanC);
    const setRatio = fuzz.token_set_ratio(cleanQ, cleanC);
    const ratio = fuzz.ratio(cleanQ, cleanC);

    // Penalizar titulos con muchas palabras adicionales no presentes en la busqueda
    const wordDiffPenalty = Math.max(0, tWords - qWords) * 2;
    const score = Math.max(sortRatio, setRatio - wordDiffPenalty, ratio);

    if (score > bestScore) bestScore = score;
  }

  // Pequeño bono de desempate por popularidad o cantidad de votos
  const popBonus = item.popularity ? Math.min(Math.log10(item.popularity + 1) * 3, 10) : 0;
  return bestScore + popBonus;
}

class MediaSearchService {
  constructor() {
    this.apiKey = config.tmdb.apiKey;
    this.baseUrl = 'https://api.themoviedb.org/3';
    this.imageBaseUrl = 'https://image.tmdb.org/t/p/w500';
  }

  /**
   * Busca contenido utilizando busqueda concurrente y ordenamiento con Fuzzy Matching:
   * 1. Radarr / Sonarr lookup (titulos oficiales y alternativos en español/ingles)
   * 2. IMDb Suggestion Engine (posters en HD y metadatos sin API key)
   * 3. TMDB API oficial (si hay clave configurada)
   * 4. TVMaze para series complementarias
   * Luego combina todos los candidatos, calcula la similitud difusa (FuzzyWuzzy) y devuelve los mejores ordenados.
   */
  async search(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return [];

    const searchPromises = [];

    if (this.apiKey) {
      searchPromises.push(this._searchTmdb(trimmed));
    }

    searchPromises.push(this._searchRadarr(trimmed));
    searchPromises.push(this._searchSonarr(trimmed));
    searchPromises.push(this._searchImdb(trimmed));
    searchPromises.push(this._searchTvMaze(trimmed));

    const settled = await Promise.allSettled(searchPromises);
    const allCandidates = [];

    for (const res of settled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        allCandidates.push(...res.value);
      }
    }

    if (allCandidates.length === 0) return [];

    // Deduplicar candidatos por imdbId, tmdbId, tvdbId o titulo + año
    const uniqueMap = new Map();
    for (const item of allCandidates) {
      const key = item.imdbId || (item.tmdbId ? `tmdb_${item.tmdbId}` : null) || (item.tvdbId ? `tvdb_${item.tvdbId}` : null) || `${item.title.toLowerCase()}_${item.year}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      } else {
        const existing = uniqueMap.get(key);
        if (!existing.seasons && item.seasons) existing.seasons = item.seasons;
        if (!existing.seasonCount && item.seasonCount) existing.seasonCount = item.seasonCount;
        if (!existing.tvdbId && item.tvdbId) existing.tvdbId = item.tvdbId;
        if (!existing.tmdbId && item.tmdbId) existing.tmdbId = item.tmdbId;
        if (!existing.posterUrl && item.posterUrl) existing.posterUrl = item.posterUrl;
      }
    }
    const unique = Array.from(uniqueMap.values());

    // Calcular puntaje FuzzyWuzzy para cada candidato
    for (const item of unique) {
      item.fuzzyScore = calculateFuzzyScore(trimmed, item);
    }

    // Ordenar de mayor a menor relevancia
    unique.sort((a, b) => b.fuzzyScore - a.fuzzyScore);

    // Si el mejor puntaje es alto (>= 60), descartamos candidatos con muy baja coincidencia (< 45)
    const topScore = unique[0]?.fuzzyScore || 0;
    if (topScore >= 60) {
      return unique.filter(i => i.fuzzyScore >= 45);
    }
    return unique;
  }

  async _searchRadarr(query) {
    if (!config.radarr.apiKey) return [];
    try {
      const res = await axios.get(`${config.radarr.url}/api/v3/movie/lookup`, {
        params: { term: query },
        headers: { 'X-Api-Key': config.radarr.apiKey },
        timeout: 6000
      });
      if (!Array.isArray(res.data)) return [];
      return res.data.map(m => {
        const poster = (m.images || []).find(i => i.coverType === 'poster');
        return {
          type: 'movie',
          title: m.title,
          originalTitle: m.originalTitle || m.title,
          alternateTitles: (m.alternateTitles || []).map(a => a.title),
          year: m.year,
          overview: m.overview || '',
          voteAverage: m.ratings ? Math.round(m.ratings.value * 10) / 10 : null,
          popularity: m.popularity || 0,
          posterUrl: poster ? poster.remoteUrl || poster.url : null,
          tmdbId: m.tmdbId,
          imdbId: m.imdbId
        };
      });
    } catch (_) {
      return [];
    }
  }

  async _searchSonarr(query) {
    if (!config.sonarr.apiKey) return [];
    try {
      const res = await axios.get(`${config.sonarr.url}/api/v3/series/lookup`, {
        params: { term: query },
        headers: { 'X-Api-Key': config.sonarr.apiKey },
        timeout: 6000
      });
      if (!Array.isArray(res.data)) return [];
      return res.data.map(s => {
        const poster = (s.images || []).find(i => i.coverType === 'poster');
        const seasonsList = (s.seasons || [])
          .filter(x => x.seasonNumber > 0)
          .map(x => x.seasonNumber);
        return {
          type: 'tv',
          title: s.title,
          originalTitle: s.originalTitle || s.title,
          alternateTitles: (s.alternateTitles || []).map(a => a.title),
          year: s.year,
          overview: s.overview || '',
          voteAverage: s.ratings ? Math.round(s.ratings.value * 10) / 10 : null,
          popularity: s.ratings?.votes || 0,
          posterUrl: poster ? poster.remoteUrl || poster.url : null,
          tvdbId: s.tvdbId,
          imdbId: s.imdbId,
          seasons: seasonsList,
          seasonCount: s.seasonCount || seasonsList.length
        };
      });
    } catch (_) {
      return [];
    }
  }

  async _searchImdb(query) {
    try {
      const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const firstLetter = cleanQuery.charAt(0) || 'a';
      const url = `https://v3.sg.media-imdb.com/suggestion/${firstLetter}/${cleanQuery}.json`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 5000
      });
      if (!res.data || !Array.isArray(res.data.d)) return [];
      return res.data
        .filter(item => item.qid === 'movie' || item.qid === 'tvSeries' || item.qid === 'tvMiniSeries' || item.q === 'feature')
        .map(item => {
          const isMovie = item.qid === 'movie' || item.q === 'feature';
          return {
            type: isMovie ? 'movie' : 'tv',
            title: item.l,
            originalTitle: item.l,
            alternateTitles: [],
            year: item.y || null,
            overview: item.s ? `Protagonistas: ${item.s}` : '',
            voteAverage: null,
            popularity: 8,
            posterUrl: item.i ? item.i.imageUrl : null,
            imdbId: item.id,
            tmdbId: null
          };
        });
    } catch (_) {
      return [];
    }
  }

  async _searchTmdb(query) {
    try {
      const res = await axios.get(`${this.baseUrl}/search/multi`, {
        params: {
          api_key: this.apiKey,
          query,
          language: 'es-MX,es-ES,en-US',
          include_adult: false
        },
        timeout: 6000
      });

      return (res.data.results || [])
        .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
        .map(item => {
          const isMovie = item.media_type === 'movie' || !!item.title;
          const releaseDate = item.release_date || item.first_air_date || '';
          const year = releaseDate ? releaseDate.split('-')[0] : '';
          const posterPath = item.poster_path;

          return {
            type: isMovie ? 'movie' : 'tv',
            title: item.title || item.name || 'Sin título',
            originalTitle: item.original_title || item.original_name || '',
            alternateTitles: [],
            year: year ? parseInt(year, 10) : null,
            overview: item.overview || 'Sin descripción disponible.',
            voteAverage: item.vote_average ? Math.round(item.vote_average * 10) / 10 : null,
            popularity: item.popularity || 0,
            posterUrl: posterPath ? `${this.imageBaseUrl}${posterPath}` : null,
            tmdbId: item.id
          };
        });
    } catch (_) {
      return [];
    }
  }

  async _searchTvMaze(query) {
    try {
      const res = await axios.get(`https://api.tvmaze.com/search/shows`, {
        params: { q: query },
        timeout: 5000
      });
      if (!res.data || res.data.length === 0) return [];

      return res.data.map(entry => {
        const show = entry.show;
        return {
          type: 'tv',
          title: show.name,
          originalTitle: show.name,
          alternateTitles: [],
          year: show.premiered ? parseInt(show.premiered.split('-')[0], 10) : null,
          overview: show.summary ? show.summary.replace(/<[^>]*>?/gm, '') : '',
          voteAverage: show.rating && show.rating.average ? show.rating.average : null,
          popularity: 5,
          posterUrl: show.image ? show.image.original || show.image.medium : null,
          tvdbId: show.externals ? show.externals.thetvdb : null
        };
      });
    } catch (_) {
      return [];
    }
  }
}

module.exports = new MediaSearchService();
