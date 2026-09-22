// --- Plex WhatsApp Bot Dashboard Client ---

const state = {
  status: null,
  downloads: [],
  requests: [],
  searchDebounceTimer: null,
  hideCompleted: localStorage.getItem('hide_completed_downloads') === 'true'
};

// Formateador de bytes a MB / GB
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Formateador de segundos a tiempo legible (ETA)
function formatSeconds(secs) {
  if (secs <= 0 || secs > 864000) return 'Completado / Desconocido';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// 1. Actualizar Estado de Servicios
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.status = data;

    updateBadge('badge-wa', data.services.whatsapp?.connected, 'WhatsApp');
    updateBadge('badge-radarr', data.services.radarr?.ok, 'Radarr');
    updateBadge('badge-sonarr', data.services.sonarr?.ok, 'Sonarr');
    updateBadge('badge-qb', data.services.qbittorrent?.ok, 'qBittorrent');
    updateBadge('badge-plex', data.services.plex?.ok, 'Plex');

    // Metricas
    document.getElementById('stat-total-req').textContent = data.stats.totalRequests || 0;
    
    if (data.services.qbittorrent?.dlSpeed) {
      document.getElementById('stat-speed').textContent = formatBytes(data.services.qbittorrent.dlSpeed) + '/s';
    } else {
      document.getElementById('stat-speed').textContent = '0 MB/s';
    }

    // Whitelist
    const wlElVal = document.getElementById('stat-whitelist-val');
    const wlElDesc = document.getElementById('stat-whitelist-desc');
    const wlIcon = document.getElementById('stat-whitelist-icon');
    if (wlElVal && data.whitelist) {
      if (data.whitelist.enabled) {
        wlElVal.textContent = 'Active';
        wlElVal.style.color = '#10b981';
        wlElDesc.textContent = `${data.whitelist.count} authorized contact(s)`;
        if (wlIcon) wlIcon.textContent = '🛡️';
      } else {
        wlElVal.textContent = 'Open';
        wlElVal.style.color = '#94a3b8';
        wlElDesc.textContent = 'Any contact can request';
        if (wlIcon) wlIcon.textContent = '🔓';
      }
    }

    // Language selector sync
    const langSelect = document.getElementById('lang-select');
    if (langSelect && data.language) {
      langSelect.value = data.language;
    }
  } catch (err) {
    console.warn('Error fetching status:', err);
  }
}

async function changeLanguage(lang) {
  try {
    const res = await fetch('/api/config/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang })
    });
    const data = await res.json();
    if (data.success) {
      fetchStatus();
    }
  } catch (err) {
    console.warn('Error changing language:', err);
  }
}

function updateBadge(id, isOnline, label) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isOnline) {
    el.className = 'badge online';
    el.innerHTML = `<span class="dot"></span> ${label} Online`;
  } else {
    el.className = 'badge offline';
    el.innerHTML = `<span class="dot"></span> ${label} Offline`;
  }
}

