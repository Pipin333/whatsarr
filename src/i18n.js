/**
 * Localization (i18n) Module
 * Supports English ('en') and Spanish ('es')
 */

const config = require('./config');

const translations = {
  en: {
    language_name: 'English',
    searching: '🔍 Searching...',
    no_results: '⚠️ No results found for "*{query}*". Please check the spelling and try again.',
    rating: 'Rating',
    genre: 'Genre',
    request_cancelled: '❌ Request cancelled.',
    invalid_option: '⚠️ Invalid option. Please reply with a valid number (e.g., 1, 2, 3 or 0 to cancel).',
    session_expired: '⏱️ The previous session has expired. Please send your request again.',
    
    // Language prompt
    choose_language: 'Which audio / language version would you like?\n\n1️⃣ Original Audio / English 🇺🇸\n2️⃣ Latin Spanish 🇲🇽\n3️⃣ Castilian Spanish 🇪🇸\n0️⃣ Cancel request\n\n_Reply with the number of your choice (1, 2, 3, or 0)_',
    lang_latino: 'Latin Spanish 🇲🇽',
    lang_castellano: 'Castilian Spanish 🇪🇸',
    lang_original: 'Original Audio / English 🇺🇸',
    
    // Season prompt
    season_prompt: '*{title}* has *{totalSeasons}* season(s).\n\nWhich season(s) would you like to download?\n• Type a number (e.g. *3*)\n• A range (e.g. *2-5*)\n• Or type *all* for the entire series.\n• Or *0* to cancel.',
    all_seasons: 'All seasons',
    single_season: 'Season {season}',
    season_range: 'Seasons {start} to {end}',
    invalid_season: '⚠️ Invalid season option. Please type a number (e.g. 1), a range (e.g. 2-5), or "all" (or 0 to cancel).',

    // Status notifications
    already_in_plex: '🍿 *{title}* ({year}) is already available on your Plex server!\nIt is downloaded and ready to watch.',
    already_downloading: '⏳ *{title}* has already been requested and is currently downloading.\nI will notify you as soon as it is finished!',
    download_started: '✅ Great! Searching and adding *{title}* in *{language}* to the download queue...\n\n⏳ I will message you here as soon as it is available on Plex.',
    download_started_tv: '✅ Great! Downloading *{title}* ({season}) in *{language}* with progressive streaming...\n\n🍿 I will message you as soon as Episode 1 is ready to play!',
    download_completed: '🍿 Your request is ready on Plex!\n\n🎬 *{title}* ({year}){extraInfo}\nEnjoy watching! 🎉',
    
    // Missing episodes restoration
    restore_missing_started: '🔄 Started restoration scan for missing episodes of *{title}* ({season}). I will notify you once downloaded.',
    restore_missing_not_found: '⚠️ Series *{title}* was not found in Sonarr or has no missing episodes registered.',
    restore_missing_error: '⚠️ Error while trying to restore missing episodes: {error}',

    // Queue cleanup
    clean_completed_title: '🧹 *Cleaned Completed Downloads*',
    clean_completed_count: 'Removed *{count}* completed download(s) from qBittorrent queue:\n{items}\n💾 *Note:* Video files remain safely preserved on your disk.',
    clean_completed_none: 'There are no completed downloads in the qBittorrent queue.',
    clean_completed_error: '⚠️ Error cleaning completed downloads: {error}'
  },

  es: {
    language_name: 'Español',
    searching: '🔍 Buscando...',
    no_results: '⚠️ No encontré resultados para "*{query}*". Por favor revisa el nombre e intenta de nuevo.',
    rating: 'Calificación',
    genre: 'Género',
    request_cancelled: '❌ Petición cancelada.',
    invalid_option: '⚠️ Opción no válida. Por favor responde con un número (ej: 1, 2, 3 o 0 para cancelar).',
    session_expired: '⏱️ La sesión anterior ha expirado. Por favor envía tu petición nuevamente.',

    // Language prompt
    choose_language: '¿En qué idioma prefieres verla?\n\n1️⃣ Español Latino 🇲🇽\n2️⃣ Castellano 🇪🇸\n3️⃣ Audio Original / Subtitulado 🇺🇸\n0️⃣ Cancelar petición\n\n_Responde con el número de tu opción (1, 2, 3 o 0)_',
    lang_latino: 'Español Latino 🇲🇽',
    lang_castellano: 'Castellano 🇪🇸',
    lang_original: 'Audio Original / Subtitulado 🇺🇸',

    // Season prompt
    season_prompt: '*{title}* tiene *{totalSeasons}* temporadas.\n\n¿Qué temporada(s) deseas descargar?\n• Escribe el número (ej: *3*)\n• Un rango (ej: *2-5*)\n• O escribe *todas* para la serie completa.\n• O *0* para cancelar.',
    all_seasons: 'Todas las temporadas',
    single_season: 'Temporada {season}',
    season_range: 'Temporadas {start} a {end}',
    invalid_season: '⚠️ Opción no válida. Por favor escribe un número de temporada (ej: 1), un rango (ej: 2-5) o "todas" (o 0 para cancelar).',

    // Status notifications
    already_in_plex: '🍿 ¡*{title}* ({year}) ya se encuentra en tu servidor Plex!\nYa está descargada y lista para ver.',
    already_downloading: '⏳ *{title}* ya fue solicitada y se encuentra actualmente descargándose.\n¡Te avisaré apenas termine!',
    download_started: '✅ ¡Excelente! Buscando y agregando en *{language}* a la cola de descarga...\n\n⏳ Te avisaré por aquí apenas esté disponible en Plex.',
    download_started_tv: '✅ ¡Excelente! Descargando *{title}* ({season}) en *{language}* con streaming progresivo...\n\n🍿 ¡Te avisaré en cuanto el Capítulo 1 esté listo para ver en Plex!',
    download_completed: '🍿 ¡Tu pedido ya está listo en Plex!\n\n🎬 *{title}* ({year}){extraInfo}\n¡A disfrutar! 🎉',

    // Missing episodes restoration
    restore_missing_started: '🔄 Restauración iniciada para los episodios faltantes de *{title}* ({season}). Te avisaré cuando se completen.',
    restore_missing_not_found: '⚠️ No se encontró la serie *{title}* en Sonarr o no tiene episodios faltantes registrados.',
    restore_missing_error: '⚠️ Error al intentar restaurar episodios faltantes: {error}',

    // Queue cleanup
    clean_completed_title: '🧹 *Limpieza de Descargas Completadas*',
    clean_completed_count: 'Se eliminaron *{count}* descarga(s) de la lista de qBittorrent:\n{items}\n💾 *Nota:* Los archivos de video se conservaron en tu disco duro.',
    clean_completed_none: 'No hay descargas completadas en la cola de qBittorrent.',
    clean_completed_error: '⚠️ Error al limpiar descargas completadas: {error}'
  }
};

class I18n {
  constructor() {
    this.defaultLang = (config.language || 'en').toLowerCase();
    if (!translations[this.defaultLang]) {
      this.defaultLang = 'en';
    }
  }

  getLanguage() {
    return (config.language || this.defaultLang || 'en').toLowerCase();
  }

  setLanguage(lang) {
    const l = (lang || '').toLowerCase();
    if (translations[l]) {
      config.language = l;
      return true;
    }
    return false;
  }

  getSupportedLanguages() {
    return Object.keys(translations).map(code => ({
      code,
      name: translations[code].language_name
    }));
  }

  t(key, params = {}, lang = null) {
    const targetLang = (lang || this.getLanguage()).toLowerCase();
    const dict = translations[targetLang] || translations.en;
    let template = dict[key] || translations.en[key] || key;

    for (const [k, v] of Object.entries(params)) {
      template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
    }

    return template;
  }
}

module.exports = new I18n();
