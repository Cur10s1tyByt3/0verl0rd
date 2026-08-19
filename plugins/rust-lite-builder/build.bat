@echo off
setlocal
set "PLUGIN_ID=rust-lite-builder"
set "OUT=%~dp0%PLUGIN_ID%.zip"
if exist "%OUT%" del /q "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%~dp0config.json','%~dp0rust-lite-builder.html','%~dp0rust-lite-builder.css','%~dp0rust-lite-builder.js','%~dp0server.js' -DestinationPath '%OUT%' -Force"
if errorlevel 1 exit /b 1
echo [ok] %OUT%
