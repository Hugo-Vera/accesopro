# AccesoPro con Laragon (Nginx como fachada) - sin Docker
#
# Preferi el comando npm (misma logica):
#   npm run local
#   npm run local:dahua
#
# Este script queda como atajo PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\start-laragon.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\start-laragon.ps1 -Profile dahua
#
# Entrar a: http://localhost:8084/accesopro
#           http://127.0.0.1:3080/accesopro
# El :3000 de esta PC es GenieACS; el dashboard AccesoPro usa :3080.

param(
  [ValidateSet("core", "dahua")]
  [string]$Profile = "core"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$extra = @()
if ($Profile -eq "dahua") { $extra += "--dahua" }

node (Join-Path $Root "scripts\dev-local.mjs") @extra
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
