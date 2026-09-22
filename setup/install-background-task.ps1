$ScriptDir = Split-Path -Parent $PSScriptRoot
$VbsPath = Join-Path $ScriptDir "start-background.vbs"
$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = Join-Path $StartupFolder "PlexWhatsAppBot.lnk"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   CONFIGURANDO INICIO AUTOMÁTICO EN SEGUNDO PLANO" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Detener instancias previas
Write-Host "Verificando instancias previas de node..."
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src/index.js*' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Host "Detenido proceso PID: $($_.ProcessId)" -ForegroundColor Yellow
}

# 2. Crear acceso directo en la carpeta de Inicio de Windows (shell:startup)
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$VbsPath`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "Inicia Plex WhatsApp Bot en segundo plano"
$Shortcut.WindowStyle = 7
$Shortcut.Save()

Write-Host "✅ Acceso directo creado en shell:startup." -ForegroundColor Green
Write-Host "El bot ahora se iniciará automáticamente con Windows sin ventanas." -ForegroundColor Green

# 3. Iniciar el bot en segundo plano ahora mismo
Write-Host "Iniciando servicio en segundo plano..." -ForegroundColor Cyan
Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $ScriptDir
Start-Sleep -Seconds 4

# 4. Comprobar salud
try {
    $res = Invoke-RestMethod -Uri "http://localhost:3001/health" -TimeoutSec 5
    Write-Host ""
    Write-Host "🎉 ¡SERVICIO EN SEGUNDO PLANO ACTIVO Y FUNCIONANDO!" -ForegroundColor Green
    Write-Host "WhatsApp conectado: $($res.whatsapp.connected)" -ForegroundColor Green
    Write-Host "Dashboard Web UI: http://localhost:3001" -ForegroundColor Cyan
} catch {
    Write-Host "Iniciando... Abre en unos segundos http://localhost:3001" -ForegroundColor Yellow
}
