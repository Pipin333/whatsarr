const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const db = require('./db');
const tmdb = require('./tmdb');
const arrService = require('./arr-service');
const llmNormalizer = require('./llm-normalizer');
const releaseScorer = require('./release-scorer');
const i18n = require('./i18n');

class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.connected = false;
    this.reconnectAttempts = 0;
  }

  isConnected() {
    return this.connected;
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(config.paths.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`[WhatsApp] Usando Baileys v${version.join('.')} (Última versión: ${isLatest})`);

    this.sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false // Manejaremos el QR manualmente para formatearlo bien
    });

    // Guardar credenciales al actualizarse
    this.sock.ev.on('creds.update', saveCreds);

    // Eventos de conexión
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n======================================================');
        console.log('📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP EN TU TELÉFONO:');
        console.log('(Abre WhatsApp -> Dispositivos Vinculados -> Vincular dispositivo)');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.connected = false;
        console.log(`[WhatsApp] Conexión cerrada. Código: ${statusCode}. ¿Reconectar?: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => this.start(), 3000);
        } else {
          console.log('[WhatsApp] Sesión cerrada permanentemente. Borra la carpeta data/auth_info_baileys para volver a escanear.');
        }
      } else if (connection === 'open') {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('\n======================================================');
        console.log('🎉 ¡WHATSAPP CONECTADO EXITOSAMENTE!');
        console.log('El bot está listo para recibir pedidos de películas y series.');
        console.log('======================================================\n');
      }
    });

    // Eventos de mensajes entrantes
    this.sock.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          await this._processIncomingMessage(msg);
        }
      } catch (err) {
        console.error('[WhatsApp] Error procesando mensaje:', err);
      }
    });
  }

  async _processIncomingMessage(msg) {
    if (!msg.message) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    const remoteJid = msg.key.remoteJid; // JID del chat (grupo o privado)
    const senderJid = msg.key.participant || remoteJid; // Quien envió el mensaje en un grupo
    const fromMe = msg.key.fromMe;

    // 0. Prohibir interacción en grupos de WhatsApp (@g.us)
    // El bot opera exclusivamente en chats privados 1 a 1 para proteger la privacidad del usuario
    if (remoteJid.endsWith('@g.us') || remoteJid.includes('@temp')) {
      return;
    }

    // 0.1 Control de mensajes propios (fromMe: true)
    // Si el usuario escribe desde su propio WhatsApp hacia otra persona, NO responder a menos que
    // sea un comando explícito con prefijo "!" (ej: !pedir, !ver) o sea su propio chat personal ("Note to self").
    if (fromMe) {
      const botNumber = (this.sock?.user?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const botLid = (this.sock?.user?.lid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      const remoteClean = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const isSelfChat = Boolean(
        (botNumber && remoteClean && (botNumber === remoteClean || remoteClean.endsWith(botNumber) || botNumber.endsWith(remoteClean))) ||
        (botLid && remoteClean && botLid === remoteClean)
      );

      if (!isSelfChat) {
        const textPreview = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          ''
        ).trim();
        if (!textPreview.startsWith('!')) {
          return;
        }
      }
    }

    // 0.2 Control de acceso: Verificar si el remitente está autorizado en la Whitelist
    if (!this._isSenderAllowed(senderJid, fromMe)) {
      // Ignorar en absoluto silencio para no interrumpir conversaciones ni alertar contactos no autorizados
      return;
    }

    // Extraer texto
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      ''
    ).trim();

    if (!text) return;

    // 1. Comprobar si el usuario tiene una sesión interactiva pendiente
    const session = db.getSession(senderJid);
    if (session) {
      if (session.state === 'AWAITING_SEASON') {
        const handled = await this._handleSeasonSelection(remoteJid, senderJid, text, session);
        if (handled) return;
      } else if (session.state === 'AWAITING_LANGUAGE') {
        const handled = await this._handleLanguageSelection(remoteJid, senderJid, text, session);
        if (handled) return;
      }
    }

    // 1.1 Comprobar comandos directos de gestión de descargas (ES / EN)
    if (/(?:limpiar|borrar|quitar|eliminar)\s+(?:las\s+)?descargas\s+completadas|(?:limpiar|borrar|quitar)\s+completadas|clear\s+(?:completed\s+)?downloads/i.test(text)) {
      try {
        const result = await arrService.clearCompletedDownloads(false);
        if (result.count > 0) {
          let items = result.titles.slice(0, 5).map(t => `• ${t}`).join('\n');
          if (result.titles.length > 5) items += `\n_...and ${result.titles.length - 5} more_`;
          const reply = `${i18n.t('clean_completed_title')}\n\n${i18n.t('clean_completed_count', { count: result.count, items })}`;
          await this.sendMessage(remoteJid, reply);
        } else {
          await this.sendMessage(remoteJid, i18n.t('clean_completed_none'));
        }
        return;
      } catch (err) {
        await this.sendMessage(remoteJid, i18n.t('clean_completed_error', { error: err.message }));
        return;
      }
    }

    // 2. Normalización de intención con LLM (Fase 1)
    const intent = await llmNormalizer.normalize(text);
    if (intent && intent.is_media_request) {
      if (intent.is_restore_missing) {
        await this._handleRestoreMissingRequest(remoteJid, senderJid, intent);
      } else if (intent.canonical_title) {
        await this._handleSearchRequest(remoteJid, senderJid, intent);
      }
    }
  }

  _isSenderAllowed(senderJid, fromMe) {
    // Si el mensaje fue enviado desde la propia cuenta del bot, siempre está autorizado
    if (fromMe) return true;

    const botJid = this.sock?.user?.id?.split('@')[0]?.split(':')[0] || '';
    const botLid = this.sock?.user?.lid?.split('@')[0]?.split(':')[0] || '';
    const senderClean = (senderJid || '').split('@')[0]?.split(':')[0]?.replace(/\D/g, '');

    // Comprobar si coincide con el número o identificador del bot vinculado
    if (botJid && senderClean && (senderClean === botJid.replace(/\D/g, '') || senderClean.endsWith(botJid.replace(/\D/g, '')))) {
      return true;
    }
    if (botLid && senderClean && senderClean === botLid.replace(/\D/g, '')) {
      return true;
    }

    // Si la whitelist está vacía o no tiene números, opera en modo abierto
    if (!config.allowedNumbers || config.allowedNumbers.length === 0) {
      return true;
    }

    // Comprobar coincidencia con los números de la whitelist
    return config.allowedNumbers.some(allowed => {
      if (senderClean === allowed) return true;
      if (senderClean.length >= 8 && allowed.length >= 8) {
        if (senderClean.endsWith(allowed) || allowed.endsWith(senderClean)) return true;
      }
      return false;
    });
  }

  _extractQuery(text, fromMe, remoteJid) {
    const trimmed = text.trim();
    const isPrivateChat = !remoteJid.endsWith('@g.us');

    // Extraer indicación explícita de temporada (ej: "temporada 4", "temp 2", "s3")
    let targetSeason = null;
    let queryWithoutSeason = trimmed;
    const seasonRegex = /(?:\s+|^)(?:temporada|temp|season|s)\s*(\d+)(?:\s+|$)/iu;
    const sMatch = trimmed.match(seasonRegex);
    if (sMatch) {
      targetSeason = parseInt(sMatch[1], 10);
      queryWithoutSeason = trimmed.replace(sMatch[0], ' ').trim();
    }
    const lower = queryWithoutSeason.toLowerCase();

    // 1. Expresiones naturales directas ("descárgame X", "puedes bajar X", "búscame X", "tienes la película X")
    const naturalPatterns = [
      /^(?:puedes\s+(?:descargar|bajar|poner)|desc[aá]rga(?:me)?|b[uú]sca(?:me)?|pon a descargar)\s+(.+)$/iu,
      /^(?:tienes\s+(?:la\s+pel[ií]cula|la\s+serie|la\s+peli)\s+)(.+)$/iu
    ];

    for (const pattern of naturalPatterns) {
      const match = queryWithoutSeason.match(pattern);
      if (match && match[1]) {
        const clean = match[1].replace(/^[¿¡:\-–\s]+/, '').replace(/[?.,!;:)\s]+$/, '').trim();
        if (clean.length >= 2) return { query: clean, targetSeason };
      }
    }

    // 2. Comprobar palabras clave de activación (ej: "quiero ver", "!pedir", "!ver", "descargar")
    for (const keyword of config.triggerKeywords) {
      if (lower.startsWith(keyword)) {
        let query = queryWithoutSeason.substring(keyword.length).trim();
        query = query.replace(/^[¿¡:\-–\s]+/, '').replace(/[?.,!;:)\s]+$/, '').trim();

        // FILTRO GRAMATICAL ANTI-FALSOS POSITIVOS:
        // Si tras "quiero ver" viene una conjunción subordinada o frase cotidiana, se descarta.
        const conversationalFilters = [
          /^(?:si|que|qué|como|cómo|cuando|cuándo|donde|dónde|a\s+ver)(?:[\s.,!?;:]|$)/iu,
          /^(?:un\s+rato|si\s+nos|si\s+se|si\s+hay|si\s+es|si\s+me|si\s+te)(?:[\s.,!?;:]|$)/iu,
          /^(?:una?\s+(?:peli|pelicula|película)?\s*(?:al|en el)\s+cine)/iu,
          /^(?:cine)(?:[\s.,!?;:]|$)/iu
        ];

        if (conversationalFilters.some(regex => regex.test(query))) {
          return null;
        }

        if (query.length >= 2) {
          return { query, targetSeason };
        }
      }
    }

    // 3. En chats privados directos, permitir "película X" o "serie X" si no proviene del bot
    if (isPrivateChat && !fromMe) {
      const directMatch = queryWithoutSeason.match(/^(?:pel[ií]cula|serie)\s+([a-zA-Z0-9\s:._\-]{2,50})$/iu);
      if (directMatch) {
        const clean = directMatch[1].replace(/^[¿¡:\-–\s]+/, '').replace(/[?.,!;:)\s]+$/, '').trim();
        return { query: clean, targetSeason };
      }
    }

    return null;
  }

  async _handleSearchRequest(remoteJid, senderJid, intentOrQuery, optionalSeason = null) {
    let intent = null;
    if (typeof intentOrQuery === 'string') {
      intent = await llmNormalizer.normalize(intentOrQuery);
      if (optionalSeason && !intent.season) {
        intent.season = optionalSeason;
      }
    } else {
      intent = intentOrQuery;
    }

    const query = intent.canonical_title || intent.original_title;
    const targetSeason = intent.season || null;
    const targetEpisode = intent.episode || null;

    console.log(`[WhatsApp] Solicitud recibida: "${query}" (Año: ${intent.year || 'N/A'}, Temp: ${targetSeason || 'N/A'}, Ep: ${targetEpisode || 'N/A'}, Fuente: ${intent.source || 'normalizer'}) de ${senderJid}`);

    // Indicar que está escribiendo
    await this.sock.sendPresenceUpdate('composing', remoteJid);

    // 1. Buscar metadatos en TMDB / MediaSearchService
    let results = await tmdb.search(query);
    if ((!results || results.length === 0) && intent.original_title && intent.original_title !== query) {
      results = await tmdb.search(intent.original_title);
    }
    if ((!results || results.length === 0) && intent.search_keywords && intent.search_keywords.length > 0) {
      for (const kw of intent.search_keywords) {
        results = await tmdb.search(kw);
        if (results && results.length > 0) break;
      }
    }

    if (!results || results.length === 0) {
      await this.sendMessage(remoteJid, i18n.t('no_results', { query }));
      return;
    }

    const media = results[0]; // Seleccionar el resultado más relevante
    const yearLabel = media.year ? ` (${media.year})` : '';

    // 2. Comprobar si el contenido ya existe en Radarr o Sonarr antes de pedir idioma
    try {
      if (media.type === 'movie') {
        const status = await arrService.checkMovieStatus(media);
        if (status.exists) {
          if (status.hasFile) {
            const msg = i18n.t('already_in_plex', { title: media.title, year: media.year || '' });
            if (media.posterUrl) {
              await this.sendImage(remoteJid, media.posterUrl, msg);
            } else {
              await this.sendMessage(remoteJid, msg);
            }
            return;
          } else {
            await this.sendMessage(remoteJid, i18n.t('already_downloading', { title: media.title }));
            return;
          }
        }
      } else if (media.type === 'series' || media.type === 'tv') {
        const status = await arrService.checkSeriesStatus(media);
        if (status.exists && status.hasFile && !targetSeason && !targetEpisode) {
          const msg = i18n.t('already_in_plex', { title: media.title, year: media.year || '' });
          if (media.posterUrl) {
            await this.sendImage(remoteJid, media.posterUrl, msg);
          } else {
            await this.sendMessage(remoteJid, msg);
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[WhatsApp] Error al verificar estado existente de media:', err.message);
    }

    // 3. FASE 2: Búsqueda en indexadores (Prowlarr) y Scoring de Releases (Fuzzball)
    let bestRelease = null;
    try {
      const keywords = intent.search_keywords && intent.search_keywords.length > 0
        ? intent.search_keywords
        : [media.title, `${media.title} ${media.year || ''}`];
      
      const torrents = await arrService.searchProwlarr(keywords);
      if (torrents && torrents.length > 0) {
        bestRelease = releaseScorer.selectBestRelease(torrents, intent, 70);
      }
    } catch (err) {
      console.warn('[WhatsApp] Error consultando Prowlarr/Fuzzball:', err.message);
    }

    const isEN = i18n.getLanguage() === 'en';
    const typeLabel = media.type === 'movie' ? (isEN ? 'Movie 🎬' : 'Película 🎬') : (isEN ? 'TV Series 📺' : 'Serie 📺');
    const ratingLabel = media.voteAverage ? `⭐ ${i18n.t('rating')}: *${media.voteAverage}/10*\n` : '';
    const overview = media.overview ? `📖 ${media.overview.slice(0, 220)}${media.overview.length > 220 ? '...' : ''}\n` : '';

    let releaseSnippet = '';
    if (bestRelease) {
      const sizeGB = (bestRelease.release.size / (1024 * 1024 * 1024)).toFixed(1);
      const seeds = bestRelease.release.seeders || 0;
      releaseSnippet = `🎯 *${isEN ? 'Optimal Release Found' : 'Release óptimo encontrado'} (${bestRelease.score}/100)*:\n📦 _${bestRelease.release.title}_\n💾 ${sizeGB} GB | 🌱 ${seeds} ${isEN ? 'seeds' : 'semillas'}\n\n`;
    }

    // Si es una serie y no se especificó temporada ni episodio, preguntar qué temporada desea
    if ((media.type === 'series' || media.type === 'tv') && !targetSeason && !targetEpisode) {
      const seasons = await arrService.getSeriesSeasons(media);
      if (seasons.length > 1) {
        db.setSession(senderJid, {
          state: 'AWAITING_SEASON',
          media,
          availableSeasons: seasons,
          bestRelease,
          intent,
          chatJid: remoteJid
        });

        const seasonGuide = i18n.t('season_prompt', {
          title: media.title,
          totalSeasons: seasons.length
        });

        const seasonCaption = [
          `*${media.title}${yearLabel}* [${typeLabel}]`,
          ratingLabel,
          releaseSnippet,
          overview,
          seasonGuide
        ].filter(Boolean).join('\n');

        if (media.posterUrl) {
          await this.sendImage(remoteJid, media.posterUrl, seasonCaption);
        } else {
          await this.sendMessage(remoteJid, seasonCaption);
        }
        return;
      }
    }

    // Para películas o series con temporada o episodio ya definido: pasar a selección de idioma
    const selectedSeason = targetSeason || 'all';
    let epLabel = '';
    if (targetEpisode) {
      epLabel = targetSeason ? ` (T${targetSeason}E${targetEpisode})` : ` (Episodio ${targetEpisode})`;
    } else if (targetSeason) {
      const parsed = arrService.parseSeasonSelection(targetSeason);
      epLabel = ` (${arrService.formatSeasonLabel(parsed)})`;
    }

    db.setSession(senderJid, {
      state: 'AWAITING_LANGUAGE',
      media,
      selectedSeason,
      targetEpisode,
      bestRelease,
      intent,
      chatJid: remoteJid
    });

    const caption = [
      `*${media.title}${yearLabel}${epLabel}* [${typeLabel}]`,
      ratingLabel,
      releaseSnippet,
      overview,
      i18n.t('choose_language')
    ].filter(Boolean).join('\n');

    if (media.posterUrl) {
      await this.sendImage(remoteJid, media.posterUrl, caption);
    } else {
      await this.sendMessage(remoteJid, caption);
    }
  }

  async _handleRestoreMissingRequest(remoteJid, senderJid, intent) {
    const title = intent.canonical_title || intent.original_title || '';
    console.log(`[WhatsApp] Solicitud de restaurar/descargar episodios faltantes: "${title}" de ${senderJid}`);
    await this.sock.sendPresenceUpdate('composing', remoteJid);

    try {
      const summary = await arrService.getMissingEpisodesSummary();
      if (!summary.ok) {
        await this.sendMessage(remoteJid, `⚠️ Sonarr no se encuentra disponible en este momento: ${summary.message}`);
        return;
      }

      let targetSeries = null;
      if (title) {
        const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        targetSeries = (summary.series || []).find(s => {
          const sNorm = s.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          return sNorm.includes(normTitle) || normTitle.includes(sNorm);
        });
      }

      if (title && !targetSeries) {
        const seriesNames = (summary.series || []).map(s => s.title).join(', ');
        await this.sendMessage(
          remoteJid,
          `ℹ️ No se detectaron episodios faltantes para "*${title}*" o la serie no está en Sonarr.\n\n${summary.seriesCount > 0 ? `Series con faltantes actuales: ${seriesNames}` : '¡Todas tus series están completas en disco!'}`
        );
        return;
      }

      const seriesId = targetSeries ? targetSeries.id : null;
      const seasonNumber = intent.season || null;

      await this.sendMessage(
        remoteJid,
        `⏳ Iniciando restauración y búsqueda de episodios faltantes para *${targetSeries ? targetSeries.title : 'todas las series'}*...\n\nRe-escaneando archivos en disco y consultando indexadores en Sonarr.`
      );

      const result = await arrService.restoreAndDownloadMissing({ seriesId, seasonNumber, action: 'all' });

      await this.sendMessage(
        remoteJid,
        `✅ *¡Restauración y búsqueda iniciada con éxito!*\n\n${result.message}\n\n🍿 Plex ha sido notificado para refrescar tus bibliotecas.`
      );
    } catch (err) {
      console.error('[WhatsApp] Error en restauración de faltantes:', err.message);
      await this.sendMessage(remoteJid, `⚠️ Ocurrió un error al procesar la restauración: ${err.message}`);
    }
  }

  async _handleSeasonSelection(remoteJid, senderJid, text, session) {
    const cleanText = text.trim().toLowerCase();
    const media = session.media;
    const seasons = session.availableSeasons || [];

    if (cleanText === '0' || cleanText.includes('cancel') || cleanText.includes('no es')) {
      db.clearSession(senderJid);
      await this.sendMessage(remoteJid, i18n.t('request_cancelled'));
      return true;
    }

    let selectedSeason = null;
    let selectedSeasonLabel = '';

    const firstSeason = seasons.length > 0 ? seasons[0].seasonNumber : 1;
    const lastSeason = seasons.length > 0 ? seasons[seasons.length - 1].seasonNumber : 1;

    // 1. Si el usuario escribe "todas", "toda", "all", "completa", "serie completa"
    if (/^(?:todas?|all|completa|serie completa)$/i.test(cleanText) || cleanText.includes('toda') || cleanText.includes('complet')) {
      selectedSeason = 'all';
      selectedSeasonLabel = i18n.t('all_seasons');
    } else {
      // 2. Parsear el número o rango de temporadas (ej: "3", "2-5", "1, 3")
      const parsedSeasons = arrService.parseSeasonSelection(cleanText);
      if (parsedSeasons && parsedSeasons.length > 0) {
        selectedSeason = parsedSeasons.length === 1 ? parsedSeasons[0] : `${parsedSeasons[0]}-${parsedSeasons[parsedSeasons.length - 1]}`;
        selectedSeasonLabel = arrService.formatSeasonLabel(parsedSeasons);
      }
    }

    if (!selectedSeason) {
      await this.sendMessage(remoteJid, i18n.t('invalid_season'));
      return true;
    }

    // Transicionar sesión para esperar el idioma
    db.setSession(senderJid, {
      ...session,
      state: 'AWAITING_LANGUAGE',
      selectedSeason,
      selectedSeasonLabel
    });

    const caption = [
      `✅ *${media.title}* - *${selectedSeasonLabel}*`,
      i18n.t('choose_language')
    ].join('\n\n');

    await this.sendMessage(remoteJid, caption);
    return true;
  }

  async _handleLanguageSelection(remoteJid, senderJid, text, session) {
    const cleanText = text.trim().toLowerCase();
    const media = session.media;
    const selectedSeason = session.selectedSeason || 'all';
    const seasonLabel = session.selectedSeasonLabel ? ` (${session.selectedSeasonLabel})` : (selectedSeason && selectedSeason !== 'all' ? ` (Temporada ${selectedSeason})` : '');

    if (cleanText === '0' || cleanText.includes('cancel') || cleanText.includes('no es')) {
      db.clearSession(senderJid);
      await this.sendMessage(remoteJid, i18n.t('request_cancelled'));
      return true;
    }

    let languageChoice = null;
    let languageLabel = '';

    const isEN = i18n.getLanguage() === 'en';
    if (isEN) {
      if (cleanText === '1' || cleanText.includes('english') || cleanText.includes('original')) {
        languageChoice = 'subtitulado';
        languageLabel = i18n.t('lang_original');
      } else if (cleanText === '2' || cleanText.includes('latino')) {
        languageChoice = 'latino';
        languageLabel = i18n.t('lang_latino');
      } else if (cleanText === '3' || cleanText.includes('castellano') || cleanText.includes('spanish')) {
        languageChoice = 'castellano';
        languageLabel = i18n.t('lang_castellano');
      }
    } else {
      if (cleanText === '1' || cleanText.includes('latino')) {
        languageChoice = 'latino';
        languageLabel = i18n.t('lang_latino');
      } else if (cleanText === '2' || cleanText.includes('castellano') || cleanText.includes('españa')) {
        languageChoice = 'castellano';
        languageLabel = i18n.t('lang_castellano');
      } else if (cleanText === '3' || cleanText.includes('sub') || cleanText.includes('original') || cleanText.includes('ingles')) {
        languageChoice = 'subtitulado';
        languageLabel = i18n.t('lang_original');
      }
    }

    if (!languageChoice) {
      await this.sendMessage(remoteJid, i18n.t('invalid_option'));
      return true;
    }

    // Limpiar sesión y proceder a encolar
    db.clearSession(senderJid);

    if (media.type === 'movie') {
      await this.sendMessage(remoteJid, i18n.t('download_started', {
        title: media.title,
        language: languageLabel
      }));
    } else {
      await this.sendMessage(remoteJid, i18n.t('download_started_tv', {
        title: media.title,
        season: seasonLabel,
        language: languageLabel
      }));
    }

    try {
      let arrResult = null;
      if (media.type === 'movie') {
        arrResult = await arrService.addMovie(media, languageChoice);
      } else {
        arrResult = await arrService.addSeries(media, languageChoice, selectedSeason);
      }

      // Solo enviamos torrent directo a qBittorrent si:
      // 1. Es una película (media.type === 'movie')
      // 2. O si es un episodio individual puntual (session.targetEpisode !== null)
      // Para temporadas completas o series completas, Sonarr es el encargado exclusivo
      // de buscar los capítulos correspondientes para evitar descargas erróneas o duplicadas.
      const isMovie = media.type === 'movie';
      const isSingleEpisodeRequest = (media.type === 'tv' || media.type === 'series') && session.targetEpisode !== null;
      // Permitir también packs completos verificados de la temporada solicitada (score >= 80)
      const isVerifiedSeasonPack = (media.type === 'tv' || media.type === 'series') && session.bestRelease?.score >= 80;

      if ((isMovie || isSingleEpisodeRequest || isVerifiedSeasonPack) && session.bestRelease?.release?.downloadUrl && languageChoice === 'subtitulado') {
        try {
          await arrService.sendTorrentToClient(
            session.bestRelease.release.downloadUrl,
            media.type,
            session.bestRelease.release.title
          );
          console.log(`[WhatsApp] 🎯 Release óptimo enviado directamente a qBittorrent: "${session.bestRelease.release.title}"`);
        } catch (torrentErr) {
          console.warn('[WhatsApp] Advertencia enviando torrent directo a qBittorrent:', torrentErr.message);
        }
      }

      // Registrar en la base de datos de solicitudes
      const parsedSeasonLabel = session.selectedSeasonLabel || (selectedSeason && selectedSeason !== 'all' ? `Temporada ${selectedSeason}` : 'Todas las temporadas');
      db.addRequest({
        mediaType: media.type,
        title: media.title,
        year: media.year,
        season: parsedSeasonLabel,
        tmdbId: media.tmdbId,
        radarrId: arrResult?.radarrId,
        sonarrId: arrResult?.sonarrId,
        userJid: senderJid,
        chatJid: remoteJid,
        language: languageChoice,
        posterUrl: media.posterUrl,
        torrentTitle: session.bestRelease?.release?.title || null
      });

      console.log(`[WhatsApp] Orden enviada para ${media.title}${seasonLabel} (${languageChoice})`);
    } catch (err) {
      console.error(`[WhatsApp] Error al agregar a Radarr/Sonarr:`, err.message);
      await this.sendMessage(
        remoteJid,
        `⚠️ Nota: Hubo una advertencia al conectar con el gestor de descargas:\n_${err.message}_`
      );
    }

    return true;
  }

  async sendMessage(jid, text) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(jid, { text });
    } catch (err) {
      console.error(`[WhatsApp] Error enviando mensaje a ${jid}:`, err.message);
    }
  }

  async sendImage(jid, imageUrl, caption) {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: caption
      });
    } catch (err) {
      console.warn(`[WhatsApp] Error enviando imagen, enviando como texto:`, err.message);
      await this.sendMessage(jid, caption);
    }
  }
}

module.exports = new WhatsAppBot();
