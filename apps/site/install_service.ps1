# ==============================================================================
#  FastALPR - Instalador de Servicio de Windows (Autogestionado con NSSM)
# ==============================================================================
# Este script descarga NSSM, configura FastALPR para ejecutarse como un servicio
# de fondo de Windows y programa la auto-recuperacion ante caidas.
#
# REQUISITO: Ejecutar esta consola de PowerShell como ADMINISTRADOR.
# ==============================================================================

# 1. Verificar privilegios de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Este script requiere privilegios de ADMINISTRADOR."
    Write-Host "Re-lanzando script con permisos de Administrador..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

# 2. Configuración de Directorios y Rutas
$workDir = "C:\AccesoSeguro"
$serviceName = "FastALPR_AccessControl"
$displayName = "FastALPR Control de Acceso"
$description = "Servicio de control de acceso vehicular por ALPR + QR DNI (FastALPR). Autogestionado y auto-recuperable."

Write-Host "=== INICIANDO INSTALACION DE SERVICIO WINDOWS (FastALPR) ===" -ForegroundColor Cyan
Write-Host "Directorio de Trabajo: $workDir" -ForegroundColor White

# Detectar ruta de Python (preferir Entorno Virtual si existe)
$pythonPath = "$workDir\.venv\Scripts\python.exe"
if (-not (Test-Path $pythonPath)) {
    Write-Host "Entorno virtual no detectado en .venv. Buscando Python global..." -ForegroundColor Yellow
    $pythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $pythonPath) {
        Write-Error "No se pudo encontrar ningun ejecutable de Python. Instale Python e intente de nuevo."
        exit
    }
}
Write-Host "Ejecutable Python detectado: $pythonPath" -ForegroundColor Green

# 3. Descargar y Extraer NSSM (Non-Sucking Service Manager)
$nssmZipUrl = "https://nssm.cc/release/nssm-2.24.zip"
$nssmZipPath = "$workDir\nssm.zip"
$nssmExtractDir = "$workDir\nssm_temp"
$nssmExePath = "$workDir\nssm.exe"

if (-not (Test-Path $nssmExePath)) {
    Write-Host "Descargando NSSM desde $nssmZipUrl ..." -ForegroundColor Cyan
    try {
        # Configurar TLS 1.2
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $nssmZipUrl -OutFile $nssmZipPath -UseBasicParsing
        
        Write-Host "Extrayendo NSSM..." -ForegroundColor Cyan
        Expand-Archive -Path $nssmZipPath -DestinationPath $nssmExtractDir -Force
        
        # Copiar ejecutable de 64 bits a la raiz del proyecto
        Copy-Item -Path "$nssmExtractDir\nssm-2.24\win64\nssm.exe" -Destination $nssmExePath -Force
        Write-Host "NSSM instalado correctamente en $nssmExePath" -ForegroundColor Green
    }
    catch {
        Write-Error "Error al descargar o extraer NSSM: $_"
        # Limpieza ante fallo
        if (Test-Path $nssmZipPath) { Remove-Item $nssmZipPath -Force }
        if (Test-Path $nssmExtractDir) { Remove-Item $nssmExtractDir -Recurse -Force }
        exit
    }
    finally {
        # Limpiar archivos temporales
        if (Test-Path $nssmZipPath) { Remove-Item $nssmZipPath -Force }
        if (Test-Path $nssmExtractDir) { Remove-Item $nssmExtractDir -Recurse -Force }
    }
} else {
    Write-Host "NSSM ya se encuentra en el directorio raiz." -ForegroundColor Green
}

# 4. Registrar y Configurar el Servicio de Windows con NSSM
Write-Host ("Registrando servicio: " + $serviceName + "...") -ForegroundColor Cyan

# Eliminar servicio previo si existe
Start-Process -FilePath $nssmExePath -ArgumentList "remove $serviceName confirm" -Wait -NoNewWindow

# Instalar servicio
$installArgs = "install $serviceName `"$pythonPath`" `"$workDir\run.py`""
$process = Start-Process -FilePath $nssmExePath -ArgumentList $installArgs -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) {
    Write-Error "Fallo al registrar el servicio con NSSM."
    exit
}

# Configurar directorio de trabajo
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppDirectory `"$workDir`"" -Wait -NoNewWindow

# Configurar Nombre en pantalla y descripcion
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName DisplayName `"$displayName`"" -Wait -NoNewWindow
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName Description `"$description`"" -Wait -NoNewWindow

# Configurar tipo de inicio (Automatico)
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName Start SERVICE_AUTO_START" -Wait -NoNewWindow

# Configurar auto-recuperacion (Restart en 5 segundos ante fallos)
Write-Host "Configurando politicas de auto-recuperacion de Windows..." -ForegroundColor Cyan
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppExit Default Restart" -Wait -NoNewWindow
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppThrottle 5000" -Wait -NoNewWindow

# Redireccionar logs de salida y errores
$logsDir = "$workDir\logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppStdout `"$logsDir\service_stdout.log`"" -Wait -NoNewWindow
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppStderr `"$logsDir\service_stderr.log`"" -Wait -NoNewWindow
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppStdoutCreationDisposition 2" -Wait -NoNewWindow
Start-Process -FilePath $nssmExePath -ArgumentList "set $serviceName AppStderrCreationDisposition 2" -Wait -NoNewWindow

# 5. Iniciar el Servicio
Write-Host "Iniciando servicio de Windows..." -ForegroundColor Cyan
$startProcess = Start-Process -FilePath $nssmExePath -ArgumentList "start $serviceName" -PassThru -Wait -NoNewWindow

if ($startProcess.ExitCode -eq 0) {
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host " SERVICIO INSTALADO E INICIADO CON EXITO " -ForegroundColor Green
    Write-Host "=======================================================================" -ForegroundColor Green
    Write-Host "Nombre del Servicio: $serviceName" -ForegroundColor White
    Write-Host "Nombre de Pantalla:  $displayName" -ForegroundColor White
    Write-Host "Estado:              Ejecutandose en segundo plano (Auto-iniciable)" -ForegroundColor White
    Write-Host "Logs del servicio:   $logsDir\service_stdout.log" -ForegroundColor White
    Write-Host "=======================================================================" -ForegroundColor Green
} else {
    Write-Warning "El servicio se registro pero no pudo iniciarse de forma automatica."
    Write-Host ("Ejecute Start-Service " + $serviceName + " manualmente para probar.") -ForegroundColor Yellow
}
