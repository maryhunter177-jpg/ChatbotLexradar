@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\LexRadar Bot Connector\scripts\Test-LexRadarConnector.ps1" -OpenReport
pause
