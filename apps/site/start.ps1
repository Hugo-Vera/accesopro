# Activa el entorno virtual
if (Test-Path ".\.venv\Scripts\Activate.ps1") {
    .\.venv\Scripts\Activate.ps1
} else {
    Write-Host "No se encontró el entorno virtual en .venv"
}

# Lanza la aplicación
python run.py
