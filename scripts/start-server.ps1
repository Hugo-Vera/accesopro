# AccesoPro — server real (producción / Docker), no modo simulado de desarrollo
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile dahua
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Profile full
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 -Native -Profile dahua
#
# Profiles:
#   core   → web + api (Docker)  |  nativo: next start + api
#   dahua  → core + agent Dahua (CGI real, openDoor, live, eventos)
#   alpr   → core + postgres + motor AccesoSeguro
#   full   → alpr + dahua
#
# Barreras: editá deploy\site.config.docker.yaml (type_in/out: ip|com, no simulated)

param(
  [ValidateSet("core", "dahua", "alpr", "full")]
  [string]$Profile = "dahua",

  [switch]$Native,
  [switch]$NoBuild,
  [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

if (-not (Test-Path "$Root\.env")) {
  if (Test-Path "$Root\.env.docker.example") {
    Copy-Item "$Root\.env.docker.example" "$Root\.env"
    Write-Host "Creado .env desde .env.docker.example — cambiá JWT_SECRET" -ForegroundColor Yellow
  } else {
    Copy-Item "$Root\.env.example" "$Root\.env"
  }
}

# Cargar .env simple (KEY=VALUE)
Get-Content "$Root\.env" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $parts = $_ -split '=', 2
  if ($parts.Count -eq 2) {
    $k = $parts[0].Trim()
    $v = $parts[1].Trim()
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

$env:NODE_ENV = "production"
$env:HOST = "0.0.0.0"
$env:NEXT_PUBLIC_API_URL = ""
$env:ACCESOPRO_API_URL = if ($env:ACCESOPRO_API_URL) { $env:ACCESOPRO_API_URL } else { "http://127.0.0.1:8787" }
$env:SITE_AGENT_URL = if ($env:SITE_AGENT_URL -and $Native) { $env:SITE_AGENT_URL } elseif ($Native) { "http://127.0.0.1:8790" } else { $env:SITE_AGENT_URL }
$env:SITE_ENGINE_URL = if ($Native) { "http://127.0.0.1:5051" } else { $env:SITE_ENGINE_URL }

if (-not $Native) {
  Write-Step "Docker Compose · profile=$Profile (producción)"

  $composeArgs = @("compose")
  if ($Profile -eq "dahua") { $composeArgs += @("--profile", "dahua") }
  elseif ($Profile -eq "alpr") { $composeArgs += @("--profile", "alpr") }
  elseif ($Profile -eq "full") { $composeArgs += @("--profile", "alpr", "--profile", "dahua") }

  if ($NoBuild) {
    $composeArgs += @("up", "-d")
  } else {
    $composeArgs += @("up", "-d", "--build")
  }

  & docker @composeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló ($LASTEXITCODE)" }

  Write-Ok "Stack arriba"
} else {
  Write-Step "Nativo producción · profile=$Profile"

  if (-not (Test-Path "$Root\node_modules")) {
    Write-Step "npm install"
    npm install
  }

  if (-not $NoBuild) {
    Write-Step "Build Next.js (standalone / start)"
    npm run build -w @accesopro/web
  }

  if (-not $SkipSeed) {
    Write-Step "Seed DB (si vacía)"
    npm run db:seed
  }

  $apiCmd = "cd '$Root'; `$env:NODE_ENV='production'; `$env:HOST='0.0.0.0'; `$env:SITE_AGENT_URL='http://127.0.0.1:8790'; `$env:SITE_ENGINE_URL='http://127.0.0.1:5051'; npm run start -w @accesopro/api"
  $webCmd = "cd '$Root'; `$env:NODE_ENV='production'; `$env:NEXT_PUBLIC_API_URL=''; `$env:API_INTERNAL_URL='http://127.0.0.1:8787'; npm run start -w @accesopro/web"

  Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCmd
  Start-Sleep -Seconds 2
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $webCmd

  if ($Profile -eq "dahua" -or $Profile -eq "full") {
    $agentDir = Join-Path $Root "apps\agent"
    $venvPy = Join-Path $agentDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPy)) {
      Write-Step "Creando venv agent"
      Push-Location $agentDir
      python -m venv .venv
      & .\.venv\Scripts\pip.exe install -r requirements.txt
      Pop-Location
    }
    $token = if ($env:SITE_AGENT_TOKEN) { $env:SITE_AGENT_TOKEN } else { "accesopro-demo-agent" }
    $agentCmd = "cd '$agentDir'; `$env:ACCESOPRO_API_URL='http://127.0.0.1:8787'; `$env:SITE_AGENT_TOKEN='$token'; & '.\.venv\Scripts\uvicorn.exe' app.main:app --host 0.0.0.0 --port 8790 --workers 1"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd
    Write-Ok "Agent Dahua :8790 (sin --reload)"
  }

  if ($Profile -eq "alpr" -or $Profile -eq "full") {
    Write-Host "Motor ALPR: levantá Postgres y luego:" -ForegroundColor Yellow
    Write-Host "  cd apps\site; .\.venv\Scripts\Activate.ps1; python run.py" -ForegroundColor Yellow
    Write-Host "Config real (no simulated): apps\site\config.yaml o deploy\site.config.real.example.yaml" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Dashboard:  http://localhost:3000" -ForegroundColor Green
Write-Host "API health: http://localhost:8787/health" -ForegroundColor Green
if ($Profile -eq "dahua" -or $Profile -eq "full") {
  Write-Host "Agent:      http://localhost:8790/health" -ForegroundColor Green
}
if ($Profile -eq "alpr" -or $Profile -eq "full") {
  Write-Host "ALPR:       http://localhost:5051" -ForegroundColor Green
}
Write-Host ""
Write-Host "Demo: admin@lasacacias.local / AccesoPro!2026" -ForegroundColor DarkGray
Write-Host "Parar Docker:  powershell -File scripts\stop-server.ps1" -ForegroundColor DarkGray
