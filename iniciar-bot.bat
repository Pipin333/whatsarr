@echo off
setlocal
title WhatsArr - Control del Bot
cd /d "%~dp0"

set ARG=%~1
if /i "%ARG%"=="start" goto do_start
if /i "%ARG%"=="stop" goto do_stop
if /i "%ARG%"=="restart" goto do_restart
if /i "%ARG%"=="status" goto do_status

:check_status
node scripts\service-manager.js is-running >nul 2>&1
if %errorlevel% equ 0 (
    goto menu_running
) else (
    goto do_start
)

:menu_running
cls
color 0A
echo ===================================================
echo           WhatsArr (Plex WhatsApp Bot) - ONLINE
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
echo          Iniciando WhatsArr (Plex Bot)
echo ===================================================
echo.
echo Iniciando proceso en segundo plano...
cscript //nologo start-background.vbs
echo Esperando confirmacion de servicios...
ping 127.0.0.1 -n 3 >nul

node scripts\service-manager.js check

echo.
echo Abriendo Dashboard en tu navegador...
start http://localhost:3001
echo.
echo Todo listo. Puedes cerrar esta ventana.
ping 127.0.0.1 -n 4 >nul
exit /b 0

:do_stop
cls
color 0C
echo ===================================================
echo          Deteniendo WhatsArr (Plex Bot)
echo ===================================================
echo.
node scripts\service-manager.js stop
echo.
echo [OK] El servicio ha sido detenido.
ping 127.0.0.1 -n 3 >nul
exit /b 0

:do_restart
cls
color 0E
echo ===================================================
echo          Reiniciando WhatsArr (Plex Bot)
echo ===================================================
echo.
echo 1. Deteniendo instancias previas...
node scripts\service-manager.js stop >nul 2>&1
ping 127.0.0.1 -n 2 >nul
echo 2. Iniciando servicio...
goto do_start

:do_status
node scripts\service-manager.js check
exit /b %errorlevel%

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
