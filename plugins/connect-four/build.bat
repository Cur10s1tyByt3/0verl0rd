@echo off
setlocal

set "PLUGIN_DIR=%~dp0"
set "PLUGIN_NAME=connect-four"
set "ZIP_OUT=%PLUGIN_DIR%%PLUGIN_NAME%.zip"
set "DLL_OUT=%PLUGIN_DIR%%PLUGIN_NAME%-windows-amd64.dll"

where gcc >nul 2>&1
if errorlevel 1 (
  echo [error] gcc was not found
  exit /b 1
)
gcc -shared -O2 -s -o "%DLL_OUT%" "%PLUGIN_DIR%native\plugin.c" -luser32 -lgdi32
if errorlevel 1 (
  echo [error] Native build failed
  exit /b 1
)

for %%F in (config.json connect-four.html connect-four.css connect-four.js server.js connect-four-windows-amd64.dll) do (
  if not exist "%PLUGIN_DIR%%%F" (
    echo [error] Missing %%F
    exit /b 1
  )
)

if exist "%ZIP_OUT%" del /f /q "%ZIP_OUT%"
pushd "%PLUGIN_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path @('config.json','connect-four.html','connect-four.css','connect-four.js','server.js','connect-four-windows-amd64.dll') -DestinationPath '%ZIP_OUT%' -Force"
set "ZIP_STATUS=%ERRORLEVEL%"
popd
if not "%ZIP_STATUS%"=="0" exit /b %ZIP_STATUS%
echo [ok] %ZIP_OUT%
