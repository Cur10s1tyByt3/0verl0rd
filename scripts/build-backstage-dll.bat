@echo off
setlocal EnableDelayedExpansion
REM Build the BackstageInjection DLL for Windows x64 using cargo (GNU target).
REM The GNU toolchain is required: the reflective loader manually maps the image
REM without the MSVC CRT bootstrapping, and the MSVC CRT's TLS/CFG machinery
REM fast-fails (0xC0000409) under a manual map. The loader itself is pure Rust
REM (BackstageInjection-Rust/src/reflective.rs). Requires the
REM x86_64-pc-windows-gnu target.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI\"
set "CRATE_DIR=%ROOT%BackstageInjection-Rust"
set "OUT_DIR=%ROOT%Overlord-Server\dist-clients"
set "TARGET=x86_64-pc-windows-gnu"
set "DLL_NAME=BackstageInjection.x64.dll"

where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: cargo not found on PATH.
    exit /b 1
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

echo Building BackstageInjection DLL for %TARGET% ...
cargo build --release --target %TARGET% --manifest-path "%CRATE_DIR%\Cargo.toml"
if %ERRORLEVEL% neq 0 goto :error

set "SRC_DLL=%CRATE_DIR%\target\%TARGET%\release\BackstageInjection.dll"
if not exist "%SRC_DLL%" goto :error

copy /y "%SRC_DLL%" "%OUT_DIR%\%DLL_NAME%" >nul
if %ERRORLEVEL% neq 0 goto :error

echo.
echo Built: %OUT_DIR%\%DLL_NAME%
exit /b 0

:error
echo.
echo BUILD FAILED
exit /b 1