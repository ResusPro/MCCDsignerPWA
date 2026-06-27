@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if not %errorlevel%==0 (
  echo Node.js and npm are required to rebuild the source project.
  pause
  exit /b 1
)
call npm install
if not %errorlevel%==0 exit /b 1
call npm run build
if not %errorlevel%==0 exit /b 1
echo.
echo Build complete. The deployment-ready files are in dist.
pause
