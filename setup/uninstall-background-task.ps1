$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = Join-Path $StartupFolder "PlexWhatsAppBot.lnk"

Write-Host "Desinstalando inicio automático de Plex WhatsApp Bot..." -ForegroundColor Yellow

# Detener proceso
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src/index.js*' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Host "Detenido proceso PID: $($_.ProcessId)"
}

if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "✅ Acceso directo eliminado de shell:startup." -ForegroundColor Green
}

Write-Host "El bot ya no se iniciará automáticamente." -ForegroundColor Green
