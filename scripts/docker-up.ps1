# AccesoPro — Docker (Windows)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path ".env")) {
  Copy-Item ".env.docker.example" ".env"
  Write-Host "Creado .env desde .env.docker.example"
}

$profile = $args[0]
if ($profile -eq "alpr") {
  docker compose --profile alpr up -d --build
} elseif ($profile -eq "full") {
  docker compose --profile alpr --profile dahua up -d --build
} else {
  docker compose up -d --build
}

Write-Host "Dashboard http://localhost:3000 | API http://localhost:8787/health"
if ($profile -eq "alpr" -or $profile -eq "full") {
  Write-Host "Motor ALPR http://localhost:5051"
}
