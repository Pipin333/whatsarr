# 🍿 Guía Completa de Configuración: Plex WhatsApp Bot

Esta guía te explica paso a paso cómo dejar funcionando el flujo completo para que cualquier familiar pida películas o series por WhatsApp y se descarguen directamente a tu PC en `G:\Media\Peliculas` y `G:\Media\Series`, avisándoles con la portada y notificando cuando esté listo en Plex.

---

## 🏗️ Arquitectura General

1. **WhatsApp Bot (Node.js)**: Escucha pedidos ("quiero ver X"), busca la ficha oficial con póster y pregunta en qué idioma la quieren (1: Latino, 2: Castellano, 3: Subtitulado).
2. **Radarr / Sonarr**: Gestores automáticos de películas y series que buscan el mejor torrent según el idioma elegido.
3. **Prowlarr**: Central de sitios de torrents (incluye trackers de contenido en español y latino).
4. **qBittorrent**: Descarga los archivos a máxima velocidad.
5. **Webhook**: Al terminar la descarga, Radarr/Sonarr avisa a tu bot en `http://localhost:3001/webhook`, y el bot le envía un WhatsApp al familiar: *"🍿 ¡Tu película ya está lista en Plex!"*.

---

## Paso 1: Instalación Rápida con PowerShell (1 minuto)

Hemos preparado un script que instala automáticamente los 4 programas necesarios mediante `winget`.

1. Abre **PowerShell** como Administrador.
2. Ejecuta el script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup\install-services.ps1
   ```
   *(O bien instala manualmente: `winget install qBittorrent.qBittorrent TeamRadarr.Radarr TeamSonarr.Sonarr TeamProwlarr.Prowlarr`)*.

---

## Paso 2: Configuración de los Programas (Solo una vez)

### 1. qBittorrent (Descargador)
1. Abre **qBittorrent** en tu escritorio.
2. Ve a **Herramientas** $\rightarrow$ **Opciones** $\rightarrow$ pestaña **Web UI**.
3. Marca la casilla **Interfaz de usuario web (Control remoto)**.
4. Puerto: `8080` (por defecto).
5. Usuario: `admin`, Contraseña: la que prefieras (por defecto `adminadmin`).
6. En la pestaña **Descargas**, puedes dejar la carpeta temporal de descargas que desees.

---

### 2. Prowlarr (Buscador de Torrents)
Abre tu navegador en `http://localhost:9696`.
1. **Agregar Trackers / Sitios**:
   - Ve a **Indexers** $\rightarrow$ **Add Indexer**.
   - Para contenido en **Español / Latino**: Busca y añade trackers como **DonTorrent**, **GranTorrent**, **DivxTotal**, **EstrenosGo**.
   - Para contenido global: Añade **1337x**, **YTS**, **EZTV**, **TorrentGalaxy**.
2. **Vincular con Radarr y Sonarr**:
   - Ve a **Settings** $\rightarrow$ **Apps** $\rightarrow$ botón `+`.
   - Selecciona **Radarr**:
     - Prowlarr Server: `http://localhost:9696`
     - Radarr Server: `http://localhost:7878`
     - API Key: La API Key de Radarr (ver paso siguiente).
   - Haz lo mismo para **Sonarr** (`http://localhost:8989`).
   - *¡Listo! Prowlarr sincronizará todos los trackers automáticamente con Radarr y Sonarr.*

---

### 3. Radarr (Películas) y Sonarr (Series)
Abre Radarr en `http://localhost:7878` y Sonarr en `http://localhost:8989`.

#### A. Obtener la API Key:
- En Radarr: Ve a **Settings** $\rightarrow$ **General** $\rightarrow$ copia la **API Key**.
- En Sonarr: Ve a **Settings** $\rightarrow$ **General** $\rightarrow$ copia la **API Key**.
- Pega ambas llaves en tu archivo `.env`:
  ```env
  RADARR_API_KEY=tu_api_key_de_radarr_aqui
  SONARR_API_KEY=tu_api_key_de_sonarr_aqui
  ```

#### B. Conectar con qBittorrent:
- Ve a **Settings** $\rightarrow$ **Download Clients** $\rightarrow$ botón `+` $\rightarrow$ **qBittorrent**.
- Host: `localhost`, Puerto: `8080`, Usuario y contraseña de tu qBittorrent.

