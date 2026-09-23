const axios = require('axios');
const config = require('./config');

class LLMNormalizer {
  constructor() {
    this.apiKey = config.gemini ? config.gemini.apiKey : (process.env.GEMINI_API_KEY || '');
    this.model = config.gemini ? config.gemini.model : (process.env.GEMINI_MODEL || 'gemini-flash-latest');
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  /**
   * Normaliza el mensaje del usuario extrayendo la intención y metadatos estructurados.
   * @param {string} rawText Texto crudo recibido en WhatsApp
   * @returns {Promise<{
   *   canonical_title: string,
   *   original_title: string,
   *   year: number|null,
   *   media_type: 'movie'|'tv',
   *   season: number|null,
   *   episode: number|null,
   *   search_keywords: string[],
   *   source: 'llm'|'fallback'
   * }>}
   */
  async normalize(rawText) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return this._fallbackParse('');
    }

    const trimmed = rawText.trim();

    // Si hay API Key disponible de Google AI Studio / Gemini, intentamos llamada al LLM
    const apiKey = this.apiKey || config.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const llmResult = await this._callGemini(trimmed, apiKey);
        if (llmResult) {
          return { ...llmResult, source: 'llm' };
        }
      } catch (err) {
        console.warn(`[LLMNormalizer] Fallo al consultar LLM (${err.message}). Activando fallback local.`);
      }
    }

    // Fallback heurístico resiliente si no hay API key o falló la llamada
    return { ...this._fallbackParse(trimmed), source: 'fallback' };
  }

  /**
   * Realiza la llamada a la API de Google Gemini en Google AI Studio
   */
  async _callGemini(rawText, apiKey) {
    const prompt = `Eres un asistente experto en cine, series y anime. Tu tarea es analizar la siguiente petición de un usuario de WhatsApp y normalizarla para poder buscarla en indexadores y trackers de torrents.
El usuario puede escribir con errores ortográficos, modismos coloquiales en español ("oye pon la de", "bájate", "quiero ver", "tienes la peli de"), nombres alternativos o traducciones no oficiales.

Petición del usuario: "${rawText.replace(/"/g, '\\"')}"

Debes devolver ESTRICTAMENTE un objeto JSON válido con este schema exacto, sin explicaciones ni texto adicional:
{
  "is_media_request": true o false (debe ser false si el usuario solo está saludando, conversando de ir al cine, o hablando de temas cotidianos sin pedir una película/serie/anime),
  "canonical_title": "Título oficial en inglés o internacional reconocido (o null si is_media_request es false)",
  "original_title": "Título original en su idioma de origen (ej: japonés para anime como 'Shingeki no Kyojin' o 'Shin Seiki Evangelion', o el mismo en inglés si es cine occidental)",
  "year": 2024 (número entero del año de estreno o null si no se conoce con certeza),
  "media_type": "movie" | "tv",
  "season": 1 (número entero de la temporada pedida, o null si es película o no se especifica),
  "episode": 1 (número entero del episodio pedido, o null si no se especifica),
  "search_keywords": ["término 1", "término 2"] (entre 2 y 4 términos óptimos y limpios para buscar en trackers de torrents, incluyendo título en inglés, original o con año)
}`;

    const url = `${this.apiUrl}/${this.model}:generateContent?key=${apiKey}`;

    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json'
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const candidate = response.data?.candidates?.[0];
    const textOutput = candidate?.content?.parts?.[0]?.text;

    if (!textOutput) return null;

    return this._safeParseJSON(textOutput, rawText);
  }

  /**
   * Parsea de manera segura el JSON devuelto por el LLM, eliminando markdown y corrigiendo anomalías.
   */
  _safeParseJSON(text, rawText = '') {
    if (!text) return null;

    let clean = text.trim();

    // Eliminar bloques de código markdown ```json ... ```
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    // Extraer únicamente el fragmento entre las llaves { ... }
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      clean = match[0];
    }

    // Corregir comas finales trailing commas antes de cerrar llaves o corchetes
    clean = clean.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(clean);
      return this._validateAndNormalizeSchema(parsed, rawText);
    } catch (err) {
      console.warn('[LLMNormalizer] Error parseando JSON de LLM:', err.message, '\nTexto:', clean);
      return null;
    }
  }

  /**
   * Valida y asegura los tipos del schema esperado
   */
  _validateAndNormalizeSchema(data, rawText = '') {
    if (!data || typeof data !== 'object') return null;

    const is_media_request = data.is_media_request !== false;
    if (!is_media_request && !data.canonical_title) {
      return {
        is_media_request: false,
        is_restore_missing: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    const canonical_title = String(data.canonical_title || '').trim();
    if (!canonical_title) {
      return {
        is_media_request: false,
        is_restore_missing: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    const isMissingRequest = rawText
      ? /(?:faltan\s+(?:cap[ií]tulos|episodios)|(?:cap[ií]tulos|episodios)\s+faltantes|restaura(?:r)?\s+(?:los\s+)?(?:episodios|cap[ií]tulos)|restaurar)/i.test(rawText)
      : false;

    const original_title = String(data.original_title || canonical_title).trim();
    const year = Number.isInteger(data.year) ? data.year : (parseInt(data.year, 10) || null);
    const media_type = (data.media_type === 'movie' || data.media_type === 'tv' || data.media_type === 'series')
      ? (data.media_type === 'series' ? 'tv' : data.media_type)
      : (data.season || data.episode ? 'tv' : 'movie');

    // season puede ser un número entero (ej: 2) o un string de rango (ej: "2-5", "2 a 5")
    let season = null;
    if (media_type !== 'movie') {
      if (Number.isInteger(data.season) && data.season > 0) {
        season = data.season;
      } else if (typeof data.season === 'string' && data.season.trim()) {
        const sTrim = data.season.trim();
        if (sTrim === 'all' || sTrim === 'todas') {
          season = 'all';
        } else {
          const m = sTrim.match(/(\d+)\s*(?:-|a|al|\.\.|to)\s*(\d+)/i);
          if (m) {
            season = `${m[1]}-${m[2]}`;
          } else {
            const num = parseInt(sTrim, 10);
            if (!isNaN(num) && num > 0) season = num;
          }
        }
      }
    }
    const episode = (media_type !== 'movie' && Number.isInteger(data.episode)) ? data.episode : ((media_type !== 'movie' && parseInt(data.episode, 10)) || null);

    let search_keywords = Array.isArray(data.search_keywords)
      ? data.search_keywords.map(k => String(k).trim()).filter(Boolean)
      : [];

    if (search_keywords.length === 0) {
      search_keywords = [canonical_title];
      if (original_title && original_title !== canonical_title) {
        search_keywords.push(original_title);
      }
      if (year) {
        search_keywords.push(`${canonical_title} ${year}`);
      }
    }

    return {
      is_media_request: true,
      is_restore_missing: Boolean(data.is_restore_missing || isMissingRequest),
      canonical_title,
      original_title,
      year: year && year > 1900 && year < 2100 ? year : null,
      media_type,
      season: season || null,
      episode: episode && episode > 0 ? episode : null,
      search_keywords: Array.from(new Set(search_keywords))
    };
  }

  /**
   * Analizador heurístico local para cuando no hay conexión con el LLM o no hay API Key configurada.
   */
  _fallbackParse(rawText) {
    let clean = (rawText || '').trim();
    if (!clean) {
      return {
        is_media_request: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    // 0. Detectar conversaciones casuales no relacionadas con descarga de películas o series
    const conversationalPatterns = [
      /^(?:hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|qu[eé] tal|c[oó]mo est[aá]s?|saludos)\b/i,
      /^(?:gracias|muchas gracias|vale|ok|okay|dale|de nada|chau|adi[oó]s|hasta luego)\b/i,
      /^(?:joya|buena|wena|listo|perfecto|genial|bac[aá]n|bkn|sipo|sip|nop|no|s[ií]|ya|claro|de acuerdo|xd|jaja(?:ja)*)\b/i,
      /^(?:eso\s+es\s+todo|no\s+tengo\s+m[aá]s|ya\s+est[aá]|te\s+parece|qu[eé]\s+onda|qu[eé]\s+pas[oó])\b/i,
      /\b(?:vamos al cine|ir al cine|en el cine|a qu[eé] hora|d[oó]nde est[aá]s|qu[eé] haces)\b/i
    ];

    const hasExplicitDownloadKeyword = /\b(?:b[aá]ja(?:te)?|desc[aá]rga(?:me)?|pon(?:\s+a\s+descargar)?|busca(?:me)?|b[uú]sca(?:me)?|!pedir|!ver|torrent)\b/i.test(clean);

    if (!hasExplicitDownloadKeyword && conversationalPatterns.some(p => p.test(clean))) {
      return {
        is_media_request: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    // 1. Extraer temporada o rango si está explícito (ej: "temporada 2", "temporadas 2-5", "temp 2 a 4", "s03", "season 4")
    let season = null;
    const rangeRegex = /(?:\b(?:temporadas|temporada|temps|temp|seasons|season|s)\s*(\d+)\s*(?:-|a|al|\.\.|to)\s*(\d+)\b)/i;
    const rangeMatch = clean.match(rangeRegex);
    if (rangeMatch) {
      season = `${rangeMatch[1]}-${rangeMatch[2]}`;
      clean = clean.replace(rangeMatch[0], ' ');
    } else {
      const seasonRegex = /(?:\b(?:temporada|temp|season|s)\s*(\d+)\b)/i;
      const sMatch = clean.match(seasonRegex);
      if (sMatch) {
        season = parseInt(sMatch[1], 10);
        clean = clean.replace(sMatch[0], ' ');
      }
    }

    // 2. Extraer episodio si está explícito (ej: "cap 1", "capítulo 3", "episodio 12", "e05", "ep 4")
    let episode = null;
    const epRegex = /(?:\b(?:capitulo|capítulo|cap|episodio|ep|e)\s*(\d+)\b)/i;
    const epMatch = clean.match(epRegex);
    if (epMatch) {
      episode = parseInt(epMatch[1], 10);
      clean = clean.replace(epMatch[0], ' ');
    }

    // 3. Extraer año si está explícito (ej: "2024", "1999")
    let year = null;
    const yearMatch = clean.match(/\b(19\d\d|20[0-2]\d)\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
      clean = clean.replace(yearMatch[0], ' ');
    }

    // 4. Limpiar modismos y prefijos coloquiales comunes
    const isMissingRequest = /(?:faltan\s+(?:cap[ií]tulos|episodios)|(?:cap[ií]tulos|episodios)\s+faltantes|restaura(?:r)?\s+(?:los\s+)?(?:episodios|cap[ií]tulos)|restaurar)/i.test(rawText);

    const prefixes = [
      /^(?:oye|hey|porfa|por\s+favor)?\s*(?:pon(?:\s+a\s+descargar)?|b[aá]ja(?:te)?|desc[aá]rga(?:me)?|b[uú]sca(?:me)?|quiero\s+ver|tienes|recomi[eé]ndame)(?:\s+(?:la|el|las|los|de|del|una|un|pel[ií]cula|serie|anime|peli|la\s+del|la\s+de|el\s+de))*\s+/i,
      /^(?:faltan\s+(?:cap[ií]tulos|episodios)\s+(?:de\s+)?|descarga(?:r)?\s+(?:los\s+)?(?:cap[ií]tulos|episodios)\s+faltantes\s+(?:de\s+)?|restaura(?:r)?\s+(?:los\s+)?(?:cap[ií]tulos|episodios)\s+(?:de\s+)?|restaurar\s+)/i,
      /^(?:la\s+pel[ií]cula|la\s+serie|la\s+peli|el\s+anime|anime|pelicula|película|serie)\s+(?:de\s+)?/i,
      /^!pedir\s+/i,
      /^!ver\s+/i
    ];

    let matchedPrefix = false;
    for (const rx of prefixes) {
      if (rx.test(clean)) {
        clean = clean.replace(rx, '');
        matchedPrefix = true;
      }
    }

    // Limpieza de signos
    clean = clean.replace(/^[¿¡:\-–\s]+/, '').replace(/[?.,!;:)\s]+$/, '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 2) {
      return {
        is_media_request: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    // 5. Diccionario de equivalencias para títulos de cultura pop / anime populares con modismos
    const knownMappings = {
      'joker 2': {
        canonical: 'Joker: Folie à Deux',
        original: 'Joker: Folie à Deux',
        year: 2024,
        type: 'movie',
        keywords: ['Joker Folie a Deux', 'Joker 2', 'Joker Folie a Deux 2024']
      },
      'shingeki no kyojin': {
        canonical: 'Attack on Titan',
        original: 'Shingeki no Kyojin',
        year: 2013,
        type: 'tv',
        keywords: ['Shingeki no Kyojin', 'Attack on Titan']
      },
      'shingeki': {
        canonical: 'Attack on Titan',
        original: 'Shingeki no Kyojin',
        year: 2013,
        type: 'tv',
        keywords: ['Shingeki no Kyojin', 'Attack on Titan']
      },
      'evangelion': {
        canonical: 'Neon Genesis Evangelion',
        original: 'Shin Seiki Evangelion',
        year: 1995,
        type: 'tv',
        keywords: ['Neon Genesis Evangelion', 'Shin Seiki Evangelion', 'Evangelion']
      },
      'gladiador 2': {
        canonical: 'Gladiator II',
        original: 'Gladiator II',
        year: 2024,
        type: 'movie',
        keywords: ['Gladiator II', 'Gladiator 2', 'Gladiator 2024']
      },
      'deadpool 3': {
        canonical: 'Deadpool & Wolverine',
        original: 'Deadpool & Wolverine',
        year: 2024,
        type: 'movie',
        keywords: ['Deadpool & Wolverine', 'Deadpool 3', 'Deadpool Wolverine']
      }
    };

    const lowerClean = clean.toLowerCase();
    const mapped = knownMappings[lowerClean];

    const hasMediaIntent = Boolean(
      mapped ||
      matchedPrefix ||
      hasExplicitDownloadKeyword ||
      season !== null ||
      episode !== null ||
      year !== null ||
      isMissingRequest ||
      /\b(?:pel[ií]cula|serie|temporada|episodio|cap[ií]tulo|anime)\b/i.test(rawText)
    );

    if (!hasMediaIntent) {
      return {
        is_media_request: false,
        canonical_title: null,
        original_title: null,
        year: null,
        media_type: 'movie',
        season: null,
        episode: null,
        search_keywords: []
      };
    }

    let canonical_title = mapped ? mapped.canonical : clean;
    let original_title = mapped ? mapped.original : clean;
    let inferredYear = year || (mapped ? mapped.year : null);
    let isTV = mapped
      ? (mapped.type === 'tv')
      : Boolean(season !== null || episode !== null || /\b(?:serie|anime|temporada|episodio|capitulo)\b/i.test(rawText));
    let media_type = isTV ? 'tv' : 'movie';

    // Generar keywords de búsqueda inteligentes
    let keywords = mapped ? [...mapped.keywords] : [clean];
    if (inferredYear && !keywords.some(k => k.includes(String(inferredYear)))) {
      keywords.push(`${clean} ${inferredYear}`);
    }
    if (season !== null && episode !== null) {
      const sPad = String(season).padStart(2, '0');
      const ePad = String(episode).padStart(2, '0');
      keywords.unshift(`${canonical_title} S${sPad}E${ePad}`);
      keywords.push(`${clean} S${sPad}E${ePad}`);
    } else if (episode !== null) {
      const ePad = String(episode).padStart(2, '0');
      keywords.unshift(`${canonical_title} E${ePad}`);
      keywords.push(`${clean} ${episode}`);
    } else if (season !== null) {
      keywords.unshift(`${canonical_title} Season ${season}`);
      keywords.push(`${clean} S${String(season).padStart(2, '0')}`);
    }

    return {
      is_media_request: true,
      is_restore_missing: isMissingRequest,
      canonical_title,
      original_title,
      year: inferredYear,
      media_type,
      season,
      episode,
      search_keywords: Array.from(new Set(keywords))
    };
  }
}

module.exports = new LLMNormalizer();
