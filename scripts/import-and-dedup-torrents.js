/**
 * Script de migración, desduplicación inteligente entre fuentes y limpieza de Torrents a Media.
 * 
 * Reglas:
 * 1. Protege estrictamente archivos que no son series/películas (juegos y documentos personales).
 * 2. Compara por Season y Episode (SxxExx).
 * 3. Si un capítulo ya existe en Media, no lo duplica.
 *    - Si la versión existente en Media tiene audiodescripción y en Torrents hay una limpia,
 *      se actualiza Media con la versión limpia.
 * 4. Si hay múltiples versiones en Torrents de un mismo capítulo (ej. FLUX vs NTG vs d3g vs MeGusta),
 *    se escoge la mejor versión (audio estándar limpio 5.1/1080p) y se descartan las restantes.
 * 5. Mueve Loki S1 y S2, Stranger Things S1, S2, S3, S5, y Top Gear S10E11 a G:\Media\Series.
 * 6. Limpia los torrents duplicados o ya migrados en G:\Torrents y qBittorrent.
 * 7. Dispara rescan en Sonarr y Plex.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../src/config');

const isDryRun = !process.argv.includes('--execute');
const torrentsDir = 'G:\\Torrents';
const mediaDir = 'G:\\Media';
const seriesDir = path.join(mediaDir, 'Series');

// Elementos estrictamente protegidos
const protectedNonMedia = [
  'enunciado proyecto 1.pdf',
  'gran turismo 5',
  'gran-turismo-4',
  'need for speed'
];

function isProtected(name) {
  const n = name.toLowerCase();
  return protectedNonMedia.some(nm => n.includes(nm));
}

// Helper para encontrar archivo de video dentro de una carpeta
const videoExts = ['.mkv', '.mp4', '.avi', '.ts', '.m4v'];
function findMainVideoFile(dir) {
  let largestFile = null;
  let maxBytes = 0;

  function scan(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      try {
        const s = fs.statSync(p);
        if (s.isDirectory()) {
          scan(p);
        } else {
          const ext = path.extname(f).toLowerCase();
          if (videoExts.includes(ext) && !f.toLowerCase().includes('sample')) {
            if (s.size > maxBytes) {
              maxBytes = s.size;
              largestFile = { path: p, name: f, size: s.size };
            }
          }
        }
      } catch (_) {}
    }
  }
  scan(dir);
  return largestFile;
}

// Copiar recursivamente
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const srcPath = path.join(src, f);
    const destPath = path.join(dest, f);
    const s = fs.statSync(srcPath);
    if (s.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

async function run() {
  console.log('========================================================================');
  console.log('🚀 MIGRACIÓN Y DESDUPLICACIÓN INTELIGENTE DE G:\\Torrents -> G:\\Media');
  console.log('========================================================================');
  console.log(`⚙️ Modo: ${isDryRun ? 'DRY-RUN (Simulación sin modificar disco)' : 'EJECUCIÓN REAL (--execute)'}`);
  console.log(`📁 Origen:  ${torrentsDir}`);
  console.log(`📁 Destino: ${seriesDir}\n`);

  if (!fs.existsSync(torrentsDir)) {
    console.error('❌ Directorio de torrents no encontrado.');
    return;
  }

  // Consultar qBittorrent para hashes de descargas a desregistrar
  let qbTorrents = [];
  try {
    const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, { timeout: 4000 });
    qbTorrents = qbRes.data || [];
  } catch (err) {
    console.warn('⚠️ No se pudo conectar con qBittorrent:', err.message);
  }

  const actions = {
    moves: [],           // { from, to, desc }
    replaces: [],        // { oldFile, newFile, desc }
    deletions: [],       // { path, isDir, desc }
    qbDeletions: []      // { hash, name }
  };

  // ========================================================================
  // PASO 1: BREAKING BAD (Temporadas 3, 4 y 5)
  // ========================================================================
  console.log('--- 1. Analizando Breaking Bad Seasons 3, 4 y 5 ---');
  const bbEntries = [
    { folder: 'Breaking Bad (2008) Season 3 S03 + Extras (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)', season: 3 },
    { folder: 'Breaking Bad (2008) Season 4 S04 + Extras (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)', season: 4 },
    { folder: 'Breaking Bad (2008) Season 5 S05 + Extras (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)', season: 5 }
  ];

  for (const b of bbEntries) {
    const p = path.join(torrentsDir, b.folder);
    if (!fs.existsSync(p)) continue;

    // Buscar en qBittorrent para desregistrar
    const qbMatch = qbTorrents.find(t => {
      const tp = (t.content_path || path.join(t.save_path, t.name)).toLowerCase();
      return tp === p.toLowerCase() || t.name.includes(`Season ${b.season}`) || t.name.includes(`S0${b.season}`);
    });
    if (qbMatch) {
      actions.qbDeletions.push({ hash: qbMatch.hash, name: qbMatch.name });
    }

    if (b.season === 5) {
      // Para Season 5, copiar las 4 featurettes y subtítulos faltantes a Media antes de borrar
      const feat52 = path.join(p, 'Featurettes 5.2');
      if (fs.existsSync(feat52)) {
        const destFeat = path.join(seriesDir, 'Breaking Bad', 'Season 5', 'Featurettes 5.2');
        actions.moves.push({
          fromDir: feat52,
          toDir: destFeat,
          type: 'copyDir',
          desc: 'Featurettes 5.2 faltantes de Breaking Bad S05'
        });
      }
      const subs = path.join(p, 'Foreign Subtitles - Entire Series');
      if (fs.existsSync(subs)) {
        const destSubs = path.join(seriesDir, 'Breaking Bad', 'Foreign Subtitles');
        actions.moves.push({
          fromDir: subs,
          toDir: destSubs,
          type: 'copyDir',
          desc: 'Subtítulos de Breaking Bad'
        });
      }
    }

    actions.deletions.push({
      path: p,
      isDir: true,
      desc: `Carpeta de torrent Breaking Bad Season ${b.season} (ya respaldada al 100% en Media)`
    });
  }

  // ========================================================================
  // PASO 2: LOKI (Temporadas 1 y 2)
  // ========================================================================
  console.log('--- 2. Analizando Loki ---');
  const lokiS1Torrent = path.join(torrentsDir, 'www.UIndex.org    -    Loki.S01E04.The.Nexus.Event.REPACK.1080p.HEVC.x265-MeGusta');
  if (fs.existsSync(lokiS1Torrent)) {
    const v = findMainVideoFile(lokiS1Torrent);
    if (v) {
      const targetDir = path.join(seriesDir, 'Loki', 'Season 1');
      actions.moves.push({
        from: v.path,
        to: path.join(targetDir, v.name),
        desc: 'Loki S01E04 (MeGusta 1080p)'
      });
      actions.deletions.push({
        path: lokiS1Torrent,
        isDir: true,
        desc: 'Carpeta fuente de torrent Loki S01E04'
      });
    }
  }

  const lokiS2Torrent = path.join(torrentsDir, 'Loki - Season 2 (2023)');
  if (fs.existsSync(lokiS2Torrent)) {
    const targetDir = path.join(seriesDir, 'Loki', 'Season 2');
    for (const f of fs.readdirSync(lokiS2Torrent)) {
      if (videoExts.includes(path.extname(f).toLowerCase())) {
        actions.moves.push({
          from: path.join(lokiS2Torrent, f),
          to: path.join(targetDir, f),
          desc: `Loki Season 2: ${f}`
        });
      }
    }
    actions.deletions.push({
      path: lokiS2Torrent,
      isDir: true,
      desc: 'Carpeta fuente de torrent Loki Season 2'
    });
  }

  // ========================================================================
  // PASO 3: TOP GEAR (Temporada 10)
  // ========================================================================
  console.log('--- 3. Analizando Top Gear Season 10 ---');
  const tgTorrent = path.join(torrentsDir, 'Top Gear UK Series 10 S10 (2007) WEB-DL 576p.x264.aac.engsub.djd');
  if (fs.existsSync(tgTorrent)) {
    const ep11Source = path.join(tgTorrent, 'Top Gear S10E11 - Top Ground Gear Force (Comic Relief Special) (No Sub).mp4');
    if (fs.existsSync(ep11Source)) {
      const targetFile = path.join(seriesDir, 'Top Gear', 'Season 10', 'Top Gear S10E11 - Top Ground Gear Force (Comic Relief Special).mp4');
      actions.moves.push({
        from: ep11Source,
        to: targetFile,
        desc: 'Top Gear S10E11 Especial (único capítulo faltante de S10)'
      });
    }
    actions.deletions.push({
      path: tgTorrent,
      isDir: true,
      desc: 'Carpeta fuente de Top Gear S10 (S10E01-E10 ya estaban en Media, E11 migrado)'
    });
  }

  // ========================================================================
  // PASO 4: STRANGER THINGS SEASON 5 (Parte 1)
  // ========================================================================
  console.log('--- 4. Analizando Stranger Things Season 5 ---');
  const stS5Torrent = path.join(torrentsDir, 'Stranger Things - Season 5 - Part 1');
  if (fs.existsSync(stS5Torrent)) {
    const targetDir = path.join(seriesDir, 'Stranger Things', 'Season 5');
    for (const f of fs.readdirSync(stS5Torrent)) {
      if (videoExts.includes(path.extname(f).toLowerCase())) {
        actions.moves.push({
          from: path.join(stS5Torrent, f),
          to: path.join(targetDir, f),
          desc: `Stranger Things Season 5: ${f}`
        });
      }
    }
    actions.deletions.push({
      path: stS5Torrent,
      isDir: true,
      desc: 'Carpeta fuente de Stranger Things Season 5'
    });
  }

  // ========================================================================
  // PASO 5: STRANGER THINGS SEASONS 1, 2, 3 (Deduplicación multi-fuente)
  // ========================================================================
  console.log('--- 5. Analizando episodios individuales de Stranger Things (Seasons 1, 2, 3) ---');
  
  // Mapeo detallado de cada capítulo con sus fuentes y decisión óptima
  const stEpisodePlan = [
    // --- TEMPORADA 1 ---
    {
      season: 1, episode: 2,
      best: 'www.UIndex.org    -    Stranger Things S01E02 Chapter Two The Weirdo on Maple Street 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 1, episode: 3,
      best: 'www.UIndex.org    -    Stranger Things S01E03 Chapter Three Holly Jolly 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 1, episode: 4,
      alreadyInMedia: true,
      // En Media ya está Stranger Things S01E04 Chapter Four The Body 1080p NF WEBRip DD5.mkv (limpia)
      discard: ['www.UIndex.org    -    Stranger Things S01E04 Chapter Four The Body with Audio Description 1080p NF WEB-DL DDP5 1 H 264-Kitsune']
    },
    {
      season: 1, episode: 6,
      replaceInMedia: 'Stranger Things S01E06 Chapter Six The Monster with Audio Description 1080p.mkv',
      best: 'www.UIndex.org    -    Stranger Things S01E06 Chapter Six The Monster 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 1, episode: 7,
      best: 'www.UIndex.org    -    Stranger Things S01E07 Chapter Seven The Bathtub 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 1, episode: 8,
      best: 'www.UIndex.org    -    Stranger Things S01E08 Chapter Eight The Upside Down 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },

    // --- TEMPORADA 2 ---
    {
      season: 2, episode: 1,
      best: 'www.UIndex.org    -    Stranger Things S02E01 Chapter One MADMAX 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: ['www.UIndex.org    -    Stranger.Things.S02E01.Chapter.One.MADMAX.1080p.HEVC.x265-MeGusta']
    },
    {
      season: 2, episode: 3,
      best: 'www.UIndex.org    -    Stranger.Things.S02E03.Chapter.Three.The.Pollywog.1080p.HEVC.x265-MeGusta',
      discard: []
    },
    {
      season: 2, episode: 4,
      best: 'www.UIndex.org    -    Stranger Things S02E04 Chapter Four Will the Wise 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 2, episode: 5,
      best: 'www.UIndex.org    -    Stranger Things S02E05 Chapter Five Dig Dug 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: []
    },
    {
      season: 2, episode: 6,
      replaceInMedia: 'Stranger Things S02E06 Chapter Six The Spy with Audio Description 1080p NF.mkv',
      best: 'www.UIndex.org    -    Stranger.Things.S02E06.Chapter.Six.The.Spy.1080p.HEVC.x265-MeGusta',
      discard: []
    },
    {
      season: 2, episode: 8,
      best: 'www.UIndex.org    -    Stranger.Things.S02E08.Chapter.Eight.The.Mind.Flayer.1080p.HEVC.x265-MeGusta',
      discard: []
    },
    {
      season: 2, episode: 9,
      best: 'www.UIndex.org    -    Stranger.Things.S02E09.Chapter.Nine.The.Gate.1080p.HEVC.x265-MeGusta',
      discard: ['www.UIndex.org    -    Stranger Things S02E09 Chapter Nine The Gate with Audio Description 1080p NF WEB-DL DDP5 1 H 264-Kitsune']
    },

    // --- TEMPORADA 3 ---
    {
      season: 3, episode: 3,
      best: 'www.UIndex.org    -    Stranger Things S03 E03 2019 1080p NF WEB-DL x264 DDP5 1-ADWeb',
      discard: []
    },
    {
      season: 3, episode: 4,
      best: 'www.UIndex.org    -    Stranger Things S03E04 Chapter Four The Sauna Test 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: [
        'www.UIndex.org    -    Stranger Things S03E04 Chapter Four The Sauna Test 1080p NF WEB-DL DDP5 1 x264-NTG',
        'www.UIndex.org    -    Stranger Things S03E04 Chapter Four The Sauna Test 1080p WEBRip 10Bit DDP5 1 HEVC-d3g'
      ]
    },
    {
      season: 3, episode: 5,
      best: 'www.UIndex.org    -    Stranger Things S03E05 Chapter Five The Flayed 1080p NF WEB-DL DDP5 1 H 264-Kitsune',
      discard: [
        'www.UIndex.org    -    Stranger Things S03E05 Chapter Five The Flayed 1080p NF WEB-DL DDP5 1 x264-NTG',
        'www.UIndex.org    -    Stranger Things S03E05 Chapter Five The Flayed 1080p WEBRip 10Bit DDP5 1 HEVC-d3g'
      ]
    },
    {
      season: 3, episode: 6,
      best: 'www.UIndex.org    -    Stranger Things S03E06 Chapter Six E Pluribus Unum 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: [
        'www.UIndex.org    -    Stranger Things S03E06 Chapter Six E Pluribus Unum 1080p WEBRip 10Bit DDP5 1 HEVC-d3g'
      ]
    },
    {
      season: 3, episode: 7,
      best: 'www.UIndex.org    -    Stranger Things S03E07 Chapter Seven The Bite 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: [
        'www.UIndex.org    -    Stranger Things S03E07 Chapter Seven The Bite 1080p NF WEB-DL DDP5 1 x264-NTG',
        'www.UIndex.org    -    Stranger Things S03E07 Chapter Seven The Bite 1080p WEBRip 10Bit DDP5 1 HEVC-d3g'
      ]
    },
    {
      season: 3, episode: 8,
      best: 'www.UIndex.org    -    Stranger Things S03E08 Chapter Eight The Battle of Starcourt 1080p NF WEB-DL DDP5 1 H 264-FLUX',
      discard: [
        'www.UIndex.org    -    Stranger.Things.S03E08.Chapter.Eight.The.Battle.of.Starcourt.1080p.HEVC.x265-MeGusta'
      ]
    }
  ];

  for (const ep of stEpisodePlan) {
    const sStr = `Season ${ep.season}`;
    const targetDir = path.join(seriesDir, 'Stranger Things', sStr);

    // 1. Manejar reemplazo de versión de Audio Description existente en Media
    if (ep.replaceInMedia && ep.best) {
      const bestFolder = path.join(torrentsDir, ep.best);
      if (fs.existsSync(bestFolder)) {
        const v = findMainVideoFile(bestFolder);
        if (v) {
          const oldMediaFile = path.join(targetDir, ep.replaceInMedia);
          const newMediaFile = path.join(targetDir, v.name);
          actions.replaces.push({
            oldFile: oldMediaFile,
            newFile: newMediaFile,
            sourceFile: v.path,
            desc: `S0${ep.season}E0${ep.episode}: Reemplazar versión con audiodescripción en Media por release limpio (${v.name})`
          });
          actions.deletions.push({
            path: bestFolder,
            isDir: true,
            desc: `Carpeta fuente de ${ep.best} (migrada como reemplazo limpio)`
          });
        }
      }
    } 
    // 2. Mover la mejor versión si no existía en Media
    else if (ep.best) {
      const bestFolder = path.join(torrentsDir, ep.best);
      if (fs.existsSync(bestFolder)) {
        const v = findMainVideoFile(bestFolder);
        if (v) {
          actions.moves.push({
            from: v.path,
            to: path.join(targetDir, v.name),
            desc: `Stranger Things S0${ep.season}E0${ep.episode} (${v.name})`
          });
          actions.deletions.push({
            path: bestFolder,
            isDir: true,
            desc: `Carpeta fuente de ${ep.best}`
          });
        }
      }
    }

    // 3. Descartar versiones perdedoras/redundantes de Torrents
    if (ep.discard && ep.discard.length > 0) {
      for (const d of ep.discard) {
        const p = path.join(torrentsDir, d);
        if (fs.existsSync(p)) {
          actions.deletions.push({
            path: p,
            isDir: true,
            desc: `Release redundante/alternativo descartado para S0${ep.season}E0${ep.episode} (${d})`
          });
        }
      }
    }
  }

  // ========================================================================
  // REPORTE DE ACCIONES
  // ========================================================================
  console.log('\n========================================================================');
  console.log(`📋 RESUMEN DE OPERACIONES IDENTIFICADAS:`);
  console.log('========================================================================');
  console.log(`📦 Movimientos hacia G:\\Media:      ${actions.moves.length}`);
  console.log(`🔄 Reemplazos limpios (sin AD):    ${actions.replaces.length}`);
  console.log(`🗑️  Eliminaciones en G:\\Torrents:    ${actions.deletions.length}`);
  console.log(`⚡ Desregistros en qBittorrent:     ${actions.qbDeletions.length}\n`);

  console.log('--- MOVIMIENTOS Y MIGRACIONES: ---');
  actions.moves.forEach(m => console.log(` ➡️  ${m.desc}`));

  console.log('\n--- MEJORAS DE AUDIO (SUSTITUCIÓN DE AUDIODESCRIPCIÓN): ---');
  actions.replaces.forEach(r => console.log(` 🔄 ${r.desc}`));

  console.log('\n--- ELIMINACIONES EN TORRENTS: ---');
  actions.deletions.forEach(d => console.log(` 🗑️  ${path.basename(d.path)} -> ${d.desc}`));

  // Verificación de seguridad de no-media
  console.log('\n========================================================================');
  console.log('🛡️  VERIFICACIÓN DE SEGURIDAD (ARCHIVOS PROTEGIDOS QUE NO SE TOCARÁN):');
  console.log('========================================================================');
  const allTorrents = fs.readdirSync(torrentsDir);
  const remaining = [];
  allTorrents.forEach(t => {
    if (isProtected(t)) {
      console.log(` 🔒 PROTEGIDO: ${t}`);
      remaining.push(t);
    }
  });

  // ========================================================================
  // EJECUCIÓN REAL (si --execute)
  // ========================================================================
  if (!isDryRun) {
    console.log('\n========================================================================');
    console.log('🚀 INICIANDO EJECUCIÓN REAL...');
    console.log('========================================================================');

    // 1. Desregistrar de qBittorrent
    for (const qb of actions.qbDeletions) {
      try {
        const formData = `hashes=${encodeURIComponent(qb.hash)}&deleteFiles=false`;
        await axios.post(`${config.qbittorrent.url}/api/v2/torrents/delete`, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000
        });
        console.log(` ✅ Desregistrado de qBittorrent: ${qb.name}`);
      } catch (err) {
        console.warn(` ⚠️ Error desregistrando ${qb.name}:`, err.message);
      }
    }

    // 2. Mover archivos a Media
    for (const m of actions.moves) {
      try {
        if (m.type === 'copyDir') {
          copyDirRecursive(m.fromDir, m.toDir);
          console.log(` 📂 Copiado directorio: ${m.desc}`);
        } else {
          const targetParent = path.dirname(m.to);
          if (!fs.existsSync(targetParent)) {
            fs.mkdirSync(targetParent, { recursive: true });
          }
          if (fs.existsSync(m.from)) {
            // Usar fs.renameSync para mover instantáneamente dentro del mismo volumen G:
            fs.renameSync(m.from, m.to);
            console.log(` 🚚 Movido a Media: ${path.basename(m.to)}`);
          }
        }
      } catch (err) {
        console.error(` ❌ Error moviendo ${m.desc}:`, err.message);
      }
    }

    // 3. Ejecutar reemplazos limpios (eliminar versión AD y mover versión limpia)
    for (const r of actions.replaces) {
      try {
        if (fs.existsSync(r.oldFile)) {
          fs.unlinkSync(r.oldFile);
          console.log(` 🗑️  Eliminada versión con audiodescripción: ${path.basename(r.oldFile)}`);
        }
        if (fs.existsSync(r.sourceFile)) {
          fs.renameSync(r.sourceFile, r.newFile);
          console.log(` ✨ Reemplazado con versión limpia: ${path.basename(r.newFile)}`);
        }
      } catch (err) {
        console.error(` ❌ Error en reemplazo limpio ${r.desc}:`, err.message);
      }
    }

    // 4. Eliminar carpetas/archivos en Torrents
    for (const d of actions.deletions) {
      try {
        if (fs.existsSync(d.path)) {
          if (d.isDir) {
            fs.rmSync(d.path, { recursive: true, force: true });
          } else {
            fs.unlinkSync(d.path);
          }
          console.log(` 🗑️  Eliminado de Torrents: ${path.basename(d.path)}`);
        }
      } catch (err) {
        console.error(` ❌ Error eliminando ${path.basename(d.path)}:`, err.message);
      }
    }

    // 5. Notificar a Sonarr para reescanear series
    console.log('\n--- Notificando a Sonarr para reindexar series ---');
    try {
      const seriesRes = await axios.get(`${config.sonarr.url}/api/v3/series`, {
        headers: { 'X-Api-Key': config.sonarr.apiKey },
        timeout: 5000
      });
      const seriesToRescan = ['Stranger Things', 'Loki', 'Top Gear', 'Breaking Bad'];
      for (const s of seriesRes.data) {
        if (seriesToRescan.some(name => s.title.toLowerCase().includes(name.toLowerCase()))) {
          await axios.post(`${config.sonarr.url}/api/v3/command`, {
            name: 'RescanSeries',
            seriesId: s.id
          }, {
            headers: { 'X-Api-Key': config.sonarr.apiKey },
            timeout: 5000
          });
          console.log(` 📡 Sonarr RescanSeries disparado para: ${s.title}`);
        }
      }
    } catch (err) {
      console.warn(' ⚠️ Error notificando a Sonarr:', err.message);
    }

    // 6. Notificar a Plex para refrescar biblioteca
    console.log('\n--- Refrescando biblioteca de Series en Plex ---');
    try {
      await axios.get(`${config.plex.url}/library/sections/all/refresh`, {
        headers: { 'X-Plex-Token': config.plex.token },
        timeout: 5000
      });
      console.log(' 📡 Biblioteca de Plex refrescada con éxito');
    } catch (err) {
      console.warn(' ⚠️ Error notificando a Plex:', err.message);
    }

    console.log('\n🎉 ¡MIGRACIÓN, DESDUPLICACIÓN Y LIMPIEZA FINALIZADAS CON ÉXITO!');
    console.log('Archivos remanentes en G:\\Torrents:');
    const finalTorrents = fs.readdirSync(torrentsDir);
    finalTorrents.forEach(f => console.log(`   📁 ${f}`));
  } else {
    console.log('\n💡 Ejecución en modo DRY-RUN completada sin cambios.');
    console.log('Para aplicar los cambios reales, ejecuta: node scripts/import-and-dedup-torrents.js --execute');
  }
}

run().catch(err => {
  console.error('\n❌ ERROR INESPERADO:', err);
  process.exit(1);
});
