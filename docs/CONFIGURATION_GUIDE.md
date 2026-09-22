# 🍿 Complete Setup Guide: Plex WhatsApp Bot

This guide provides step-by-step instructions to configure the complete automated media pipeline. Authorized friends or family members can request movies and TV series directly via WhatsApp, and the system downloads them automatically to your PC, notifying the user with cover posters and alerts when ready to watch on Plex.

---

## 🏗️ System Architecture

1. **WhatsApp Bot (Node.js & Baileys)**: Listens to incoming requests (e.g., *"I want to watch Inception"* or *"quiero ver Gladiator 2"*), normalizes the title with Google Gemini AI or local fuzzy logic, presents high-res poster and metadata, and asks for language/audio version.
2. **Radarr & Sonarr**: Automatic managers for movies and TV series that select optimal releases based on profile and scoring.
3. **Prowlarr**: Centralized indexer proxy that synchronizes public and private torrent trackers across Radarr and Sonarr.
4. **qBittorrent**: High-speed BitTorrent client operating via Web UI API (`http://localhost:8080`).
5. **Webhooks & Auto-Scan**: Once the download completes, Radarr/Sonarr triggers `http://localhost:3001/webhook`. The bot alerts Plex to refresh libraries and automatically sends a WhatsApp celebration message: *"🍿 Your request is ready on Plex! 🎬 Inception (2010)"*.

---

## Step 1: Automated Windows Installation (1 Minute)

An automated script is provided to install all 4 required applications via `winget`.

1. Open **PowerShell** as Administrator.
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup\install-services.ps1
   ```
   *(Or install manually: `winget install qBittorrent.qBittorrent TeamRadarr.Radarr TeamSonarr.Sonarr TeamProwlarr.Prowlarr`)*.

---

## Step 2: Service Configuration (One-Time Setup)

### 1. qBittorrent (Downloader)
1. Open **qBittorrent**.
2. Go to **Tools** $\rightarrow$ **Options** $\rightarrow$ **Web UI** tab.
3. Check **Web User Interface (Remote control)** on port `8080`.
4. Default credentials: User: `admin`, Password: `adminadmin` (or your chosen password).
5. In the **Connection** tab, consider unchecking **Use UPnP** if your local router experiences NAT port conflicts.

---

### 2. Prowlarr (Indexer Manager)
Open your browser at `http://localhost:9696`.
1. **Add Indexers / Trackers**:
   - Navigate to **Indexers** $\rightarrow$ **Add Indexer**.
   - For English / Global content: Add **1337x**, **YTS**, **EZTV**, **TorrentGalaxy**, **Limetorrents**.
   - For Spanish / Latin content: Add **DonTorrent**, **GranTorrent**, **DivxTotal**, etc.
2. **Link with Radarr & Sonarr**:
   - Navigate to **Settings** $\rightarrow$ **Apps** $\rightarrow$ click `+`.
   - Select **Radarr**:
     - Prowlarr Server: `http://localhost:9696`
     - Radarr Server: `http://localhost:7878`
     - API Key: Your Radarr API Key (from Radarr Settings $\rightarrow$ General).
   - Repeat the exact same step for **Sonarr** (`http://localhost:8989`).
   - Prowlarr will automatically sync all indexers with Radarr and Sonarr.

---

### 3. Radarr (Movies) & Sonarr (TV Shows)
Open Radarr at `http://localhost:7878` and Sonarr at `http://localhost:8989`.

1. **Root Folders (Media Destinations)**:
   - In Radarr: **Settings** $\rightarrow$ **Media Management** $\rightarrow$ **Root Folders** $\rightarrow$ Add your movie folder (e.g., `C:\Media\Movies`).
   - In Sonarr: **Settings** $\rightarrow$ **Media Management** $\rightarrow$ **Root Folders** $\rightarrow$ Add your TV folder (e.g., `C:\Media\TV`).
2. **Connect Download Client (qBittorrent)**:
   - In both Radarr and Sonarr: **Settings** $\rightarrow$ **Download Clients** $\rightarrow$ click `+` $\rightarrow$ select **qBittorrent**.
   - Host: `localhost` | Port: `8080`.
   - Username: `admin` | Password: your qBittorrent password.
   - Click **Test** and **Save**.
3. **Webhook Notifications (Callback to Bot)**:
   - In both Radarr and Sonarr: **Settings** $\rightarrow$ **Connect** $\rightarrow$ click `+` $\rightarrow$ select **Webhook**.
   - **Name**: `Plex WhatsApp Bot`
   - **Triggers**: Check ✅ **On Download** and ✅ **On Upgrade**.
   - **URL**: `http://localhost:3001/webhook`
   - **Method**: `POST`
   - Click **Test** and then **Save**.

---

### 4. Plex Media Server Token (Auto-Refresh)
To enable instant library scanning as soon as a download finishes:
- On Windows, the bot automatically reads the token from the Windows registry (`HKCU:\Software\Plex, Inc.\Plex Media Server`).
- Alternatively, you can explicitly set `PLEX_TOKEN=your_token` in your `.env` file.

---

## Step 3: Starting and Managing the Bot

### Control Script: `iniciar-bot.bat`
You only need to interact with `iniciar-bot.bat`:
- **If the bot is stopped**: Starts the background process invisibly, tests connectivity with WhatsApp/Radarr/Sonarr, and launches the Web UI Dashboard at `http://localhost:3001`.
- **If the bot is running**: Displays a clean command menu to view real-time logs, restart services, open the Web UI, or stop the bot.

```cmd
# Command line shortcuts:
iniciar-bot.bat start    # Start background service
iniciar-bot.bat restart  # Restart background service
iniciar-bot.bat stop     # Stop background service
```

### Windows Startup Daemon (Optional)
To have the bot launch automatically every time you log in to Windows:
1. Open **PowerShell** in the project folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup\install-background-task.ps1
   ```
2. A hidden shortcut will be created in `shell:startup`. To remove it later, run `uninstall-background-task.ps1`.

---

## Step 4: WhatsApp Device Pairing

1. In your terminal, run:
   ```powershell
   npm start
   ```
2. A QR code will be displayed in the terminal.
3. On your phone:
   - Open **WhatsApp** $\rightarrow$ **Settings** $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
   - Scan the QR code displayed on the screen.
4. Once connected, your credentials are saved in `data/auth_info_baileys/`. You can now close the terminal and run `iniciar-bot.bat`.
