# AccesoPro con Laragon (Nginx como fachada) - sin Docker
#
# 1) Instala vhost accesopro.test + alias /accesopro
# 2) Levanta API + Web en nativo
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\start-laragon.ps1
#
# Entrar a: http://localhost:8084/accesopro
#           http://127.0.0.1:3080/accesopro
# El :3000 de esta PC es GenieACS; el dashboard AccesoPro usa :3080.

param(
  [ValidateSet("core", "dahua")]
  [string]$Profile = "core",

  [string]$LaragonRoot = "C:\laragon"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }

if (-not (Test-Path $LaragonRoot)) {
  throw "No encontre Laragon en $LaragonRoot."
}

$sitesDir = Join-Path $LaragonRoot "etc\nginx\sites-enabled"
$aliasDir = Join-Path $LaragonRoot "etc\nginx\alias"
$vhostSrc = Join-Path $Root "deploy\laragon\accesopro.test.conf"
$aliasSrc = Join-Path $Root "deploy\laragon\alias-accesopro.conf"

if (-not (Test-Path $vhostSrc)) { throw "Falta $vhostSrc" }
if (-not (Test-Path $sitesDir)) { throw "No esta $sitesDir" }

Write-Step "Configurando Nginx Laragon"

Copy-Item $vhostSrc (Join-Path $sitesDir "accesopro.test.conf") -Force
Write-Ok "Vhost accesopro.test.conf"

$autoVhost = Join-Path $sitesDir "auto.accesopro.test.conf"
if (Test-Path $autoVhost) {
  Remove-Item $autoVhost -Force
  Write-Ok "Quitado auto.accesopro.test.conf (listaba el codigo fuente)"
}

if (Test-Path $aliasDir) {
  Copy-Item $aliasSrc (Join-Path $aliasDir "accesopro.conf") -Force
  Write-Ok "Alias /accesopro -> Next :3080"
}

if (-not (Test-Path "$Root\.env")) {
  Copy-Item "$Root\.env.example" "$Root\.env"
  Write-Ok "Creado .env"
}

$envPath = "$Root\.env"
$envText = Get-Content $envPath -Raw
$origins = "http://localhost:8084,http://127.0.0.1:8084,http://127.0.0.1:3080,http://localhost:3080,http://accesopro.test:8084"
if ($envText -notmatch 'localhost:8084') {
  if ($envText -match '(?m)^WEB_ORIGIN=') {
    $envText = $envText -replace '(?m)^WEB_ORIGIN=.*', "WEB_ORIGIN=$origins"
  } else {
    $envText = $envText.TrimEnd() + "`r`nWEB_ORIGIN=$origins`r`n"
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($envPath, $envText, $utf8)
  Write-Ok "WEB_ORIGIN incluye :8084 (Laragon)"
}

Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $parts = $_ -split '=', 2
  if ($parts.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

$env:HOST = "0.0.0.0"
$env:NEXT_PUBLIC_API_URL = ""
$env:API_INTERNAL_URL = "http://127.0.0.1:8787"
$env:SITE_AGENT_URL = "http://127.0.0.1:8790"
$env:ACCESOPRO_API_URL = "http://127.0.0.1:8787"

if (-not (Test-Path "$Root\node_modules")) {
  Write-Step "npm install"
  npm install
}

Write-Step "Levantando AccesoPro nativo ($Profile)"

$apiCmd = @"
cd '$Root'; `$env:HOST='0.0.0.0'; `$env:WEB_ORIGIN='$origins'; `$env:SITE_AGENT_URL='http://127.0.0.1:8790'; npm run dev:api
"@
$webCmd = @"
cd '$Root'; `$env:NEXT_PUBLIC_API_URL=''; `$env:API_INTERNAL_URL='http://127.0.0.1:8787'; `$env:NEXT_PUBLIC_BASE_PATH='/accesopro'; npx --workspace @accesopro/web next dev --hostname 0.0.0.0 --port 3080
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCmd
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $webCmd

if ($Profile -eq "dahua") {
  $agentDir = Join-Path $Root "apps\agent"
  $uvicorn = Join-Path $agentDir ".venv\Scripts\uvicorn.exe"
  if (-not (Test-Path $uvicorn)) {
    Write-Step "Preparando venv agent Dahua"
    Push-Location $agentDir
    python -m venv .venv
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    Pop-Location
  }
  $token = if ($env:SITE_AGENT_TOKEN) { $env:SITE_AGENT_TOKEN } else { "accesopro-demo-agent" }
  $agentCmd = @"
cd '$agentDir'; `$env:ACCESOPRO_API_URL='http://127.0.0.1:8787'; `$env:SITE_AGENT_TOKEN='$token'; & '.\.venv\Scripts\uvicorn.exe' app.main:app --host 0.0.0.0 --port 8790
"@
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd
  Write-Ok "Agent Dahua :8790"
}

Write-Step "Recargando Nginx"
$nginxDir = Get-ChildItem (Join-Path $LaragonRoot "bin\nginx") -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName "nginx.exe") } |
  Select-Object -First 1
if ($nginxDir) {
  $nginxExe = Join-Path $nginxDir.FullName "nginx.exe"
  Push-Location $nginxDir.FullName
  & $nginxExe -s reload 2>&1 | Out-Host
  Pop-Location
  Write-Ok "Nginx reload"
} else {
  Write-Warn "No encontre nginx.exe. En Laragon: Stop + Start a Nginx."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  AccesoPro via Laragon" -ForegroundColor Green
Write-Host "  http://localhost:8084/accesopro" -ForegroundColor Green
Write-Host "  http://127.0.0.1:3080/accesopro" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "API health:    http://localhost:8787/health"
if ($Profile -eq "dahua") { Write-Host "Agent:         http://localhost:8790/health" }
Write-Host ""
Write-Host "Demo: admin@lasacacias.local / AccesoPro!2026" -ForegroundColor DarkGray
Write-Host "Espera ~15s a que Next compile y despues abre la URL." -ForegroundColor Yellow
