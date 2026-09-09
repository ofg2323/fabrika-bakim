@echo off
chcp 65001 >nul
title Fabrika Bakim Yonetimi (CMMS) - Canli Yayin
cls
echo ================================================================
echo  [CMMS] Fabrika Bakim Yonetimi - Guvenli Canli Tunel Baslatici
echo ================================================================
echo.

cd /d "%~dp0backend"

:: Node.js sunucusunun calisip calismadigini kontrol et, calismiyorsa baslat
netstat -ano | findstr :3001 | findstr LISTENING >nul
if %errorlevel% neq 0 (
    echo [1/2] Node.js API Sunucusu baslatiliyor (Port 3001)...
    start "CMMS API Sunucusu (Port 3001)" cmd /k "npm start"
    timeout /t 3 >nul
) else (
    echo [1/2] Node.js API Sunucusu zaten calisiyor (Port 3001).
)

echo [2/2] Cloudflare Guvenli Canli Tunel (HTTPS) baglantisi kuruluyor...
echo.
echo ================================================================
echo  Asagida beliren "https://...trycloudflare.com" linkini
echo  telefonunuzdan veya fabrikanin herhangi bir bilgisayarindan acabilirsiniz.
echo ================================================================
echo.

if exist "tools\cloudflared.exe" (
    tools\cloudflared.exe tunnel --protocol http2 --url http://localhost:3001
) else (
    cloudflared tunnel --protocol http2 --url http://localhost:3001
)
pause
