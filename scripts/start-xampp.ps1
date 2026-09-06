# AccesoPro con XAMPP (Apache como fachada) - sin Docker
#
# 1) Habilita mod_proxy_http en XAMPP
# 2) Instala VirtualHost :3080 -> Next :3000
# 3) Levanta API + Web (+ Agent Dahua) en nativo
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\start-xampp.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-xampp.ps1 -Profile dahua
#   powershell -ExecutionPolicy Bypass -File scripts\start-xampp.ps1 -Prod
#
# Entrar a: http://localhost:3080

param(
  [ValidateSet("core", "dahua")]
  [string]$Profile = "dahua",

  [string]$XamppRoot = "C:\xampp",

  [switch]$Prod
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }

if (-not (Test-Path $XamppRoot)) {
  throw "No encontre XAMPP en $XamppRoot. Usa -XamppRoot con la ruta correcta."
}

$httpd = Join-Path $XamppRoot "apache\conf\httpd.conf"
$extraDir = Join-Path $XamppRoot "apache\conf\extra"
$confTarget = Join-Path $extraDir "accesopro.conf"
$confSource = Join-Path $Root "deploy\xampp\accesopro.conf"

if (-not (Test-Path $httpd)) { throw "No esta httpd.conf en $httpd" }
if (-not (Test-Path $confSource)) { throw "Falta $confSource" }

Write-Step "Configurando Apache XAMPP"

Copy-Item $confSource $confTarget -Force
Write-Ok "Instalado $confTarget"

$httpdText = Get-Content $httpd -Raw
$changed = $false
if ($httpdText -match '(?m)^#LoadModule proxy_http_module') {
  $httpdText = $httpdText -replace '(?m)^#LoadModule proxy_http_module', 'LoadModule proxy_http_module'
  $changed = $true
  Write-Ok "Habilitado mod_proxy_http"
}
if ($httpdText -notmatch 'LoadModule proxy_module') {
  Write-Warn "mod_proxy no aparece cargado - revisa httpd.conf"
}
if ($httpdText -match '(?m)^#LoadModule headers_module') {
  $httpdText = $httpdText -replace '(?m)^#LoadModule headers_module', 'LoadModule headers_module'
  $changed = $true
  Write-Ok "Habilitado mod_headers"
}

$includeLine = 'Include "conf/extra/accesopro.conf"'
if ($httpdText -notmatch 'accesopro\.conf') {
  $httpdText = $httpdText.TrimEnd() + "`r`n`r`n# AccesoPro`r`n$includeLine`r`n"
  $changed = $true
  Write-Ok "Agregado Include accesopro.conf"
}

if ($changed) {
  $backup = "$httpd.accesopro.bak"
  if (-not (Test-Path $backup)) {
    Copy-Item $httpd $backup
    Write-Ok "Backup httpd -> $backup"
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($httpd, $httpdText, $utf8)
}

if (-not (Test-Path "$Root\.env")) {
  Copy-Item "$Root\.env.example" "$Root\.env"
  Write-Ok "Creado .env"
}

$envPath = "$Root\.env"
$envText = Get-Content $envPath -Raw
$origins = "http://localhost:3080,http://localhost:3000,http://127.0.0.1:3080,http://127.0.0.1:3000"
if ($envText -notmatch 'localhost:3080') {
  if ($envText -match '(?m)^WEB_ORIGIN=') {
    $envText = $envText -replace '(?m)^WEB_ORIGIN=.*', "WEB_ORIGIN=$origins"
  } else {
    $envText = $envText.TrimEnd() + "`r`nWEB_ORIGIN=$origins`r`n"
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($envPath, $envText, $utf8)
  Write-Ok "WEB_ORIGIN incluye :3080 (XAMPP)"
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

if ($Prod) {
  Write-Step "Build produccion"
  npm run build -w @accesopro/web
  $apiCmd = @"
cd '$Root'; `$env:NODE_ENV='production'; `$env:HOST='0.0.0.0'; `$env:WEB_ORIGIN='$origins'; `$env:SITE_AGENT_URL='http://127.0.0.1:8790'; npm run start -w @accesopro/api
"@
  $webCmd = @"
cd '$Root'; `$env:NODE_ENV='production'; `$env:NEXT_PUBLIC_API_URL=''; `$env:API_INTERNAL_URL='http://127.0.0.1:8787'; npm run start -w @accesopro/web
"@
} else {
  $apiCmd = @"
cd '$Root'; `$env:HOST='0.0.0.0'; `$env:WEB_ORIGIN='$origins'; `$env:SITE_AGENT_URL='http://127.0.0.1:8790'; npm run dev:api
"@
  $webCmd = @"
cd '$Root'; `$env:NEXT_PUBLIC_API_URL=''; `$env:API_INTERNAL_URL='http://127.0.0.1:8787'; npm run dev:web
"@
}

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

Write-Step "Apache XAMPP"
$httpdExe = Join-Path $XamppRoot "apache\bin\httpd.exe"
$apacheStart = Join-Path $XamppRoot "apache_start.bat"
if (Test-Path $httpdExe) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $testOut = & $httpdExe -t 2>&1
  Write-Host ($testOut | Out-String)
  # XAMPP suele NO instalarse como servicio: -k restart falla. Matar + apache_start.bat
  Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  if (Test-Path $apacheStart) {
    Start-Process -FilePath $apacheStart -WorkingDirectory $XamppRoot -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Ok "Apache reiniciado (escucha :3080)"
  } else {
    Write-Warn "Usa Stop + Start en XAMPP Control Panel para cargar :3080"
  }
  $ErrorActionPreference = $prevEap
} else {
  Write-Warn "Abri XAMPP Control Panel y dale Start a Apache"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  AccesoPro via XAMPP" -ForegroundColor Green
Write-Host "  http://localhost:3080" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Directo Next:  http://localhost:3000"
Write-Host "API health:    http://localhost:8787/health"
if ($Profile -eq "dahua") { Write-Host "Agent:         http://localhost:8790/health" }
Write-Host ""
Write-Host "Demo: admin@lasacacias.local / AccesoPro!2026" -ForegroundColor DarkGray
Write-Host "Espera ~15s a que Next compile y despues abre :3080" -ForegroundColor Yellow
