@echo off
rem Updates Kivori SekAI in this folder to the newest GitHub release. Your list and settings stay.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" %*
