@echo off
title Fabrika Bakim Yonetimi (CMMS) - Canli Yayin
cls

echo ================================================================
echo  Fabrika Bakim Yonetimi - Guvenli Canli Tunel Baslatici
echo ================================================================
echo.

:: 0. Zip icinden dogrudan calistirma kontrolu
echo "%~dp0" | findstr /i "\\AppData\\Local\\Temp" >nul
if %errorlevel% equ 0 goto err_temp_zip

:: 1. Node.js ve npm kontrolu
where node >nul 2>nul
if %errorlevel% neq 0 goto err_no_node
where npm >nul 2>nul
if %errorlevel% neq 0 goto err_no_node

:: 2. Klasor kontrolu
if not exist "%~dp0backend" goto err_no_backend
cd /d "%~dp0backend"

:: 3. .env dosyasi kontrolu
if not exist ".env" goto err_no_env

:: 4. node_modules kontrolu
if exist "node_modules" goto check_cloudflared
echo [BILGI] Ilk kurulum tespit edildi, bagimliliklar yukleniyor (npm install)...
call npm install
if %errorlevel% neq 0 goto err_npm_install

:check_cloudflared
:: 5. Cloudflared kontrolu ve otomatik indirme (TLS 1.2/1.3 guvenli indirme)
if exist "tools\cloudflared.exe" goto check_server
where cloudflared >nul 2>nul
if %errorlevel% equ 0 goto check_server

echo [BILGI] Cloudflare Tunnel araci indiriliyor, lutfen bekleyin...
if not exist "tools" mkdir "tools"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; try { (New-Object System.Net.WebClient).DownloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', 'tools\cloudflared.exe') } catch { exit 1 }"
if not exist "tools\cloudflared.exe" goto err_cloudflared

:check_server
:: 6. Node.js sunucusunu baslat
netstat -ano | findstr :3001 | findstr LISTENING >nul
if %errorlevel% equ 0 goto server_already_running

echo [1/2] Node.js API Sunucusu baslatiliyor - Port 3001...
start "CMMS API Sunucusu" cmd /k "npm start"
ping -n 4 127.0.0.1 >nul
goto start_tunnel

:server_already_running
echo [1/2] Node.js API Sunucusu zaten calisiyor - Port 3001.

:start_tunnel
echo [2/2] Cloudflare Guvenli Canli Tunel kuruluyor...
echo.
echo ================================================================
echo  Asagida beliren trycloudflare linkini
echo  telefonunuzdan veya herhangi bir bilgisayardan acabilirsiniz.
echo ================================================================
echo.

if exist "tools\cloudflared.exe" goto run_tools_tunnel
cloudflared tunnel --protocol http2 --url http://localhost:3001
goto tunnel_finished

:run_tools_tunnel
tools\cloudflared.exe tunnel --protocol http2 --url http://localhost:3001

:tunnel_finished
echo.
echo Tunel kapatildi veya sonlandi.
pause
exit /b 0

:err_temp_zip
echo.
echo ================================================================
echo [HATA] ZIP DOSYASINDAN DOGRUDAN CALISTIRILAMAZ!
echo ================================================================
echo Lutfen zip dosyasina sag tiklayip "Tumunu Ayikla" (veya "Klasore Cikar")
echo secenegini kullanarak klasore cikartin, ardindan o klasordeki
echo canli-baslat.bat dosyasini calistirin.
echo.
pause
exit /b 1

:err_no_node
echo.
echo ================================================================
echo [HATA] Bilgisayarinizda Node.js KURULU DEGIL!
echo ================================================================
echo Bu sunucuyu kendi bilgisayarinizda calistirmak icin Node.js gereklidir.
echo Lutfen https://nodejs.org adresinden LTS surumunu indirip kurun,
echo ardindan bu dosyayi tekrar calistirin.
echo.
pause
exit /b 1

:err_no_backend
echo.
echo ================================================================
echo [HATA] "backend" klasoru bulunamadi!
echo ================================================================
echo canli-baslat.bat ana proje dizininde olmalidir.
echo.
pause
exit /b 1

:err_no_env
echo.
echo ================================================================
echo [HATA] backend\.env yapilandirma dosyasi bulunamadi!
echo ================================================================
echo Veritabani baglantisi icin backend\.env dosyasi gereklidir.
echo Lutfen .env dosyasini backend klasorune yerlestirin.
echo.
pause
exit /b 1

:err_npm_install
echo.
echo ================================================================
echo [HATA] npm install basarisiz oldu!
echo ================================================================
echo Internet baglantinizi ve Node.js kurulumunuzu kontrol edin.
echo.
pause
exit /b 1

:err_cloudflared
echo.
echo ================================================================
echo [HATA] Cloudflare Tunnel araci indirilemedi!
echo ================================================================
echo Internet baglantinizi veya guvenlik duvari ayarlarini kontrol edin.
echo.
pause
exit /b 1