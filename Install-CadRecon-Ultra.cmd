@echo off
setlocal
cd /d "%~dp0"
echo CadRecon Ultra - installation in a folder of your choice.
echo Requires Python 3.11 and Windows 11. CPU build only.
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\install-ultra.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not complete. Inspect the message above.
  pause
  exit /b 1
)
echo Setup finished. Use Start-CadRecon-Ultra.cmd from your chosen folder.
pause
