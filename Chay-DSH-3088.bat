@echo off
title DeepSeek Harness - Port 3088 (Multi-User)

echo ========================================================
echo   Dang kiem tra va giai phong Port 3088...
echo ========================================================
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3088 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo ========================================================
echo   Dang khoi dong DeepSeek Harness tren Port 3088
echo   Moi truong: Multi-User rieng biet (.dsh-multiuser)
echo   Plugin User Manager: Da tu dong kich hoat
echo ========================================================
set "DSH_HOME=C:\Users\Admin\.dsh-multiuser"
dsh web --port 3088
pause
