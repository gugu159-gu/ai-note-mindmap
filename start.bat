@echo off
rem ============================================================
rem  AI Note Tool - one click launcher
rem  NOTE: this file is intentionally ASCII-only and CRLF-terminated.
rem  cmd.exe parses .bat with the OEM codepage (936/GBK on zh-CN),
rem  so non-ASCII bytes here get garbled or break parsing.
rem  All Chinese messages live in start.ps1 (saved as UTF-8 BOM).
rem ============================================================
chcp 65001 >nul
title AI Note Tool
setlocal
set "ROOT=%~dp0"

if not exist "%ROOT%start.ps1" (
    echo [ERROR] start.ps1 not found next to this file.
    echo         expected: %ROOT%start.ps1
    pause
    exit /b 1
)

where pwsh.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start.ps1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start.ps1"
)

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [ERROR] launcher exited with code %RC%
echo.
pause
endlocal
