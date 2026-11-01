# CNW Web Startup Script for Windows
# Run this from the project root: D:\cnw\Creat_New_Website(CNW)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$NpmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpmCommand) { throw "npm.cmd is not installed or not in PATH." }

Write-Host "=== CNW Web Startup ===" -ForegroundColor Cyan
Write-Host ""

# Function to install npm packages
function Install-NpmPackages($dir, $name) {
    Write-Host "Checking $name..." -ForegroundColor Yellow
    
    if (-not (Test-Path (Join-Path $dir "node_modules"))) {
        Write-Host "  Installing $name dependencies..." -ForegroundColor Gray
        & $NpmCommand --prefix $dir install --quiet
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ Failed to install $name" -ForegroundColor Red
            return $false
        }
        Write-Host "  ✓ $name installed" -ForegroundColor Green
    } else {
        Write-Host "  ✓ $name already installed" -ForegroundColor Green
    }
    return $true
}

# Install dependencies
$backendOk = Install-NpmPackages $BackendDir "Backend"
if (-not $backendOk) { exit 1 }

$frontendOk = Install-NpmPackages $FrontendDir "Frontend"
if (-not $frontendOk) { exit 1 }

Write-Host ""
Write-Host "=== Starting CNW Web ===" -ForegroundColor Cyan
Write-Host ""

# Start backend
Write-Host "Starting backend on http://localhost:5000..." -ForegroundColor Yellow
$backendProcess = Start-Process -FilePath "node" -ArgumentList "server.js" `
    -WorkingDirectory $BackendDir `
    -PassThru `
    -RedirectStandardOutput (Join-Path $env:TEMP "cnw-backend-out.log") `
    -RedirectStandardError (Join-Path $env:TEMP "cnw-backend-err.log")

Start-Sleep -Seconds 3

# Check if backend started
if (-not $backendProcess.HasExited) {
    Write-Host "✓ Backend started successfully" -ForegroundColor Green
    
    # Show backend logs
    if (Test-Path (Join-Path $env:TEMP "cnw-backend-out.log")) {
        $logs = Get-Content (Join-Path $env:TEMP "cnw-backend-out.log") -Tail 5
        if ($logs -match "server_started") {
            Write-Host "  Backend is running!" -ForegroundColor Green
        }
    }
} else {
    Write-Host "✗ Backend failed to start (exit code: $($backendProcess.ExitCode))" -ForegroundColor Red
    if (Test-Path (Join-Path $env:TEMP "cnw-backend-err.log")) {
        Write-Host "Error details:" -ForegroundColor Red
        Get-Content (Join-Path $env:TEMP "cnw-backend-err.log") | Select-Object -First 10
    }
    $backendProcess.Close()
    exit 1
}

# Start frontend
Write-Host ""
Write-Host "Starting frontend on http://localhost:5173..." -ForegroundColor Yellow
$frontendProcess = Start-Process -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js" `
    -WorkingDirectory $FrontendDir `
    -PassThru `
    -RedirectStandardOutput (Join-Path $env:TEMP "cnw-frontend-out.log") `
    -RedirectStandardError (Join-Path $env:TEMP "cnw-frontend-err.log")

Start-Sleep -Seconds 3

if (-not $frontendProcess.HasExited) {
    Write-Host "✓ Frontend started successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Frontend failed to start (exit code: $($frontendProcess.ExitCode))" -ForegroundColor Red
    if (Test-Path (Join-Path $env:TEMP "cnw-frontend-err.log")) {
        Write-Host "Error details:" -ForegroundColor Red
        Get-Content (Join-Path $env:TEMP "cnw-frontend-err.log") | Select-Object -First 10
    }
}

Write-Host ""
Write-Host "=== URLs ===" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Backend API: http://localhost:5000" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers" -ForegroundColor Yellow

# Keep running until user presses Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 1
        # Check if processes are still alive
        if ($backendProcess.HasExited) {
            Write-Host "`nBackend stopped unexpectedly" -ForegroundColor Red
            break
        }
        if ($frontendProcess.HasExited) {
            Write-Host "`nFrontend stopped unexpectedly" -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    if (-not $backendProcess.HasExited) { Stop-Process $backendProcess.Id -Force -ErrorAction SilentlyContinue }
    if (-not $frontendProcess.HasExited) { Stop-Process $frontendProcess.Id -Force -ErrorAction SilentlyContinue }
}