// 2. Actualizar Descargas de qBittorrent
async function fetchDownloads() {
  try {
    const res = await fetch('/api/downloads');
    const data = await res.json();
    const torrents = data.torrents || [];
    state.downloads = torrents;

    const stalledCount = torrents.filter(t => t.is_stalled || t.is_error).length;
    const completedCount = torrents.filter(t => t.is_completed || t.progress >= 100).length;

    // Actualizar botones de control en cabecera
    const toggleBtn = document.getElementById('toggle-completed-btn');
    if (toggleBtn) {
      if (state.hideCompleted) {
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = `👁️ Mostrar Completadas${completedCount > 0 ? ` (${completedCount})` : ''}`;
        toggleBtn.title = 'Mostrar descargas completadas en la vista';
      } else {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = `👁️ Ocultar Completadas`;
        toggleBtn.title = 'Ocultar descargas completadas en la vista';
      }
    }

    const clearBtn = document.getElementById('clear-completed-btn');
    if (clearBtn) {
      if (completedCount > 0) {
        clearBtn.style.display = 'inline-flex';
        clearBtn.innerHTML = `🧹 Quitar Completadas (${completedCount})`;
      } else {
        clearBtn.style.display = 'none';
      }
    }

    // Filtrar torrents para la vista si está activa la opción de ocultar
    const visibleTorrents = state.hideCompleted
      ? torrents.filter(t => !(t.is_completed || t.progress >= 100))
      : torrents;

    const hiddenCount = torrents.length - visibleTorrents.length;

    document.getElementById('stat-active-dl').textContent = torrents.length;
    let badgeText = `${torrents.length} activas`;
    if (stalledCount > 0) badgeText += ` (${stalledCount} colgadas)`;
    if (state.hideCompleted && hiddenCount > 0) badgeText += ` [${hiddenCount} ocultas]`;
    document.getElementById('downloads-count').textContent = badgeText;

    const container = document.getElementById('downloads-container');
    if (torrents.length === 0) {
      container.innerHTML = '<div class="empty-state">No hay descargas activas en este momento.</div>';
      return;
    }

    if (visibleTorrents.length === 0 && state.hideCompleted) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2rem;">
          <p style="font-size: 1rem; color: #fff; margin-bottom: 0.5rem;">✅ Todas las descargas activas (${hiddenCount}) están completadas y han sido ocultadas.</p>
          <button class="btn btn-sm btn-outline" onclick="toggleHideCompleted()" style="margin-top: 0.5rem;">👁️ Mostrar Completadas (${hiddenCount})</button>
        </div>
      `;
      return;
    }

    container.innerHTML = visibleTorrents.map(t => {
      const isComplete = t.is_completed || t.progress >= 100;
      const speed = t.dlspeed > 0 ? `⚡ ${formatBytes(t.dlspeed)}/s` : (isComplete ? 'Sembrando' : 'En pausa / Esperando');
      const sizeStr = formatBytes(t.size);
      const etaStr = t.eta > 0 && t.dlspeed > 0 && !isComplete ? `⏱️ Restante: ${formatSeconds(t.eta)}` : '';
      const safeName = (t.name || '').replace(/'/g, "\\'");

      let stateBadge = '';
      let itemClass = 'download-item';
      if (t.is_error) {
        itemClass += ' error';
        stateBadge = '<span class="status-badge error">❌ Error</span>';
      } else if (t.is_stalled) {
        itemClass += ' stalled';
        stateBadge = '<span class="status-badge stalled">⚠️ Colgada</span>';
      } else if (isComplete) {
        itemClass += ' completed';
        stateBadge = '<span class="status-badge completed">✅ Sembrando</span>';
      } else {
        stateBadge = '<span class="status-badge downloading">⬇️ Descargando</span>';
      }

      let actionsHtml = '';
      if (isComplete) {
        actionsHtml = `
          <button class="btn btn-outline btn-sm" onclick="removeCompletedDownload('${t.hash}', '${safeName}')" title="Quitar de qBittorrent conservando archivos en disco">🧹 Quitar de lista</button>
          <button class="btn btn-danger btn-sm" onclick="cancelDownload('${t.hash}', '${safeName}')" title="Borrar descarga y eliminar archivos del disco">🗑️ Borrar</button>
        `;
      } else {
        actionsHtml = `
          <button class="btn btn-warning btn-sm" onclick="retryDownload('${t.hash}', '${safeName}')" title="Reintentar descarga colgada o buscar release alternativo">🔄 Reintentar</button>
          <button class="btn btn-danger btn-sm" onclick="cancelDownload('${t.hash}', '${safeName}')" title="Cancelar y borrar archivos">❌ Cancelar</button>
        `;
      }

      return `
        <div class="${itemClass}">
          <div class="download-header">
            <span class="download-title" title="${t.name}">${t.name}</span>
            <div class="download-meta">
              ${stateBadge}
              <span>${speed}</span>
              <span>${t.progress}% de ${sizeStr}</span>
              ${etaStr ? `<span>${etaStr}</span>` : ''}
              <div class="download-actions">
                ${actionsHtml}
              </div>
            </div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${Math.min(100, t.progress)}%"></div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error obteniendo descargas:', err);
  }
}

