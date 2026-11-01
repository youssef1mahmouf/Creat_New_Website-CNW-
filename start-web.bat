@echo off
echo ================================================
echo  CNW - Create New Website
echo  Starting Web Application
echo ================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking backend dependencies...
if not exist "backend\node_modules" (
    echo     Installing backend dependencies...
    cd backend
    call npm install
    if errorlevel 1 (
        echo     ❌ Failed to install backend dependencies
        pause
        exit /b 1
    )
    cd ..
) else (
    echo     ✓ Backend dependencies ready
)

echo.
echo [2/4] Checking frontend dependencies...
if not exist "frontend\node_modules" (
    echo     Installing frontend dependencies...
    cd frontend
    call npm install
    if errorlevel 1 (
        echo     ❌ Failed to install frontend dependencies
        pause
        exit /b 1
    )
    cd ..
) else (
    echo     ✓ Frontend dependencies ready
)

echo.
echo [3/4] Starting backend server (PORT 5000)...
cd backend
start "CNW Backend" cmd /k "node server.js"
cd ..

timeout /t 3 /nobreak >nul

echo.
echo [4/4] Starting frontend dev server (PORT 5173)...
cd frontend
start "CNW Frontend" cmd /k "npm run dev"
cd ..

echo.
echo ================================================
echo  ✓ Servers are starting...
echo.
echo  Frontend: http://localhost:5173
echo  Backend API: http://localhost:5000
echo.
echo  Open the frontend URL in your browser.
echo ================================================
echo.
echo Press any key to close this window (servers keep running)...
pause >nul
