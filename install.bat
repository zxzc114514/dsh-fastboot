@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "LAUNCHER=%ROOT_DIR%scripts\launcher.ps1"
if exist "%LAUNCHER%" goto :run
echo [ERROR] Missing launcher script: "%LAUNCHER%"
pause
exit /b 1

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" install %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :failed
exit /b 0

:failed
exit /b %RC%
