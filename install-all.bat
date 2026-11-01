@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not in PATH.& echo Install Node.js LTS, then run this file again.& exit /b 1)
echo Node.js version:
node --version
echo npm version:
npm --version
echo.
echo Installing backend dependencies...
cd "backend"
npm install
if errorlevel 1 exit /b 1
echo.
echo Installing frontend dependencies...
cd "frontend"
npm install
if errorlevel 1 exit /b 1
echo.
echo Building frontend...
npm run build
if errorlevel 1 exit /b 1
echo.
echo DONE.
exit /b 0
