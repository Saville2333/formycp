@echo off
chcp 65001 >nul
title Cthulhu Table - 本地预览
cd /d "%~dp0"
echo.
echo   正在启动 Cthulhu Table 本地预览...
echo   浏览器将自动打开 http://127.0.0.1:8000/
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8000
if errorlevel 1 (
  echo.
  echo 启动失败。请确认 8000 端口未被占用，或手动运行：
  echo   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
  pause
)
