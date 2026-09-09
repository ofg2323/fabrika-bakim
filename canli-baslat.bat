@echo off
title Fabrika Bakim Yonetimi (CMMS) - Canli Yayin
cls

echo ================================================================
echo  Fabrika Bakim Yonetimi - Guvenli Canli Tunel Baslatici
echo ================================================================
echo.

cd /d "%~dp0backend"

:: 1. .env dosyasi kontrolu
if exist ".env" goto check_node_modules
echo [UYARI] backend\.env dosyasi bulunamadi!
echo Lutfen .env dosyasini backend klasorune kopyalayin.
echo.
pause
exit /b 1

:check_node_modules
:: 2. node_modules kontrolu
if exist "node_modules" goto check_cloudflared
echo [BILGI] Ilk kurulum: Bagimliliklar yukleniyor, lutfen bekleyin...
call npm install
if %errorlevel% neq 0 (
    echo [HATA] npm install basarisiz oldu. Node.js kurulu oldugundan emin olun.
    pause
    exit /b 1
)

:check_cloudflared
:: 3. Cloudflared kontrolu ve otomatik indirme
if exist "tools\cloudflared.exe" goto check_server
where cloudflared >nul 2>nul
if %errorlevel% equ 0 goto check_server

echo [BILGI] Cloudflare Tunnel araci hazirlaniyor, lutfen bekleyin...
if not exist "tools" mkdir "tools"
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'tools\cloudflared.exe'"
if not exist "tools\cloudflared.exe" (
    echo [HATA] Cloudflare Tunnel indirilemedi. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
)

:check_server
:: 4. Node.js sunucusunu baslat
netstat -ano | findstr :3001 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [1/2] Node.js API Sunucusu zaten calisiyor.
    goto start_tunnel
)

echo [1/2] Node.js API Sunucusu baslatiliyor - Port 3001...
start "CMMS API Sunucusu" cmd /k "npm start"
ping -n 4 127.0.0.1 >nul

:start_tunnel
echo [2/2] Cloudflare Guvenli Canli Tunel kuruluyor...
echo.
echo ================================================================
echo  Asagida beliren trycloudflare linkini
echo  telefonunuzdan veya herhangi bir bilgisayardan acabilirsiniz.
echo ================================================================
echo.

if exist "tools\cloudflared.exe" (
    tools\cloudflared.exe tunnel --protocol http2 --url http://localhost:3001
) else (
    cloudflared tunnel --protocol http2 --url http://localhost:3001
)

pause