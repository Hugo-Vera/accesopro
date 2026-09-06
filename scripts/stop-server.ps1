# AccesoPro — parar stack Docker (todos los perfiles)
param(
  [switch]$WipeVolumes
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$composeArgs = @("compose", "--profile", "alpr", "--profile", "dahua", "down")
if ($WipeVolumes) {
  $composeArgs += "-v"
  Write-Host "ATENCION: se borran volúmenes (SQLite API, Postgres, evidencias)" -ForegroundColor Red
}

& docker @composeArgs
Write-Host "Stack detenido." -ForegroundColor Green
Write-Host "Si corrías -Native, cerrá las ventanas de PowerShell de api/web/agent." -ForegroundColor DarkGray
