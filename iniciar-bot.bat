@echo off
setlocal enabledelayedexpansion
title Plex WhatsApp Bot - Control
cd /d "%~dp0"

set ARG=%~1
if /i "%ARG%"=="start" goto do_start
if /i "%ARG%"=="stop" goto do_stop
if /i "%ARG%"=="restart" goto do_restart
if /i "%ARG%"=="status" goto do_status

:check_status
powershell -NoProfile -Command "try { $res = Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    goto menu_running
) else (
    goto do_start
)

:menu_running
cls
color 0A
echo ===================================================
echo           Plex WhatsApp Bot - ONLINE
echo ===================================================
echo  El servicio ya se encuentra corriendo en segundo plano.
echo.
echo  [1] Abrir Dashboard Web (http://localhost:3001)
echo  [2] Reiniciar el bot (detener y volver a iniciar)
echo  [3] Detener el bot por completo
echo  [4] Ver registro de actividad en vivo (Logs)
echo  [0] Salir
echo.
set /p OPT="Selecciona una opcion (por defecto 1): "
if "%OPT%"=="" set OPT=1
if "%OPT%"=="1" goto open_web
if "%OPT%"=="2" goto do_restart
if "%OPT%"=="3" goto do_stop
if "%OPT%"=="4" goto show_logs
if "%OPT%"=="0" exit /b 0
goto menu_running

:do_start
cls
color 0B
echo ===================================================
echo          Iniciando Plex WhatsApp Bot
echo ===================================================
echo.
echo Iniciando proceso en segundo plano...
cscript //nologo start-background.vbs
echo Esperando confirmacion de conexion...
timeout /t 4 /nobreak >nul

powershell -NoProfile -Command "try { $res = Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 3; Write-Host ' [OK] Servidor Web: ONLINE (http://localhost:3001)' -ForegroundColor Green; Write-Host (' [OK] WhatsApp: ' + ($res.whatsapp.connected ? 'CONECTADO' : 'Iniciando...')) -ForegroundColor Green; Write-Host (' [OK] Sonarr:   ' + ($res.sonarr.ok ? 'CONECTADO' : 'No disponible')) -ForegroundColor Green; Write-Host (' [OK] Radarr:   ' + ($res.radarr.ok ? 'CONECTADO' : 'No disponible')) -ForegroundColor Green } catch { Write-Host ' [!] El bot esta arrancando... puedes verificar en unos segundos.' -ForegroundColor Yellow }"

echo.
echo Abriendo Dashboard en tu navegador...
start http://localhost:3001
echo.
echo Todo listo. Puedes cerrar esta ventana.
timeout /t 5
exit /b 0

:do_stop
cls
color 0C
echo ===================================================
echo          Deteniendo Plex WhatsApp Bot
echo ===================================================
echo.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src/index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Detenido proceso PID: ' + $_.ProcessId) -ForegroundColor Yellow }"
echo.
echo [OK] El servicio ha sido detenido.
timeout /t 3
exit /b 0

:do_restart
cls
color 0E
echo ===================================================
echo          Reiniciando Plex WhatsApp Bot
echo ===================================================
echo.
echo 1. Deteniendo instancias previas...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*src/index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul
echo 2. Iniciando servicio...
goto do_start

:open_web
start http://localhost:3001
exit /b 0

:show_logs
cls
color 07
echo ===================================================
echo       Registro en Vivo (data\bot.log)
echo          Presiona Ctrl+C para salir
echo ===================================================
echo.
if exist "data\bot.log" (
    powershell -NoProfile -Command "Get-Content -Path 'data\bot.log' -Tail 35 -Wait"
) else (
    echo Aun no existe el archivo data\bot.log
    pause
)
goto menu_running
