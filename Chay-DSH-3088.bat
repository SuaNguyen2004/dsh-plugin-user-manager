@echo off
title DeepSeek Harness - Port 3088 (Multi-User)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3088" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

echo ========================================================
echo   Dang khoi dong DeepSeek Harness tren Port 3088
echo   Moi truong: Multi-User rieng biet (.dsh-multiuser)
echo   Plugin User Manager: Da tu dong kich hoat
echo ========================================================
set "DSH_HOME=C:\Users\Admin\.dsh-multiuser"
dsh web --port 3088
pause
