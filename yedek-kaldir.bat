@echo off
chcp 65001 >nul
schtasks /Delete /TN "FabrikaBakim-Gunluk-Yedek" /F
echo.
pause
