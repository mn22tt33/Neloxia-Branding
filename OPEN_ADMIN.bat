@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open_admin.ps1"
if errorlevel 1 (
  echo.
  echo تعذر فتح لوحة الإدارة.
  pause
)
