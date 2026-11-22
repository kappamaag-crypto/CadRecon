#requires -Version 5.1
<#
.SYNOPSIS
  Experimental CadRecon Ultra Local installer with selectable directory.
.DESCRIPTION
  Windows 11, Python 3.11 prerequisite. Installs CPU PaddleOCR into a private
  venv, copies only project backend into the target folder and creates a
  loopback-only launcher for the consent-gated single-tenant API.
  This is not a signed, bundled, admin-free production one-click installer.
#>
[CmdletBinding()]
param(
  [string]$TargetDir = "",
  [switch]$NonInteractive,
  [switch]$SkipPaddleForTests
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stop-Setup([string]$message) {
  Write-Host ("CadRecon Ultra: " + $message) -ForegroundColor Red
  throw $message
}
function Find-Python311 {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if (-not $launcher) { Stop-Setup "Python launcher not found. Install Python 3.11 from python.org." }
  & py -3.11 -c "import sys; assert sys.version_info[:2] == (3, 11)" 2>$null
  if ($LASTEXITCODE -ne 0) { Stop-Setup "Python 3.11 is required. Install it before running this setup." }
}
function Select-InstallDirectory {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "Выберите папку для CadRecon Ultra (внутри появится подкаталог CadReconUltra)"
  $dlg.ShowNewFolderButton = $true
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Stop-Setup "Installation cancelled by user"
  }
  return (Join-Path $dlg.SelectedPath "CadReconUltra")
}
function Test-Target([string]$destination) {
  if ($destination.StartsWith("\\")) { Stop-Setup "UNC and network paths are not supported in this pilot." }
  $full = [System.IO.Path]::GetFullPath($destination)
  if ($full.Length -lt 7 -or $full -match '^[A-Za-z]:\\(Windows|Program Files)(\\|$)') {
    Stop-Setup "Choose a user-writable, non-system directory."
  }
  if (Test-Path (Join-Path $full "app\backend")) {
    Stop-Setup "Existing CadRecon Ultra installation detected. Setup will not overwrite it."
  }
  return $full
}
function Setup {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  if (-not (Test-Path (Join-Path $repoRoot "backend\online_server.py"))) {
    Stop-Setup "Run installer from the CadRecon repository (scripts folder)."
  }
  if (-not $TargetDir) {
    if ($NonInteractive) { Stop-Setup "Provide -TargetDir when -NonInteractive is set." }
    $TargetDir = Select-InstallDirectory
  }
  $folder = Test-Target $TargetDir
  Write-Host "CadRecon Ultra local pilot" -ForegroundColor Cyan
  Write-Host "Path: $folder"
  Write-Host "Server: http://127.0.0.1:8766 (only this PC)"
  Write-Host "Runtime: Python 3.11, CPU inference; OCR model weights require initial download."
  if (-not $NonInteractive) {
    $approval = Read-Host "Install in this folder? [Y/N]"
    if ($approval -notin @("y", "Y", "д", "Д")) { Stop-Setup "Installation cancelled." }
  }
  Find-Python311
  $drive = [System.IO.Path]::GetPathRoot($folder)
  $disk = New-Object System.IO.DriveInfo($drive)
  if ($disk.AvailableFreeSpace -lt 5GB) {
    Stop-Setup "Less than 5 GB free. The OCR models/virtual environment may be large."
  }
  $appDir = Join-Path $folder "app"
  $venv = Join-Path $appDir ".venv"
  $python = Join-Path $venv "Scripts\python.exe"
  foreach ($name in @("app", "models", "cache", "projects", "logs", "config")) {
    New-Item -Path (Join-Path $folder $name) -ItemType Directory -Force | Out-Null
  }
  try {
    Copy-Item -LiteralPath (Join-Path $repoRoot "backend") -Destination $appDir -Recurse -Force
    Write-Host "Creating isolated Python environment..."
    & py -3.11 -m venv $venv
    if ($LASTEXITCODE -ne 0) { Stop-Setup "Failed to create virtual environment." }
    & $python -m pip install --disable-pip-version-check --upgrade pip
    if ($LASTEXITCODE -ne 0) { Stop-Setup "pip bootstrap failed." }
    if (-not $SkipPaddleForTests) {
      & $python -m pip install --disable-pip-version-check paddlepaddle
      if ($LASTEXITCODE -ne 0) { Stop-Setup "PaddlePaddle CPU installation failed; check platform wheel support." }
      & $python -m pip install --disable-pip-version-check -r (Join-Path $appDir "backend\requirements.txt")
    } else {
      & $python -m pip install --disable-pip-version-check -r (Join-Path $appDir "backend\requirements-test.txt")
    }
    if ($LASTEXITCODE -ne 0) { Stop-Setup "Python dependencies could not be installed." }
    & $python -c "import fastapi, uvicorn, cv2, numpy; print('Runtime imports: OK')"
    if ($LASTEXITCODE -ne 0) { Stop-Setup "Runtime self-test failed." }

    # Always generate cryptographically secure bytes, never use pseudo random or a fixed token.
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes)
    $secretPath = Join-Path $folder "config\token.txt"
    [System.IO.File]::WriteAllText($secretPath,$token,[System.Text.UTF8Encoding]::new($false))
    # Restrict to current account; do not place the token into app/browser localStorage.
    & icacls $secretPath /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(R,W)" *> $null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $secretPath -Force -ErrorAction SilentlyContinue
      Stop-Setup "Failed to restrict token file access. Installation stopped."
    }

    $startPath = Join-Path $folder "Start-CadRecon-Ultra.cmd"
    $launch = @'
@echo off
setlocal
cd /d "%~dp0app"
set "PADDLE_HOME=%~dp0models"
set "PYTHONPATH=%~dp0app"
for /f "usebackq delims=" %%A in ("%~dp0config\token.txt") do set "CADRECON_ONLINE_TOKEN=%%A"
set "CADRECON_ONLINE_ORIGINS=https://kappamaag-crypto.github.io,http://localhost:5173,http://127.0.0.1:5173"
echo CadRecon Ultra is available on http://127.0.0.1:8766
"%~dp0app\.venv\Scripts\python.exe" -m uvicorn backend.online_server:app --host 127.0.0.1 --port 8766
echo Server stopped. Press any key.
pause >nul
'@
    [System.IO.File]::WriteAllText($startPath,$launch,[System.Text.Encoding]::ASCII)
    $state = [ordered]@{
      app="CadRecon Ultra";install_path=$folder;cpu_only=$true;
      pilot=$true;engine="PaddleOCR PP-OCRv5 + OpenCV";port=8766;
      created_at=(Get-Date).ToUniversalTime().ToString("o");
      warning="Not production SaaS; confirm consent in the browser."
    }
    $state|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $folder "config\install.json") -Encoding UTF8
    Write-Host "Installation completed." -ForegroundColor Green
    Write-Host "Start: $startPath"
    Write-Host "Browser: https://kappamaag-crypto.github.io/CadRecon/"
    Write-Host "URL: http://127.0.0.1:8766"
    Write-Host "Token file: $secretPath (keep private; paste into Online Accurate token field)"
    Write-Host "Use test drawings first; no guarantees of production CAD accuracy."
  } catch {
    Write-Warning ("Installation failed. Partial files remain at " + $folder)
    Write-Warning "Remove only the CadReconUltra folder after inspecting its contents."
    throw
  }
}
Setup
