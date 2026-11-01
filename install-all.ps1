$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not in PATH." }
$NpmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpmCommand) { throw "npm.cmd is not installed or not in PATH." }
Write-Host "Node.js: $(node --version)"
Write-Host "npm: $(& $NpmCommand --version)"
& $NpmCommand --prefix backend install
if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed (exit code $LASTEXITCODE)." }
& $NpmCommand --prefix frontend install
if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed (exit code $LASTEXITCODE)." }
& $NpmCommand --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit code $LASTEXITCODE)." }
Write-Host "DONE."