// Reintentar descarga individual activa, colgada o fallida
window.retryDownload = async function(hash, name) {
  if (!confirm(`¿Deseas reintentar la descarga de "${name}"?\n\nSi está gestionada por Sonarr o Radarr, se descartará este release y se buscará otro automáticamente. Si es directa, se recomprobará y forzará en qBittorrent.`)) {
    return;
  }
  try {
    const res = await fetch('/api/downloads/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.message || 'Reintento ejecutado con éxito'}`);
      fetchDownloads();
      fetchLogs();
    } else {
      alert(`⚠️ Error al reintentar: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
};

// Reintentar todas las descargas colgadas o fallidas en lote
window.retryAllStalled = async function() {
  const btn = document.getElementById('retry-stalled-btn');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '🔄 Reintentando...';
  }
  try {
    const res = await fetch('/api/downloads/retry-stalled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Escaneo de colgadas completado.\nSe ejecutaron ${data.count} acciones de reintento en descargas colgadas o fallidas.`);
      fetchDownloads();
      fetchLogs();
    } else {
      alert(`⚠️ Error al reintentar colgadas: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

// Cancelar descarga activa
window.cancelDownload = async function(hash, name) {
  if (!confirm(`¿Estás seguro de que deseas cancelar y eliminar la descarga de "${name}"? Se borrarán los archivos parciales de qBittorrent.`)) {
    return;
  }
  try {
    const res = await fetch('/api/downloads/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, deleteFiles: true })
    });
    const data = await res.json();
    if (data.success) {
      fetchDownloads();
      fetchStatus();
    } else {
      alert(`⚠️ Error al cancelar: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
};

// Alternar ocultar / mostrar descargas completadas en la vista
window.toggleHideCompleted = function() {
  state.hideCompleted = !state.hideCompleted;
  localStorage.setItem('hide_completed_downloads', state.hideCompleted ? 'true' : 'false');
  fetchDownloads();
};

// Eliminar de qBittorrent todas las descargas completadas en lote (conservando archivos en disco)
window.clearCompletedDownloads = async function() {
  const completed = (state.downloads || []).filter(t => t.is_completed || t.progress >= 100);
  const count = completed.length;
  if (count === 0) {
    alert('No hay descargas completadas en la cola.');
    return;
  }

  if (!confirm(`¿Deseas quitar ${count} descarga(s) completada(s) de la lista de qBittorrent?\n\nℹ️ Los archivos de video descargados SE CONSERVAN INTACTOS en tu disco duro.`)) {
    return;
  }

  const btn = document.getElementById('clear-completed-btn');
  const origText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '🧹 Quitando...';
  }

  try {
    const res = await fetch('/api/downloads/clear-completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteFiles: false })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.message || 'Descargas completadas eliminadas de la lista.'}`);
      fetchDownloads();
      fetchStatus();
      if (typeof fetchLogs === 'function') fetchLogs();
    } else {
      alert(`⚠️ Error al limpiar: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
};

// Quitar una descarga completada individual de la lista (conservando archivos en disco)
window.removeCompletedDownload = async function(hash, name) {
  if (!confirm(`¿Quitar "${name}" de la lista de qBittorrent?\n\nℹ️ El archivo de video NO se borrará de tu disco duro.`)) {
    return;
  }
  try {
    const res = await fetch('/api/downloads/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, deleteFiles: false })
    });
    const data = await res.json();
    if (data.success) {
      fetchDownloads();
      fetchStatus();
      if (typeof fetchLogs === 'function') fetchLogs();
    } else {
      alert(`⚠️ Error: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
};

// Reintentar búsqueda de solicitud registrada
window.retryRequest = async function(id, title) {
  if (!confirm(`¿Deseas reiniciar la búsqueda en Radarr/Sonarr para "${title}"?`)) return;
  try {
    const res = await fetch('/api/requests/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.message}`);
      fetchDownloads();
      fetchLogs();
    } else {
      alert(`⚠️ Error al reintentar solicitud: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
};

// 2.5 Gestión de Episodios Faltantes y Restauración
window.openMissingModal = function() {
  const modal = document.getElementById('missing-modal');
  if (modal) modal.style.display = 'flex';
  loadMissingSeries();
};

window.closeMissingModal = function() {
  const modal = document.getElementById('missing-modal');
  if (modal) modal.style.display = 'none';
};

window.loadMissingSeries = async function() {
  const container = document.getElementById('missing-series-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">⏳ Analizando series y temporadas con episodios faltantes...</div>';

  try {
    const res = await fetch('/api/series/missing');
    const data = await res.json();
    if (!data.success || !data.series || data.series.length === 0) {
      container.innerHTML = '<div class="empty-state">🎉 ¡Todas las series están completas! No se detectaron episodios faltantes pendientes.</div>';
      return;
    }

    container.innerHTML = data.series.map(s => {
      const safeTitle = (s.title || '').replace(/"/g, '&quot;').replace(/'/g, "\\'");
      const seasonsHtml = (s.seasons || []).map(se => `
        <div class="missing-season-item">
          <div>
            <div class="missing-season-name">Temporada ${se.seasonNumber}</div>
            <div class="missing-season-count">⚠️ ${se.missing} faltante${se.missing > 1 ? 's' : ''} (${se.files}/${se.total} en disco)</div>
          </div>
          <button class="btn btn-outline btn-xs" onclick="runRestoreAction('${s.id}', '${se.seasonNumber}', 'search')" title="Buscar episodios faltantes de esta temporada">
            ⬇️ Descargar T${se.seasonNumber}
          </button>
        </div>
      `).join('');

      return `
        <div class="missing-series-card">
          <div class="missing-series-header">
            <div>
              <span class="missing-series-title">${s.title} ${s.year ? `(${s.year})` : ''}</span>
              <div class="missing-series-stats">📁 ${s.path || ''} • <strong>${s.filesOnDisk}/${s.totalEpisodes} episodios (${s.percentComplete}%)</strong></div>
            </div>
            <span class="missing-series-badge">⚠️ ${s.missingEpisodes} Faltante${s.missingEpisodes > 1 ? 's' : ''}</span>
          </div>
          <div class="missing-seasons-grid">
            ${seasonsHtml}
          </div>
          <div class="missing-series-actions">
            <button class="btn btn-primary btn-sm" onclick="runRestoreAction('${s.id}', null, 'all')">
              ⚡ Restaurar y Descargar Serie
            </button>
            <button class="btn btn-outline btn-sm" onclick="runRestoreAction('${s.id}', null, 'rescan')">
              🔄 Re-escanear Disco
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">⚠️ Error cargando faltantes: ${err.message}</div>`;
  }
};

window.runRestoreAction = async function(seriesId = null, seasonNumber = null, action = 'all') {
  const btn = document.getElementById('btn-restore-all-modal');
  let originalText = '';
  if (btn && !seriesId && !seasonNumber) {
    originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Procesando...';
  }

  try {
    const res = await fetch('/api/series/restore-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesId, seasonNumber, action })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ Acción completada exitosamente:\n\n${data.message}`);
      loadMissingSeries();
      fetchLogs();
      fetchDownloads();
    } else {
      alert(`⚠️ Advertencia: ${data.error || 'No se pudo completar la acción'}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  } finally {
    if (btn && !seriesId && !seasonNumber) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

// 3. Actualizar Historial de Solicitudes
async function fetchRequests() {
  try {
    const res = await fetch('/api/requests');
    const data = await res.json();
    const requests = data.requests || [];
    state.requests = requests;

    const container = document.getElementById('requests-container');
    if (requests.length === 0) {
      container.innerHTML = '<div class="empty-state">No hay solicitudes registradas aún.</div>';
      return;
    }

    const DEFAULT_POSTER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="78" viewBox="0 0 52 78"><rect width="52" height="78" fill="#18181b"/><text x="26" y="44" font-size="22" text-anchor="middle" fill="#71717a">🎬</text></svg>'
    );

    container.innerHTML = requests.map(r => {
      const poster = (r.posterUrl && r.posterUrl.trim()) ? r.posterUrl.replace(/"/g, '&quot;') : DEFAULT_POSTER;
      const langBadge = r.language === 'latino' ? '🇲🇽 Latino' : r.language === 'castellano' ? '🇪🇸 Castellano' : '🇬🇧 Sub';
      let statusClass = 'completed';
      let statusLabel = '🍿 Listo en Plex';
      if (r.status === 'downloading') {
        statusClass = 'downloading';
        statusLabel = '⬇️ Descargando';
      } else if (r.status === 'cancelled') {
        statusClass = 'cancelled';
        statusLabel = '❌ Cancelada';
      }
      const userPhone = r.userJid ? r.userJid.split('@')[0] : 'Web';
      const safeTitle = (r.title || '').replace(/"/g, '&quot;').replace(/'/g, "\\'");
      const displayTitle = (r.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const isSeries = r.mediaType === 'series' || r.mediaType === 'tv';
      const retryBtn = r.status === 'downloading' 
        ? `<button class="btn btn-outline btn-xs" onclick="retryRequest('${r.id}', '${safeTitle}')" title="Reintentar búsqueda en Radarr/Sonarr">🔄 Reintentar</button>`
        : '';
      const missingBtn = isSeries
        ? `<button class="btn btn-outline btn-xs" onclick="runRestoreAction('${r.sonarrId || ''}', null, 'all')" title="Re-escanear disco y buscar episodios faltantes de esta serie">🩺 Faltantes</button>`
        : '';

      return `
        <div class="req-card">
          <img class="req-thumb" src="${poster}" alt="${safeTitle}">
          <div class="req-info">
            <span class="req-title" title="${safeTitle}">${displayTitle} ${r.year ? `(${r.year})` : ''}${r.season ? ` • 📺 ${r.season}` : ''}</span>
            <span class="req-meta">👤 ${userPhone} • ${langBadge}</span>
            <div style="display:flex; align-items:center; gap: 0.5rem; margin-top: 0.25rem; flex-wrap: wrap;">
              <span class="status-tag ${statusClass}">${statusLabel}</span>
              ${retryBtn}
              ${missingBtn}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error obteniendo solicitudes:', err);
  }
}

// 4. Actualizar Logs de Actividad
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    const logs = data.logs || [];
    const container = document.getElementById('logs-container');
    if (logs.length === 0) return;

    container.innerHTML = logs.map(l => {
      const time = l.timestamp.split('T')[1].slice(0, 8);
      return `<div class="log-line ${l.level}">[${time}] ${l.message}</div>`;
    }).join('');
  } catch (_) {}
}

// 5. Buscador FuzzyWuzzy
async function performSearch(query) {
  const container = document.getElementById('search-results');
  if (!query.trim()) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="empty-state">🔍 Buscando con Fuzzy Matching...</div>';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state">No se encontraron resultados para "${query}".</div>`;
      return;
    }

    container.innerHTML = results.map((item, idx) => {
      const poster = item.posterUrl || 'https://via.placeholder.com/300x450?text=Sin+Poster';
      const isSeries = item.type === 'series' || item.type === 'tv';
      const typeLabel = isSeries ? 'Serie 📺' : 'Película 🎬';
      const scoreLabel = item.fuzzyScore ? `⭐ Match: ${Math.round(item.fuzzyScore)}%` : '';
      const encodedItem = encodeURIComponent(JSON.stringify(item));
      const cardKey = `search-card-${idx}`;

      let seasonSelector = '';
      if (isSeries) {
        if (Array.isArray(item.seasons) && item.seasons.length > 0) {
          const seasonOptions = item.seasons.map(sNum => `<option value="${sNum}">Temporada ${sNum}</option>`).join('');
          seasonSelector = `
            <select class="season-select" id="season-select-${cardKey}" onchange="handleSeasonChange(this)">
              <option value="all">🌟 Todas las temporadas (${item.seasons.length})</option>
              ${seasonOptions}
              <option value="custom">✏️ Rango personalizado (ej: 2-5)...</option>
            </select>
            <div class="custom-range-box" style="display: none;">
              <input type="text" class="custom-range-input" placeholder="Ej: 2-5 o 1, 3">
            </div>
          `;
        } else {
          // Placeholder dinámico que cargará asíncronamente las temporadas exactas de Sonarr
          seasonSelector = `
            <select class="season-select" id="season-select-${cardKey}" data-load-title="${encodeURIComponent(item.title)}" data-load-tvdb="${item.tvdbId || ''}" onchange="handleSeasonChange(this)">
              <option value="all">🌟 Todas las temporadas</option>
              <option value="1">Temporada 1</option>
              <option value="custom">✏️ Rango personalizado (ej: 2-5)...</option>
            </select>
            <div class="custom-range-box" style="display: none;">
              <input type="text" class="custom-range-input" placeholder="Ej: 2-5 o 1, 3">
            </div>
          `;
        }
      }

      return `
        <div class="search-card-item" id="${cardKey}">
          <img class="search-poster" src="${poster}" alt="${item.title}">
          <div class="search-card-body">
            <span class="search-card-title">${item.title}</span>
            <div class="search-card-meta">
              <span>${item.year || 'N/A'} • ${typeLabel}</span>
              <span style="color: var(--plex-gold)">${scoreLabel}</span>
            </div>
            ${seasonSelector}
            <div class="search-card-actions">
              <button class="btn-req" onclick="requestMedia('${encodedItem}', 'latino', this)">🇲🇽 Latino</button>
              <button class="btn-req" onclick="requestMedia('${encodedItem}', 'castellano', this)">🇪🇸 Cast.</button>
              <button class="btn-req" onclick="requestMedia('${encodedItem}', 'subtitulado', this)">🇬🇧 Sub</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Disparar carga de temporadas reales para los selects que las requieran
    loadDynamicSeasons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error al buscar: ${err.message}</div>`;
  }
}

// Carga asíncrona de temporadas reales para las tarjetas de series
async function loadDynamicSeasons() {
  const selects = document.querySelectorAll('.season-select[data-load-title]');
  for (const sel of selects) {
    const title = decodeURIComponent(sel.getAttribute('data-load-title') || '');
    const tvdbId = sel.getAttribute('data-load-tvdb') || '';
    if (!title) continue;

    fetch(`/api/series/seasons?title=${encodeURIComponent(title)}&tvdbId=${tvdbId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.seasons) && data.seasons.length > 0) {
          const currentVal = sel.value;
          const optionsHtml = [
            `<option value="all">🌟 Todas las temporadas (${data.seasons.length})</option>`,
            ...data.seasons.map(s => `<option value="${s.seasonNumber}">Temporada ${s.seasonNumber}</option>`),
            `<option value="custom">✏️ Rango personalizado (ej: 2-5)...</option>`
          ].join('');
          sel.innerHTML = optionsHtml;
          if (currentVal && Array.from(sel.options).some(o => o.value === currentVal)) {
            sel.value = currentVal;
          }
          sel.removeAttribute('data-load-title');
        }
      })
      .catch(() => {});
  }
}

// Control del input de rango personalizado en tarjetas de búsqueda
window.handleSeasonChange = function(sel) {
  const card = sel.closest('.search-card-item');
  if (!card) return;
  const rangeBox = card.querySelector('.custom-range-box');
  if (!rangeBox) return;
  if (sel.value === 'custom') {
    rangeBox.style.display = 'block';
    const input = rangeBox.querySelector('.custom-range-input');
    if (input) input.focus();
  } else {
    rangeBox.style.display = 'none';
  }
};

// 6. Solicitar Descarga desde la UI
window.requestMedia = async function(encodedItem, lang, btn = null) {
  const item = JSON.parse(decodeURIComponent(encodedItem));
  let selectedSeason = 'all';
  let formattedSeasonLabel = '';
  const isSeries = item.type === 'series' || item.type === 'tv';
  if (isSeries) {
    let sel = null;
    let card = null;
    if (btn && btn.closest) {
      card = btn.closest('.search-card-item');
      sel = card?.querySelector('.season-select');
    }
    if (!sel) {
      card = document.querySelector('.search-card-item');
      sel = card?.querySelector('.season-select');
    }
    if (sel && sel.value) {
      if (sel.value === 'custom') {
        const customInput = card?.querySelector('.custom-range-input');
        const customVal = customInput ? customInput.value.trim() : '';
        if (!customVal) {
          alert('Por favor, ingresa el rango de temporadas deseado (ej: 2-5 o 1, 3)');
          if (customInput) customInput.focus();
          return;
        }
        selectedSeason = customVal;
        formattedSeasonLabel = ` (Temporadas ${customVal})`;
      } else if (sel.value === 'all') {
        selectedSeason = 'all';
        formattedSeasonLabel = ' (Todas las temporadas)';
      } else {
        selectedSeason = sel.value;
        formattedSeasonLabel = ` (Temporada ${sel.value})`;
      }
    }
  }

  const seasonText = isSeries ? formattedSeasonLabel : '';
  if (!confirm(`¿Deseas ordenar la descarga de "${item.title}"${seasonText} en ${lang.toUpperCase()}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/request-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media: item,
        languageChoice: lang,
        seasonSelection: selectedSeason
      })
    });
    const data = await res.json();
    if (data.success) {
      const confirmLabel = data.seasonLabel ? ` (${data.seasonLabel})` : seasonText;
      alert(`✅ ¡Solicitud enviada! "${item.title}"${confirmLabel} se agregó a la cola de descarga.`);
      fetchDownloads();
      fetchRequests();
    } else {
      alert(`⚠️ Error: ${data.error}`);
    }
  } catch (err) {
    alert(`Error de red: ${err.message}`);
  }
};

// 7. Gestión de Whitelist
async function fetchWhitelist() {
  try {
    const res = await fetch('/api/whitelist');
    const data = await res.json();
    if (!data.success || !data.whitelist) return;

    const wl = data.whitelist;
    const toggle = document.getElementById('toggle-whitelist');
    const toggleText = document.getElementById('toggle-whitelist-text');
    if (toggle) {
      toggle.checked = wl.enabled;
      toggleText.textContent = wl.enabled ? 'Restricción Activa' : 'Modo Abierto (Cualquiera)';
    }

    const container = document.getElementById('whitelist-container');
    if (!container) return;

    if (!wl.numbers || wl.numbers.length === 0) {
      container.innerHTML = '<div class="empty-state">No hay números registrados en la whitelist. El bot atenderá a cualquier usuario.</div>';
      return;
    }

    container.innerHTML = wl.numbers.map(item => `
      <div class="whitelist-item">
        <div class="whitelist-item-info">
          <span class="whitelist-item-number">+${item.number}</span>
          <span class="whitelist-item-label">${item.label || 'Usuario Autorizado'}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeWhitelistNumber('${item.number}')">🗑️ Eliminar</button>
      </div>
    `).join('');
  } catch (err) {
    console.warn('Error obteniendo whitelist:', err);
  }
}

window.removeWhitelistNumber = async function(number) {
  if (!confirm(`¿Eliminar el número +${number} de la whitelist?`)) return;
  try {
    const res = await fetch('/api/whitelist/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number })
    });
    const data = await res.json();
    if (data.success) {
      fetchWhitelist();
      fetchStatus();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

// Reloj en tiempo real
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  fetchDownloads();
  fetchRequests();
  fetchLogs();
  fetchWhitelist();
  updateClock();

  // Formulario agregar whitelist
  const formAddWl = document.getElementById('form-add-whitelist');
  if (formAddWl) {
    formAddWl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const numInput = document.getElementById('whitelist-number-input');
      const labelInput = document.getElementById('whitelist-label-input');
      const number = numInput.value.trim();
      const label = labelInput.value.trim();

      if (!number) return;

      try {
        const res = await fetch('/api/whitelist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number, label })
        });
        const data = await res.json();
        if (data.success) {
          numInput.value = '';
          labelInput.value = '';
          fetchWhitelist();
          fetchStatus();
        } else {
          alert(`⚠️ ${data.error || 'Error al agregar número'}`);
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  }

  // Toggle whitelist
  const toggleWl = document.getElementById('toggle-whitelist');
  if (toggleWl) {
    toggleWl.addEventListener('change', async () => {
      try {
        const res = await fetch('/api/whitelist/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: toggleWl.checked })
        });
        const data = await res.json();
        if (data.success) {
          fetchWhitelist();
          fetchStatus();
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  }

  // Bucle de sondeo automático cada 3 segundos
  setInterval(() => {
    fetchStatus();
    fetchDownloads();
    fetchLogs();
    updateClock();
  }, 3000);

  // Sondeo de solicitudes cada 10 segundos
  setInterval(fetchRequests, 10000);

  // Buscador
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');

  searchBtn.addEventListener('click', () => {
    performSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performSearch(searchInput.value);
    }
  });

  // Forzar escaneo de Plex
  document.getElementById('btn-plex-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-plex-refresh');
    btn.style.opacity = '0.5';
    try {
      await fetch('/api/plex/refresh', { method: 'POST' });
      alert('🔄 Solicitud de escaneo enviada a Plex');
    } catch (_) {}
    setTimeout(() => btn.style.opacity = '1', 1000);
  });

  // Refrescar historial
  document.getElementById('refresh-requests-btn').addEventListener('click', fetchRequests);
});
