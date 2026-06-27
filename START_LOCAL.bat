@echo off
setlocal
cd /d "%~dp0DEPLOY"
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  py -m http.server 8080
  exit /b
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python -m http.server 8080
  exit /b
)
echo Python was not found. Upload the contents of DEPLOY to the existing GitHub Pages repository instead.
pause
