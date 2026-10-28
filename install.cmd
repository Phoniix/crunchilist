@echo off
rem Installs or refreshes Kivori SekAI from the newest GitHub release into %%LOCALAPPDATA%%\KivoriSekAI.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install.ps1" %*
