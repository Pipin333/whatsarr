/**
 * Script de limpieza segura de G:\Torrents
 * Elimina exclusivamente los archivos y carpetas de descargas que ya están
 * 100% respaldados e indexados en G:\Media (Películas y Series).
 * 
 * Protege estrictamente:
 * - Descargas activas en curso (< 100%)
 * - Archivos personales (PDFs, documentos)
 * - Juegos (PS3, PC, etc.) y contenido no presente en G:\Media
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../src/config');

const mediaDir = config.seriesPath ? path.dirname(config.seriesPath) : 'G:\\Media';
const torrentsDir = 'G:\\Torrents';
const isDryRun = !process.argv.includes('--execute');

const videoExts = ['.mkv', '.mp4', '.avi', '.ts', '.m4v', '.mov', '.wmv'];

async function cleanDuplicates() {
  console.log('================================================================');
  console.log('🧹 AUDITORÍA Y LIMPIEZA SEGURA DE TORRENTS DUPLICADOS EN MEDIA');
  console.log('================================================================');
  console.log(`📁 Carpeta Torrents: ${torrentsDir}`);
  console.log(`📁 Carpeta Media:    ${mediaDir}`);
  console.log(`⚙️ Modo:             ${isDryRun ? 'DRY-RUN (Simulación sin borrar)' : 'EJECUCIÓN REAL (--execute)'}`);
  console.log('----------------------------------------------------------------\n');

  if (!fs.existsSync(torrentsDir)) {
    console.error(`❌ La carpeta ${torrentsDir} no existe.`);
    return;
  }

  // 1. Indexar todos los archivos presentes en G:\Media
  console.log('1. Escaneando archivos existentes en G:\\Media...');
  const mediaByIno = new Set();
  const mediaBySizeAndName = new Set();
  let mediaFileCount = 0;

  function scanMedia(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const s = fs.statSync(full);
        if (s.isDirectory()) {
          scanMedia(full);
        } else {
          mediaByIno.add(s.ino);
          mediaBySizeAndName.add(`${f.toLowerCase()}_${s.size}`);
          mediaFileCount++;
        }
      } catch (_) {}
    }
  }

  scanMedia(path.join(mediaDir, 'Peliculas'));
  scanMedia(path.join(mediaDir, 'Series'));
  console.log(`   ✅ ${mediaFileCount} archivos indexados en G:\\Media (Peliculas + Series)\n`);

  // 2. Consultar estado en qBittorrent
  console.log('2. Consultando descargas activas en qBittorrent...');
  let qbTorrents = [];
  try {
    const qbRes = await axios.get(`${config.qbittorrent.url}/api/v2/torrents/info`, { timeout: 4000 });
    qbTorrents = qbRes.data || [];
  } catch (err) {
    console.warn(`   ⚠️ Advertencia: qBittorrent no respondió (${err.message}).`);
  }

  const activeDlPaths = new Set(
    qbTorrents
      .filter(t => t.progress < 1 && t.state !== 'pausedUP' && t.state !== 'uploading')
      .map(t => (t.content_path || path.join(t.save_path, t.name)).toLowerCase())
  );
  console.log(`   ✅ Torrents en qBittorrent: ${qbTorrents.length} (Descargas activas protegidas: ${activeDlPaths.size})\n`);

  // 3. Inspeccionar elementos en G:\Torrents
  console.log('3. Analizando coincidencias y duplicados en G:\\Torrents...');
  const entries = fs.readdirSync(torrentsDir);
  const itemsToClean = [];
  const protectedItems = [];

  for (const entry of entries) {
    const full = path.join(torrentsDir, entry);
    const fullLower = full.toLowerCase();

    // Comprobar si está en descarga activa
    let isDownloading = false;
    for (const dp of activeDlPaths) {
      if (fullLower.startsWith(dp) || dp.startsWith(fullLower)) {
        isDownloading = true;
        break;
      }
    }

    if (isDownloading) {
      protectedItems.push({ entry, reason: 'Descarga activa en progreso (< 100%)' });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(full);
    } catch (_) {
      continue;
    }

    // Archivo individual en raíz de G:\Torrents
    if (!stat.isDirectory()) {
      const isRepeated = mediaByIno.has(stat.ino) || mediaBySizeAndName.has(`${entry.toLowerCase()}_${stat.size}`);
      if (isRepeated) {
        itemsToClean.push({
          entry,
          fullPath: full,
          isDir: false,
          size: stat.size,
          videoFiles: 1
        });
      } else {
        protectedItems.push({ entry, reason: 'Archivo no presente en G:\\Media (personal/juego)' });
      }
      continue;
    }

    // Directorio en G:\Torrents
    let totalFiles = 0;
    let videoFiles = 0;
    let repeatedVideoFiles = 0;
    let dirSize = 0;

    function inspectDir(dir) {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (st.isDirectory()) {
            inspectDir(fp);
          } else {
            totalFiles++;
            dirSize += st.size;
            const ext = path.extname(f).toLowerCase();
            if (videoExts.includes(ext) && !f.toLowerCase().includes('sample')) {
              videoFiles++;
              if (mediaByIno.has(st.ino) || mediaBySizeAndName.has(`${f.toLowerCase()}_${st.size}`)) {
                repeatedVideoFiles++;
              }
            }
          }
        } catch (_) {}
      }
    }

    inspectDir(full);

    // Criterio de seguridad: si tiene videos y TODOS sus videos ya existen en G:\Media
    if (videoFiles > 0 && repeatedVideoFiles === videoFiles) {
      itemsToClean.push({
        entry,
        fullPath: full,
        isDir: true,
        size: dirSize,
        videoFiles,
        totalFiles
      });
    } else if (repeatedVideoFiles > 0) {
      protectedItems.push({
        entry,
        reason: `Parcialmente repetido (${repeatedVideoFiles}/${videoFiles} videos en Media)`
      });
    } else {
      protectedItems.push({
        entry,
        reason: 'Contenido no presente en G:\\Media (Juegos / Archivos propios)'
      });
    }
  }

  // 4. Mostrar resumen
  console.log('================================================================');
  console.log(`📋 ELEMENTOS REPETIDOS CONFIRMADOS PARA LIMPIEZA (${itemsToClean.length}):`);
  console.log('================================================================');
  let totalBytesToClean = 0;
  itemsToClean.forEach(item => {
    totalBytesToClean += item.size;
    const sizeGB = (item.size / 1024 / 1024 / 1024).toFixed(2);
    const detail = item.isDir ? `[Carpeta - ${item.videoFiles} videos]` : `[Archivo]`;
    console.log(` 🗑️  ${item.entry} (${sizeGB} GB) ${detail}`);
  });
  console.log(`\n📦 Espacio total de descargas repetidas: ${(totalBytesToClean / 1024 / 1024 / 1024).toFixed(2)} GB`);

  console.log('\n================================================================');
  console.log(`🛡️  ELEMENTOS PROTEGIDOS QUE NO SE TOCARÁN (${protectedItems.length}):`);
  console.log('================================================================');
  protectedItems.forEach(p => {
    console.log(` 🔒 ${p.entry} -> ${p.reason}`);
  });

  // 5. Ejecutar eliminación si se especificó --execute
  if (!isDryRun) {
    console.log('\n================================================================');
    console.log('🚀 INICIANDO LIMPIEZA REAL...');
    console.log('================================================================');

    // 5.1 Eliminar torrents terminados de qBittorrent cuya carpeta se vaya a borrar
    for (const item of itemsToClean) {
      const matchQb = qbTorrents.find(t => {
        const tPath = (t.content_path || path.join(t.save_path, t.name)).toLowerCase();
        return tPath === item.fullPath.toLowerCase();
      });

      if (matchQb) {
        try {
          const formData = `hashes=${encodeURIComponent(matchQb.hash)}&deleteFiles=true`;
          await axios.post(`${config.qbittorrent.url}/api/v2/torrents/delete`, formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
          });
          console.log(` ✅ Desregistrado y eliminado de qBittorrent: "${matchQb.name}"`);
        } catch (qbErr) {
          console.warn(` ⚠️ Error desregistrando de qBittorrent ${matchQb.name}:`, qbErr.message);
        }
      }
    }

    // 5.2 Eliminar carpetas/archivos huérfanos de G:\Torrents
    let cleanedCount = 0;
    for (const item of itemsToClean) {
      try {
        if (fs.existsSync(item.fullPath)) {
          if (item.isDir) {
            fs.rmSync(item.fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(item.fullPath);
          }
          console.log(` 🗑️  Eliminado de disco: ${item.entry}`);
          cleanedCount++;
        }
      } catch (err) {
        console.error(` ❌ Error eliminando ${item.entry}:`, err.message);
      }
    }

    console.log('\n🎉 ¡LIMPIEZA COMPLETADA CON ÉXITO!');
    console.log(`Total de elementos eliminados de G:\\Torrents: ${cleanedCount}`);
    console.log(`Tu biblioteca en G:\\Media permanece 100% intacta y disponible en Plex.`);
  } else {
    console.log('\n💡 Nota: Este fue un simulacro (DRY-RUN). No se borró ningún archivo.');
    console.log('Para ejecutar la limpieza real, pasa el argumento --execute');
  }
}

cleanDuplicates().catch(err => {
  console.error('\n❌ ERROR INESPERADO EN LIMPIEZA:', err);
  process.exit(1);
});
