# AccesoPro — arranque local (una máquina)
# Desde cualquier carpeta:
#   powershell -ExecutionPolicy Bypass -File C:\Users\Master\AccesoPro\scripts\start-accesopro.ps1
# O primero: cd C:\Users\Master\AccesoPro

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path "$Root\package.json")) {
  Write-Host "ERROR: No encuentro el proyecto en $Root" -ForegroundColor Red
  Write-Host "Usá la ruta completa:" -ForegroundColor Yellow
  Write-Host '  powershell -ExecutionPolicy Bypass -File C:\Users\Master\AccesoPro\scripts\start-accesopro.ps1'
  exit 1
}
Set-Location $Root
if (-not (Test-Path "$Root\.env")) {
  Copy-Item "$Root\.env.example" "$Root\.env"
  Write-Host "Creado .env desde .env.example"
}

$env:ACCESOPRO_API_URL = "http://127.0.0.1:8787"
$env:ACCESOPRO_BRIDGE_KEY = "accesopro-bridge"
$env:SITE_ENGINE_URL = "http://127.0.0.1:5051"

$env:HOST = "0.0.0.0"
$env:NEXT_PUBLIC_API_URL = ""

Write-Host "AccesoPro — levantando API (:8787) y Web (:3000) en 0.0.0.0"
Write-Host "Motor ALPR: cd apps\site && python run.py  (puerto 5051, si módulo alpr)"
Write-Host "Agent Dahua: cd apps\agent && uvicorn app.main:app --port 8790"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root'; `$env:HOST='0.0.0.0'; npm run dev:api"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root'; `$env:NEXT_PUBLIC_API_URL=''; npm run dev:web"

$zt = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -like '*ZeroTier*' -and $_.IPAddress -notlike '169.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host "Dashboard local: http://localhost:3000"
if ($zt) { Write-Host "Dashboard ZeroTier/LAN: http://${zt}:3000" }
Write-Host "API health: http://localhost:8787/health"
