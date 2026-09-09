@echo off
chcp 65001 >nul
title Fabrika Bakim Yonetimi (CMMS) - Canli Yayin
cls
echo ================================================================
echo  [CMMS] Fabrika Bakim Yonetimi - Guvenli Canli Tunel Baslatici
echo ================================================================
echo.

cd /d "%~dp0backend"

:: 1. .env dosyasi kontrolu
if not exist ".env" (
    echo [UYARI] backend\.env dosyasi bulunamadi!
    echo Lutfen .env dosyasini bu klasore (backend\) kopyalayin.
    echo.
    pause
    exit /b 1
)

:: 2. node_modules kontrolu
if not exist "node_modules" (
    echo [BILGI] Ilk kurulum tespit edildi, bagimliliklar yukleniyor (npm install)...
    call npm install
    if %errorlevel% neq 0 (
        echo [HATA] npm install basarisiz oldu. Node.js kurulu oldugundan emin olun.
        pause
        exit /b 1
    )
)

:: 3. Cloudflared kontrolu ve otomatik indirme
if not exist "tools\cloudflared.exe" (
    where cloudflared >nul 2>nul
    if %errorlevel% neq 0 (
        echo [BILGI] Cloudflare Tunnel araci hazirlaniyor, lutfen bekleyin...
        if not exist "tools" mkdir "tools"
        powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'tools\cloudflared.exe'"
        if not exist "tools\cloudflared.exe" (
            echo [HATA] Cloudflare Tunnel indirilemedi. Internet baglantinizi kontrol edin.
            pause
            exit /b 1
        )
    )
)

:: 4. Node.js sunucusunun calisip calismadigini kontrol et, calismiyorsa baslat
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
