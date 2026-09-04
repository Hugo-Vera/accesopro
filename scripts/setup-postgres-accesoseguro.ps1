# AccesoSeguro - verificar PostgreSQL y crear la base fastalpr
# Uso (PowerShell como Administrador):
#   powershell -ExecutionPolicy Bypass -File C:\Users\Master\AccesoPro\scripts\setup-postgres-accesoseguro.ps1
#
# Si Chocolatey genero una clave aleatoria:
#   powershell -ExecutionPolicy Bypass -File ... -DbPassword "clave-de-choco" -SetPassword postgres

param(
  [string]$DbName = "fastalpr",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres",
  [string]$SetPassword = "",
  [string]$DbHost = "127.0.0.1",
  [int]$DbPort = 5432
)

if ($env:ACCESOSEGURO_PG_PASSWORD) {
  $DbPassword = $env:ACCESOSEGURO_PG_PASSWORD
}

function Find-Psql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    "C:\Program Files\PostgreSQL",
    "C:\Program Files (x86)\PostgreSQL"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem -Path $root -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

Write-Host "AccesoSeguro - setup PostgreSQL" -ForegroundColor Cyan

$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc -and $svc.Status -ne "Running") {
  Write-Host "Iniciando servicio $($svc.Name)..." -ForegroundColor Yellow
  Start-Service $svc.Name
}

$psql = Find-Psql
if (-not $psql) {
  Write-Host ""
  Write-Host "No encuentro PostgreSQL (psql)." -ForegroundColor Red
  Write-Host "Instalalo con Chocolatey (PowerShell como Admin):" -ForegroundColor Yellow
  Write-Host '  choco install postgresql18 -y --params "/Password:postgres"'
  exit 1
}

Write-Host "psql: $psql" -ForegroundColor Green
$env:PGPASSWORD = $DbPassword

$ping = & $psql -h $DbHost -p $DbPort -U $DbUser -d postgres -tAc "SELECT 1" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "No pude conectar a PostgreSQL en ${DbHost}:${DbPort}" -ForegroundColor Red
  Write-Host $ping
  Write-Host ""
  Write-Host "Busca la clave generada en la salida de choco install (Generated password: ...)" -ForegroundColor Yellow
  Write-Host "o en C:\Users\Master\AppData\Local\Temp\chocolatey\install-postgresql.log"
  Write-Host ""
  Write-Host "Luego ejecuta con TU clave real (no el texto de ejemplo):" -ForegroundColor Yellow
  Write-Host '  powershell -ExecutionPolicy Bypass -File C:\Users\Master\AccesoPro\scripts\setup-postgres-accesoseguro.ps1 -DbPassword TU_CLAVE -SetPassword postgres'
  exit 1
}

if ($SetPassword) {
  Write-Host "Cambiando clave del usuario postgres..." -ForegroundColor Yellow
  $escaped = $SetPassword -replace "'", "''"
  & $psql -h $DbHost -p $DbPort -U $DbUser -d postgres -c "ALTER USER postgres WITH PASSWORD '$escaped';"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "No se pudo cambiar la clave." -ForegroundColor Red
    exit 1
  }
  $env:PGPASSWORD = $SetPassword
  Write-Host "Clave actualizada a postgres." -ForegroundColor Green
}

$exists = & $psql -h $DbHost -p $DbPort -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'" 2>&1
if ($exists -match "1") {
  Write-Host "Base $DbName ya existe." -ForegroundColor Green
} else {
  Write-Host "Creando base $DbName..." -ForegroundColor Yellow
  & $psql -h $DbHost -p $DbPort -U $DbUser -d postgres -c "CREATE DATABASE $DbName;"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "No se pudo crear la base." -ForegroundColor Red
    exit 1
  }
  Write-Host "Base $DbName creada." -ForegroundColor Green
}

Write-Host ""
Write-Host "Listo. Ahora levanta el motor ALPR:" -ForegroundColor Cyan
Write-Host "  cd C:\Users\Master\AccesoPro\apps\site"
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  python run.py"
Write-Host ""
Write-Host "Panel motor: http://127.0.0.1:5051  (admin / admin)"
