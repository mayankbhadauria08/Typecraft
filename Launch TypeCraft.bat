@echo off
REM TypeCraft launcher - opens the snapshot in your default browser.
REM Uses %~dp0 (this file's own folder), so the folder can be moved or
REM renamed and the launcher still works.

setlocal
set "PAGE=%~dp0index.html"

if not exist "%PAGE%" (
  echo.
  echo   Could not find index.html next to this launcher.
  echo   Expected it at: "%PAGE%"
  echo.
  echo   Keep this .bat in the same folder as index.html.
  echo.
  pause
  exit /b 1
)

start "" "%PAGE%"
endlocal
