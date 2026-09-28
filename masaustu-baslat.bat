@echo off
title Fabrika Bakim Yonetimi (CMMS) - Masaustu Uygulamasi
cls

echo ================================================================
echo  Fabrika Bakim Yonetimi - Masaustu Uygulama Baslatici
echo ================================================================
echo.

:: 1. Backend klasorune gec
cd /d "%~dp0backend"

:: 2. Node.js sunucusunu kontrol et
netstat -ano | findstr :3001 | findstr LISTENING >nul
if %errorlevel% equ 0 goto start_browser

echo [1/2] API Sunucusu arka planda baslatiliyor...
start "CMMS API Sunucusu" /min cmd /c "npm start"
ping -n 4 127.0.0.1 >nul

:start_browser
echo [2/2] Masaustu penceresi aciliyor...

:: Masaustune kisayol olustur (varsa gec)
set "DESKTOP_LNK=%USERPROFILE%\Desktop\Fabrika Bakim Yonetimi.lnk"
if not exist "%DESKTOP_LNK%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_LNK%'); $s.TargetPath = '%~dp0masaustu-baslat.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0Fabrika Bakım Yönetimi.ico'; $s.Description = 'Fabrika Bakım Yönetimi CMMS Masaüstü Uygulaması'; $s.Save()" >nul 2>nul
  echo [BILGI] Masaustunuze "Fabrika Bakim Yonetimi" kisayolu olusturuldu.
)

:: Tarayicilari kontrol et ve Pencere Modunda (--app) ac
where msedge >nul 2>nul
if %errorlevel% equ 0 (
  start "" msedge --app=http://localhost:3001
  goto done
)

where chrome >nul 2>nul
if %errorlevel% equ 0 (
  start "" chrome --app=http://localhost:3001
  goto done
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3001
  goto done
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3001
  goto done
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=http://localhost:3001
  goto done
)

:: Standart tarayici ile ac
start http://localhost:3001

:done
exit /b 0
