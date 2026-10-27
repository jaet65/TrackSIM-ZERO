@echo off
title TrackSIM ZERO - Servicio Local Lander
color 0B
echo ========================================================
echo        TrackSIM ZERO - Servicio Local Lander DB
echo ========================================================
echo.
echo Verificando entorno Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] No se encontro Python en el sistema.
    echo Por favor asegurese de tener Python 3.10+ instalado.
    pause
    exit /b 1
)

echo Iniciando servicio de conexion en http://localhost:5005 ...
echo Presione Ctrl+C para detener el servicio.
echo.
python local_server.py
pause