#### C. Configurar Carpetas Raíz:
- En Radarr: **Settings** $\rightarrow$ **Media Management** $\rightarrow$ **Root Folders** $\rightarrow$ Añade `G:\Media\Peliculas`.
- En Sonarr: **Settings** $\rightarrow$ **Media Management** $\rightarrow$ **Root Folders** $\rightarrow$ Añade `G:\Media\Series`.

#### D. Configurar el Webhook de Notificación hacia el Bot:
Para que cuando una película termine de descargarse se envíe el WhatsApp:
1. En Radarr (y lo mismo en Sonarr): Ve a **Settings** $\rightarrow$ **Connect** $\rightarrow$ botón `+` $\rightarrow$ selecciona **Webhook**.
2. Nombre: `Plex WhatsApp Bot`
3. Notificaciones a marcar:
   - ✅ **On Download**
   - ✅ **On Upgrade**
4. URL: `http://localhost:3001/webhook`
5. Método: `POST`
6. Haz clic en **Test** para comprobar la conexión y luego en **Save**.

---

## Paso 3: Configurar Plex Media Server

Abre tu servidor Plex en `http://localhost:32400/web`:
1. Ve a **Ajustes** $\rightarrow$ **Bibliotecas**.
2. Asegúrate de tener:
   - Biblioteca de **Películas** apuntando a: `G:\Media\Peliculas`
   - Biblioteca de **Series de TV** apuntando a: `G:\Media\Series`
3. En **Ajustes** $\rightarrow$ **Biblioteca**, activa:
   - ✅ **Escanear mi biblioteca automáticamente** (cuando detecte cambios de archivos).

---

## Paso 4: Iniciar el Bot de WhatsApp

1. Haz doble clic en el archivo `start-bot.bat` (o ejecuta `npm start`).
2. En la consola aparecerá un **Código QR**.
3. Abre WhatsApp en el teléfono que usarás para el bot (tu número secundario o personal):
   - Ve a **Ajustes / Configuración** $\rightarrow$ **Dispositivos Vinculados**.
   - Toca en **Vincular un dispositivo** y escanea el código QR de la pantalla.
4. En cuanto diga `🎉 ¡WHATSAPP CONECTADO EXITOSAMENTE!`, el bot ya estará 100% activo.

---

## 💬 Cómo Usarlo en WhatsApp

Cualquier familiar puede enviar un mensaje al bot (en privado o en un grupo de WhatsApp donde esté el bot):

1. **Petición**:
   > *"quiero ver Inception"*
   > o *"!pedir Gladiator 2"*

2. **Respuesta interactiva del Bot**:
   El bot responderá enviando la **imagen oficial del póster** con la ficha técnica y las opciones:
   ```text
   🎬 *Gladiator II (2024)* [Película]
   📖 Protagonistas: Paul Mescal, Denzel Washington...

   ¿En qué idioma la prefieres? Responde con el número:
   1️⃣ Español Latino 🇲🇽
   2️⃣ Español Castellano 🇪🇸
   3️⃣ Idioma Original con Subtítulos 🇬🇧
   0️⃣ Cancelar / No es esta
   ```

3. **El familiar responde**:
   > `1`

4. **Confirmación**:
   > *"✅ ¡Excelente! Buscando y agregando Gladiator II en Español Latino 🇲🇽 a la cola de descarga. Te avisaré por aquí apenas esté disponible en Plex. 🍿"*

5. **Aviso automático al terminar**:
   En cuanto qBittorrent termina de descargar y Radarr la guarda en `G:\Media\Peliculas`, el bot envía automáticamente:
   ```text
   🍿 *¡Tu pedido ya está listo en Plex!*
   🎬 *Gladiator II (2024)*
   ✨ Ya se encuentra disponible en tu servidor para ver cuando quieras. ¡A disfrutar! 🎉
   ```

---

## 🛠️ Herramientas de Prueba Incluidas

- **Probar búsqueda de portadas y películas**:
  ```powershell
  npm run test-search
  ```
- **Simular notificación de descarga completada**:
  ```powershell
  npm run test-webhook
  ```
- **Ver estado del bot**:
  Abre en tu navegador `http://localhost:3001/health` para ver el estado de WhatsApp y conexiones.
