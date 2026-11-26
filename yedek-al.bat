@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Yedek aliniyor...
echo.
node "backend\scripts\proje-yedek.js"
set CODE=%ERRORLEVEL%
echo.
if %CODE% neq 0 (
  echo Yedek alinamadi. Hata kodu: %CODE%
) else (
  echo Yedek basariyla olusturuldu: yedek\ klasoru
)
pause
exit /b %CODE%
