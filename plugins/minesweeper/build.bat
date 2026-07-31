@echo off
setlocal

set "PLUGIN_DIR=%~dp0"
set "PLUGIN_NAME=minesweeper"
set "ZIP_OUT=%PLUGIN_DIR%%PLUGIN_NAME%.zip"

for %%F in (config.json minesweeper.html minesweeper.css minesweeper.js server.js) do (
  if not exist "%PLUGIN_DIR%%%F" (
    echo [error] Missing %%F
    exit /b 1
  )
)

if exist "%ZIP_OUT%" del /f /q "%ZIP_OUT%"
pushd "%PLUGIN_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path @('config.json','minesweeper.html','minesweeper.css','minesweeper.js','server.js') -DestinationPath '%ZIP_OUT%' -Force"
set "ZIP_STATUS=%ERRORLEVEL%"
popd
if not "%ZIP_STATUS%"=="0" exit /b %ZIP_STATUS%

echo [ok] %ZIP_OUT%
