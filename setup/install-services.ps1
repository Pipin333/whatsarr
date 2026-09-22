# Script para instalar los servicios del stack multimedia en Windows mediante winget
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Instalador de Servicios Multimedia para Plex (Arr Stack)" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

$packages = @(
    @{ Name = "qBittorrent"; Id = "qBittorrent.qBittorrent" },
    @{ Name = "Radarr (Películas)"; Id = "TeamRadarr.Radarr" },
    @{ Name = "Sonarr (Series)"; Id = "TeamSonarr.Sonarr" },
    @{ Name = "Prowlarr (Buscador de Torrents)"; Id = "TeamProwlarr.Prowlarr" }
)

foreach ($pkg in $packages) {
    Write-Host "▶ Instalando $($pkg.Name)..." -ForegroundColor Yellow
    winget install --id $pkg.Id --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $($pkg.Name) instalado correctamente." -ForegroundColor Green
    } else {
        Write-Host "⚠️ Advertencia con $($pkg.Name) (código de salida: $LASTEXITCODE). Si ya estaba instalado, puedes continuar." -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Instalación completada." -ForegroundColor Green
Write-Host " Puertos web por defecto:" -ForegroundColor White
Write-Host " - qBittorrent:  http://localhost:8080 (habilitar WebUI en Opciones)" -ForegroundColor White
Write-Host " - Radarr:        http://localhost:7878" -ForegroundColor White
Write-Host " - Sonarr:        http://localhost:8989" -ForegroundColor White
Write-Host " - Prowlarr:      http://localhost:9696" -ForegroundColor White
Write-Host "=========================================================" -ForegroundColor Cyan
