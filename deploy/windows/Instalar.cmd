@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-LexRadarConnector.ps1"
if errorlevel 1 (
  echo.
  echo A instalacao falhou. Fotografe esta tela e envie ao suporte.
  pause
  exit /b 1
)
echo.
echo Instalacao concluida.
pause
